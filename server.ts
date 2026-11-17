import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

function md5Hex(input: string): string {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const cliPortIdx = process.argv.indexOf('--port');
const cliPort = cliPortIdx !== -1 ? Number(process.argv[cliPortIdx + 1]) : 0;
const PORT =
  (Number.isFinite(cliPort) && cliPort > 0 ? cliPort : 0) ||
  (process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000);

app.use(express.json({ limit: '5mb' }));

// Security headers (iframe-compatible for preview while enforcing XSS/MIME protections)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});

const botUsernameCache = new Map<string, string>();

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Persistent Server File Database (data/db.json) ----
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

interface MemberRecord {
  id: string;
  name: string;
  phone: string;
  phoneVerified: boolean;
  telegramUsername: string;
  telegramId?: string;
  telegramPhotoUrl?: string;
  telegramVerified: boolean;
  points: number;
  pinHash?: string;
  pinSalt?: string;
  tokenVersion?: number;
  createdAt: number;
  lastLoginAt: number;
}

interface AdminSecrets {
  adminPin: string;
  botToken: string;
  chatId: string;
  bakongToken: string;
  telegramGatewayToken: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  smsWebhookUrl: string;
  smsWebhookApiKey: string;
}

interface PersistedDatabase {
  sessionSecret: string;
  members: MemberRecord[];
  orders: Record<string, unknown>[];
  menuItems: Record<string, unknown>[] | null;
  toppings: Record<string, unknown>[] | null;
  shopSettings: Record<string, unknown> | null;
  secrets: AdminSecrets;
  lastTelegramUpdateOffset: number;
  usedPaymentRefs: string[];
}

function loadDatabase(): PersistedDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const defaultSecret =
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
      ? process.env.SESSION_SECRET
      : crypto.randomBytes(32).toString('hex');

  const defaults: PersistedDatabase = {
    sessionSecret: defaultSecret,
    members: [],
    orders: [],
    menuItems: null,
    toppings: null,
    shopSettings: null,
    secrets: {
      adminPin: process.env.ADMIN_PIN || '1234',
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      bakongToken: process.env.BAKONG_API_TOKEN || '',
      telegramGatewayToken: process.env.TELEGRAM_GATEWAY_TOKEN || '',
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
      twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
      smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
      smsWebhookApiKey: process.env.SMS_WEBHOOK_API_KEY || '',
    },
    lastTelegramUpdateOffset: 0,
    usedPaymentRefs: [],
  };

  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as Partial<PersistedDatabase>;
      return {
        ...defaults,
        ...parsed,
        sessionSecret:
          process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
            ? process.env.SESSION_SECRET
            : parsed.sessionSecret || defaultSecret,
        secrets: {
          ...defaults.secrets,
          ...(parsed.secrets || {}),
        },
        members: Array.isArray(parsed.members) ? parsed.members : [],
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        usedPaymentRefs: Array.isArray(parsed.usedPaymentRefs) ? parsed.usedPaymentRefs : [],
      };
    }
  } catch {
    // Fallback to clean initialized DB
  }

  saveDatabaseAtomic(defaults);
  return defaults;
}

function saveDatabaseAtomic(nextDb: PersistedDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(nextDb, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

const db = loadDatabase();
const SESSION_SECRET = db.sessionSecret;

// Indexes backed by persisted DB
const membersById = new Map<string, MemberRecord>();
const memberIdByPhone = new Map<string, string>();
const memberIdByTgId = new Map<string, string>();
const memberIdByTgUsername = new Map<string, string>();
const serverOrders = new Map<string, Record<string, unknown>>();

for (const m of db.members) {
  membersById.set(m.id, m);
  if (m.phone) memberIdByPhone.set(m.phone, m.id);
  if (m.telegramId) memberIdByTgId.set(m.telegramId, m.id);
  if (m.telegramUsername) memberIdByTgUsername.set(m.telegramUsername.toLowerCase(), m.id);
}
for (const o of db.orders) {
  if (o && typeof o.id === 'string') {
    serverOrders.set(o.id, o);
  }
}

function flushDb(): void {
  db.members = Array.from(membersById.values());
  db.orders = Array.from(serverOrders.values()).sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
  saveDatabaseAtomic(db);
}

// Ephemeral challenge & rate-limit stores
interface OtpChallenge {
  hash: string;
  salt: string;
  target: string;
  gatewayRequestId?: string;
  channel: 'telegram_gateway' | 'twilio' | 'sms_webhook';
  name: string;
  telegramUsername?: string;
  expiresAt: number;
  attempts: number;
}

interface TelegramLinkSession {
  nonce: string;
  mode: 'login' | 'contact';
  name?: string;
  memberId?: string;
  expectedPhone?: string;
  error?: string;
  createdAt: number;
  expiresAt: number;
  startedByTelegramId?: string;
  verifiedPhone?: string;
  verifiedUser?: {
    id: string;
    username: string;
    firstName: string;
  };
}

interface PaymentVerifySession {
  id: string;
  billNumber: string;
  md5: string;
  hasOfficialKhqr: boolean;
  expectedAmountUsd: number;
  expectedAmount: number;
  currency: 'USD' | 'KHR';
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'awaiting_owner' | 'verified' | 'amount_mismatch' | 'rejected';
  verifiedBy?: 'bakong_md5' | 'telegram_owner' | 'web_admin' | 'auto_slip_ocr' | 'slip_ref';
  paidAmount?: number;
  paidCurrency?: 'USD' | 'KHR';
  transactionRef?: string;
  bankName?: string;
  slipHash?: string;
  customerName?: string;
  customerPhone?: string;
  slipImg?: string;
  telegramChatId?: string;
  telegramMessageId?: number;
  telegramHasPhoto?: boolean;
  telegramSentAt?: number;
  error?: string;
}

const otpStore = new Map<string, OtpChallenge>();
const tgLinkStore = new Map<string, TelegramLinkSession>();
const paymentSessionStore = new Map<string, PaymentVerifySession>();
const revokedTokens = new Set<string>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const pinLockoutMap = new Map<string, { failures: number; lockedUntil: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) if (v.expiresAt < now) otpStore.delete(k);
  for (const [k, v] of tgLinkStore.entries()) if (v.expiresAt < now) tgLinkStore.delete(k);
  for (const [k, v] of paymentSessionStore.entries()) if (v.expiresAt < now) paymentSessionStore.delete(k);
  for (const [k, v] of rateLimitMap.entries()) if (v.resetAt < now) rateLimitMap.delete(k);
}, 60_000).unref();

// ---- Helper Functions ----
function getEffectiveBotToken(): string {
  return (db.secrets.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function getEffectiveChatId(): string {
  return (db.secrets.chatId || process.env.TELEGRAM_CHAT_ID || '').trim();
}

function getEffectiveBakongToken(): string {
  return (db.secrets.bakongToken || process.env.BAKONG_API_TOKEN || '').trim();
}

function getEffectiveBotUsername(): string {
  const fromSettings =
    db.shopSettings && typeof db.shopSettings.botUsername === 'string'
      ? db.shopSettings.botUsername
      : '';
  return (fromSettings || process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@+/, '').trim();
}

function getEffectiveGatewayToken(): string {
  return (db.secrets.telegramGatewayToken || process.env.TELEGRAM_GATEWAY_TOKEN || '').trim();
}

function getEffectiveTwilio() {
  return {
    sid: (db.secrets.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '').trim(),
    token: (db.secrets.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN || '').trim(),
    from: (db.secrets.twilioFromNumber || process.env.TWILIO_FROM_NUMBER || '').trim(),
  };
}

function getEffectiveSmsWebhook() {
  return {
    url: (db.secrets.smsWebhookUrl || process.env.SMS_WEBHOOK_URL || '').trim(),
    apiKey: (db.secrets.smsWebhookApiKey || process.env.SMS_WEBHOOK_API_KEY || '').trim(),
  };
}

function detectPhoneOtpChannel(): 'telegram_gateway' | 'twilio' | 'sms_webhook' | 'none' {
  if (getEffectiveGatewayToken()) return 'telegram_gateway';
  const tw = getEffectiveTwilio();
  if (tw.sid && tw.token && tw.from) return 'twilio';
  const wh = getEffectiveSmsWebhook();
  if (wh.url) return 'sms_webhook';
  return 'none';
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  const cur = rateLimitMap.get(key);
  if (!cur || cur.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (cur.count >= maxRequests) {
    return { allowed: false, retryAfterSec: Math.ceil((cur.resetAt - now) / 1000) };
  }
  cur.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function normalizePhone(raw: string): string {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (digits.startsWith('0')) digits = '+855' + digits.slice(1);
  else if (!digits.startsWith('+')) {
    digits = digits.startsWith('855') ? '+' + digits : '+855' + digits;
  }
  return digits;
}

function isValidPhone(normalized: string): boolean {
  return /^\+\d{8,15}$/.test(normalized);
}

function sanitizeText(val: unknown, maxLen = 80): string {
  return String(val || '').replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function normalizeTgUsername(raw: unknown): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
  return cleaned ? `@${cleaned}` : '';
}

function hashOtp(otp: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${otp}:${SESSION_SECRET}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

interface TokenPayload {
  sub: string;
  role: 'member' | 'admin';
  ver?: number;
  jti: string;
  iat: number;
  exp: number;
}

function signSessionToken(
  sub: string,
  role: 'member' | 'admin',
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  ver?: number
): string {
  const now = Date.now();
  const payload: TokenPayload = {
    sub,
    role,
    ...(typeof ver === 'number' ? { ver } : {}),
    jti: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string | undefined): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  try {
    const bufSig = Buffer.from(sig);
    const bufExp = Buffer.from(expectedSig);
    if (bufSig.length !== bufExp.length || !crypto.timingSafeEqual(bufSig, bufExp)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    if (revokedTokens.has(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

interface PaymentProofPayload {
  sid: string;
  amtUsd: number;
  amtCur: number;
  cur: 'USD' | 'KHR';
  by: 'bakong_md5' | 'telegram_owner' | 'web_admin' | 'auto_slip_ocr' | 'slip_ref';
  md5: string;
  ref: string;
  bankName?: string;
  slipHash?: string;
  iat: number;
  exp: number;
}

function signPaymentProofToken(sess: PaymentVerifySession): string {
  const now = Date.now();
  const payload: PaymentProofPayload = {
    sid: sess.id,
    amtUsd: Number(sess.expectedAmountUsd.toFixed(2)),
    amtCur: sess.paidAmount ?? sess.expectedAmount,
    cur: sess.paidCurrency || sess.currency,
    by: sess.verifiedBy || 'slip_ref',
    md5: sess.md5,
    ref: sess.transactionRef || sess.billNumber,
    bankName: sess.bankName,
    slipHash: sess.slipHash,
    iat: now,
    exp: now + 30 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`pay1:${encoded}`)
    .digest('base64url');
  return `pay1.${encoded}.${sig}`;
}

interface AnalyzedSlipResult {
  isBankReceipt: boolean;
  transferStatus: 'SUCCESS' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  bankName: string;
  paidAmount: number;
  currency: 'USD' | 'KHR' | 'OTHER';
  transactionId: string;
  recipientName: string;
  recipientAccount: string;
  receiptDateYmd: string;
  receiptTimeHm: string;
  appearsTampered: boolean;
  summaryKm: string;
}

function getEffectiveGeminiKey(): string {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY' || key.startsWith('YOUR_')) return '';
  return key;
}

function computeSlipSha256(dataUri: string): string {
  const m = dataUri.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const raw = m ? Buffer.from(m[1], 'base64') : Buffer.from(dataUri, 'utf8');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function formatPhnomPenhDateTime(tsMs: number): { ymd: string; hm: string; display: string } {
  const shifted = new Date(tsMs + 7 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return { ymd: `${y}-${m}-${d}`, hm: `${hh}:${mm}`, display: `${y}-${m}-${d} ${hh}:${mm} (UTC+7)` };
}

function getShopMerchantHints(settings: Record<string, unknown> | null): string[] {
  if (!settings) return [];
  const rawFields = [
    settings.khqrMerchantName,
    settings.brandTitle,
    settings.shopName,
    settings.khqrBakongId,
    settings.bankInfo,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  const tokens = rawFields
    .toLowerCase()
    .split(/[^a-z0-9\u1780-\u17ff]+/)
    .filter((t) => (/^\d+$/.test(t) ? t.length >= 4 : t.length >= 3))
    .filter((t) => !['cafe', 'coffee', 'shop', 'aba', 'bakong', 'khqr', 'pay', 'bank', 'acleda', 'wing'].includes(t));
  return Array.from(new Set(tokens));
}

function doesRecipientMatchShop(
  merchantHints: string[],
  recipientName: string,
  recipientAccount: string
): boolean {
  if (!merchantHints.length) return true;
  const combined = `${recipientName || ''} ${recipientAccount || ''}`.toLowerCase();
  const cleanCombinedDigits = combined.replace(/\D/g, '');
  if (!combined.trim() || combined.trim().length < 3) return true;
  for (const hint of merchantHints) {
    if (/^\d+$/.test(hint)) {
      const tail = hint.slice(-4);
      if (cleanCombinedDigits.includes(tail)) return true;
    } else if (combined.includes(hint)) {
      return true;
    }
  }
  return false;
}

async function analyzeBankSlipWithGemini(
  apiKey: string,
  dataUri: string,
  sess: PaymentVerifySession
): Promise<AnalyzedSlipResult> {
  const m = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) {
    throw new Error('ទម្រង់រូបភាពវិក្កយបត្រមិនត្រឹមត្រូវទេ');
  }
  const mimeType = m[1];
  const base64Data = m[2];
  const nowPP = formatPhnomPenhDateTime(Date.now());
  const merchantHints = getShopMerchantHints(db.shopSettings);

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = [
    'Analyze this uploaded bank transfer receipt / payment slip image strictly for anti-fraud verification in Cambodia.',
    `Expected payment amount: ${sess.expectedAmount} ${sess.currency} (or USD $${sess.expectedAmountUsd.toFixed(2)}).`,
    merchantHints.length ? `Expected shop recipient keywords/account: ${merchantHints.join(', ')}.` : '',
    `Current Cambodia time: ${nowPP.display}.`,
    'Rules:',
    '1. isBankReceipt=true ONLY if this is an authentic completed banking/e-wallet payment confirmation receipt (ABA, ACLEDA, Bakong, Wing, Canadia, Sathapana, Prince, Chip Mong, Vattanac, KB Prasac, Phillip Bank, etc.). A KHQR scan-to-pay screen BEFORE payment is NOT a receipt (isBankReceipt=false). Random photos/text notes are NOT receipts.',
    '2. transferStatus: SUCCESS only if clearly marked completed/successful/paid. PENDING, FAILED, or UNKNOWN otherwise.',
    '3. Extract exact numeric paidAmount and currency (USD or KHR or OTHER) printed on the receipt. Never guess.',
    '4. Extract transactionId (Trx ID / Ref / Hash / Trace No) printed on the receipt, recipientName, recipientAccount.',
    '5. Extract receiptDateYmd (YYYY-MM-DD) and receiptTimeHm (24h HH:MM) converted if AM/PM is shown, or empty string if absent.',
    '6. Set appearsTampered=true if digits/text look edited, pasted over, mismatched fonts, blurred/cropped out amount or status, or artificially altered.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: prompt },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isBankReceipt: { type: Type.BOOLEAN },
          transferStatus: { type: Type.STRING, enum: ['SUCCESS', 'PENDING', 'FAILED', 'UNKNOWN'] },
          bankName: { type: Type.STRING },
          paidAmount: { type: Type.NUMBER },
          currency: { type: Type.STRING, enum: ['USD', 'KHR', 'OTHER'] },
          transactionId: { type: Type.STRING },
          recipientName: { type: Type.STRING },
          recipientAccount: { type: Type.STRING },
          receiptDateYmd: { type: Type.STRING },
          receiptTimeHm: { type: Type.STRING },
          appearsTampered: { type: Type.BOOLEAN },
          summaryKm: { type: Type.STRING },
        },
        required: [
          'isBankReceipt',
          'transferStatus',
          'bankName',
          'paidAmount',
          'currency',
          'transactionId',
          'recipientName',
          'recipientAccount',
          'receiptDateYmd',
          'receiptTimeHm',
          'appearsTampered',
          'summaryKm',
        ],
      },
    },
  });

  const rawText = (response.text || '{}').trim();
  return JSON.parse(rawText) as AnalyzedSlipResult;
}

function validateReceiptAgainstSession(
  ocr: AnalyzedSlipResult,
  sess: PaymentVerifySession,
  slipHash: string,
  manualRef: string
): { ok: true; paidAmount: number; paidCurrency: 'USD' | 'KHR'; effectiveRef: string; bankName: string } | {
  ok: false;
  httpStatus: number;
  status: 'amount_mismatch' | 'rejected';
  error: string;
} {
  if (!ocr.isBankReceipt) {
    return {
      ok: false,
      httpStatus: 400,
      status: 'rejected',
      error: ocr.summaryKm || 'រូបភាពនេះមិនមែនជាវិក្កយបត្រវេរលុយជោគជ័យពីធនាគារទេ! សូម Upload រូបវិក្កយបត្រវេរប្រាក់ពិតប្រាកដ។',
    };
  }
  if (ocr.appearsTampered) {
    return {
      ok: false,
      httpStatus: 400,
      status: 'rejected',
      error: 'ប្រព័ន្ធសុវត្ថិភាពរកឃើញថារូបវិក្កយបត្រនេះមានសញ្ញាកែសម្រួល ឬមិនច្បាស់លាស់! សូម Upload រូបដើម ឬផ្ញើជូនម្ចាស់ហាងពិនិត្យ។',
    };
  }
  if (ocr.transferStatus !== 'SUCCESS') {
    return {
      ok: false,
      httpStatus: 400,
      status: 'rejected',
      error: `ស្ថានភាពប្រតិបត្តិការណ៍លើវិក្កយបត្រមិនទាន់ជោគជ័យទេ (${ocr.transferStatus})!`,
    };
  }

  const paidAmt = Number(ocr.paidAmount || 0);
  if (!Number.isFinite(paidAmt) || paidAmt <= 0 || ocr.currency === 'OTHER') {
    return {
      ok: false,
      httpStatus: 400,
      status: 'amount_mismatch',
      error: 'មិនអាចអានចំនួនទឹកប្រាក់ និងរូបិយប័ណ្ណច្បាស់លើវិក្កយបត្របានទេ!',
    };
  }

  const khrRate = Number(db.shopSettings?.khqrKhrRate || 4100) || 4100;
  let paidMatches = false;
  if (ocr.currency === sess.currency) {
    const tol = sess.currency === 'KHR' ? 100 : 0.01;
    paidMatches = paidAmt + tol >= sess.expectedAmount;
  } else {
    const paidUsd = ocr.currency === 'KHR' ? paidAmt / khrRate : paidAmt;
    paidMatches = paidUsd + 0.02 >= sess.expectedAmountUsd;
  }

  if (!paidMatches) {
    const readStr =
      ocr.currency === 'KHR' ? `${Math.round(paidAmt).toLocaleString()} ៛` : `$${paidAmt.toFixed(2)}`;
    const reqStr =
      sess.currency === 'KHR'
        ? `${Math.round(sess.expectedAmount).toLocaleString()} ៛ ($${sess.expectedAmountUsd.toFixed(2)})`
        : `$${sess.expectedAmountUsd.toFixed(2)}`;
    return {
      ok: false,
      httpStatus: 400,
      status: 'amount_mismatch',
      error: `ចំនួនលុយលើវិក្កយបត្រមិនគ្រប់ទេ! អានឃើញ ${readStr} ≠ ត្រូវបង់ ${reqStr}`,
    };
  }

  const merchantHints = getShopMerchantHints(db.shopSettings);
  if (!doesRecipientMatchShop(merchantHints, ocr.recipientName, ocr.recipientAccount)) {
    return {
      ok: false,
      httpStatus: 400,
      status: 'rejected',
      error: `ឈ្មោះអ្នកទទួលលើវិក្កយបត្រ (${ocr.recipientName || ocr.recipientAccount}) មិនត្រូវគ្នានឹងគណនីហាងទេ!`,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(ocr.receiptDateYmd || '')) {
    const [yy, mm, dd] = ocr.receiptDateYmd.split('-').map(Number);
    const hasTime = /^\d{2}:\d{2}$/.test(ocr.receiptTimeHm || '');
    const [hh, min] = hasTime ? ocr.receiptTimeHm.split(':').map(Number) : [23, 59];
    const receiptUtcMs = Date.UTC(yy, mm - 1, dd, hh, min) - 7 * 3600 * 1000;
    const maxAllowedPastMs = hasTime ? 30 * 60 * 1000 : 12 * 3600 * 1000;
    if (receiptUtcMs < sess.createdAt - maxAllowedPastMs) {
      return {
        ok: false,
        httpStatus: 400,
        status: 'rejected',
        error: `វិក្កយបត្រនេះចាស់ហួសពេល (${ocr.receiptDateYmd}${hasTime ? ` ${ocr.receiptTimeHm}` : ''})! សូមបង់ប្រាក់ថ្មី រួច Upload វិក្កយបត្រទើបវេរ។`,
      };
    }
  }

  const cleanOcrTx = sanitizeText(ocr.transactionId, 48).replace(/\s+/g, '');
  const cleanManual = sanitizeText(manualRef, 48).replace(/\s+/g, '');
  const effectiveRef = cleanOcrTx.length >= 4 ? cleanOcrTx : cleanManual;

  if (slipHash && isPaymentRefUsed(`slip:${slipHash}`)) {
    return {
      ok: false,
      httpStatus: 409,
      status: 'rejected',
      error: 'រូបវិក្កយបត្រ (Slip) នេះធ្លាប់បានប្រើប្រាស់សម្រាប់ការកម្ម៉ង់មុនរួចហើយ! ហាមប្រើម្តងទៀត។',
    };
  }
  if (effectiveRef && isPaymentRefUsed(`ref:${effectiveRef.toLowerCase()}`)) {
    return {
      ok: false,
      httpStatus: 409,
      status: 'rejected',
      error: `លេខប្រតិបត្តិការណ៍ (${effectiveRef}) នេះធ្លាប់បានប្រើប្រាស់រួចហើយ!`,
    };
  }

  return {
    ok: true,
    paidAmount: paidAmt,
    paidCurrency: ocr.currency === 'KHR' ? 'KHR' : 'USD',
    effectiveRef: effectiveRef || `SLIP-${slipHash.slice(0, 8).toUpperCase()}`,
    bankName: sanitizeText(ocr.bankName, 40) || 'Bank Transfer',
  };
}

function verifyPaymentProofToken(token: unknown): PaymentProofPayload | null {
  if (!token || typeof token !== 'string' || !token.startsWith('pay1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`pay1:${encoded}`)
    .digest('base64url');
  try {
    const bufSig = Buffer.from(sig);
    const bufExp = Buffer.from(expectedSig);
    if (bufSig.length !== bufExp.length || !crypto.timingSafeEqual(bufSig, bufExp)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PaymentProofPayload;
    if (!payload.sid || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function isPaymentRefUsed(key: string): boolean {
  if (!key) return false;
  return Array.isArray(db.usedPaymentRefs) && db.usedPaymentRefs.includes(key);
}

function markPaymentRefUsed(keys: Array<string | undefined>): void {
  if (!Array.isArray(db.usedPaymentRefs)) db.usedPaymentRefs = [];
  for (const k of keys) {
    const clean = String(k || '').trim();
    if (clean && !db.usedPaymentRefs.includes(clean)) {
      db.usedPaymentRefs.unshift(clean);
    }
  }
  if (db.usedPaymentRefs.length > 500) {
    db.usedPaymentRefs = db.usedPaymentRefs.slice(0, 500);
  }
}

function extractBearer(req: express.Request): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return undefined;
}

function requireAdmin(req: express.Request, res: express.Response): TokenPayload | null {
  const payload = verifySessionToken(extractBearer(req));
  if (!payload || payload.role !== 'admin') {
    res.status(401).json({ ok: false, error: 'ទាមទារការអនុញ្ញាតពីម្ចាស់ហាង' });
    return null;
  }
  return payload;
}

function toPublicMember(rec: MemberRecord) {
  return {
    id: rec.id,
    name: rec.name,
    phone: rec.phone,
    phoneVerified: rec.phoneVerified,
    telegramUsername: rec.telegramUsername,
    telegramId: rec.telegramId,
    telegramPhotoUrl: rec.telegramPhotoUrl,
    telegramVerified: rec.telegramVerified,
    points: rec.points,
    hasPin: Boolean(rec.pinHash && rec.pinSalt),
    createdAt: rec.createdAt,
    lastLoginAt: rec.lastLoginAt,
  };
}

function isValidMemberPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

function isWeakMemberPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const weakSet = new Set([
    '1234',
    '4321',
    '0123',
    '3210',
    '12345',
    '54321',
    '123456',
    '654321',
    '1122',
    '2211',
    '1212',
    '2121',
    '112233',
  ]);
  return weakSet.has(pin);
}

function getAuthenticatedMember(req: express.Request): { member: MemberRecord; payload: TokenPayload } | null {
  const payload = verifySessionToken(extractBearer(req));
  if (!payload || payload.role !== 'member') return null;
  const member = membersById.get(payload.sub);
  if (!member) return null;
  if ((payload.ver ?? 1) !== (member.tokenVersion ?? 1)) return null;
  return { member, payload };
}

function upsertMember(params: {
  targetMemberId?: string;
  name?: string;
  phone?: string;
  phoneVerified?: boolean;
  telegramUsername?: string;
  telegramId?: string;
  telegramPhotoUrl?: string;
  telegramVerified?: boolean;
  pointsDelta?: number;
}): { ok: true; member: MemberRecord } | { ok: false; error: string } {
  // Never match/hijack accounts via unverified phone or unverified telegramUsername.
  let existingId: string | undefined;
  if (params.targetMemberId && membersById.has(params.targetMemberId)) {
    existingId = params.targetMemberId;
  } else if (params.telegramId && memberIdByTgId.has(params.telegramId)) {
    existingId = memberIdByTgId.get(params.telegramId);
  } else if (params.phone && params.phoneVerified && memberIdByPhone.has(params.phone)) {
    const holderId = memberIdByPhone.get(params.phone)!;
    const holder = membersById.get(holderId);
    if (holder) {
      if (holder.phoneVerified) {
        if (params.telegramId && holder.telegramId && holder.telegramId !== params.telegramId) {
          return {
            ok: false,
            error: 'លេខទូរស័ព្ទនេះត្រូវបានផ្ទៀងផ្ទាត់ជាមួយគណនី Telegram ផ្សេងរួចហើយ!',
          };
        }
        existingId = holder.id;
      } else {
        // Strip unverified phone from unverified squatter so the real SIM owner gets a clean verified account
        memberIdByPhone.delete(params.phone);
        holder.phone = '';
        holder.phoneVerified = false;
        holder.tokenVersion = (holder.tokenVersion || 1) + 1;
      }
    }
  }

  // Enforce verified phone exclusivity across different accounts
  if (params.phone && params.phoneVerified) {
    const holderId = memberIdByPhone.get(params.phone);
    if (holderId && holderId !== existingId) {
      const holder = membersById.get(holderId);
      if (holder) {
        if (holder.phoneVerified) {
          return {
            ok: false,
            error: 'លេខទូរស័ព្ទនេះត្រូវបានផ្ទៀងផ្ទាត់ជាមួយគណនីផ្សេងរួចហើយ!',
          };
        }
        memberIdByPhone.delete(params.phone);
        holder.phone = '';
        holder.phoneVerified = false;
        holder.tokenVersion = (holder.tokenVersion || 1) + 1;
      }
    }
  }

  // If a cryptographically verified Telegram user claims a @username held unverified by another phone-only account, release it
  if (params.telegramVerified && params.telegramUsername) {
    const holderId = memberIdByTgUsername.get(params.telegramUsername.toLowerCase());
    if (holderId && holderId !== existingId) {
      const holder = membersById.get(holderId);
      if (holder && !holder.telegramId) {
        holder.telegramUsername = '';
        memberIdByTgUsername.delete(params.telegramUsername.toLowerCase());
      }
    }
  }

  const now = Date.now();
  let rec: MemberRecord;
  if (existingId && membersById.has(existingId)) {
    rec = membersById.get(existingId)!;
    if (params.name) rec.name = params.name;
    if (params.phone && params.phoneVerified) {
      if (rec.phone && rec.phone !== params.phone) {
        memberIdByPhone.delete(rec.phone);
      }
      rec.phone = params.phone;
      rec.phoneVerified = true;
    }
    if (params.telegramUsername && (params.telegramVerified || !rec.telegramUsername)) {
      rec.telegramUsername = params.telegramUsername;
    }
    if (params.telegramId) rec.telegramId = params.telegramId;
    if (params.telegramPhotoUrl) rec.telegramPhotoUrl = params.telegramPhotoUrl;
    if (params.telegramVerified) rec.telegramVerified = true;
    if (params.pointsDelta) rec.points += params.pointsDelta;
    if (!rec.tokenVersion) rec.tokenVersion = 1;
    rec.lastLoginAt = now;
  } else {
    const id = `MBR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    rec = {
      id,
      name: params.name || 'អតិថិជន Emerald Brew',
      phone: params.phoneVerified && params.phone ? params.phone : '',
      phoneVerified: Boolean(params.phoneVerified && params.phone),
      telegramUsername: params.telegramUsername || '',
      telegramId: params.telegramId,
      telegramPhotoUrl: params.telegramPhotoUrl,
      telegramVerified: Boolean(params.telegramVerified),
      points: Math.max(1, params.pointsDelta || 1),
      tokenVersion: 1,
      createdAt: now,
      lastLoginAt: now,
    };
    membersById.set(id, rec);
  }

  if (rec.phone) memberIdByPhone.set(rec.phone, rec.id);
  if (rec.telegramId) memberIdByTgId.set(rec.telegramId, rec.id);
  if (rec.telegramUsername) memberIdByTgUsername.set(rec.telegramUsername.toLowerCase(), rec.id);
  flushDb();
  return { ok: true, member: rec };
}

async function sendTelegramBotMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: number }> {
  if (!botToken || !chatId) return { ok: false };
  try {
    const body: Record<string, unknown> = { chat_id: chatId.trim(), text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const resp = await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      6000
    );
    const data = (await resp.json()) as { ok?: boolean; result?: { message_id?: number } };
    return { ok: Boolean(data.ok), messageId: data.result?.message_id };
  } catch {
    return { ok: false };
  }
}

async function sendTelegramBotPhoto(
  botToken: string,
  chatId: string,
  dataUri: string,
  caption: string,
  replyMarkup?: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: number }> {
  if (!botToken || !chatId) return { ok: false };
  const m = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return { ok: false };
  try {
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const form = new FormData();
    form.append('chat_id', chatId.trim());
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    form.append('photo', new Blob([buf], { type: mime }), `payment-slip.${ext}`);

    const resp = await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/sendPhoto`,
      { method: 'POST', body: form },
      9000
    );
    const data = (await resp.json()) as { ok?: boolean; result?: { message_id?: number } };
    return { ok: Boolean(data.ok), messageId: data.result?.message_id };
  } catch {
    return { ok: false };
  }
}

async function answerTelegramCallback(botToken: string, callbackId: string, text: string): Promise<void> {
  if (!botToken || !callbackId) return;
  try {
    await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false }),
      },
      4000
    );
  } catch {
    // ignore
  }
}

async function editTelegramPaymentMessage(
  botToken: string,
  sess: PaymentVerifySession,
  statusFooterHtml: string
): Promise<void> {
  if (!botToken || !sess.telegramChatId || !sess.telegramMessageId) return;
  const shopBrand =
    (db.shopSettings && typeof db.shopSettings.brandTitle === 'string' && db.shopSettings.brandTitle) ||
    'Emerald Brew Cafe';
  const amtText =
    sess.currency === 'KHR'
      ? `${Math.round(sess.expectedAmount).toLocaleString()} ៛ ($${sess.expectedAmountUsd.toFixed(2)})`
      : `$${sess.expectedAmountUsd.toFixed(2)}`;
  const nextText = [
    `💳 <b>${shopBrand} · ផ្ទៀងផ្ទាត់ការទូទាត់ KHQR</b>`,
    `🧾 វិក្កយបត្រ៖ <code>${sess.billNumber}</code>`,
    `💰 ចំនួនទឹកប្រាក់៖ <b>${amtText}</b>`,
    sess.customerName ? `👤 អតិថិជន៖ ${sess.customerName} (${sess.customerPhone || '-'})` : '',
    sess.transactionRef ? `🔖 លេខយោង៖ <code>${sess.transactionRef}</code>` : '',
    '',
    statusFooterHtml,
  ]
    .filter(Boolean)
    .join('\n');

  const endpoint = sess.telegramHasPhoto ? 'editMessageCaption' : 'editMessageText';
  const payload = sess.telegramHasPhoto
    ? {
        chat_id: sess.telegramChatId,
        message_id: sess.telegramMessageId,
        caption: nextText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      }
    : {
        chat_id: sess.telegramChatId,
        message_id: sess.telegramMessageId,
        text: nextText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      };

  try {
    await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      5000
    );
  } catch {
    // ignore
  }
}

function getShopBrandTitle(): string {
  return (
    (db.shopSettings && typeof db.shopSettings.brandTitle === 'string' && db.shopSettings.brandTitle.trim()) ||
    'Emerald Brew Cafe'
  );
}

function getOrderTelegramKeyboard(orderId: string, status: unknown): Record<string, unknown> {
  const st = String(status || 'Pending');
  if (st === 'Completed') return { inline_keyboard: [] };
  if (st === 'Ready') {
    return {
      inline_keyboard: [[{ text: '✔️ បញ្ចប់ដល់ដៃ (Completed)', callback_data: `ord_done:${orderId}` }]],
    };
  }
  if (st === 'Brewing') {
    return {
      inline_keyboard: [
        [
          { text: '🚀 រួចរាល់ / កំពុងដឹក (Ready)', callback_data: `ord_rdy:${orderId}` },
          { text: '✔️ បញ្ចប់ (Done)', callback_data: `ord_done:${orderId}` },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: '✅ បញ្ជាក់ទទួលកម្ម៉ង់ (Confirm)', callback_data: `ord_ok:${orderId}` },
        { text: '🚀 រួចរាល់ (Ready)', callback_data: `ord_rdy:${orderId}` },
      ],
      [{ text: '✔️ បញ្ចប់ (Done)', callback_data: `ord_done:${orderId}` }],
    ],
  };
}

function buildOrderTelegramMessageText(order: Record<string, unknown>, statusFooterHtml?: string): string {
  const cust = (order.customer || {}) as Record<string, unknown>;
  const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
  const itemsTxt = items
    .map((i) => `• ${i.qty}x ${i.name} (${i.options}) = $${(Number(i.unitPrice) * Number(i.qty)).toFixed(2)}`)
    .join('\n');
  const coords = cust.coords as { lat?: number; lng?: number } | undefined;
  const locTxt =
    order.type === 'dinein'
      ? `🪑 តុលេខ ${cust.tableNum || 1}`
      : `📍 ${cust.addressName || '-'}${
          coords ? `\n🗺 https://maps.google.com/?q=${coords.lat},${coords.lng}` : ''
        }`;
  const payStatusLine =
    order.payment === 'KHQR / ABA' && order.paymentVerified
      ? `✅ <b>ទូទាត់ KHQR បានផ្ទៀងផ្ទាត់</b> (${
          order.paymentVerifiedBy === 'bakong_md5'
            ? 'Bakong Auto'
            : order.paymentVerifiedBy === 'telegram_owner'
              ? 'Telegram Approved'
              : order.paymentVerifiedBy === 'web_admin'
                ? 'Website Approved'
                : order.paymentVerifiedBy === 'auto_slip_ocr'
                  ? `Auto Slip Verified${order.paymentBankName ? ` · ${order.paymentBankName}` : ''}`
                  : 'Slip Verified'
        })${order.paymentRef ? ` · Ref: <code>${order.paymentRef}</code>` : ''}`
      : `💵 ទូទាត់៖ ${order.payment}`;
  const st = String(order.status || 'Pending');
  const stLabel =
    st === 'Brewing'
      ? '✅ <b>ស្ថានភាព៖ ហាងបានបញ្ជាក់ & កំពុងរៀបចំ (Confirmed)</b>'
      : st === 'Ready'
        ? '🚀 <b>ស្ថានភាព៖ រួចរាល់ / កំពុងដឹកជញ្ជូន (Ready)</b>'
        : st === 'Completed'
          ? '✔️ <b>ស្ថានភាព៖ បានបញ្ចប់ជោគជ័យ (Completed)</b>'
          : '⏳ <b>ស្ថានភាព៖ រង់ចាំការបញ្ជាក់ (Pending)</b>';
  const phoneBadge = cust.phone
    ? cust.phoneVerified
      ? ' ✅ Verified'
      : cust.memberVerified
        ? ' 🔐 Member'
        : ' ⚠️ មិនទាន់ផ្ទៀងផ្ទាត់'
    : '';
  return [
    `🔔 <b>កម្ម៉ង់ ${order.id}</b> (${order.timestamp})`,
    `👤 ${cust.name || '-'} (${cust.phone || '-'}${phoneBadge})`,
    locTxt,
    '',
    itemsTxt,
    '',
    `💰 សរុប៖ <b>$${Number(order.grandTotal || 0).toFixed(2)}</b>`,
    payStatusLine,
    statusFooterHtml || stLabel,
  ]
    .filter((v) => v !== undefined)
    .join('\n');
}

async function editTelegramOrderMessage(
  botToken: string,
  order: Record<string, unknown>,
  statusFooterHtml?: string
): Promise<void> {
  const msgId = Number(order.tgMessageId || 0);
  const chatId = String(order.tgChatId || getEffectiveChatId() || '').trim();
  if (!botToken || !chatId || !msgId) return;
  try {
    await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/editMessageText`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: msgId,
          text: buildOrderTelegramMessageText(order, statusFooterHtml),
          parse_mode: 'HTML',
          reply_markup: getOrderTelegramKeyboard(String(order.id), order.status),
        }),
      },
      5000
    );
  } catch {
    // ignore
  }
}

let lastOrdersTgPollAt = 0;

async function processTelegramUpdates(botToken: string): Promise<void> {
  if (!botToken) return;
  try {
    const updRes = await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/getUpdates?offset=${db.lastTelegramUpdateOffset}&limit=40&timeout=0`,
      {},
      4500
    );
    const updData = (await updRes.json()) as {
      ok?: boolean;
      result?: Array<{
        update_id: number;
        callback_query?: {
          id: string;
          data?: string;
          from?: { id: number; first_name?: string; username?: string };
          message?: { message_id?: number; chat?: { id?: number | string } };
        };
        message?: {
          text?: string;
          from?: { id: number; username?: string; first_name?: string; last_name?: string };
          contact?: {
            phone_number?: string;
            first_name?: string;
            last_name?: string;
            user_id?: number;
          };
        };
      }>;
    };

    if (!updData.ok || !Array.isArray(updData.result)) return;

    const shopBrand = getShopBrandTitle();
    let offsetChanged = false;

    for (const upd of updData.result) {
      if (upd.update_id >= db.lastTelegramUpdateOffset) {
        db.lastTelegramUpdateOffset = upd.update_id + 1;
        offsetChanged = true;
      }

      // 1. Handle Shop Owner Inline Button Approval for KHQR Payments & Order Confirmations
      if (upd.callback_query?.data) {
        const cb = upd.callback_query;
        const dataStr = cb.data || '';
        const colonIdx = dataStr.indexOf(':');
        const action = colonIdx > 0 ? dataStr.slice(0, colonIdx) : '';
        const targetId = colonIdx > 0 ? dataStr.slice(colonIdx + 1) : '';
        const reviewerName = sanitizeText(cb.from?.first_name || cb.from?.username || 'ម្ចាស់ហាង', 40);

        if (action === 'ord_ok' || action === 'ord_rdy' || action === 'ord_done') {
          const ord = targetId ? serverOrders.get(targetId) : undefined;
          if (!ord) {
            await answerTelegramCallback(botToken, cb.id, 'រកមិនឃើញការកម្ម៉ង់នេះទេ');
            continue;
          }
          if (!ord.tgMessageId && cb.message?.message_id) {
            ord.tgMessageId = cb.message.message_id;
          }
          if (!ord.tgChatId && cb.message?.chat?.id !== undefined) {
            ord.tgChatId = String(cb.message.chat.id);
          }

          const nextStatus =
            action === 'ord_ok' ? 'Brewing' : action === 'ord_rdy' ? 'Ready' : 'Completed';
          ord.status = nextStatus;
          if (!ord.confirmedAt) ord.confirmedAt = Date.now();
          ord.confirmedBy = 'telegram';
          serverOrders.set(targetId, ord);
          offsetChanged = true;

          const answerText =
            nextStatus === 'Brewing'
              ? `✅ បានបញ្ជាក់ទទួលកម្ម៉ង់ ${targetId}!`
              : nextStatus === 'Ready'
                ? `🚀 កម្ម៉ង់ ${targetId} រួចរាល់!`
                : `✔️ កម្ម៉ង់ ${targetId} បានបញ្ចប់!`;
          const footerHtml =
            nextStatus === 'Brewing'
              ? `✅ <b>ស្ថានភាព៖ បានបញ្ជាក់ & កំពុងរៀបចំដោយ ${reviewerName} (Telegram)</b>`
              : nextStatus === 'Ready'
                ? `🚀 <b>ស្ថានភាព៖ រួចរាល់ / កំពុងដឹកជញ្ជូន (${reviewerName})</b>`
                : `✔️ <b>ស្ថានភាព៖ បានបញ្ចប់រួចរាល់ (${reviewerName})</b>`;
          await answerTelegramCallback(botToken, cb.id, answerText);
          await editTelegramOrderMessage(botToken, ord, footerHtml);
          continue;
        }

        const sess = targetId ? paymentSessionStore.get(targetId) : undefined;
        if (!sess || sess.expiresAt < Date.now()) {
          await answerTelegramCallback(botToken, cb.id, 'វគ្គទូទាត់នេះផុតកំណត់ ឬរួចរាល់ហើយ');
          continue;
        }

        if (action === 'pay_ok') {
          sess.status = 'verified';
          sess.verifiedBy = 'telegram_owner';
          sess.paidAmount = sess.expectedAmount;
          sess.transactionRef = sess.transactionRef || sess.billNumber;
          sess.error = undefined;
          await answerTelegramCallback(botToken, cb.id, '✅ បានបញ្ជាក់ទទួលប្រាក់គ្រប់!');
          await editTelegramPaymentMessage(
            botToken,
            sess,
            `✅ <b>ស្ថានភាព៖ បានបញ្ជាក់ទទួលលុយគ្រប់ដោយ ${reviewerName}</b>`
          );
        } else if (action === 'pay_amt') {
          sess.status = 'amount_mismatch';
          sess.error = 'ម្ចាស់ហាងជូនដំណឹងថា ចំនួនលុយវេរចូលមិនគ្រប់តាមវិក្កយបត្រទេ! សូមពិនិត្យម្តងទៀត។';
          await answerTelegramCallback(botToken, cb.id, '⚠️ បានជូនដំណឹងភ្ញៀវថាខ្វះចំនួនលុយ');
          await editTelegramPaymentMessage(
            botToken,
            sess,
            `⚠️ <b>ស្ថានភាព៖ លុយចូលមិនគ្រប់ចំនួន (${reviewerName})</b>`
          );
        } else if (action === 'pay_no') {
          sess.status = 'rejected';
          sess.error = 'ម្ចាស់ហាងជូនដំណឹងថា មិនទាន់ឃើញទឹកប្រាក់ចូលធនាគារទេ! សូមផ្ទៀងផ្ទាត់ម្តងទៀត។';
          await answerTelegramCallback(botToken, cb.id, '❌ បានបដិសេធ៖ មិនទាន់ឃើញលុយចូល');
          await editTelegramPaymentMessage(
            botToken,
            sess,
            `❌ <b>ស្ថានភាព៖ មិនទាន់ទទួលបានប្រាក់ (${reviewerName})</b>`
          );
        }
        continue;
      }

      const msg = upd.message;
      const from = msg?.from;
      if (!msg || !from) continue;

      const fullFirstName =
        [sanitizeText(from.first_name, 40), sanitizeText(from.last_name, 40)].filter(Boolean).join(' ') ||
        'អតិថិជន';
      const msgText = (msg.text || '').trim();

      // 2. Handle /start <nonce>, /start, /register, /help
      if (msgText.startsWith('/start') || msgText.startsWith('/register') || msgText === '/help') {
        const parts = msgText.split(/\s+/);
        const matchedNonce = parts[1];

        if (matchedNonce && tgLinkStore.has(matchedNonce)) {
          const targetSess = tgLinkStore.get(matchedNonce)!;
          targetSess.startedByTelegramId = String(from.id);
          targetSess.verifiedUser = {
            id: String(from.id),
            username: from.username || '',
            firstName: fullFirstName,
          };

          if (targetSess.mode === 'contact') {
            const expectedLine = targetSess.expectedPhone
              ? `\n📱 លេខទូរស័ព្ទត្រូវផ្ទៀងផ្ទាត់៖ <b>${targetSess.expectedPhone}</b>`
              : '';
            await sendTelegramBotMessage(
              botToken,
              String(from.id),
              `🌿 <b>សូមស្វាគមន៍មកកាន់ ${shopBrand}!</b>\n` +
                `<i>ចុះឈ្មោះសមាជិក & ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ (Free ១០០%)</i>\n\n` +
                `👋 សួស្តី <b>${fullFirstName}</b>!${expectedLine}\n` +
                `ដើម្បីផ្ទៀងផ្ទាត់លេខទូរស័ព្ទពិតប្រាកដ សូមចុចប៊ូតុង <b>«📱 ចែករំលែកលេខទូរស័ព្ទចុះឈ្មោះ (Free)»</b> ខាងក្រោម 👇`,
              {
                keyboard: [
                  [
                    {
                      text: '📱 ចែករំលែកលេខទូរស័ព្ទចុះឈ្មោះ (Free)',
                      request_contact: true,
                    },
                  ],
                ],
                resize_keyboard: true,
                one_time_keyboard: true,
              }
            );
          } else {
            await sendTelegramBotMessage(
              botToken,
              String(from.id),
              `🌿 <b>សូមស្វាគមន៍មកកាន់ ${shopBrand}!</b>\n` +
                `<i>Welcome to ${shopBrand} · Official Member</i>\n\n` +
                `👋 សួស្តី <b>${fullFirstName}</b>!\n` +
                `✅ គណនី Telegram របស់អ្នកត្រូវបានចុះឈ្មោះ & ភ្ជាប់ដោយសុវត្ថិភាពរួចរាល់ ១០០%។\n\n` +
                `🎁 <b>អត្ថប្រយោជន៍សមាជិករបស់អ្នក៖</b>\n` +
                `• ⭐ សន្សំពិន្ទុស្វ័យប្រវត្តិ (+1 ★ រាល់ពេលកម្ម៉ង់ ១ មុខ)\n` +
                `• 🛵 តាមដានអ្នកដឹកជញ្ជូន Live លើផែនទី\n` +
                `• 🔐 បង់ប្រាក់ KHQR មានការផ្ទៀងផ្ទាត់សុវត្ថិភាព\n\n` +
                `📲 សូមត្រឡប់ទៅគេហទំព័រវិញ គណនីរបស់អ្នកនឹងបើកដោយស្វ័យប្រវត្តិ!`
            );
          }
        } else {
          // Direct /start or /register in Telegram Bot without web nonce
          const upsertRes = upsertMember({
            name: fullFirstName,
            telegramId: String(from.id),
            telegramUsername: from.username ? `@${from.username}` : '',
            telegramVerified: true,
          });
          if (upsertRes.ok) {
            const registered = upsertRes.member;
            await sendTelegramBotMessage(
              botToken,
              String(from.id),
              `🌿 <b>សូមស្វាគមន៍មកកាន់ ${shopBrand}!</b>\n` +
                `<i>Member Registration & Ordering Assistant</i>\n\n` +
                `👋 សួស្តី <b>${registered.name}</b>!\n` +
                `🆔 លេខកូដសមាជិក៖ <code>${registered.id}</code>\n` +
                `⭐ ពិន្ទុសន្សំបច្ចុប្បន្ន៖ <b>${registered.points || 1} ★</b>\n` +
                `${registered.phone ? `📱 លេខទូរស័ព្ទ៖ <b>${registered.phone}</b> ${registered.phoneVerified ? '✅' : '(មិនទាន់ផ្ទៀងផ្ទាត់)'}\n` : ''}\n` +
                `🎁 <b>អត្ថប្រយោជន៍សមាជិក៖</b>\n` +
                `• កម្ម៉ង់ភេសជ្ជៈ & អាហារងាយស្រួលទាំង ២ ភាសា\n` +
                `• សន្សំពិន្ទុប្តូររង្វាន់រាល់ការកម្ម៉ង់\n` +
                `• ទទួលដំណឹងពេលហាងទទួលលុយ និងដឹកជញ្ជូនដល់ទីតាំង\n\n` +
                `${
                  registered.phoneVerified
                    ? '✅ គណនីសមាជិករបស់អ្នកត្រូវបានផ្ទៀងផ្ទាត់ពេញលេញរួចរាល់!'
                    : '👇 ចុចប៊ូតុងខាងក្រោមដើម្បីភ្ជាប់លេខទូរស័ព្ទជាមួយគណនីសមាជិករបស់អ្នក (Free ១០០%)៖'
                }`,
              registered.phoneVerified
                ? undefined
                : {
                    keyboard: [
                      [
                        {
                          text: '📱 ចុះឈ្មោះលេខទូរស័ព្ទសមាជិក (Free)',
                          request_contact: true,
                        },
                      ],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                  }
            );
          }
        }
      }

      // 3. Handle authentic Telegram Share Contact (must match sender's own Telegram user_id)
      if (msg.contact?.phone_number && Number(msg.contact.user_id) === Number(from.id)) {
        const verifiedPhone = normalizePhone(msg.contact.phone_number);
        if (isValidPhone(verifiedPhone)) {
          let linkedSessionFound = false;
          let linkedMemberId: string | undefined;
          let matchedCand: TelegramLinkSession | undefined;
          let expectedPhoneMismatch = false;
          for (const cand of tgLinkStore.values()) {
            if (
              cand.mode === 'contact' &&
              cand.expiresAt >= Date.now() &&
              cand.startedByTelegramId === String(from.id)
            ) {
              linkedSessionFound = true;
              linkedMemberId = cand.memberId;
              matchedCand = cand;
              if (cand.expectedPhone && cand.expectedPhone !== verifiedPhone) {
                expectedPhoneMismatch = true;
                cand.error = `លេខទូរស័ព្ទដែលបាន Share តាម Telegram (${verifiedPhone}) មិនត្រូវគ្នានឹងលេខ (${cand.expectedPhone}) ទេ! សូមប្រើ Telegram ដែលកាន់លេខ ${cand.expectedPhone} ឬទុកប្រអប់លេខរំពឹងទុកទំនេរ។`;
              } else {
                cand.verifiedPhone = verifiedPhone;
                cand.verifiedUser = cand.verifiedUser || {
                  id: String(from.id),
                  username: from.username || '',
                  firstName: fullFirstName,
                };
              }
            }
          }

          if (expectedPhoneMismatch && matchedCand?.error) {
            await sendTelegramBotMessage(
              botToken,
              String(from.id),
              `⚠️ <b>លេខទូរស័ព្ទមិនត្រូវគ្នា</b>\n\n${matchedCand.error}`,
              { remove_keyboard: true }
            );
          } else {
            const upsertRes = upsertMember({
              targetMemberId: linkedMemberId,
              name: matchedCand?.name || fullFirstName,
              phone: verifiedPhone,
              phoneVerified: true,
              telegramId: String(from.id),
              telegramUsername: from.username ? `@${from.username}` : '',
              telegramVerified: true,
            });
            if (!upsertRes.ok) {
              if (matchedCand) matchedCand.error = upsertRes.error;
              await sendTelegramBotMessage(
                botToken,
                String(from.id),
                `⚠️ <b>មិនអាចភ្ជាប់លេខទូរស័ព្ទ ${verifiedPhone} បានទេ</b>\n\n${upsertRes.error}`,
                { remove_keyboard: true }
              );
            } else {
              const member = upsertRes.member;
              await sendTelegramBotMessage(
                botToken,
                String(from.id),
                `🎉 <b>ចុះឈ្មោះសមាជិកជោគជ័យ · ${shopBrand}</b>\n\n` +
                  `👤 ឈ្មោះ៖ <b>${member.name}</b>\n` +
                  `📱 លេខទូរស័ព្ទ៖ <b>${verifiedPhone}</b> ✅ (Verified Free)\n` +
                  `🆔 កូដសមាជិក៖ <code>${member.id}</code>\n` +
                  `⭐ ពិន្ទុសន្សំ៖ <b>${member.points || 1} ★</b>\n\n` +
                  `${
                    linkedSessionFound
                      ? '📲 សូមត្រឡប់ទៅគេហទំព័រវិញ ប្រព័ន្ធនឹងបើកគណនីរបស់អ្នកភ្លាមៗ!'
                      : '☕ សូមអរគុណ! លោកអ្នកអាចប្រើលេខទូរស័ព្ទ ឬ Telegram នេះដើម្បីកម្ម៉ង់ភ្លាមៗនៅលើគេហទំព័រ។'
                  }`,
                { remove_keyboard: true }
              );
            }
          }
        }
      }
    }

    if (offsetChanged) flushDb();
  } catch {
    // non-fatal poll failure
  }
}

async function resolveBotUsername(botToken: string): Promise<string> {
  const explicit = getEffectiveBotUsername();
  if (explicit) return explicit;
  if (!botToken) return '';
  const cached = botUsernameCache.get(botToken);
  if (cached) return cached;
  try {
    const meRes = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/getMe`, {}, 3500);
    const meData = (await meRes.json()) as { ok?: boolean; result?: { username?: string } };
    if (meData.ok && meData.result?.username) {
      botUsernameCache.set(botToken, meData.result.username);
      return meData.result.username;
    }
  } catch {
    // ignore timeout/network failure
  }
  return '';
}

// ---- Official Auth & Payment Capabilities ----
app.get('/api/auth/capabilities', async (_req, res) => {
  const botToken = getEffectiveBotToken();
  const chatId = getEffectiveChatId();
  const botUsername = await resolveBotUsername(botToken);

  const phoneOtpChannel = detectPhoneOtpChannel();
  const botReady = Boolean(botToken && botUsername);
  return res.json({
    ok: true,
    telegramWidgetReady: botReady,
    telegramBotReady: botReady,
    telegramContactReady: botReady,
    telegramOrderVerifyReady: Boolean(botToken && chatId),
    bakongVerifyReady: Boolean(getEffectiveBakongToken()),
    slipAutoVerifyReady: Boolean(getEffectiveGeminiKey()),
    phoneOtpReady: phoneOtpChannel !== 'none',
    phoneOtpChannel,
    botUsername,
  });
});

// ---- Secure Phone + PIN Sign-In / Registration (Anti-Spoofing & Brute-Force Protected) ----
app.post('/api/auth/quick-login', (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`quick_login_${ip}`, 15, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ ok: false, error: `សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី មុននឹងព្យាយាមម្តងទៀត` });
  }

  const phone = normalizePhone(String(req.body?.phone || ''));
  const name = sanitizeText(req.body?.name, 60);
  const tgUsername = normalizeTgUsername(req.body?.telegramUsername);
  const pin = String(req.body?.pin || '').trim();

  if (!isValidPhone(phone)) {
    return res.status(400).json({
      ok: false,
      error: 'លេខទូរស័ព្ទមិនត្រឹមត្រូវទេ (ឧ. 012 345 678)',
    });
  }

  if (pin && !isValidMemberPin(pin)) {
    return res.status(400).json({
      ok: false,
      error: 'កូដ PIN សុវត្ថិភាពត្រូវតែមានលេខ ៤ ដល់ ៨ ខ្ទង់',
    });
  }

  const existingId = memberIdByPhone.get(phone);
  const existing = existingId ? membersById.get(existingId) : undefined;

  if (existing) {
    // Existing account WITHOUT a PIN cannot be hijacked via quick-login — must authenticate via verified channel first
    if (!existing.pinHash || !existing.pinSalt) {
      return res.status(403).json({
        ok: false,
        requiresChannelVerification: true,
        hasTelegram: Boolean(existing.telegramId || existing.telegramUsername),
        memberName: existing.name,
        error:
          'គណនីនេះត្រូវបានការពាររួចហើយ! ដើម្បីការពារការបន្លំ សូមចូលតាម Telegram ឬ OTP វិញ (រួចអាចកំណត់កូដ PIN ក្នុងគណនី)។',
      });
    }

    const lockKey = `mbr_phone_${phone}`;
    const lock = pinLockoutMap.get(lockKey);
    if (lock && lock.lockedUntil > Date.now()) {
      const secs = Math.ceil((lock.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({
        ok: false,
        locked: true,
        retryAfterSec: secs,
        error: `បញ្ចូលកូដ PIN ខុសច្រើនដង! គណនីត្រូវបានចាក់សោបណ្តោះអាសន្ន ${secs} វិនាទី`,
      });
    }

    if (!pin) {
      return res.status(401).json({
        ok: false,
        requiresPin: true,
        memberName: existing.name,
        error: 'គណនីនេះមានកូដ PIN ការពារ! សូមបញ្ចូលកូដ PIN ដើម្បីចូល។',
      });
    }

    const candidateHash = hashOtp(pin, existing.pinSalt);
    if (!safeEqualHex(candidateHash, existing.pinHash)) {
      const failures = (lock?.failures || 0) + 1;
      if (failures >= 5) {
        pinLockoutMap.set(lockKey, { failures: 0, lockedUntil: Date.now() + 5 * 60_000 });
        return res.status(429).json({
          ok: false,
          locked: true,
          retryAfterSec: 300,
          error: 'បញ្ចូលកូដ PIN ខុស ៥ ដង! ត្រូវបានចាក់សោ ៥ នាទីដើម្បីការពារគណនី',
        });
      }
      pinLockoutMap.set(lockKey, { failures, lockedUntil: 0 });
      return res.status(401).json({
        ok: false,
        requiresPin: true,
        memberName: existing.name,
        attemptsRemaining: 5 - failures,
        error: `កូដ PIN មិនត្រឹមត្រូវទេ (នៅសល់ ${5 - failures} ដង)!`,
      });
    }

    pinLockoutMap.delete(lockKey);
    existing.lastLoginAt = Date.now();
    flushDb();
    const token = signSessionToken(existing.id, 'member', 7 * 24 * 60 * 60 * 1000, existing.tokenVersion || 1);
    return res.json({ ok: true, isNew: false, token, member: toPublicMember(existing) });
  }

  // New Quick-Phone Registration: require Name and strong Security PIN
  if (!name) {
    return res.status(400).json({
      ok: false,
      isNewAccountAttempt: true,
      error: 'សូមបញ្ចូលឈ្មោះរបស់អ្នកដើម្បីបង្កើតគណនីថ្មី',
    });
  }
  if (!pin) {
    return res.status(400).json({
      ok: false,
      isNewAccountAttempt: true,
      error: 'ដើម្បីការពារការបន្លំគណនី សូមកំណត់កូដ PIN ការពារ (លេខ ៤–៨ ខ្ទង់)',
    });
  }
  if (isWeakMemberPin(pin)) {
    return res.status(400).json({
      ok: false,
      isNewAccountAttempt: true,
      error: 'កូដ PIN ងាយទាយពេក! សូមជ្រើសរើសលេខផ្សេង (ជៀសវាង 1234 ឬលេខដូចៗគ្នា)',
    });
  }

  const now = Date.now();
  const salt = crypto.randomBytes(16).toString('hex');
  const safeTgUsername =
    tgUsername && !memberIdByTgUsername.has(tgUsername.toLowerCase()) ? tgUsername : '';
  const member: MemberRecord = {
    id: `MBR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    name,
    phone,
    phoneVerified: false,
    telegramUsername: safeTgUsername,
    telegramVerified: false,
    points: 1,
    pinSalt: salt,
    pinHash: hashOtp(pin, salt),
    tokenVersion: 1,
    createdAt: now,
    lastLoginAt: now,
  };
  membersById.set(member.id, member);
  memberIdByPhone.set(phone, member.id);
  if (safeTgUsername) memberIdByTgUsername.set(safeTgUsername.toLowerCase(), member.id);
  flushDb();

  const token = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion);
  return res.json({ ok: true, isNew: true, token, member: toPublicMember(member) });
});

// ---- Official Phone OTP Delivery (Telegram Gateway / Twilio / SMS Webhook ONLY — Zero Demo Preview) ----
app.post('/api/auth/phone/send-otp', async (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`send_otp_${ip}`, 6, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ ok: false, error: `សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី មុននឹងស្នើសុំលេខកូដម្តងទៀត` });
  }

  const name = sanitizeText(req.body?.name, 60);
  const phone = normalizePhone(String(req.body?.phone || ''));
  const tgUsername = normalizeTgUsername(req.body?.telegramUsername);

  if (!isValidPhone(phone)) {
    return res.status(400).json({
      ok: false,
      error: 'លេខទូរស័ព្ទមិនត្រឹមត្រូវទេ (ឧ. 012 345 678 ឬ +85512345678)',
    });
  }

  const channel = detectPhoneOtpChannel();
  if (channel === 'none') {
    return res.status(503).json({
      ok: false,
      error:
        'មិនទាន់បានភ្ជាប់សេវាផ្ញើ OTP ផ្លូវការទេ! សូមម្ចាស់ហាងកំណត់ Telegram Gateway Token ឬ Twilio / SMS Gateway ក្នុងផ្ទាំងគ្រប់គ្រងហាង។',
    });
  }

  const otp = String(crypto.randomInt(100000, 999999));
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashOtp(otp, salt);

  // 1. Official Telegram Gateway API (delivers real verification code to user's Telegram by phone number)
  if (channel === 'telegram_gateway') {
    try {
      const gwToken = getEffectiveGatewayToken();
      const gwRes = await fetchWithTimeout(
        'https://gatewayapi.telegram.org/sendVerificationMessage',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${gwToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone_number: phone,
            code: otp,
            ttl: 300,
          }),
        },
        8000
      );
      const gwData = (await gwRes.json()) as {
        ok?: boolean;
        error?: string;
        result?: { request_id?: string };
      };
      if (!gwData.ok) {
        return res.status(502).json({
          ok: false,
          error: `Telegram Gateway បដិសេធការផ្ញើ៖ ${gwData.error || 'សូមពិនិត្យ Token ឬលេខទូរស័ព្ទ'}`,
        });
      }
      otpStore.set(`phone:${phone}`, {
        hash,
        salt,
        target: phone,
        gatewayRequestId: gwData.result?.request_id,
        channel: 'telegram_gateway',
        name: name || 'អតិថិជន Emerald Brew',
        telegramUsername: tgUsername || undefined,
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0,
      });
      return res.json({
        ok: true,
        phone,
        channel: 'telegram_gateway',
        expiresInSeconds: 300,
      });
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'មិនអាចភ្ជាប់ទៅ Telegram Gateway API បានទេ',
      });
    }
  }

  // 2. Official Twilio SMS API
  if (channel === 'twilio') {
    const tw = getEffectiveTwilio();
    try {
      const params = new URLSearchParams({
        To: phone,
        From: tw.from,
        Body: `Emerald Brew Cafe: លេខកូដផ្ទៀងផ្ទាត់របស់អ្នកគឺ ${otp} (សុពលភាព ៥ នាទី)`,
      });
      const twRes = await fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(tw.sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${tw.sid}:${tw.token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
        8000
      );
      if (!twRes.ok) {
        const errBody = await twRes.text();
        return res.status(502).json({
          ok: false,
          error: `Twilio SMS បរាជ័យ (${twRes.status}): ${errBody.slice(0, 120)}`,
        });
      }
      otpStore.set(`phone:${phone}`, {
        hash,
        salt,
        target: phone,
        channel: 'twilio',
        name: name || 'អតិថិជន Emerald Brew',
        telegramUsername: tgUsername || undefined,
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0,
      });
      return res.json({ ok: true, phone, channel: 'twilio', expiresInSeconds: 300 });
    } catch {
      return res.status(502).json({ ok: false, error: 'មិនអាចភ្ជាប់ទៅ Twilio SMS API បានទេ' });
    }
  }

  // 3. Official Custom SMS Webhook (PlasGate / MekongSMS / Local Gateway)
  const wh = getEffectiveSmsWebhook();
  try {
    const whRes = await fetchWithTimeout(
      wh.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(wh.apiKey ? { Authorization: `Bearer ${wh.apiKey}`, 'X-API-Key': wh.apiKey } : {}),
        },
        body: JSON.stringify({
          to: phone,
          code: otp,
          message: `Emerald Brew Cafe: លេខកូដផ្ទៀងផ្ទាត់របស់អ្នកគឺ ${otp}`,
        }),
      },
      8000
    );
    if (!whRes.ok) {
      return res.status(502).json({ ok: false, error: 'SMS Gateway Webhook បានបដិសេធការផ្ញើ' });
    }
    otpStore.set(`phone:${phone}`, {
      hash,
      salt,
      target: phone,
      channel: 'sms_webhook',
      name: name || 'អតិថិជន Emerald Brew',
      telegramUsername: tgUsername || undefined,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
    });
    return res.json({ ok: true, phone, channel: 'sms_webhook', expiresInSeconds: 300 });
  } catch {
    return res.status(502).json({ ok: false, error: 'មិនអាចភ្ជាប់ទៅ SMS Gateway បានទេ' });
  }
});

app.post('/api/auth/phone/verify-otp', (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`verify_otp_${ip}`, 15, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ ok: false, error: `ព្យាយាមច្រើនដងពេក! សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី` });
  }

  const phone = normalizePhone(String(req.body?.phone || ''));
  const code = String(req.body?.code || '').replace(/\D/g, '');
  const challenge = otpStore.get(`phone:${phone}`);

  if (!challenge) {
    return res.status(400).json({ ok: false, error: 'លេខកូដ OTP ផុតកំណត់ ឬមិនទាន់បានស្នើសុំទេ' });
  }
  if (challenge.expiresAt < Date.now()) {
    otpStore.delete(`phone:${phone}`);
    return res.status(400).json({ ok: false, error: 'លេខកូដ OTP ផុតកំណត់ហើយ សូមស្នើសុំម្តងទៀត' });
  }
  if (challenge.attempts >= 5) {
    otpStore.delete(`phone:${phone}`);
    return res.status(429).json({ ok: false, error: 'បញ្ចូលខុសលើស ៥ ដង! សូមស្នើសុំលេខកូដថ្មី' });
  }

  challenge.attempts += 1;
  const candidateHash = hashOtp(code, challenge.salt);
  if (!safeEqualHex(candidateHash, challenge.hash)) {
    return res.status(400).json({
      ok: false,
      error: `លេខកូដ OTP មិនត្រឹមត្រូវទេ (នៅសល់ ${5 - challenge.attempts} ដង)`,
    });
  }

  otpStore.delete(`phone:${phone}`);
  const authMember = getAuthenticatedMember(req);
  const upsertRes = upsertMember({
    targetMemberId: authMember?.member.id,
    name: sanitizeText(req.body?.name, 60) || challenge.name,
    phone,
    phoneVerified: true,
    telegramUsername: normalizeTgUsername(req.body?.telegramUsername) || challenge.telegramUsername,
  });
  if (!upsertRes.ok) {
    return res.status(409).json({ ok: false, error: upsertRes.error });
  }
  const member = upsertRes.member;
  const token = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion || 1);
  return res.json({ ok: true, token, member: toPublicMember(member) });
});

// ---- Official Telegram Login Widget HMAC-SHA256 Verification ----
app.post('/api/auth/telegram/verify-widget', (req, res) => {
  const botToken = getEffectiveBotToken();
  if (!botToken) {
    return res.status(503).json({
      ok: false,
      error: 'មិនទាន់បានកំណត់ Telegram Bot Token នៅលើ Server ទេ',
    });
  }

  const user = req.body as Record<string, unknown>;
  const hash = String(user?.hash || '');
  const authDate = Number(user?.auth_date || 0);
  if (!hash || !user?.id || !authDate) {
    return res.status(400).json({ ok: false, error: 'ទិន្នន័យ Telegram Login មិនពេញលេញ' });
  }

  // Reject stale auth payloads older than 24 hours
  if (Math.abs(Date.now() / 1000 - authDate) > 86400) {
    return res.status(401).json({ ok: false, error: 'ការផ្ទៀងផ្ទាត់ Telegram ហួសសុពលភាព សូមចូលម្តងទៀត' });
  }

  const checkString = Object.keys(user)
    .filter((k) => k !== 'hash' && user[k] !== undefined && user[k] !== null && user[k] !== '')
    .sort()
    .map((k) => `${k}=${user[k]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  if (!safeEqualHex(hash, expectedHash)) {
    return res.status(401).json({ ok: false, error: 'ហត្ថលេខា Telegram មិនត្រឹមត្រូវ (HMAC Failed)' });
  }

  const fullName =
    [sanitizeText(user.first_name, 40), sanitizeText(user.last_name, 40)]
      .filter(Boolean)
      .join(' ') || 'Telegram User';
  const username = normalizeTgUsername(user.username);

  const upsertRes = upsertMember({
    name: fullName,
    telegramId: String(user.id),
    telegramUsername: username,
    telegramPhotoUrl: typeof user.photo_url === 'string' ? user.photo_url : undefined,
    telegramVerified: true,
  });
  if (!upsertRes.ok) {
    return res.status(409).json({ ok: false, error: upsertRes.error });
  }
  const member = upsertRes.member;
  const token = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion || 1);
  return res.json({ ok: true, token, member: toPublicMember(member) });
});

// ---- Official Telegram Bot 1-Click Deep Link & Free Share-Contact Phone Verification ----
app.post('/api/auth/telegram/init-link', async (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`tg_init_${ip}`, 12, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res.status(429).json({ ok: false, error: 'សូមរង់ចាំបន្តិចមុននឹងបង្កើតតំណភ្ជាប់ថ្មី' });
  }

  const botToken = getEffectiveBotToken();

  if (!botToken) {
    return res.status(503).json({
      ok: false,
      error:
        'សូមម្ចាស់ហាងបញ្ចូល Telegram Bot Token (ឥតគិតថ្លៃពី @BotFather) ក្នុងផ្ទាំងគ្រប់គ្រងហាង ដើម្បីបើកដំណើរការការភ្ជាប់ Telegram ផ្លូវការ។',
    });
  }

  const botUsername = await resolveBotUsername(botToken);
  if (!botUsername) {
    return res.status(503).json({
      ok: false,
      error: 'មិនអាចទាញយក Bot Username បានទេ! សូមពិនិត្យ Bot Token និង Bot Username ក្នុងផ្ទាំងគ្រប់គ្រង។',
    });
  }

  const mode = req.body?.mode === 'contact' ? 'contact' : 'login';
  const rawExpected = req.body?.expectedPhone ? normalizePhone(String(req.body.expectedPhone)) : '';
  if (req.body?.expectedPhone && String(req.body.expectedPhone).trim() && !isValidPhone(rawExpected)) {
    return res.status(400).json({
      ok: false,
      error: 'លេខទូរស័ព្ទដែលត្រូវផ្ទៀងផ្ទាត់មិនត្រឹមត្រូវទេ (ឧ. 012 345 678)',
    });
  }
  const authMember = getAuthenticatedMember(req);
  const prefix = mode === 'contact' ? 'ph' : 'eb';
  const nonce = `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
  tgLinkStore.set(nonce, {
    nonce,
    mode,
    name: sanitizeText(req.body?.name, 60),
    memberId: authMember?.member.id,
    expectedPhone: mode === 'contact' && rawExpected ? rawExpected : undefined,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  return res.json({
    ok: true,
    nonce,
    mode,
    botUsername,
    deepLink: `https://t.me/${botUsername}?start=${nonce}`,
    expiresInSeconds: 600,
  });
});

function completeTelegramSession(nonce: string, session: TelegramLinkSession) {
  tgLinkStore.delete(nonce);
  if (session.error) {
    return { ok: false, error: session.error };
  }
  // Never treat user-typed phone as verified; ONLY accept session.verifiedPhone from Telegram Share Contact
  const verifiedPhone = session.verifiedPhone;
  if (session.expectedPhone && verifiedPhone && session.expectedPhone !== verifiedPhone) {
    return {
      ok: false,
      error: `លេខទូរស័ព្ទដែលបាន Share តាម Telegram (${verifiedPhone}) មិនត្រូវគ្នានឹងលេខ (${session.expectedPhone}) ទេ!`,
    };
  }
  const upsertRes = upsertMember({
    targetMemberId: session.memberId,
    name: session.name || session.verifiedUser?.firstName || 'Telegram User',
    phone: verifiedPhone,
    phoneVerified: Boolean(verifiedPhone),
    telegramUsername: session.verifiedUser?.username ? `@${session.verifiedUser.username}` : '',
    telegramId: session.verifiedUser?.id,
    telegramVerified: true,
  });
  if (!upsertRes.ok) {
    return { ok: false, error: upsertRes.error };
  }
  const member = upsertRes.member;
  const token = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion || 1);
  return { ok: true, linked: true, token, member: toPublicMember(member) };
}

app.post('/api/auth/telegram/poll-link', async (req, res) => {
  const nonce = String(req.body?.nonce || '').trim();
  const session = tgLinkStore.get(nonce);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(404).json({ ok: false, error: 'តំណភ្ជាប់ផុតកំណត់ហើយ' });
  }

  if (session.error) {
    tgLinkStore.delete(nonce);
    return res.status(409).json({ ok: false, error: session.error });
  }
  if (session.mode === 'login' && session.verifiedUser) {
    const out = completeTelegramSession(nonce, session);
    return res.status(out.ok ? 200 : 409).json(out);
  }
  if (session.mode === 'contact' && session.verifiedUser && session.verifiedPhone) {
    const out = completeTelegramSession(nonce, session);
    return res.status(out.ok ? 200 : 409).json(out);
  }

  const botToken = getEffectiveBotToken();
  if (botToken) {
    await processTelegramUpdates(botToken);
  }

  const updated = tgLinkStore.get(nonce);
  if (updated) {
    if (updated.error) {
      tgLinkStore.delete(nonce);
      return res.status(409).json({ ok: false, error: updated.error });
    }
    if (updated.mode === 'login' && updated.verifiedUser) {
      const out = completeTelegramSession(nonce, updated);
      return res.status(out.ok ? 200 : 409).json(out);
    }
    if (updated.mode === 'contact' && updated.verifiedUser && updated.verifiedPhone) {
      const out = completeTelegramSession(nonce, updated);
      return res.status(out.ok ? 200 : 409).json(out);
    }
    return res.json({
      ok: true,
      linked: false,
      step: updated.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
    });
  }

  return res.json({
    ok: true,
    linked: false,
    step: session.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
  });
});

// ---- Automatic KHQR Payment Verification Endpoints (Bakong NBC MD5 + Telegram Bot Approval + Exact-Amount Slip) ----
app.post('/api/payments/khqr/create', (req, res) => {
  const amountUsd = Number(req.body?.amountUsd || 0);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return res.status(400).json({ ok: false, error: 'ចំនួនទឹកប្រាក់ត្រូវតែធំជាង $0.00' });
  }

  const currency: 'USD' | 'KHR' = req.body?.currency === 'KHR' ? 'KHR' : 'USD';
  const rawExpected = Number(req.body?.amountCurrency || amountUsd);
  const expectedAmount =
    currency === 'KHR'
      ? Math.max(100, Math.round(rawExpected))
      : Number(amountUsd.toFixed(2));
  const billNumber = sanitizeText(req.body?.billNumber, 28) || `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const khqrPayload = String(req.body?.khqrPayload || '').trim();
  const hasOfficialKhqr = khqrPayload.startsWith('000201');
  const md5 = hasOfficialKhqr
    ? md5Hex(khqrPayload)
    : md5Hex(`${billNumber}:${expectedAmount}:${currency}:${Date.now()}`);

  const sessionId = `PAYS-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const now = Date.now();
  const session: PaymentVerifySession = {
    id: sessionId,
    billNumber,
    md5,
    hasOfficialKhqr,
    expectedAmountUsd: Number(amountUsd.toFixed(2)),
    expectedAmount,
    currency,
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    status: 'pending',
    customerName: sanitizeText(req.body?.customerName, 60) || undefined,
    customerPhone: sanitizeText(req.body?.customerPhone, 25) || undefined,
  };
  paymentSessionStore.set(sessionId, session);

  return res.json({
    ok: true,
    sessionId,
    billNumber,
    md5,
    expectedAmountUsd: session.expectedAmountUsd,
    expectedAmount: session.expectedAmount,
    currency: session.currency,
    expiresInSeconds: 600,
    bakongVerifyReady: Boolean(getEffectiveBakongToken()),
    telegramOrderVerifyReady: Boolean(getEffectiveBotToken() && getEffectiveChatId()),
    slipAutoVerifyReady: Boolean(getEffectiveGeminiKey()),
  });
});

app.post('/api/payments/khqr/check', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const sess = paymentSessionStore.get(sessionId);
  if (!sess || sess.expiresAt < Date.now()) {
    paymentSessionStore.delete(sessionId);
    return res.status(404).json({
      ok: false,
      expired: true,
      error: 'វគ្គទូទាត់ផុតកំណត់ហើយ សូមបង្កើត QR ថ្មី',
    });
  }

  if (sess.status === 'verified') {
    return res.json({
      ok: true,
      status: 'verified',
      verified: true,
      verifiedBy: sess.verifiedBy || 'bakong_md5',
      paidAmount: sess.paidAmount ?? sess.expectedAmount,
      currency: sess.currency,
      transactionRef: sess.transactionRef || sess.billNumber,
      proofToken: signPaymentProofToken(sess),
    });
  }

  const bakongToken = getEffectiveBakongToken();
  if (bakongToken && sess.hasOfficialKhqr && sess.md5) {
    try {
      const bRes = await fetchWithTimeout(
        'https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bakongToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ md5: sess.md5 }),
        },
        6500
      );
      if (bRes.ok) {
        const bData = (await bRes.json()) as {
          responseCode?: number;
          responseMessage?: string;
          data?: {
            hash?: string;
            amount?: number | string;
            currency?: string;
            fromAccountId?: string;
            toAccountId?: string;
          } | null;
        };
        if (bData.responseCode === 0 && bData.data) {
          const paidAmt = Number(bData.data.amount || 0);
          const paidCur = String(bData.data.currency || sess.currency).toUpperCase();
          const txHash = String(bData.data.hash || '').trim();
          const tol = sess.currency === 'KHR' ? 100 : 0.01;

          if (isPaymentRefUsed(`md5:${sess.md5}`) || (txHash && isPaymentRefUsed(`tx:${txHash}`))) {
            sess.status = 'rejected';
            sess.error = 'ប្រតិបត្តិការណ៍ KHQR នេះត្រូវបានប្រើរួចហើយ!';
          } else if (paidCur !== sess.currency) {
            sess.status = 'amount_mismatch';
            sess.paidAmount = paidAmt;
            sess.error = `រូបិយប័ណ្ណមិនត្រូវគ្នាទេ (ទទួល ${paidAmt} ${paidCur} ≠ ត្រូវបង់ ${sess.expectedAmount} ${sess.currency})`;
          } else if (paidAmt + tol < sess.expectedAmount) {
            sess.status = 'amount_mismatch';
            sess.paidAmount = paidAmt;
            sess.error = `ទឹកប្រាក់វេរចូលមិនគ្រប់ចំនួនទេ! ទទួលបាន ${paidAmt} ${paidCur} (ខ្វះ ${(sess.expectedAmount - paidAmt).toFixed(sess.currency === 'KHR' ? 0 : 2)} ${sess.currency})`;
          } else {
            sess.status = 'verified';
            sess.verifiedBy = 'bakong_md5';
            sess.paidAmount = paidAmt;
            sess.transactionRef = txHash ? txHash.slice(0, 20) : sess.billNumber;
            sess.error = undefined;
            return res.json({
              ok: true,
              status: 'verified',
              verified: true,
              verifiedBy: 'bakong_md5',
              paidAmount: sess.paidAmount,
              currency: sess.currency,
              transactionRef: sess.transactionRef,
              proofToken: signPaymentProofToken(sess),
            });
          }
        }
      }
    } catch {
      // ignore transient Bakong API timeout
    }
  }

  const botToken = getEffectiveBotToken();
  if (botToken) {
    await processTelegramUpdates(botToken);
  }

  if (sess.status === 'verified') {
    return res.json({
      ok: true,
      status: 'verified',
      verified: true,
      verifiedBy: sess.verifiedBy || 'telegram_owner',
      paidAmount: sess.paidAmount ?? sess.expectedAmount,
      currency: sess.currency,
      transactionRef: sess.transactionRef || sess.billNumber,
      proofToken: signPaymentProofToken(sess),
    });
  }

  return res.json({
    ok: true,
    status: sess.status,
    verified: false,
    paidAmount: sess.paidAmount,
    currency: sess.currency,
    error: sess.error,
  });
});

app.post('/api/payments/khqr/request-telegram-verify', async (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`pay_tg_${ip}`, 8, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ ok: false, error: `សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី មុននឹងផ្ញើសំណើម្តងទៀត` });
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  const sess = paymentSessionStore.get(sessionId);
  if (!sess || sess.expiresAt < Date.now()) {
    return res.status(404).json({ ok: false, error: 'វគ្គទូទាត់ផុតកំណត់ហើយ សូមបង្កើត QR ថ្មី' });
  }
  if (sess.status === 'verified') {
    return res.json({
      ok: true,
      status: 'verified',
      verified: true,
      proofToken: signPaymentProofToken(sess),
    });
  }

  const botToken = getEffectiveBotToken();
  const chatId = getEffectiveChatId();
  if (!botToken || !chatId) {
    return res.status(503).json({
      ok: false,
      error: 'មិនទាន់បានកំណត់ Telegram Bot Token និង Group Chat ID ក្នុងការកំណត់ហាងទេ!',
    });
  }

  const enteredRef = sanitizeText(req.body?.paymentRef, 40);
  if (enteredRef && isPaymentRefUsed(`ref:${enteredRef.toLowerCase()}`)) {
    return res.status(400).json({
      ok: false,
      error: 'លេខប្រតិបត្តិការណ៍ (Transaction ID) នេះធ្លាប់បានប្រើប្រាស់រួចហើយ!',
    });
  }

  if (req.body?.paidAmount !== undefined && req.body?.paidAmount !== '') {
    const paidAmt = Number(req.body.paidAmount);
    const tol = sess.currency === 'KHR' ? 100 : 0.01;
    if (!Number.isFinite(paidAmt) || paidAmt + tol < sess.expectedAmount) {
      return res.status(400).json({
        ok: false,
        error: `ចំនួនលុយបញ្ចូលមិនគ្រប់តាមវិក្កយបត្រទេ! ត្រូវបង់ ${
          sess.currency === 'KHR'
            ? `${Math.round(sess.expectedAmount).toLocaleString()} ៛`
            : `$${sess.expectedAmountUsd.toFixed(2)}`
        }`,
      });
    }
  }

  const slipImg =
    typeof req.body?.slipImg === 'string' && req.body.slipImg.startsWith('data:image/')
      ? req.body.slipImg.slice(0, 750_000)
      : '';
  const custName = sanitizeText(req.body?.customerName, 60) || sess.customerName || 'ភ្ញៀវ Emerald Brew';
  const custPhone = sanitizeText(req.body?.customerPhone, 25) || sess.customerPhone || '-';
  const orderSummary = sanitizeText(req.body?.orderSummary, 180);

  sess.customerName = custName;
  sess.customerPhone = custPhone;
  if (enteredRef) sess.transactionRef = enteredRef;
  if (slipImg) sess.slipImg = slipImg;

  const shopBrand = getShopBrandTitle();
  const amtText =
    sess.currency === 'KHR'
      ? `${Math.round(sess.expectedAmount).toLocaleString()} ៛ ($${sess.expectedAmountUsd.toFixed(2)})`
      : `$${sess.expectedAmountUsd.toFixed(2)}`;
  const caption = [
    `💳 <b>${shopBrand} · ស្នើផ្ទៀងផ្ទាត់ការទូទាត់ KHQR</b>`,
    `🧾 វិក្កយបត្រ៖ <code>${sess.billNumber}</code>`,
    `💰 ត្រូវបង់គ្រប់៖ <b>${amtText}</b>`,
    `👤 អតិថិជន៖ ${custName} (${custPhone})`,
    enteredRef ? `🔖 លេខយោង៖ <code>${enteredRef}</code>` : '',
    orderSummary ? `☕ មុខទំនិញ៖ ${orderSummary}` : '',
    '',
    '👇 <i>សូមម្ចាស់ហាងពិនិត្យលុយចូលធនាគារ រួចចុចប៊ូតុងខាងក្រោម៖</i>',
  ]
    .filter(Boolean)
    .join('\n');

  const markup = {
    inline_keyboard: [
      [{ text: '✅ ទទួលលុយគ្រប់ (អនុញ្ញាតកម្ម៉ង់)', callback_data: `pay_ok:${sess.id}` }],
      [
        { text: '⚠️ ខ្វះចំនួនលុយ', callback_data: `pay_amt:${sess.id}` },
        { text: '❌ មិនទាន់ចូលទេ', callback_data: `pay_no:${sess.id}` },
      ],
    ],
  };

  let sent: { ok: boolean; messageId?: number } = { ok: false };
  let hasPhoto = false;
  if (slipImg) {
    sent = await sendTelegramBotPhoto(botToken, chatId, slipImg, caption, markup);
    hasPhoto = sent.ok;
  }
  if (!sent.ok) {
    sent = await sendTelegramBotMessage(botToken, chatId, caption, markup);
    hasPhoto = false;
  }

  if (!sent.ok) {
    return res.status(502).json({
      ok: false,
      error: 'មិនអាចផ្ញើសំណើទៅ Telegram ហាងបានទេ! សូមពិនិត្យ Bot Token & Chat ID',
    });
  }

  sess.status = 'awaiting_owner';
  sess.error = undefined;
  sess.telegramChatId = chatId;
  sess.telegramMessageId = sent.messageId;
  sess.telegramHasPhoto = hasPhoto;
  sess.telegramSentAt = Date.now();

  return res.json({
    ok: true,
    status: 'awaiting_owner',
    message: 'បានផ្ញើទៅ Telegram ហាងរួចរាល់! កំពុងរង់ចាំម្ចាស់ហាងចុចបញ្ជាក់...',
  });
});

app.post('/api/payments/khqr/verify-slip', async (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`slip_auto_${ip}`, 12, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ ok: false, error: `សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី មុននឹងស្កេនវិក្កយបត្រម្តងទៀត` });
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  const sess = paymentSessionStore.get(sessionId);
  if (!sess || sess.expiresAt < Date.now()) {
    return res.status(404).json({ ok: false, error: 'វគ្គទូទាត់ផុតកំណត់ហើយ សូមបង្កើត QR ថ្មី' });
  }

  if (sess.status === 'verified') {
    return res.json({
      ok: true,
      status: 'verified',
      verified: true,
      verifiedBy: sess.verifiedBy || 'auto_slip_ocr',
      paidAmount: sess.paidAmount ?? sess.expectedAmount,
      currency: sess.paidCurrency || sess.currency,
      transactionRef: sess.transactionRef || sess.billNumber,
      bankName: sess.bankName,
      slipHash: sess.slipHash,
      proofToken: signPaymentProofToken(sess),
    });
  }

  const cleanRef = sanitizeText(req.body?.paymentRef, 48);
  const slipImg =
    typeof req.body?.slipImg === 'string' && req.body.slipImg.startsWith('data:image/')
      ? req.body.slipImg.slice(0, 750_000)
      : '';

  if (!slipImg) {
    return res.status(400).json({
      ok: false,
      error: 'ដើម្បីសុវត្ថិភាពខ្ពស់បំផុត សូម Upload រូបវិក្កយបត្រវេរលុយពីធនាគារ (Bank Slip Screenshot)!',
    });
  }

  const slipHash = computeSlipSha256(slipImg);
  if (isPaymentRefUsed(`slip:${slipHash}`)) {
    sess.status = 'rejected';
    sess.error = 'រូបវិក្កយបត្រ (Slip) នេះធ្លាប់បានប្រើប្រាស់រួចហើយ! ហាមប្រើវិក្កយបត្រចាស់ម្តងទៀត។';
    return res.status(409).json({
      ok: false,
      status: 'rejected',
      error: sess.error,
    });
  }

  const geminiKey = getEffectiveGeminiKey();
  if (!geminiKey) {
    return res.status(503).json({
      ok: false,
      needsOwnerReview: true,
      error:
        'មិនទាន់បានកំណត់សេវាស្កេនវិក្កយបត្រ Auto (GEMINI_API_KEY) លើ Server ទេ! សូមចុច «ផ្ញើទៅ Telegram Bot ហាង» ដើម្បីឱ្យម្ចាស់ហាងចុចបញ្ជាក់ដោយសុវត្ថិភាព។',
    });
  }

  try {
    const ocr = await analyzeBankSlipWithGemini(geminiKey, slipImg, sess);
    const verdict = validateReceiptAgainstSession(ocr, sess, slipHash, cleanRef);
    if (!verdict.ok) {
      sess.status = verdict.status;
      sess.error = verdict.error;
      return res.status(verdict.httpStatus).json({
        ok: false,
        status: verdict.status,
        error: verdict.error,
        detected: {
          bankName: ocr.bankName,
          paidAmount: ocr.paidAmount,
          currency: ocr.currency,
          transactionId: ocr.transactionId,
          transferStatus: ocr.transferStatus,
        },
      });
    }

    sess.status = 'verified';
    sess.verifiedBy = 'auto_slip_ocr';
    sess.paidAmount = verdict.paidAmount;
    sess.paidCurrency = verdict.paidCurrency;
    sess.transactionRef = verdict.effectiveRef;
    sess.bankName = verdict.bankName;
    sess.slipHash = slipHash;
    sess.slipImg = slipImg;
    sess.error = undefined;

    return res.json({
      ok: true,
      status: 'verified',
      verified: true,
      verifiedBy: 'auto_slip_ocr',
      paidAmount: verdict.paidAmount,
      currency: verdict.paidCurrency,
      transactionRef: verdict.effectiveRef,
      bankName: verdict.bankName,
      slipHash,
      proofToken: signPaymentProofToken(sess),
    });
  } catch (err) {
    console.error('Slip OCR verification error:', err instanceof Error ? err.message : err);
    return res.status(502).json({
      ok: false,
      needsOwnerReview: true,
      error: 'ប្រព័ន្ធស្កេនវិក្កយបត្រមានភាពរអាក់រអួលបណ្តោះអាសន្ន! សូមសាកល្បងម្តងទៀត ឬផ្ញើទៅ Telegram ហាង។',
    });
  }
});

app.get('/api/payments/khqr/pending', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const now = Date.now();
  const pending = Array.from(paymentSessionStore.values())
    .filter((s) => s.expiresAt > now && (s.status === 'pending' || s.status === 'awaiting_owner'))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => ({
      id: s.id,
      billNumber: s.billNumber,
      expectedAmountUsd: s.expectedAmountUsd,
      expectedAmount: s.expectedAmount,
      currency: s.currency,
      status: s.status,
      transactionRef: s.transactionRef,
      customerName: s.customerName,
      customerPhone: s.customerPhone,
      slipImg: s.slipImg,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  return res.json({ ok: true, sessions: pending });
});

app.post('/api/payments/khqr/admin-decide', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const sessionId = String(req.body?.sessionId || '').trim();
  const decision = String(req.body?.decision || '').trim();
  const sess = paymentSessionStore.get(sessionId);
  if (!sess || sess.expiresAt < Date.now()) {
    return res.status(404).json({ ok: false, error: 'វគ្គទូទាត់នេះផុតកំណត់ ឬរួចរាល់ហើយ' });
  }

  const botToken = getEffectiveBotToken();
  if (decision === 'approve') {
    sess.status = 'verified';
    sess.verifiedBy = 'web_admin';
    sess.paidAmount = sess.expectedAmount;
    sess.transactionRef = sess.transactionRef || sess.billNumber;
    sess.error = undefined;
    if (botToken && sess.telegramMessageId) {
      await editTelegramPaymentMessage(
        botToken,
        sess,
        '✅ <b>ស្ថានភាព៖ បានបញ្ជាក់ទទួលលុយគ្រប់ (Website Admin)</b>'
      );
    }
    return res.json({ ok: true, status: 'verified' });
  }

  if (decision === 'amount_mismatch') {
    sess.status = 'amount_mismatch';
    sess.error = 'ម្ចាស់ហាងជូនដំណឹងថា ចំនួនលុយវេរចូលមិនគ្រប់តាមវិក្កយបត្រទេ! សូមពិនិត្យម្តងទៀត។';
    if (botToken && sess.telegramMessageId) {
      await editTelegramPaymentMessage(
        botToken,
        sess,
        '⚠️ <b>ស្ថានភាព៖ លុយចូលមិនគ្រប់ចំនួន (Website Admin)</b>'
      );
    }
    return res.json({ ok: true, status: 'amount_mismatch' });
  }

  sess.status = 'rejected';
  sess.error = 'ម្ចាស់ហាងជូនដំណឹងថា មិនទាន់ឃើញទឹកប្រាក់ចូលធនាគារទេ! សូមផ្ទៀងផ្ទាត់ម្តងទៀត។';
  if (botToken && sess.telegramMessageId) {
    await editTelegramPaymentMessage(
      botToken,
      sess,
      '❌ <b>ស្ថានភាព៖ មិនទាន់ទទួលបានប្រាក់ (Website Admin)</b>'
    );
  }
  return res.json({ ok: true, status: 'rejected' });
});

// ---- Official Telegram Mini App initData HMAC-SHA256 Verification ----
app.post('/api/auth/telegram/verify-webapp', (req, res) => {
  const initData = String(req.body?.initData || '');
  const botToken = getEffectiveBotToken();
  if (!initData || !botToken) {
    return res.status(400).json({ ok: false, error: 'Missing Telegram initData or Bot Token' });
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash') || '';
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!safeEqualHex(hash, expectedHash)) {
      return res.status(401).json({ ok: false, error: 'Telegram signature verification failed' });
    }

    const userRaw = params.get('user');
    const tgUser = userRaw
      ? (JSON.parse(userRaw) as {
          id: number;
          first_name?: string;
          last_name?: string;
          username?: string;
          photo_url?: string;
        })
      : null;
    if (!tgUser?.id) return res.status(400).json({ ok: false, error: 'Invalid Telegram user payload' });

    const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram User';
    const upsertRes = upsertMember({
      name: fullName,
      telegramId: String(tgUser.id),
      telegramUsername: tgUser.username ? `@${tgUser.username}` : '',
      telegramPhotoUrl: tgUser.photo_url,
      telegramVerified: true,
    });
    if (!upsertRes.ok) {
      return res.status(409).json({ ok: false, error: upsertRes.error });
    }
    const member = upsertRes.member;
    const token = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion || 1);
    return res.json({ ok: true, token, member: toPublicMember(member) });
  } catch {
    return res.status(400).json({ ok: false, error: 'Failed to parse Telegram WebApp data' });
  }
});

// ---- Session Inspection, Profile Update & Logout ----
app.get('/api/auth/me', (req, res) => {
  const auth = getAuthenticatedMember(req);
  if (!auth) return res.status(401).json({ ok: false });
  return res.json({ ok: true, member: toPublicMember(auth.member), expiresAt: auth.payload.exp });
});

app.put('/api/auth/me', (req, res) => {
  const auth = getAuthenticatedMember(req);
  if (!auth) {
    return res.status(401).json({ ok: false, error: 'សូមចូលគណនីជាមុនសិន' });
  }
  const { member, payload } = auth;

  const rawName = req.body?.name;
  const rawPhone = req.body?.phone;
  const rawTg = req.body?.telegramUsername;
  const rawPin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
  const currentPin = typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
  const clearPin = req.body?.clearPin === true;

  if (clearPin && !member.telegramVerified && !member.phoneVerified) {
    return res.status(400).json({
      ok: false,
      error: 'គណនីចុះឈ្មោះតាមទូរស័ព្ទត្រូវតែរក្សាទុកកូដ PIN ដើម្បីការពារការបន្លំ!',
    });
  }

  const isChangingPhone =
    typeof rawPhone === 'string' &&
    ((!rawPhone.trim() && Boolean(member.phone)) ||
      (Boolean(rawPhone.trim()) && normalizePhone(rawPhone.trim()) !== member.phone));

  if ((rawPin || clearPin || isChangingPhone) && member.pinHash && member.pinSalt) {
    const editLockKey = `mbr_edit_${member.id}`;
    const lock = pinLockoutMap.get(editLockKey);
    if (lock && lock.lockedUntil > Date.now()) {
      const secs = Math.ceil((lock.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ ok: false, error: `បញ្ចូល PIN ចាស់ខុសច្រើនដង! សូមរង់ចាំ ${secs} វិនាទី` });
    }
    if (!currentPin || !safeEqualHex(hashOtp(currentPin, member.pinSalt), member.pinHash)) {
      const failures = (lock?.failures || 0) + 1;
      if (failures >= 5) {
        pinLockoutMap.set(editLockKey, { failures: 0, lockedUntil: Date.now() + 5 * 60_000 });
        revokedTokens.add(payload.jti);
        return res.status(401).json({
          ok: false,
          sessionRevoked: true,
          error: 'បញ្ចូលកូដ PIN ចាស់ខុស ៥ ដង! សម័យចូលត្រូវបានផ្តាច់ដើម្បីសុវត្ថិភាព',
        });
      }
      pinLockoutMap.set(editLockKey, { failures, lockedUntil: 0 });
      return res.status(401).json({
        ok: false,
        error: `កូដ PIN ចាស់មិនត្រឹមត្រូវទេ (នៅសល់ ${5 - failures} ដង)!`,
      });
    }
    pinLockoutMap.delete(editLockKey);
  }

  if (rawPin) {
    if (!isValidMemberPin(rawPin)) {
      return res.status(400).json({
        ok: false,
        error: 'កូដ PIN ថ្មីត្រូវតែមានលេខ ៤ ដល់ ៨ ខ្ទង់',
      });
    }
    if (isWeakMemberPin(rawPin)) {
      return res.status(400).json({
        ok: false,
        error: 'កូដ PIN ថ្មីងាយទាយពេក! សូមជ្រើសរើសលេខផ្សេង (ជៀសវាង 1234 ឬលេខដូចគ្នា)',
      });
    }
  }

  if (typeof rawName === 'string') {
    const cleanName = sanitizeText(rawName, 60);
    if (!cleanName) {
      return res.status(400).json({ ok: false, error: 'សូមបញ្ចូលឈ្មោះរបស់អ្នក' });
    }
    member.name = cleanName;
  }

  if (typeof rawPhone === 'string') {
    const trimmed = rawPhone.trim();
    if (!trimmed) {
      if (!member.telegramId) {
        return res.status(400).json({ ok: false, error: 'សូមរក្សាទុកលេខទូរស័ព្ទយ៉ាងតិច ១ ខ្សែ' });
      }
      if (member.phone) memberIdByPhone.delete(member.phone);
      member.phone = '';
      member.phoneVerified = false;
    } else {
      const nextPhone = normalizePhone(trimmed);
      if (!isValidPhone(nextPhone)) {
        return res.status(400).json({
          ok: false,
          error: 'លេខទូរស័ព្ទមិនត្រឹមត្រូវទេ (ឧ. 012 345 678)',
        });
      }
      if (nextPhone !== member.phone) {
        const existingPhoneOwner = memberIdByPhone.get(nextPhone);
        if (existingPhoneOwner && existingPhoneOwner !== member.id) {
          return res.status(409).json({
            ok: false,
            error: 'លេខទូរស័ព្ទនេះមានគណនីផ្សេងប្រើរួចហើយ!',
          });
        }
        if (member.phone) memberIdByPhone.delete(member.phone);
        member.phone = nextPhone;
        member.phoneVerified = false;
        memberIdByPhone.set(nextPhone, member.id);
      }
    }
  }

  if (typeof rawTg === 'string') {
    const nextTg = normalizeTgUsername(rawTg);
    if (nextTg !== member.telegramUsername) {
      if (nextTg) {
        const existingTgOwner = memberIdByTgUsername.get(nextTg.toLowerCase());
        if (existingTgOwner && existingTgOwner !== member.id) {
          return res.status(409).json({
            ok: false,
            error: 'Telegram @username នេះត្រូវបានភ្ជាប់ជាមួយគណនីផ្សេងរួចហើយ!',
          });
        }
      }
      if (member.telegramUsername) {
        memberIdByTgUsername.delete(member.telegramUsername.toLowerCase());
      }
      member.telegramUsername = nextTg;
      if (nextTg) {
        memberIdByTgUsername.set(nextTg.toLowerCase(), member.id);
      }
    }
  }

  let rotatedToken: string | undefined;
  if (clearPin) {
    delete member.pinHash;
    delete member.pinSalt;
    member.tokenVersion = (member.tokenVersion || 1) + 1;
    rotatedToken = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion);
  } else if (rawPin) {
    const salt = crypto.randomBytes(16).toString('hex');
    member.pinSalt = salt;
    member.pinHash = hashOtp(rawPin, salt);
    member.tokenVersion = (member.tokenVersion || 1) + 1;
    rotatedToken = signSessionToken(member.id, 'member', 7 * 24 * 60 * 60 * 1000, member.tokenVersion);
  }

  member.lastLoginAt = Date.now();
  flushDb();
  return res.json({
    ok: true,
    member: toPublicMember(member),
    ...(rotatedToken ? { token: rotatedToken } : {}),
  });
});

app.post('/api/auth/logout-all', (req, res) => {
  const auth = getAuthenticatedMember(req);
  if (!auth) return res.status(401).json({ ok: false, error: 'សូមចូលគណនីជាមុនសិន' });
  auth.member.tokenVersion = (auth.member.tokenVersion || 1) + 1;
  revokedTokens.add(auth.payload.jti);
  flushDb();
  return res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const payload = verifySessionToken(extractBearer(req));
  if (payload) revokedTokens.add(payload.jti);
  return res.json({ ok: true });
});

// ---- Admin PIN Verification & Secure Server Secrets ----
app.post('/api/admin/verify-pin', (req, res) => {
  const ip = getClientIp(req);
  const lock = pinLockoutMap.get(ip);
  if (lock && lock.lockedUntil > Date.now()) {
    const secs = Math.ceil((lock.lockedUntil - Date.now()) / 1000);
    return res
      .status(429)
      .json({ ok: false, error: `បញ្ចូល PIN ខុសច្រើនដង! សូមរង់ចាំ ${secs} វិនាទី` });
  }

  const submittedPin = String(req.body?.pin || '').trim();
  const expectedPin = String(db.secrets.adminPin || '1234').trim();

  const a = Buffer.from(submittedPin);
  const b = Buffer.from(expectedPin);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    const failures = (lock?.failures || 0) + 1;
    if (failures >= 5) {
      pinLockoutMap.set(ip, { failures: 0, lockedUntil: Date.now() + 60_000 });
      return res.status(429).json({ ok: false, error: 'បញ្ចូល PIN ខុស ៥ ដង! ត្រូវបានចាក់សោ ៦០ វិនាទី' });
    }
    pinLockoutMap.set(ip, { failures, lockedUntil: 0 });
    return res.status(401).json({ ok: false, error: `លេខកូដ PIN មិនត្រឹមត្រូវ (នៅសល់ ${5 - failures} ដង)` });
  }

  pinLockoutMap.delete(ip);
  const adminToken = signSessionToken('owner-admin', 'admin', 12 * 60 * 60 * 1000);
  return res.json({ ok: true, adminToken });
});

app.get('/api/admin/config', (req, res) => {
  if (!requireAdmin(req, res)) return;
  return res.json({
    ok: true,
    secrets: db.secrets,
    members: Array.from(membersById.values()).map(toPublicMember),
  });
});

app.put('/api/admin/config', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const incoming = (req.body?.secrets || {}) as Partial<AdminSecrets>;
  db.secrets = {
    adminPin: String(incoming.adminPin ?? db.secrets.adminPin).trim() || '1234',
    botToken: String(incoming.botToken ?? db.secrets.botToken).trim(),
    chatId: String(incoming.chatId ?? db.secrets.chatId).trim(),
    bakongToken: String(incoming.bakongToken ?? db.secrets.bakongToken).trim(),
    telegramGatewayToken: String(incoming.telegramGatewayToken ?? db.secrets.telegramGatewayToken).trim(),
    twilioAccountSid: String(incoming.twilioAccountSid ?? db.secrets.twilioAccountSid).trim(),
    twilioAuthToken: String(incoming.twilioAuthToken ?? db.secrets.twilioAuthToken).trim(),
    twilioFromNumber: String(incoming.twilioFromNumber ?? db.secrets.twilioFromNumber).trim(),
    smsWebhookUrl: String(incoming.smsWebhookUrl ?? db.secrets.smsWebhookUrl).trim(),
    smsWebhookApiKey: String(incoming.smsWebhookApiKey ?? db.secrets.smsWebhookApiKey).trim(),
  };
  flushDb();
  return res.json({ ok: true, secrets: db.secrets });
});

app.post('/api/admin/telegram/test', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const candidateToken = String(req.body?.botToken ?? getEffectiveBotToken()).trim();
  const candidateGateway = String(req.body?.telegramGatewayToken ?? getEffectiveGatewayToken()).trim();

  if (!candidateToken && !candidateGateway) {
    return res.status(400).json({
      ok: false,
      error: 'សូមបញ្ចូល Telegram Bot Token (@BotFather) ឬ Telegram Gateway Token ជាមុនសិន',
    });
  }

  let botUsername = '';
  let botFirstName = '';
  let detectedChatId = '';
  let detectedChatTitle = '';

  if (candidateToken) {
    try {
      const meRes = await fetchWithTimeout(
        `https://api.telegram.org/bot${candidateToken}/getMe`,
        {},
        5000
      );
      const meData = (await meRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: { username?: string; first_name?: string };
      };
      if (!meData.ok || !meData.result?.username) {
        return res.status(400).json({
          ok: false,
          error: `Bot Token មិនត្រឹមត្រូវទេ៖ ${meData.description || 'Invalid Telegram Bot Token'}`,
        });
      }
      botUsername = meData.result.username;
      botFirstName = meData.result.first_name || botUsername;
      botUsernameCache.set(candidateToken, botUsername);

      if (!getEffectiveChatId()) {
        try {
          const updRes = await fetchWithTimeout(
            `https://api.telegram.org/bot${candidateToken}/getUpdates?limit=10&timeout=0`,
            {},
            4000
          );
          const updData = (await updRes.json()) as {
            ok?: boolean;
            result?: Array<{
              message?: { chat?: { id?: number | string; title?: string; username?: string; first_name?: string } };
              my_chat_member?: { chat?: { id?: number | string; title?: string; username?: string; first_name?: string } };
            }>;
          };
          if (updData.ok && Array.isArray(updData.result)) {
            for (let i = updData.result.length - 1; i >= 0; i--) {
              const chat = updData.result[i]?.message?.chat || updData.result[i]?.my_chat_member?.chat;
              if (chat?.id !== undefined) {
                detectedChatId = String(chat.id);
                detectedChatTitle = chat.title || chat.first_name || chat.username || '';
                break;
              }
            }
          }
        } catch {
          // optional chat discovery
        }
      }
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'មិនអាចភ្ជាប់ទៅ Telegram API (api.telegram.org) បានទេ',
      });
    }
  }

  return res.json({
    ok: true,
    botValid: Boolean(botUsername),
    botUsername,
    botFirstName,
    detectedChatId,
    detectedChatTitle,
    gatewayConfigured: Boolean(candidateGateway),
  });
});

// ---- Persistent Public Shop & Orders Sync ----
app.get('/api/shop', (_req, res) => {
  return res.json({
    ok: true,
    storagePersistent: true,
    menuItems: db.menuItems,
    toppings: db.toppings,
    shopSettings: db.shopSettings,
  });
});

app.put('/api/shop', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (Array.isArray(req.body?.menuItems)) db.menuItems = req.body.menuItems;
  if (Array.isArray(req.body?.toppings)) db.toppings = req.body.toppings;
  if (req.body?.shopSettings && typeof req.body.shopSettings === 'object') {
    db.shopSettings = req.body.shopSettings;
  }
  flushDb();
  return res.json({ ok: true, storagePersistent: true });
});

app.get('/api/orders', async (req, res) => {
  const botToken = getEffectiveBotToken();
  if (botToken && req.query.skipTg !== '1' && Date.now() - lastOrdersTgPollAt >= 1200) {
    lastOrdersTgPollAt = Date.now();
    await processTelegramUpdates(botToken);
  }
  const list = Array.from(serverOrders.values()).sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
  return res.json({ ok: true, orders: list });
});

app.post('/api/orders', async (req, res) => {
  const rawOrder = req.body as Record<string, unknown>;
  if (!rawOrder || typeof rawOrder.id !== 'string') {
    return res.status(400).json({ ok: false, error: 'Invalid order payload' });
  }
  const existingOrder = serverOrders.get(String(rawOrder.id));
  const order: Record<string, unknown> = existingOrder
    ? { ...existingOrder, ...rawOrder }
    : { ...rawOrder };
  const isNew = !existingOrder;
  const authMemberSession = getAuthenticatedMember(req);
  const callerIsAdmin = verifySessionToken(extractBearer(req))?.role === 'admin';

  if (isNew) {
    const rawCust =
      order.customer && typeof order.customer === 'object'
        ? { ...(order.customer as Record<string, unknown>) }
        : {};
    const rawPhoneStr = typeof rawCust.phone === 'string' ? rawCust.phone.trim() : '';
    const normCustPhone = rawPhoneStr ? normalizePhone(rawPhoneStr) : '';

    if (order.type === 'delivery' && !isValidPhone(normCustPhone)) {
      return res.status(400).json({
        ok: false,
        error: 'សូមបញ្ចូលលេខទូរស័ព្ទឲ្យបានត្រឹមត្រូវសម្រាប់ការដឹកជញ្ជូន (ឧ. 012 345 678)',
      });
    }
    if (normCustPhone) {
      rawCust.phone = normCustPhone;
      const ownerId = memberIdByPhone.get(normCustPhone);
      const phoneOwner = ownerId ? membersById.get(ownerId) : undefined;
      if (
        phoneOwner &&
        (phoneOwner.phoneVerified || phoneOwner.pinHash || phoneOwner.telegramVerified) &&
        authMemberSession?.member.id !== phoneOwner.id
      ) {
        return res.status(403).json({
          ok: false,
          requiresPhoneAuth: true,
          phone: normCustPhone,
          error:
            'លេខទូរស័ព្ទនេះបានចុះឈ្មោះសមាជិករួចហើយ! សូមចូលគណនី (PIN / Telegram / OTP) ជាមុនសិន ដើម្បីការពារការបន្លំលេខទូរស័ព្ទ។',
        });
      }
    }

    if (authMemberSession) {
      rawCust.memberId = authMemberSession.member.id;
      rawCust.memberVerified = true;
      rawCust.phoneVerified = Boolean(
        authMemberSession.member.phoneVerified &&
          normCustPhone &&
          normCustPhone === authMemberSession.member.phone
      );
    } else {
      // Never trust client-supplied memberId or phoneVerified without a verified Bearer session token
      delete rawCust.memberId;
      rawCust.memberVerified = false;
      rawCust.phoneVerified = false;
    }
    order.customer = rawCust;
  } else if (existingOrder && !callerIsAdmin) {
    // Lock sensitive identity & verified payment fields on non-admin updates
    const prevCust =
      existingOrder.customer && typeof existingOrder.customer === 'object'
        ? (existingOrder.customer as Record<string, unknown>)
        : {};
    const nextCust =
      order.customer && typeof order.customer === 'object'
        ? { ...(order.customer as Record<string, unknown>) }
        : { ...prevCust };
    if (prevCust.memberId !== undefined) nextCust.memberId = prevCust.memberId;
    else delete nextCust.memberId;
    nextCust.memberVerified = Boolean(prevCust.memberVerified);
    nextCust.phoneVerified = Boolean(prevCust.phoneVerified);
    order.customer = nextCust;

    order.grandTotal = existingOrder.grandTotal;
    order.paymentVerified = existingOrder.paymentVerified;
    order.paymentVerifiedBy = existingOrder.paymentVerifiedBy;
    order.paymentPaidAmount = existingOrder.paymentPaidAmount;
    order.paymentCurrency = existingOrder.paymentCurrency;
    order.paymentRef = existingOrder.paymentRef;
    order.paymentBankName = existingOrder.paymentBankName;
    order.paymentSlipHash = existingOrder.paymentSlipHash;
    order.paymentMd5 = existingOrder.paymentMd5;
  }

  if (isNew && order.payment === 'KHQR / ABA') {
    const proof = verifyPaymentProofToken(order.paymentProofToken);
    const expectedGrandTotal = Number(order.grandTotal || 0);
    if (!proof || proof.amtUsd + 0.02 < expectedGrandTotal) {
      return res.status(402).json({
        ok: false,
        error:
          'ការទូទាត់ KHQR មិនទាន់បានផ្ទៀងផ្ទាត់ ឬចំនួនទឹកប្រាក់មិនត្រឹមត្រូវទេ! សូមទូទាត់ និងផ្ទៀងផ្ទាត់ការបង់ប្រាក់ជាមុនសិន។',
      });
    }
    const refKey = proof.ref && proof.ref !== '-' ? `ref:${proof.ref.toLowerCase()}` : '';
    const md5Key = proof.by === 'bakong_md5' && proof.md5 ? `md5:${proof.md5}` : '';
    const slipKey = proof.slipHash ? `slip:${proof.slipHash}` : '';
    if (
      (md5Key && isPaymentRefUsed(md5Key)) ||
      (refKey && isPaymentRefUsed(refKey)) ||
      (slipKey && isPaymentRefUsed(slipKey))
    ) {
      return res.status(409).json({
        ok: false,
        error: 'ការទូទាត់ / វិក្កយបត្រ / លេខយោងប្រតិបត្តិការណ៍នេះត្រូវបានប្រើសម្រាប់ការកម្ម៉ង់មុនរួចហើយ!',
      });
    }
    markPaymentRefUsed([md5Key, refKey, slipKey]);
    paymentSessionStore.delete(proof.sid);

    order.paymentVerified = true;
    order.paymentVerifiedBy = proof.by;
    order.paymentPaidAmount = proof.amtCur;
    order.paymentCurrency = proof.cur;
    order.paymentRef = proof.ref;
    if (proof.bankName) order.paymentBankName = proof.bankName;
    if (proof.slipHash) order.paymentSlipHash = proof.slipHash;
    order.paymentMd5 = proof.md5;
  }
  delete order.paymentProofToken;

  serverOrders.set(String(order.id), order);

  if (isNew) {
    const cust = (order.customer || {}) as Record<string, unknown>;
    const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
    const earnedPoints = items.reduce((sum, it) => sum + Math.max(1, Number(it.qty) || 1), 0);
    if (earnedPoints > 0) {
      let targetMember: MemberRecord | undefined = authMemberSession?.member;
      if (!targetMember && order.payment === 'KHQR / ABA' && order.paymentVerified) {
        if (typeof cust.phone === 'string' && cust.phone.trim()) {
          const norm = normalizePhone(cust.phone);
          const byPhone = norm ? memberIdByPhone.get(norm) : undefined;
          if (byPhone) targetMember = membersById.get(byPhone);
        }
      }
      if (targetMember) {
        targetMember.points = (targetMember.points || 0) + earnedPoints;
      }
    }

    // Decrement defined stock quantities on ordered menu items
    if (items.length > 0 && Array.isArray(db.menuItems)) {
      const qtyByName = new Map<string, number>();
      for (const it of items) {
        const key = String(it.name || '').trim().toLowerCase();
        if (!key) continue;
        qtyByName.set(key, (qtyByName.get(key) || 0) + Math.max(1, Number(it.qty) || 1));
      }
      for (const m of db.menuItems as Array<Record<string, unknown>>) {
        if (typeof m.stockQty === 'number' && Number.isFinite(m.stockQty)) {
          const key = String(m.name || '').trim().toLowerCase();
          const orderedQty = qtyByName.get(key);
          if (orderedQty) {
            m.stockQty = Math.max(0, Math.round(m.stockQty) - orderedQty);
          }
        }
      }
    }
  }

  if (!isNew && existingOrder && existingOrder.status !== order.status && !order.confirmedAt && order.status !== 'Pending') {
    order.confirmedAt = Date.now();
    if (!order.confirmedBy) order.confirmedBy = 'website';
    serverOrders.set(String(order.id), order);
  }

  flushDb();

  // Send official Telegram Bot order alert with inline confirmation buttons, or sync status edits
  const botToken = getEffectiveBotToken();
  const chatId = getEffectiveChatId();
  if (isNew) {
    if (botToken && chatId) {
      const msg = buildOrderTelegramMessageText(order);
      const markup = getOrderTelegramKeyboard(String(order.id), order.status);
      const sent = await sendTelegramBotMessage(botToken, chatId, msg, markup);
      if (sent.ok && sent.messageId) {
        order.tgMessageId = sent.messageId;
        order.tgChatId = chatId;
        serverOrders.set(String(order.id), order);
        flushDb();
      }
    }
  } else if (existingOrder && existingOrder.status !== order.status && botToken && order.tgMessageId) {
    const footer =
      order.status === 'Brewing'
        ? '✅ <b>ស្ថានភាព៖ បានបញ្ជាក់ & កំពុងរៀបចំ (Website Admin)</b>'
        : order.status === 'Ready'
          ? '🚀 <b>ស្ថានភាព៖ រួចរាល់ / កំពុងដឹកជញ្ជូន (Website Admin)</b>'
          : order.status === 'Completed'
            ? '✔️ <b>ស្ថានភាព៖ បានបញ្ចប់រួចរាល់ (Website Admin)</b>'
            : undefined;
    editTelegramOrderMessage(botToken, order, footer).catch(() => {});
  }

  return res.json({ ok: true, order });
});

app.post('/api/orders/:id/feedback', (req, res) => {
  const orderId = String(req.params.id || '').trim();
  const existing = serverOrders.get(orderId);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'រកមិនឃើញការកម្ម៉ង់នេះទេ' });
  }
  if (existing.status !== 'Completed') {
    return res.status(400).json({ ok: false, error: 'អាចវាយតម្លៃបានតែការកម្ម៉ង់ដែលបានបញ្ចប់ប៉ុណ្ណោះ' });
  }

  const rating = Math.round(Number(req.body?.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: 'សូមជ្រើសរើសផ្កាយពី ១ ដល់ ៥' });
  }
  const comment = String(req.body?.comment || '').trim().slice(0, 500);
  const cust = (existing.customer || {}) as Record<string, unknown>;
  const customerName = String(req.body?.customerName || cust.name || '').trim() || undefined;

  const updated = {
    ...existing,
    feedback: {
      rating,
      comment,
      submittedAt: Date.now(),
      customerName,
    },
  };
  serverOrders.set(orderId, updated);
  flushDb();
  return res.json({ ok: true, order: updated });
});

app.delete('/api/orders/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  serverOrders.delete(req.params.id);
  flushDb();
  return res.json({ ok: true });
});

app.get('/api/resolve-map-link', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl || rawUrl.length > 1000) {
    return res.status(400).json({ ok: false, error: 'តំណរ Google Maps មិនត្រឹមត្រូវ' });
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ ok: false, error: 'តំណរ Google Maps មិនត្រឹមត្រូវ' });
  }
  const allowedHosts = new Set([
    'maps.app.goo.gl',
    'goo.gl',
    'g.co',
    'maps.google.com',
    'google.com',
    'www.google.com',
  ]);
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'គាំទ្រតែតំណរ Google Maps ប៉ុណ្ណោះ' });
  }

  const extractFromString = (txt: string): { lat: number; lng: number } | null => {
    let decoded = txt;
    try {
      decoded = decodeURIComponent(txt);
    } catch {
      // ignore
    }
    const patterns = [
      /!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/,
      /@(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
      /[?&](?:q|ll|destination|center|sll)=(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
      /https?:\/\/(?:www\.)?google\.[^"'\s]+\/@(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,
    ];
    for (const re of patterns) {
      const m = decoded.match(re) || txt.match(re);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat, lng };
        }
      }
    }
    return null;
  };

  const direct = extractFromString(rawUrl);
  if (direct) {
    return res.json({ ok: true, ...direct, resolvedUrl: rawUrl });
  }

  try {
    const resp = await fetchWithTimeout(
      parsed.toString(),
      {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SuanCoffeeBot/1.0)',
        },
      },
      7000
    );
    const finalUrl = resp.url || rawUrl;
    const fromFinalUrl = extractFromString(finalUrl);
    if (fromFinalUrl) {
      return res.json({ ok: true, ...fromFinalUrl, resolvedUrl: finalUrl });
    }
    const html = (await resp.text()).slice(0, 60000);
    const fromHtml = extractFromString(html);
    if (fromHtml) {
      return res.json({ ok: true, ...fromHtml, resolvedUrl: finalUrl });
    }
    return res.status(404).json({ ok: false, error: 'រកមិនឃើញកូអរដោនេក្នុង Link នេះទេ' });
  } catch {
    return res.status(502).json({ ok: false, error: 'មិនអាចបើក Link Google Maps បានទេ' });
  }
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err && typeof err === 'object' && ('type' in err || err instanceof SyntaxError)) {
      return res.status(400).json({ ok: false, error: 'ទិន្នន័យសំណើមិនត្រឹមត្រូវ ឬធំពេក' });
    }
    return next(err);
  }
);

// ---- Vite Dev Middleware / Production Static Serving ----
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Emerald Brew Cafe server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '5mb' }));

// Security headers (iframe-compatible for preview while enforcing XSS/MIME protections)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  next();
});

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
  createdAt: number;
  lastLoginAt: number;
}

interface AdminSecrets {
  adminPin: string;
  botToken: string;
  chatId: string;
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
      telegramGatewayToken: process.env.TELEGRAM_GATEWAY_TOKEN || '',
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
      twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
      smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
      smsWebhookApiKey: process.env.SMS_WEBHOOK_API_KEY || '',
    },
    lastTelegramUpdateOffset: 0,
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
  phone?: string;
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

const otpStore = new Map<string, OtpChallenge>();
const tgLinkStore = new Map<string, TelegramLinkSession>();
const revokedTokens = new Set<string>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const pinLockoutMap = new Map<string, { failures: number; lockedUntil: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) if (v.expiresAt < now) otpStore.delete(k);
  for (const [k, v] of tgLinkStore.entries()) if (v.expiresAt < now) tgLinkStore.delete(k);
  for (const [k, v] of rateLimitMap.entries()) if (v.resetAt < now) rateLimitMap.delete(k);
}, 60_000).unref();

// ---- Helper Functions ----
function getEffectiveBotToken(): string {
  return (db.secrets.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
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
  jti: string;
  iat: number;
  exp: number;
}

function signSessionToken(
  sub: string,
  role: 'member' | 'admin',
  ttlMs = 7 * 24 * 60 * 60 * 1000
): string {
  const now = Date.now();
  const payload: TokenPayload = {
    sub,
    role,
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

function upsertMember(params: {
  name?: string;
  phone?: string;
  phoneVerified?: boolean;
  telegramUsername?: string;
  telegramId?: string;
  telegramPhotoUrl?: string;
  telegramVerified?: boolean;
  pointsDelta?: number;
}): MemberRecord {
  let existingId: string | undefined;
  if (params.telegramId && memberIdByTgId.has(params.telegramId)) {
    existingId = memberIdByTgId.get(params.telegramId);
  } else if (params.phone && memberIdByPhone.has(params.phone)) {
    existingId = memberIdByPhone.get(params.phone);
  } else if (params.telegramUsername && memberIdByTgUsername.has(params.telegramUsername.toLowerCase())) {
    existingId = memberIdByTgUsername.get(params.telegramUsername.toLowerCase());
  }

  const now = Date.now();
  let rec: MemberRecord;
  if (existingId && membersById.has(existingId)) {
    rec = membersById.get(existingId)!;
    if (params.name) rec.name = params.name;
    if (params.phone) rec.phone = params.phone;
    if (params.phoneVerified) rec.phoneVerified = true;
    if (params.telegramUsername) rec.telegramUsername = params.telegramUsername;
    if (params.telegramId) rec.telegramId = params.telegramId;
    if (params.telegramPhotoUrl) rec.telegramPhotoUrl = params.telegramPhotoUrl;
    if (params.telegramVerified) rec.telegramVerified = true;
    if (params.pointsDelta) rec.points += params.pointsDelta;
    rec.lastLoginAt = now;
  } else {
    const id = `MBR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    rec = {
      id,
      name: params.name || 'អតិថិជន Emerald Brew',
      phone: params.phone || '',
      phoneVerified: Boolean(params.phoneVerified),
      telegramUsername: params.telegramUsername || '',
      telegramId: params.telegramId,
      telegramPhotoUrl: params.telegramPhotoUrl,
      telegramVerified: Boolean(params.telegramVerified),
      points: Math.max(1, params.pointsDelta || 1),
      createdAt: now,
      lastLoginAt: now,
    };
    membersById.set(id, rec);
  }

  if (rec.phone) memberIdByPhone.set(rec.phone, rec.id);
  if (rec.telegramId) memberIdByTgId.set(rec.telegramId, rec.id);
  if (rec.telegramUsername) memberIdByTgUsername.set(rec.telegramUsername.toLowerCase(), rec.id);
  flushDb();
  return rec;
}

async function sendTelegramBotMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<boolean> {
  if (!botToken || !chatId) return false;
  try {
    const body: Record<string, unknown> = { chat_id: chatId.trim(), text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

// ---- Official Auth Capabilities ----
app.get('/api/auth/capabilities', async (_req, res) => {
  const botToken = getEffectiveBotToken();
  let botUsername = getEffectiveBotUsername();

  if (botToken && !botUsername) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const meData = (await meRes.json()) as { ok?: boolean; result?: { username?: string } };
      if (meData.ok && meData.result?.username) {
        botUsername = meData.result.username;
      }
    } catch {
      // ignore
    }
  }

  const phoneOtpChannel = detectPhoneOtpChannel();
  const botReady = Boolean(botToken && botUsername);
  return res.json({
    ok: true,
    telegramWidgetReady: botReady,
    telegramBotReady: botReady,
    telegramContactReady: botReady,
    phoneOtpReady: phoneOtpChannel !== 'none',
    phoneOtpChannel,
    botUsername,
  });
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
      const gwRes = await fetch('https://gatewayapi.telegram.org/sendVerificationMessage', {
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
      });
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
      const twRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(tw.sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${tw.sid}:${tw.token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
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
    const whRes = await fetch(wh.url, {
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
    });
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
  const member = upsertMember({
    name: sanitizeText(req.body?.name, 60) || challenge.name,
    phone,
    phoneVerified: true,
    telegramUsername: normalizeTgUsername(req.body?.telegramUsername) || challenge.telegramUsername,
  });
  const token = signSessionToken(member.id, 'member');
  return res.json({ ok: true, token, member });
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

  const member = upsertMember({
    name: fullName,
    telegramId: String(user.id),
    telegramUsername: username,
    telegramPhotoUrl: typeof user.photo_url === 'string' ? user.photo_url : undefined,
    telegramVerified: true,
  });
  const token = signSessionToken(member.id, 'member');
  return res.json({ ok: true, token, member });
});

// ---- Official Telegram Bot 1-Click Deep Link & Free Share-Contact Phone Verification ----
app.post('/api/auth/telegram/init-link', async (req, res) => {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`tg_init_${ip}`, 12, 5 * 60 * 1000);
  if (!rl.allowed) {
    return res.status(429).json({ ok: false, error: 'សូមរង់ចាំបន្តិចមុននឹងបង្កើតតំណភ្ជាប់ថ្មី' });
  }

  const botToken = getEffectiveBotToken();
  let botUsername = getEffectiveBotUsername();

  if (!botToken) {
    return res.status(503).json({
      ok: false,
      error:
        'សូមម្ចាស់ហាងបញ្ចូល Telegram Bot Token (ឥតគិតថ្លៃពី @BotFather) ក្នុងផ្ទាំងគ្រប់គ្រងហាង ដើម្បីបើកដំណើរការការភ្ជាប់ Telegram ផ្លូវការ។',
    });
  }

  if (!botUsername) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const meData = (await meRes.json()) as { ok?: boolean; result?: { username?: string } };
      if (meData.ok && meData.result?.username) {
        botUsername = meData.result.username;
      }
    } catch {
      // ignore
    }
  }

  if (!botUsername) {
    return res.status(503).json({
      ok: false,
      error: 'មិនអាចទាញយក Bot Username បានទេ! សូមពិនិត្យ Bot Token និង Bot Username ក្នុងផ្ទាំងគ្រប់គ្រង។',
    });
  }

  const mode = req.body?.mode === 'contact' ? 'contact' : 'login';
  const prefix = mode === 'contact' ? 'ph' : 'eb';
  const nonce = `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
  tgLinkStore.set(nonce, {
    nonce,
    mode,
    name: sanitizeText(req.body?.name, 60),
    phone: normalizePhone(String(req.body?.phone || '')) || undefined,
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
  const verifiedPhone = session.verifiedPhone || session.phone;
  const member = upsertMember({
    name: session.name || session.verifiedUser?.firstName || 'Telegram User',
    phone: verifiedPhone,
    phoneVerified: Boolean(session.verifiedPhone || session.phone),
    telegramUsername: session.verifiedUser?.username ? `@${session.verifiedUser.username}` : '',
    telegramId: session.verifiedUser?.id,
    telegramVerified: true,
  });
  const token = signSessionToken(member.id, 'member');
  return { ok: true, linked: true, token, member };
}

app.post('/api/auth/telegram/poll-link', async (req, res) => {
  const nonce = String(req.body?.nonce || '').trim();
  const session = tgLinkStore.get(nonce);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(404).json({ ok: false, error: 'តំណភ្ជាប់ផុតកំណត់ហើយ' });
  }

  if (session.mode === 'login' && session.verifiedUser) {
    return res.json(completeTelegramSession(nonce, session));
  }
  if (session.mode === 'contact' && session.verifiedUser && session.verifiedPhone) {
    return res.json(completeTelegramSession(nonce, session));
  }

  const botToken = getEffectiveBotToken();
  if (!botToken) {
    return res.json({
      ok: true,
      linked: false,
      step: session.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
    });
  }

  try {
    const updRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?offset=${db.lastTelegramUpdateOffset}&limit=30&timeout=0`
    );
    const updData = (await updRes.json()) as {
      ok?: boolean;
      result?: Array<{
        update_id: number;
        message?: {
          text?: string;
          from?: { id: number; username?: string; first_name?: string };
          contact?: {
            phone_number?: string;
            first_name?: string;
            user_id?: number;
          };
        };
      }>;
    };

    if (updData.ok && Array.isArray(updData.result)) {
      let offsetChanged = false;
      for (const upd of updData.result) {
        if (upd.update_id >= db.lastTelegramUpdateOffset) {
          db.lastTelegramUpdateOffset = upd.update_id + 1;
          offsetChanged = true;
        }
        const msg = upd.message;
        const from = msg?.from;
        if (!msg || !from) continue;

        const msgText = msg.text || '';
        if (msgText.includes('/start')) {
          const parts = msgText.trim().split(/\s+/);
          const matchedNonce = parts[1];
          if (matchedNonce && tgLinkStore.has(matchedNonce)) {
            const targetSess = tgLinkStore.get(matchedNonce)!;
            targetSess.startedByTelegramId = String(from.id);
            targetSess.verifiedUser = {
              id: String(from.id),
              username: from.username || '',
              firstName: from.first_name || 'Telegram User',
            };

            if (targetSess.mode === 'contact') {
              await sendTelegramBotMessage(
                botToken,
                String(from.id),
                `📱 <b>Emerald Brew Cafe</b>\nសូមចុចប៊ូតុង <b>«📱 ចុចផ្ញើលេខទូរស័ព្ទផ្ទៀងផ្ទាត់»</b> ខាងក្រោម ដើម្បីបញ្ជាក់លេខទូរស័ព្ទពិតរបស់អ្នកដោយឥតគិតថ្លៃ ១០០%!`,
                {
                  keyboard: [
                    [
                      {
                        text: '📱 ចុចផ្ញើលេខទូរស័ព្ទផ្ទៀងផ្ទាត់ (Free)',
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
                `✅ <b>Emerald Brew Cafe</b>\nគណនី Telegram របស់អ្នក (${from.first_name || 'User'}) ត្រូវបានភ្ជាប់ដោយសុវត្ថិភាពរួចរាល់!`
              );
            }
          }
        }

        // Verify authentic Telegram Share Contact (must match sender's own Telegram user_id)
        if (msg.contact?.phone_number && Number(msg.contact.user_id) === Number(from.id)) {
          const verifiedPhone = normalizePhone(msg.contact.phone_number);
          if (isValidPhone(verifiedPhone)) {
            for (const cand of tgLinkStore.values()) {
              if (
                cand.mode === 'contact' &&
                cand.expiresAt >= Date.now() &&
                cand.startedByTelegramId === String(from.id)
              ) {
                cand.verifiedPhone = verifiedPhone;
                cand.verifiedUser = cand.verifiedUser || {
                  id: String(from.id),
                  username: from.username || '',
                  firstName: from.first_name || msg.contact.first_name || 'Telegram User',
                };
              }
            }
            await sendTelegramBotMessage(
              botToken,
              String(from.id),
              `✅ <b>Emerald Brew Cafe</b>\nលេខទូរស័ព្ទ <b>${verifiedPhone}</b> ត្រូវបានផ្ទៀងផ្ទាត់ដោយជោគជ័យ (Free ១០០%)!\nសូមត្រឡប់ទៅគេហទំព័រវិញ។`,
              { remove_keyboard: true }
            );
          }
        }
      }
      if (offsetChanged) flushDb();
    }

    const updated = tgLinkStore.get(nonce);
    if (updated) {
      if (updated.mode === 'login' && updated.verifiedUser) {
        return res.json(completeTelegramSession(nonce, updated));
      }
      if (updated.mode === 'contact' && updated.verifiedUser && updated.verifiedPhone) {
        return res.json(completeTelegramSession(nonce, updated));
      }
      return res.json({
        ok: true,
        linked: false,
        step: updated.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
      });
    }
  } catch {
    // non-fatal poll failure
  }

  return res.json({
    ok: true,
    linked: false,
    step: session.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
  });
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
    const member = upsertMember({
      name: fullName,
      telegramId: String(tgUser.id),
      telegramUsername: tgUser.username ? `@${tgUser.username}` : '',
      telegramPhotoUrl: tgUser.photo_url,
      telegramVerified: true,
    });
    const token = signSessionToken(member.id, 'member');
    return res.json({ ok: true, token, member });
  } catch {
    return res.status(400).json({ ok: false, error: 'Failed to parse Telegram WebApp data' });
  }
});

// ---- Session Inspection & Logout ----
app.get('/api/auth/me', (req, res) => {
  const payload = verifySessionToken(extractBearer(req));
  if (!payload || payload.role !== 'member') {
    return res.status(401).json({ ok: false });
  }
  const member = membersById.get(payload.sub);
  if (!member) return res.status(404).json({ ok: false });
  return res.json({ ok: true, member, expiresAt: payload.exp });
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
    members: Array.from(membersById.values()),
  });
});

app.put('/api/admin/config', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const incoming = (req.body?.secrets || {}) as Partial<AdminSecrets>;
  db.secrets = {
    adminPin: String(incoming.adminPin ?? db.secrets.adminPin).trim() || '1234',
    botToken: String(incoming.botToken ?? db.secrets.botToken).trim(),
    chatId: String(incoming.chatId ?? db.secrets.chatId).trim(),
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

// ---- Persistent Public Shop & Orders Sync ----
app.get('/api/shop', (_req, res) => {
  return res.json({
    ok: true,
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
  return res.json({ ok: true });
});

app.get('/api/orders', (_req, res) => {
  const list = Array.from(serverOrders.values()).sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
  return res.json({ ok: true, orders: list });
});

app.post('/api/orders', async (req, res) => {
  const order = req.body as Record<string, unknown>;
  if (!order || typeof order.id !== 'string') {
    return res.status(400).json({ ok: false, error: 'Invalid order payload' });
  }
  const isNew = !serverOrders.has(order.id);
  serverOrders.set(order.id, order);
  flushDb();

  // Send official Telegram Bot order alert from server when a new order arrives
  if (isNew) {
    const botToken = getEffectiveBotToken();
    const chatId = (db.secrets.chatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    if (botToken && chatId) {
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
      const msg = `🔔 <b>កម្ម៉ង់ថ្មី ${order.id}</b> (${order.timestamp})\n👤 ${cust.name || '-'} (${cust.phone || '-'})\n${locTxt}\n\n${itemsTxt}\n\n💵 សរុប៖ <b>$${Number(order.grandTotal || 0).toFixed(2)}</b> (${order.payment})`;
      sendTelegramBotMessage(botToken, chatId, msg).catch(() => {});
    }
  }

  return res.json({ ok: true, order });
});

app.delete('/api/orders/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  serverOrders.delete(req.params.id);
  flushDb();
  return res.json({ ok: true });
});

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

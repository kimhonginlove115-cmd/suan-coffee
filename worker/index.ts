// Cloudflare Workers Full-Stack Backend for Emerald Brew Cafe
// Uses 100% Web Standards (crypto.subtle, fetch, KVNamespace) — zero Node.js built-ins required.

import { md5Hex } from '../src/utils/md5';

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface AssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBindingLike;
  CAFE_KV?: KVNamespaceLike;
  SESSION_SECRET?: string;
  ADMIN_PIN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_CHAT_ID?: string;
  BAKONG_API_TOKEN?: string;
  TELEGRAM_GATEWAY_TOKEN?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  SMS_WEBHOOK_URL?: string;
  SMS_WEBHOOK_API_KEY?: string;
}

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
  verifiedBy?: 'bakong_md5' | 'telegram_owner' | 'slip_ref';
  paidAmount?: number;
  transactionRef?: string;
  customerName?: string;
  customerPhone?: string;
  slipImg?: string;
  telegramChatId?: string;
  telegramMessageId?: number;
  telegramHasPhoto?: boolean;
  telegramSentAt?: number;
  error?: string;
}

interface PaymentProofPayload {
  sid: string;
  amtUsd: number;
  amtCur: number;
  cur: 'USD' | 'KHR';
  by: 'bakong_md5' | 'telegram_owner' | 'slip_ref';
  md5: string;
  ref: string;
  iat: number;
  exp: number;
}

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

interface TokenPayload {
  sub: string;
  role: 'member' | 'admin';
  jti: string;
  iat: number;
  exp: number;
}

const DB_KV_KEY = 'emerald_brew_db_v1';
const memoryFallbackStore = new Map<string, { value: string; expiresAt?: number }>();
const botUsernameCache = new Map<string, string>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

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

// ---- KV + In-Memory Fallback Store ----
async function kvGet(env: Env, key: string): Promise<string | null> {
  if (env.CAFE_KV) {
    return env.CAFE_KV.get(key);
  }
  const hit = memoryFallbackStore.get(key);
  if (!hit) return null;
  if (hit.expiresAt && hit.expiresAt < Date.now()) {
    memoryFallbackStore.delete(key);
    return null;
  }
  return hit.value;
}

async function kvPut(env: Env, key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (env.CAFE_KV) {
    await env.CAFE_KV.put(key, value, ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : undefined);
    return;
  }
  memoryFallbackStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
  });
}

async function kvDelete(env: Env, key: string): Promise<void> {
  if (env.CAFE_KV) {
    await env.CAFE_KV.delete(key);
    return;
  }
  memoryFallbackStore.delete(key);
}

// ---- Web Crypto Helpers ----
function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(new ArrayBuffer(len));
  crypto.getRandomValues(arr);
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomHex(byteLen: number): string {
  return bytesToHex(randomBytes(byteLen));
}

function randomSixDigitOtp(): string {
  const limit = 4294967296 - (4294967296 % 900000);
  const arr = new Uint32Array(1);
  let val = 0;
  do {
    crypto.getRandomValues(arr);
    val = arr[0];
  } while (val >= limit);
  return String(100000 + (val % 900000));
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  return constantTimeEqualBytes(encoder.encode(a), encoder.encode(b));
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = hexToBytes(a);
  const bufB = hexToBytes(b);
  if (!bufA || !bufB) return false;
  return constantTimeEqualBytes(bufA, bufB);
}

async function sha256Bytes(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(input));
}

async function sha256Hex(input: string): Promise<string> {
  return bytesToHex(new Uint8Array(await sha256Bytes(input)));
}

async function hmacSha256RawKey(keyData: BufferSource, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

async function signSessionToken(
  secret: string,
  sub: string,
  role: 'member' | 'admin',
  ttlMs = 7 * 24 * 60 * 60 * 1000
): Promise<string> {
  const now = Date.now();
  const payload: TokenPayload = {
    sub,
    role,
    jti: randomHex(12),
    iat: now,
    exp: now + ttlMs,
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sigBytes = await hmacSha256RawKey(encoder.encode(secret), encoded);
  return `${encoded}.${toBase64Url(sigBytes)}`;
}

async function verifySessionToken(
  env: Env,
  secret: string,
  token: string | undefined
): Promise<TokenPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedBytes = await hmacSha256RawKey(encoder.encode(secret), encoded);
  const expectedSig = toBase64Url(expectedBytes);
  if (!constantTimeEqualStrings(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encoded))) as TokenPayload;
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    const revoked = await kvGet(env, `revoked:${payload.jti}`);
    if (revoked) return null;
    return payload;
  } catch {
    return null;
  }
}

async function signPaymentProofToken(secret: string, sess: PaymentVerifySession): Promise<string> {
  const now = Date.now();
  const payload: PaymentProofPayload = {
    sid: sess.id,
    amtUsd: Number(sess.expectedAmountUsd.toFixed(2)),
    amtCur: sess.expectedAmount,
    cur: sess.currency,
    by: sess.verifiedBy || 'slip_ref',
    md5: sess.md5,
    ref: sess.transactionRef || sess.billNumber,
    iat: now,
    exp: now + 30 * 60 * 1000,
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sigBytes = await hmacSha256RawKey(encoder.encode(secret), `pay1:${encoded}`);
  return `pay1.${encoded}.${toBase64Url(sigBytes)}`;
}

async function verifyPaymentProofToken(secret: string, token: unknown): Promise<PaymentProofPayload | null> {
  if (!token || typeof token !== 'string' || !token.startsWith('pay1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = toBase64Url(await hmacSha256RawKey(encoder.encode(secret), `pay1:${encoded}`));
  if (!constantTimeEqualStrings(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encoded))) as PaymentProofPayload;
    if (!payload.sid || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function isPaymentRefUsed(db: PersistedDatabase, key: string): boolean {
  if (!key) return false;
  return Array.isArray(db.usedPaymentRefs) && db.usedPaymentRefs.includes(key);
}

function markPaymentRefUsed(db: PersistedDatabase, keys: Array<string | undefined>): void {
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

// ---- Database Load / Save ----
async function loadDb(env: Env): Promise<PersistedDatabase> {
  const envSecret = env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 ? env.SESSION_SECRET : '';
  const fallbackEphemeralSecret =
    !env.CAFE_KV && !envSecret
      ? await sha256Hex(`${env.ADMIN_PIN || '1234'}:suan-coffee-ephemeral-session-v1`)
      : '';
  const defaults: PersistedDatabase = {
    sessionSecret: envSecret || fallbackEphemeralSecret || randomHex(32),
    members: [],
    orders: [],
    menuItems: null,
    toppings: null,
    shopSettings: null,
    secrets: {
      adminPin: env.ADMIN_PIN || '1234',
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      chatId: env.TELEGRAM_CHAT_ID || '',
      bakongToken: env.BAKONG_API_TOKEN || '',
      telegramGatewayToken: env.TELEGRAM_GATEWAY_TOKEN || '',
      twilioAccountSid: env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: env.TWILIO_AUTH_TOKEN || '',
      twilioFromNumber: env.TWILIO_FROM_NUMBER || '',
      smsWebhookUrl: env.SMS_WEBHOOK_URL || '',
      smsWebhookApiKey: env.SMS_WEBHOOK_API_KEY || '',
    },
    lastTelegramUpdateOffset: 0,
    usedPaymentRefs: [],
  };

  try {
    const raw = await kvGet(env, DB_KV_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
      return {
        ...defaults,
        ...parsed,
        sessionSecret: envSecret || parsed.sessionSecret || defaults.sessionSecret,
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
    // fallback to defaults
  }

  await saveDb(env, defaults);
  return defaults;
}

async function saveDb(env: Env, db: PersistedDatabase): Promise<void> {
  await kvPut(env, DB_KV_KEY, JSON.stringify(db));
}

// ---- Helpers ----
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  );
}

function extractBearer(req: Request): string | undefined {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return undefined;
}

async function checkRateLimit(env: Env, key: string, maxRequests: number, windowSeconds: number) {
  const rlKey = `rl:${key}`;
  const now = Date.now();
  const raw = await kvGet(env, rlKey);
  let state: { count: number; resetAt: number } | null = null;
  if (raw) {
    try {
      state = JSON.parse(raw) as { count: number; resetAt: number };
    } catch {
      state = null;
    }
  }
  if (!state || state.resetAt < now) {
    await kvPut(env, rlKey, JSON.stringify({ count: 1, resetAt: now + windowSeconds * 1000 }), windowSeconds);
    return { allowed: true, retryAfterSec: 0 };
  }
  if (state.count >= maxRequests) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((state.resetAt - now) / 1000)) };
  }
  state.count += 1;
  const remainingSec = Math.max(60, Math.ceil((state.resetAt - now) / 1000));
  await kvPut(env, rlKey, JSON.stringify(state), remainingSec);
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

function getEffectiveBotToken(env: Env, db: PersistedDatabase): string {
  return (db.secrets.botToken || env.TELEGRAM_BOT_TOKEN || '').trim();
}

function getEffectiveChatId(env: Env, db: PersistedDatabase): string {
  return (db.secrets.chatId || env.TELEGRAM_CHAT_ID || '').trim();
}

function getEffectiveBakongToken(env: Env, db: PersistedDatabase): string {
  return (db.secrets.bakongToken || env.BAKONG_API_TOKEN || '').trim();
}

function getEffectiveBotUsername(env: Env, db: PersistedDatabase): string {
  const fromSettings =
    db.shopSettings && typeof db.shopSettings.botUsername === 'string'
      ? db.shopSettings.botUsername
      : '';
  return (fromSettings || env.TELEGRAM_BOT_USERNAME || '').replace(/^@+/, '').trim();
}

function getEffectiveGatewayToken(env: Env, db: PersistedDatabase): string {
  return (db.secrets.telegramGatewayToken || env.TELEGRAM_GATEWAY_TOKEN || '').trim();
}

function getEffectiveTwilio(env: Env, db: PersistedDatabase) {
  return {
    sid: (db.secrets.twilioAccountSid || env.TWILIO_ACCOUNT_SID || '').trim(),
    token: (db.secrets.twilioAuthToken || env.TWILIO_AUTH_TOKEN || '').trim(),
    from: (db.secrets.twilioFromNumber || env.TWILIO_FROM_NUMBER || '').trim(),
  };
}

function getEffectiveSmsWebhook(env: Env, db: PersistedDatabase) {
  return {
    url: (db.secrets.smsWebhookUrl || env.SMS_WEBHOOK_URL || '').trim(),
    apiKey: (db.secrets.smsWebhookApiKey || env.SMS_WEBHOOK_API_KEY || '').trim(),
  };
}

function detectPhoneOtpChannel(env: Env, db: PersistedDatabase): 'telegram_gateway' | 'twilio' | 'sms_webhook' | 'none' {
  if (getEffectiveGatewayToken(env, db)) return 'telegram_gateway';
  const tw = getEffectiveTwilio(env, db);
  if (tw.sid && tw.token && tw.from) return 'twilio';
  const wh = getEffectiveSmsWebhook(env, db);
  if (wh.url) return 'sms_webhook';
  return 'none';
}

function upsertMember(
  db: PersistedDatabase,
  params: {
    name?: string;
    phone?: string;
    phoneVerified?: boolean;
    telegramUsername?: string;
    telegramId?: string;
    telegramPhotoUrl?: string;
    telegramVerified?: boolean;
    pointsDelta?: number;
  }
): MemberRecord {
  const existing = db.members.find(
    (m) =>
      (params.telegramId && m.telegramId === params.telegramId) ||
      (params.phone && m.phone === params.phone) ||
      (params.telegramUsername && m.telegramUsername.toLowerCase() === params.telegramUsername.toLowerCase())
  );

  const now = Date.now();
  if (existing) {
    if (params.name) existing.name = params.name;
    if (params.phone) existing.phone = params.phone;
    if (params.phoneVerified) existing.phoneVerified = true;
    if (params.telegramUsername) existing.telegramUsername = params.telegramUsername;
    if (params.telegramId) existing.telegramId = params.telegramId;
    if (params.telegramPhotoUrl) existing.telegramPhotoUrl = params.telegramPhotoUrl;
    if (params.telegramVerified) existing.telegramVerified = true;
    if (params.pointsDelta) existing.points += params.pointsDelta;
    existing.lastLoginAt = now;
    return existing;
  }

  const rec: MemberRecord = {
    id: `MBR-${randomHex(6).toUpperCase()}`,
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
  db.members.unshift(rec);
  return rec;
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
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const form = new FormData();
    form.append('chat_id', chatId.trim());
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    form.append('photo', new Blob([bytes], { type: mime }), `payment-slip.${ext}`);

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

function getShopBrandTitle(db: PersistedDatabase): string {
  return (
    (db.shopSettings && typeof db.shopSettings.brandTitle === 'string' && db.shopSettings.brandTitle.trim()) ||
    'Emerald Brew Cafe'
  );
}

async function editTelegramPaymentMessage(
  botToken: string,
  db: PersistedDatabase,
  sess: PaymentVerifySession,
  statusFooterHtml: string
): Promise<void> {
  if (!botToken || !sess.telegramChatId || !sess.telegramMessageId) return;
  const shopBrand = getShopBrandTitle(db);
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

async function processTelegramUpdates(
  env: Env,
  db: PersistedDatabase,
  botToken: string,
  activeNonce?: string,
  activeSession?: TelegramLinkSession
): Promise<TelegramLinkSession | undefined> {
  if (!botToken) return activeSession;
  let sessionRef = activeSession;
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
        };
        message?: {
          text?: string;
          from?: { id: number; username?: string; first_name?: string; last_name?: string };
          contact?: { phone_number?: string; first_name?: string; last_name?: string; user_id?: number };
        };
      }>;
    };

    if (!updData.ok || !Array.isArray(updData.result)) return sessionRef;

    const shopBrand = getShopBrandTitle(db);
    let dirty = false;

    for (const upd of updData.result) {
      if (upd.update_id >= db.lastTelegramUpdateOffset) {
        db.lastTelegramUpdateOffset = upd.update_id + 1;
        dirty = true;
      }

      if (upd.callback_query?.data) {
        const cb = upd.callback_query;
        const dataStr = cb.data || '';
        const colonIdx = dataStr.indexOf(':');
        const action = colonIdx > 0 ? dataStr.slice(0, colonIdx) : '';
        const sid = colonIdx > 0 ? dataStr.slice(colonIdx + 1) : '';
        const rawPay = sid ? await kvGet(env, `pay:${sid}`) : null;
        const paySess = safeJsonParse<PaymentVerifySession>(rawPay);
        const reviewerName = sanitizeText(cb.from?.first_name || cb.from?.username || 'ម្ចាស់ហាង', 40);

        if (!paySess || paySess.expiresAt < Date.now()) {
          await answerTelegramCallback(botToken, cb.id, 'វគ្គទូទាត់នេះផុតកំណត់ ឬរួចរាល់ហើយ');
          continue;
        }

        if (action === 'pay_ok') {
          paySess.status = 'verified';
          paySess.verifiedBy = 'telegram_owner';
          paySess.paidAmount = paySess.expectedAmount;
          paySess.transactionRef = paySess.transactionRef || paySess.billNumber;
          paySess.error = undefined;
          await kvPut(env, `pay:${sid}`, JSON.stringify(paySess), 900);
          await answerTelegramCallback(botToken, cb.id, '✅ បានបញ្ជាក់ទទួលប្រាក់គ្រប់!');
          await editTelegramPaymentMessage(
            botToken,
            db,
            paySess,
            `✅ <b>ស្ថានភាព៖ បានបញ្ជាក់ទទួលលុយគ្រប់ដោយ ${reviewerName}</b>`
          );
        } else if (action === 'pay_amt') {
          paySess.status = 'amount_mismatch';
          paySess.error = 'ម្ចាស់ហាងជូនដំណឹងថា ចំនួនលុយវេរចូលមិនគ្រប់តាមវិក្កយបត្រទេ! សូមពិនិត្យម្តងទៀត។';
          await kvPut(env, `pay:${sid}`, JSON.stringify(paySess), 900);
          await answerTelegramCallback(botToken, cb.id, '⚠️ បានជូនដំណឹងភ្ញៀវថាខ្វះចំនួនលុយ');
          await editTelegramPaymentMessage(
            botToken,
            db,
            paySess,
            `⚠️ <b>ស្ថានភាព៖ លុយចូលមិនគ្រប់ចំនួន (${reviewerName})</b>`
          );
        } else if (action === 'pay_no') {
          paySess.status = 'rejected';
          paySess.error = 'ម្ចាស់ហាងជូនដំណឹងថា មិនទាន់ឃើញទឹកប្រាក់ចូលធនាគារទេ! សូមផ្ទៀងផ្ទាត់ម្តងទៀត។';
          await kvPut(env, `pay:${sid}`, JSON.stringify(paySess), 900);
          await answerTelegramCallback(botToken, cb.id, '❌ បានបដិសេធ៖ មិនទាន់ឃើញលុយចូល');
          await editTelegramPaymentMessage(
            botToken,
            db,
            paySess,
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

      if (msgText.startsWith('/start') || msgText.startsWith('/register') || msgText === '/help') {
        const parts = msgText.split(/\s+/);
        const matchedNonce = parts[1];
        const targetSess: TelegramLinkSession | null = matchedNonce
          ? matchedNonce === activeNonce && sessionRef
            ? sessionRef
            : safeJsonParse<TelegramLinkSession>(await kvGet(env, `tg:${matchedNonce}`))
          : null;

        if (matchedNonce && targetSess) {
          targetSess.startedByTelegramId = String(from.id);
          targetSess.verifiedUser = {
            id: String(from.id),
            username: from.username || '',
            firstName: fullFirstName,
          };
          await kvPut(env, `tg:${matchedNonce}`, JSON.stringify(targetSess), 600);
          await kvPut(env, `tg_user_active:${from.id}`, matchedNonce, 600);
          if (matchedNonce === activeNonce) sessionRef = targetSess;

          if (targetSess.mode === 'contact') {
            await sendTelegramBotMessage(
              botToken,
              String(from.id),
              `🌿 <b>សូមស្វាគមន៍មកកាន់ ${shopBrand}!</b>\n` +
                `<i>ចុះឈ្មោះសមាជិក & ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ (Free ១០០%)</i>\n\n` +
                `👋 សួស្តី <b>${fullFirstName}</b>!\n` +
                `ដើម្បីបញ្ចប់ការចុះឈ្មោះ និងទទួលការដឹកជញ្ជូនរហ័សទាន់ចិត្ត សូមចុចប៊ូតុង <b>«📱 ចែករំលែកលេខទូរស័ព្ទចុះឈ្មោះ (Free)»</b> ខាងក្រោម 👇`,
              {
                keyboard: [[{ text: '📱 ចែករំលែកលេខទូរស័ព្ទចុះឈ្មោះ (Free)', request_contact: true }]],
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
          const registered = upsertMember(db, {
            name: fullFirstName,
            telegramId: String(from.id),
            telegramUsername: from.username ? `@${from.username}` : '',
            telegramVerified: true,
          });
          dirty = true;
          await sendTelegramBotMessage(
            botToken,
            String(from.id),
            `🌿 <b>សូមស្វាគមន៍មកកាន់ ${shopBrand}!</b>\n` +
              `<i>Member Registration & Ordering Assistant</i>\n\n` +
              `👋 សួស្តី <b>${registered.name}</b>!\n` +
              `🆔 លេខកូដសមាជិក៖ <code>${registered.id}</code>\n` +
              `⭐ ពិន្ទុសន្សំបច្ចុប្បន្ន៖ <b>${registered.points || 1} ★</b>\n` +
              `${registered.phone ? `📱 លេខទូរស័ព្ទ៖ <b>${registered.phone}</b> ✅\n` : ''}\n` +
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
                  keyboard: [[{ text: '📱 ចុះឈ្មោះលេខទូរស័ព្ទសមាជិក (Free)', request_contact: true }]],
                  resize_keyboard: true,
                  one_time_keyboard: true,
                }
          );
        }
      }

      if (msg.contact?.phone_number && Number(msg.contact.user_id) === Number(from.id)) {
        const verifiedPhone = normalizePhone(msg.contact.phone_number);
        if (isValidPhone(verifiedPhone)) {
          let linkedSessionFound = false;
          const activeUserNonce = await kvGet(env, `tg_user_active:${from.id}`);
          if (activeUserNonce) {
            const cand: TelegramLinkSession | null =
              activeUserNonce === activeNonce && sessionRef
                ? sessionRef
                : safeJsonParse<TelegramLinkSession>(await kvGet(env, `tg:${activeUserNonce}`));
            if (cand && cand.mode === 'contact' && cand.startedByTelegramId === String(from.id)) {
              linkedSessionFound = true;
              cand.verifiedPhone = verifiedPhone;
              cand.verifiedUser = cand.verifiedUser || {
                id: String(from.id),
                username: from.username || '',
                firstName: fullFirstName,
              };
              await kvPut(env, `tg:${activeUserNonce}`, JSON.stringify(cand), 600);
              if (activeUserNonce === activeNonce) sessionRef = cand;
            }
          }
          const member = upsertMember(db, {
            name: fullFirstName,
            phone: verifiedPhone,
            phoneVerified: true,
            telegramId: String(from.id),
            telegramUsername: from.username ? `@${from.username}` : '',
            telegramVerified: true,
          });
          dirty = true;
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

    if (dirty) await saveDb(env, db);
  } catch {
    // ignore transient poll error
  }
  return sessionRef;
}

async function resolveBotUsername(env: Env, db: PersistedDatabase, botToken: string): Promise<string> {
  const explicit = getEffectiveBotUsername(env, db);
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

async function requireAdmin(req: Request, env: Env, db: PersistedDatabase): Promise<TokenPayload | null> {
  const payload = await verifySessionToken(env, db.sessionSecret, extractBearer(req));
  if (!payload || payload.role !== 'admin') return null;
  return payload;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handleApiRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  const db = await loadDb(env);

  // 1. Capabilities
  if (path === '/api/auth/capabilities' && method === 'GET') {
    const botToken = getEffectiveBotToken(env, db);
    const chatId = getEffectiveChatId(env, db);
    const botUsername = await resolveBotUsername(env, db, botToken);
    const phoneOtpChannel = detectPhoneOtpChannel(env, db);
    const botReady = Boolean(botToken && botUsername);
    return jsonResponse({
      ok: true,
      telegramWidgetReady: botReady,
      telegramBotReady: botReady,
      telegramContactReady: botReady,
      telegramOrderVerifyReady: Boolean(botToken && chatId),
      bakongVerifyReady: Boolean(getEffectiveBakongToken(env, db)),
      phoneOtpReady: phoneOtpChannel !== 'none',
      phoneOtpChannel,
      botUsername,
    });
  }

  // 2. Phone OTP Send
  if (path === '/api/auth/phone/send-otp' && method === 'POST') {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(env, `send_otp_${ip}`, 6, 300);
    if (!rl.allowed) {
      return jsonResponse({ ok: false, error: `សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី មុននឹងស្នើសុំលេខកូដម្តងទៀត` }, 429);
    }
    const body = await readJsonBody(req);
    const name = sanitizeText(body.name, 60);
    const phone = normalizePhone(String(body.phone || ''));
    const tgUsername = normalizeTgUsername(body.telegramUsername);
    if (!isValidPhone(phone)) {
      return jsonResponse({ ok: false, error: 'លេខទូរស័ព្ទមិនត្រឹមត្រូវទេ (ឧ. 012 345 678 ឬ +85512345678)' }, 400);
    }

    const channel = detectPhoneOtpChannel(env, db);
    if (channel === 'none') {
      return jsonResponse(
        {
          ok: false,
          error:
            'មិនទាន់បានភ្ជាប់សេវាផ្ញើ OTP ផ្លូវការទេ! សូមម្ចាស់ហាងប្រើ Telegram Share Contact (Free) ឬកំណត់ Telegram Gateway / Twilio។',
        },
        503
      );
    }

    const otp = randomSixDigitOtp();
    const salt = randomHex(16);
    const hash = await sha256Hex(`${salt}:${otp}:${db.sessionSecret}`);

    if (channel === 'telegram_gateway') {
      try {
        const gwToken = getEffectiveGatewayToken(env, db);
        const gwRes = await fetchWithTimeout(
          'https://gatewayapi.telegram.org/sendVerificationMessage',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${gwToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone_number: phone, code: otp, ttl: 300 }),
          },
          8000
        );
        const gwData = (await gwRes.json()) as { ok?: boolean; error?: string; result?: { request_id?: string } };
        if (!gwData.ok) {
          return jsonResponse({ ok: false, error: `Telegram Gateway បដិសេធ៖ ${gwData.error || 'Token Error'}` }, 502);
        }
        const challenge: OtpChallenge = {
          hash,
          salt,
          target: phone,
          gatewayRequestId: gwData.result?.request_id,
          channel: 'telegram_gateway',
          name: name || 'អតិថិជន Emerald Brew',
          telegramUsername: tgUsername || undefined,
          expiresAt: Date.now() + 300_000,
          attempts: 0,
        };
        await kvPut(env, `otp:${phone}`, JSON.stringify(challenge), 300);
        return jsonResponse({ ok: true, phone, channel: 'telegram_gateway', expiresInSeconds: 300 });
      } catch {
        return jsonResponse({ ok: false, error: 'មិនអាចភ្ជាប់ទៅ Telegram Gateway API បានទេ' }, 502);
      }
    }

    if (channel === 'twilio') {
      const tw = getEffectiveTwilio(env, db);
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
              Authorization: `Basic ${btoa(`${tw.sid}:${tw.token}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          },
          8000
        );
        if (!twRes.ok) {
          return jsonResponse({ ok: false, error: `Twilio SMS បរាជ័យ (${twRes.status})` }, 502);
        }
        const challenge: OtpChallenge = {
          hash,
          salt,
          target: phone,
          channel: 'twilio',
          name: name || 'អតិថិជន Emerald Brew',
          telegramUsername: tgUsername || undefined,
          expiresAt: Date.now() + 300_000,
          attempts: 0,
        };
        await kvPut(env, `otp:${phone}`, JSON.stringify(challenge), 300);
        return jsonResponse({ ok: true, phone, channel: 'twilio', expiresInSeconds: 300 });
      } catch {
        return jsonResponse({ ok: false, error: 'មិនអាចភ្ជាប់ទៅ Twilio SMS API បានទេ' }, 502);
      }
    }

    const wh = getEffectiveSmsWebhook(env, db);
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
        return jsonResponse({ ok: false, error: 'SMS Gateway Webhook បានបដិសេធការផ្ញើ' }, 502);
      }
      const challenge: OtpChallenge = {
        hash,
        salt,
        target: phone,
        channel: 'sms_webhook',
        name: name || 'អតិថិជន Emerald Brew',
        telegramUsername: tgUsername || undefined,
        expiresAt: Date.now() + 300_000,
        attempts: 0,
      };
      await kvPut(env, `otp:${phone}`, JSON.stringify(challenge), 300);
      return jsonResponse({ ok: true, phone, channel: 'sms_webhook', expiresInSeconds: 300 });
    } catch {
      return jsonResponse({ ok: false, error: 'មិនអាចភ្ជាប់ទៅ SMS Gateway បានទេ' }, 502);
    }
  }

  // 3. Phone OTP Verify
  if (path === '/api/auth/phone/verify-otp' && method === 'POST') {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(env, `verify_otp_${ip}`, 15, 300);
    if (!rl.allowed) {
      return jsonResponse({ ok: false, error: `ព្យាយាមច្រើនដងពេក! សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី` }, 429);
    }
    const body = await readJsonBody(req);
    const phone = normalizePhone(String(body.phone || ''));
    const code = String(body.code || '').replace(/\D/g, '');
    const raw = await kvGet(env, `otp:${phone}`);
    const challenge = safeJsonParse<OtpChallenge>(raw);
    if (!challenge) {
      return jsonResponse({ ok: false, error: 'លេខកូដ OTP ផុតកំណត់ ឬមិនទាន់បានស្នើសុំទេ' }, 400);
    }
    if (challenge.expiresAt < Date.now()) {
      await kvDelete(env, `otp:${phone}`);
      return jsonResponse({ ok: false, error: 'លេខកូដ OTP ផុតកំណត់ហើយ សូមស្នើសុំម្តងទៀត' }, 400);
    }
    if (challenge.attempts >= 5) {
      await kvDelete(env, `otp:${phone}`);
      return jsonResponse({ ok: false, error: 'បញ្ចូលខុសលើស ៥ ដង! សូមស្នើសុំលេខកូដថ្មី' }, 429);
    }

    challenge.attempts += 1;
    const candidateHash = await sha256Hex(`${challenge.salt}:${code}:${db.sessionSecret}`);
    if (!safeEqualHex(candidateHash, challenge.hash)) {
      await kvPut(env, `otp:${phone}`, JSON.stringify(challenge), 300);
      return jsonResponse({ ok: false, error: `លេខកូដ OTP មិនត្រឹមត្រូវទេ (នៅសល់ ${5 - challenge.attempts} ដង)` }, 400);
    }

    await kvDelete(env, `otp:${phone}`);
    const member = upsertMember(db, {
      name: sanitizeText(body.name, 60) || challenge.name,
      phone,
      phoneVerified: true,
      telegramUsername: normalizeTgUsername(body.telegramUsername) || challenge.telegramUsername,
    });
    await saveDb(env, db);
    const token = await signSessionToken(db.sessionSecret, member.id, 'member');
    return jsonResponse({ ok: true, token, member });
  }

  // 4. Official Telegram Login Widget Verification
  if (path === '/api/auth/telegram/verify-widget' && method === 'POST') {
    const botToken = getEffectiveBotToken(env, db);
    if (!botToken) {
      return jsonResponse({ ok: false, error: 'មិនទាន់បានកំណត់ Telegram Bot Token ទេ' }, 503);
    }
    const user = await readJsonBody(req);
    const hash = String(user.hash || '');
    const authDate = Number(user.auth_date || 0);
    if (!hash || !user.id || !authDate) {
      return jsonResponse({ ok: false, error: 'ទិន្នន័យ Telegram Login មិនពេញលេញ' }, 400);
    }
    if (Math.abs(Date.now() / 1000 - authDate) > 86400) {
      return jsonResponse({ ok: false, error: 'ការផ្ទៀងផ្ទាត់ Telegram ហួសសុពលភាព សូមចូលម្តងទៀត' }, 401);
    }

    const checkString = Object.keys(user)
      .filter((k) => k !== 'hash' && user[k] !== undefined && user[k] !== null && user[k] !== '')
      .sort()
      .map((k) => `${k}=${user[k]}`)
      .join('\n');

    const secretKey = await sha256Bytes(botToken);
    const expectedHex = bytesToHex(await hmacSha256RawKey(secretKey, checkString));
    if (!safeEqualHex(hash, expectedHex)) {
      return jsonResponse({ ok: false, error: 'ហត្ថលេខា Telegram មិនត្រឹមត្រូវ (HMAC Failed)' }, 401);
    }

    const fullName =
      [sanitizeText(user.first_name, 40), sanitizeText(user.last_name, 40)].filter(Boolean).join(' ') ||
      'Telegram User';
    const member = upsertMember(db, {
      name: fullName,
      telegramId: String(user.id),
      telegramUsername: normalizeTgUsername(user.username),
      telegramPhotoUrl: typeof user.photo_url === 'string' ? user.photo_url : undefined,
      telegramVerified: true,
    });
    await saveDb(env, db);
    const token = await signSessionToken(db.sessionSecret, member.id, 'member');
    return jsonResponse({ ok: true, token, member });
  }

  // 5. Telegram Bot 1-Click Init Link (Free Login + Free Share Contact)
  if (path === '/api/auth/telegram/init-link' && method === 'POST') {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(env, `tg_init_${ip}`, 12, 300);
    if (!rl.allowed) {
      return jsonResponse({ ok: false, error: 'សូមរង់ចាំបន្តិចមុននឹងបង្កើតតំណភ្ជាប់ថ្មី' }, 429);
    }

    const botToken = getEffectiveBotToken(env, db);
    if (!botToken) {
      return jsonResponse(
        {
          ok: false,
          error: 'សូមម្ចាស់ហាងបញ្ចូល Telegram Bot Token (ឥតគិតថ្លៃពី @BotFather) ក្នុងផ្ទាំងគ្រប់គ្រងហាង។',
        },
        503
      );
    }
    const botUsername = await resolveBotUsername(env, db, botToken);
    if (!botUsername) {
      return jsonResponse({ ok: false, error: 'មិនអាចទាញយក Bot Username បានទេ' }, 503);
    }

    const body = await readJsonBody(req);
    const mode = body.mode === 'contact' ? 'contact' : 'login';
    const prefix = mode === 'contact' ? 'ph' : 'eb';
    const nonce = `${prefix}_${randomHex(6)}`;
    const sess: TelegramLinkSession = {
      nonce,
      mode,
      name: sanitizeText(body.name, 60),
      phone: normalizePhone(String(body.phone || '')) || undefined,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    };
    await kvPut(env, `tg:${nonce}`, JSON.stringify(sess), 600);

    return jsonResponse({
      ok: true,
      nonce,
      mode,
      botUsername,
      deepLink: `https://t.me/${botUsername}?start=${nonce}`,
      expiresInSeconds: 600,
    });
  }

  // 6. Telegram Bot Poll Link
  if (path === '/api/auth/telegram/poll-link' && method === 'POST') {
    const body = await readJsonBody(req);
    const nonce = String(body.nonce || '').trim();
    const rawSess = await kvGet(env, `tg:${nonce}`);
    const parsedSess = safeJsonParse<TelegramLinkSession>(rawSess);
    if (!parsedSess) return jsonResponse({ ok: false, error: 'តំណភ្ជាប់ផុតកំណត់ហើយ' }, 404);
    let session: TelegramLinkSession = parsedSess;
    if (session.expiresAt < Date.now()) {
      await kvDelete(env, `tg:${nonce}`);
      return jsonResponse({ ok: false, error: 'តំណភ្ជាប់ផុតកំណត់ហើយ' }, 404);
    }

    const finalize = async (target: TelegramLinkSession) => {
      await kvDelete(env, `tg:${nonce}`);
      const verifiedPhone = target.verifiedPhone || target.phone;
      const member = upsertMember(db, {
        name: target.name || target.verifiedUser?.firstName || 'Telegram User',
        phone: verifiedPhone,
        phoneVerified: Boolean(target.verifiedPhone || target.phone),
        telegramUsername: target.verifiedUser?.username ? `@${target.verifiedUser.username}` : '',
        telegramId: target.verifiedUser?.id,
        telegramVerified: true,
      });
      await saveDb(env, db);
      const token = await signSessionToken(db.sessionSecret, member.id, 'member');
      return jsonResponse({ ok: true, linked: true, token, member });
    };

    if (session.mode === 'login' && session.verifiedUser) return finalize(session);
    if (session.mode === 'contact' && session.verifiedUser && session.verifiedPhone) return finalize(session);

    const botToken = getEffectiveBotToken(env, db);
    if (botToken) {
      const updatedSess = await processTelegramUpdates(env, db, botToken, nonce, session);
      if (updatedSess) session = updatedSess;
    }

    if (session.mode === 'login' && session.verifiedUser) return finalize(session);
    if (session.mode === 'contact' && session.verifiedUser && session.verifiedPhone) return finalize(session);

    return jsonResponse({
      ok: true,
      linked: false,
      step: session.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
    });
  }

  // 6b. Automatic KHQR Payment Verification
  if (path === '/api/payments/khqr/create' && method === 'POST') {
    const body = await readJsonBody(req);
    const amountUsd = Number(body.amountUsd || 0);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return jsonResponse({ ok: false, error: 'ចំនួនទឹកប្រាក់ត្រូវតែធំជាង $0.00' }, 400);
    }
    const currency: 'USD' | 'KHR' = body.currency === 'KHR' ? 'KHR' : 'USD';
    const rawExpected = Number(body.amountCurrency || amountUsd);
    const expectedAmount =
      currency === 'KHR' ? Math.max(100, Math.round(rawExpected)) : Number(amountUsd.toFixed(2));
    const billNumber = sanitizeText(body.billNumber, 28) || `PAY-${randomHex(3).toUpperCase()}`;
    const khqrPayload = String(body.khqrPayload || '').trim();
    const hasOfficialKhqr = khqrPayload.startsWith('000201');
    const md5 = hasOfficialKhqr
      ? md5Hex(khqrPayload)
      : md5Hex(`${billNumber}:${expectedAmount}:${currency}:${Date.now()}`);

    const sessionId = `PAYS-${randomHex(8).toUpperCase()}`;
    const now = Date.now();
    const sess: PaymentVerifySession = {
      id: sessionId,
      billNumber,
      md5,
      hasOfficialKhqr,
      expectedAmountUsd: Number(amountUsd.toFixed(2)),
      expectedAmount,
      currency,
      createdAt: now,
      expiresAt: now + 600_000,
      status: 'pending',
      customerName: sanitizeText(body.customerName, 60) || undefined,
      customerPhone: sanitizeText(body.customerPhone, 25) || undefined,
    };
    await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);

    return jsonResponse({
      ok: true,
      sessionId,
      billNumber,
      md5,
      expectedAmountUsd: sess.expectedAmountUsd,
      expectedAmount: sess.expectedAmount,
      currency: sess.currency,
      expiresInSeconds: 600,
      bakongVerifyReady: Boolean(getEffectiveBakongToken(env, db)),
      telegramOrderVerifyReady: Boolean(getEffectiveBotToken(env, db) && getEffectiveChatId(env, db)),
    });
  }

  if (path === '/api/payments/khqr/check' && method === 'POST') {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const rawSess = sessionId ? await kvGet(env, `pay:${sessionId}`) : null;
    let sess = safeJsonParse<PaymentVerifySession>(rawSess);
    if (!sess || sess.expiresAt < Date.now()) {
      if (sessionId) await kvDelete(env, `pay:${sessionId}`);
      return jsonResponse({ ok: false, expired: true, error: 'វគ្គទូទាត់ផុតកំណត់ហើយ សូមបង្កើត QR ថ្មី' }, 404);
    }

    if (sess.status === 'verified') {
      return jsonResponse({
        ok: true,
        status: 'verified',
        verified: true,
        verifiedBy: sess.verifiedBy || 'bakong_md5',
        paidAmount: sess.paidAmount ?? sess.expectedAmount,
        currency: sess.currency,
        transactionRef: sess.transactionRef || sess.billNumber,
        proofToken: await signPaymentProofToken(db.sessionSecret, sess),
      });
    }

    const bakongToken = getEffectiveBakongToken(env, db);
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
            data?: { hash?: string; amount?: number | string; currency?: string } | null;
          };
          if (bData.responseCode === 0 && bData.data) {
            const paidAmt = Number(bData.data.amount || 0);
            const paidCur = String(bData.data.currency || sess.currency).toUpperCase();
            const txHash = String(bData.data.hash || '').trim();
            const tol = sess.currency === 'KHR' ? 100 : 0.01;

            if (isPaymentRefUsed(db, `md5:${sess.md5}`) || (txHash && isPaymentRefUsed(db, `tx:${txHash}`))) {
              sess.status = 'rejected';
              sess.error = 'ប្រតិបត្តិការណ៍ KHQR នេះត្រូវបានប្រើរួចហើយ!';
              await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);
            } else if (paidCur !== sess.currency) {
              sess.status = 'amount_mismatch';
              sess.paidAmount = paidAmt;
              sess.error = `រូបិយប័ណ្ណមិនត្រូវគ្នាទេ (ទទួល ${paidAmt} ${paidCur} ≠ ត្រូវបង់ ${sess.expectedAmount} ${sess.currency})`;
              await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);
            } else if (paidAmt + tol < sess.expectedAmount) {
              sess.status = 'amount_mismatch';
              sess.paidAmount = paidAmt;
              sess.error = `ទឹកប្រាក់វេរចូលមិនគ្រប់ចំនួនទេ! ទទួលបាន ${paidAmt} ${paidCur} (ខ្វះ ${(sess.expectedAmount - paidAmt).toFixed(sess.currency === 'KHR' ? 0 : 2)} ${sess.currency})`;
              await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);
            } else {
              sess.status = 'verified';
              sess.verifiedBy = 'bakong_md5';
              sess.paidAmount = paidAmt;
              sess.transactionRef = txHash ? txHash.slice(0, 20) : sess.billNumber;
              sess.error = undefined;
              await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);
              return jsonResponse({
                ok: true,
                status: 'verified',
                verified: true,
                verifiedBy: 'bakong_md5',
                paidAmount: sess.paidAmount,
                currency: sess.currency,
                transactionRef: sess.transactionRef,
                proofToken: await signPaymentProofToken(db.sessionSecret, sess),
              });
            }
          }
        }
      } catch {
        // ignore transient Bakong timeout
      }
    }

    const botToken = getEffectiveBotToken(env, db);
    if (botToken) {
      await processTelegramUpdates(env, db, botToken);
      const refreshed = safeJsonParse<PaymentVerifySession>(await kvGet(env, `pay:${sessionId}`));
      if (refreshed) sess = refreshed;
    }

    if (sess.status === 'verified') {
      return jsonResponse({
        ok: true,
        status: 'verified',
        verified: true,
        verifiedBy: sess.verifiedBy || 'telegram_owner',
        paidAmount: sess.paidAmount ?? sess.expectedAmount,
        currency: sess.currency,
        transactionRef: sess.transactionRef || sess.billNumber,
        proofToken: await signPaymentProofToken(db.sessionSecret, sess),
      });
    }

    return jsonResponse({
      ok: true,
      status: sess.status,
      verified: false,
      paidAmount: sess.paidAmount,
      currency: sess.currency,
      error: sess.error,
    });
  }

  if (path === '/api/payments/khqr/request-telegram-verify' && method === 'POST') {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(env, `pay_tg_${ip}`, 8, 300);
    if (!rl.allowed) {
      return jsonResponse(
        { ok: false, error: `សូមរង់ចាំ ${rl.retryAfterSec} វិនាទី មុននឹងផ្ញើសំណើម្តងទៀត` },
        429
      );
    }

    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const sess = safeJsonParse<PaymentVerifySession>(sessionId ? await kvGet(env, `pay:${sessionId}`) : null);
    if (!sess || sess.expiresAt < Date.now()) {
      return jsonResponse({ ok: false, error: 'វគ្គទូទាត់ផុតកំណត់ហើយ សូមបង្កើត QR ថ្មី' }, 404);
    }
    if (sess.status === 'verified') {
      return jsonResponse({
        ok: true,
        status: 'verified',
        verified: true,
        proofToken: await signPaymentProofToken(db.sessionSecret, sess),
      });
    }

    const botToken = getEffectiveBotToken(env, db);
    const chatId = getEffectiveChatId(env, db);
    if (!botToken || !chatId) {
      return jsonResponse(
        { ok: false, error: 'មិនទាន់បានកំណត់ Telegram Bot Token និង Group Chat ID ក្នុងការកំណត់ហាងទេ!' },
        503
      );
    }

    const enteredRef = sanitizeText(body.paymentRef, 40);
    if (enteredRef && isPaymentRefUsed(db, `ref:${enteredRef.toLowerCase()}`)) {
      return jsonResponse({ ok: false, error: 'លេខប្រតិបត្តិការណ៍ (Transaction ID) នេះធ្លាប់បានប្រើប្រាស់រួចហើយ!' }, 400);
    }

    if (body.paidAmount !== undefined && body.paidAmount !== '') {
      const paidAmt = Number(body.paidAmount);
      const tol = sess.currency === 'KHR' ? 100 : 0.01;
      if (!Number.isFinite(paidAmt) || paidAmt + tol < sess.expectedAmount) {
        return jsonResponse(
          {
            ok: false,
            error: `ចំនួនលុយបញ្ចូលមិនគ្រប់តាមវិក្កយបត្រទេ! ត្រូវបង់ ${
              sess.currency === 'KHR'
                ? `${Math.round(sess.expectedAmount).toLocaleString()} ៛`
                : `$${sess.expectedAmountUsd.toFixed(2)}`
            }`,
          },
          400
        );
      }
    }

    const slipImg =
      typeof body.slipImg === 'string' && body.slipImg.startsWith('data:image/')
        ? body.slipImg.slice(0, 750_000)
        : '';
    const custName = sanitizeText(body.customerName, 60) || sess.customerName || 'ភ្ញៀវ Emerald Brew';
    const custPhone = sanitizeText(body.customerPhone, 25) || sess.customerPhone || '-';
    const orderSummary = sanitizeText(body.orderSummary, 180);

    sess.customerName = custName;
    sess.customerPhone = custPhone;
    if (enteredRef) sess.transactionRef = enteredRef;
    if (slipImg) sess.slipImg = slipImg;

    const shopBrand = getShopBrandTitle(db);
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
      return jsonResponse({ ok: false, error: 'មិនអាចផ្ញើសំណើទៅ Telegram ហាងបានទេ! សូមពិនិត្យ Bot Token & Chat ID' }, 502);
    }

    sess.status = 'awaiting_owner';
    sess.error = undefined;
    sess.telegramChatId = chatId;
    sess.telegramMessageId = sent.messageId;
    sess.telegramHasPhoto = hasPhoto;
    sess.telegramSentAt = Date.now();
    await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);

    return jsonResponse({
      ok: true,
      status: 'awaiting_owner',
      message: 'បានផ្ញើទៅ Telegram ហាងរួចរាល់! កំពុងរង់ចាំម្ចាស់ហាងចុចបញ្ជាក់...',
    });
  }

  if (path === '/api/payments/khqr/verify-slip' && method === 'POST') {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const sess = safeJsonParse<PaymentVerifySession>(sessionId ? await kvGet(env, `pay:${sessionId}`) : null);
    if (!sess || sess.expiresAt < Date.now()) {
      return jsonResponse({ ok: false, error: 'វគ្គទូទាត់ផុតកំណត់ហើយ សូមបង្កើត QR ថ្មី' }, 404);
    }

    const paidAmountRaw = Number(body.paidAmount);
    const tol = sess.currency === 'KHR' ? 100 : 0.01;
    if (!Number.isFinite(paidAmountRaw) || paidAmountRaw <= 0) {
      return jsonResponse({ ok: false, error: 'សូមបញ្ចូលចំនួនទឹកប្រាក់ដែលអ្នកបានវេរពិតប្រាកដ' }, 400);
    }
    if (paidAmountRaw + tol < sess.expectedAmount) {
      sess.status = 'amount_mismatch';
      sess.paidAmount = paidAmountRaw;
      await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);
      return jsonResponse(
        {
          ok: false,
          status: 'amount_mismatch',
          error: `ចំនួនលុយមិនគ្រប់ទេ! ទទួលបញ្ចូល ${paidAmountRaw} ${sess.currency} ≠ ត្រូវបង់ ${
            sess.currency === 'KHR'
              ? `${Math.round(sess.expectedAmount).toLocaleString()} ៛`
              : `$${sess.expectedAmountUsd.toFixed(2)}`
          }`,
        },
        400
      );
    }

    const cleanRef = sanitizeText(body.paymentRef, 40);
    const slipImg =
      typeof body.slipImg === 'string' && body.slipImg.startsWith('data:image/')
        ? body.slipImg.slice(0, 750_000)
        : '';

    if (cleanRef.length < 6 && !slipImg) {
      return jsonResponse(
        {
          ok: false,
          error: 'សូមបញ្ចូលលេខប្រតិបត្តិការណ៍ធនាគារ (យ៉ាងតិច ៦ តួ) ឬ Upload រូបវិក្កយបត្រវេរលុយ (Slip)!',
        },
        400
      );
    }

    if (cleanRef && isPaymentRefUsed(db, `ref:${cleanRef.toLowerCase()}`)) {
      return jsonResponse({ ok: false, error: 'លេខប្រតិបត្តិការណ៍ (Transaction ID) នេះធ្លាប់បានប្រើប្រាស់រួចហើយ!' }, 400);
    }

    sess.status = 'verified';
    sess.verifiedBy = 'slip_ref';
    sess.paidAmount = paidAmountRaw;
    sess.transactionRef = cleanRef || sess.billNumber;
    if (slipImg) sess.slipImg = slipImg;
    sess.error = undefined;
    await kvPut(env, `pay:${sessionId}`, JSON.stringify(sess), 900);

    return jsonResponse({
      ok: true,
      status: 'verified',
      verified: true,
      verifiedBy: 'slip_ref',
      paidAmount: sess.paidAmount,
      currency: sess.currency,
      transactionRef: sess.transactionRef,
      proofToken: await signPaymentProofToken(db.sessionSecret, sess),
    });
  }

  // 7. Telegram WebApp Verify
  if (path === '/api/auth/telegram/verify-webapp' && method === 'POST') {
    const body = await readJsonBody(req);
    const initData = String(body.initData || '');
    const botToken = getEffectiveBotToken(env, db);
    if (!initData || !botToken) {
      return jsonResponse({ ok: false, error: 'Missing Telegram initData or Bot Token' }, 400);
    }
    try {
      const params = new URLSearchParams(initData);
      const hash = params.get('hash') || '';
      params.delete('hash');
      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');

      const secretKeyBytes = await hmacSha256RawKey(encoder.encode('WebAppData'), botToken);
      const expectedHex = bytesToHex(
        await hmacSha256RawKey(new Uint8Array(secretKeyBytes).buffer, dataCheckString)
      );
      if (!safeEqualHex(hash, expectedHex)) {
        return jsonResponse({ ok: false, error: 'Telegram signature verification failed' }, 401);
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
      if (!tgUser?.id) return jsonResponse({ ok: false, error: 'Invalid Telegram user payload' }, 400);

      const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Telegram User';
      const member = upsertMember(db, {
        name: fullName,
        telegramId: String(tgUser.id),
        telegramUsername: tgUser.username ? `@${tgUser.username}` : '',
        telegramPhotoUrl: tgUser.photo_url,
        telegramVerified: true,
      });
      await saveDb(env, db);
      const token = await signSessionToken(db.sessionSecret, member.id, 'member');
      return jsonResponse({ ok: true, token, member });
    } catch {
      return jsonResponse({ ok: false, error: 'Failed to parse Telegram WebApp data' }, 400);
    }
  }

  // 8. Session Inspection & Logout
  if (path === '/api/auth/me' && method === 'GET') {
    const payload = await verifySessionToken(env, db.sessionSecret, extractBearer(req));
    if (!payload || payload.role !== 'member') return jsonResponse({ ok: false }, 401);
    const member = db.members.find((m) => m.id === payload.sub);
    if (!member) return jsonResponse({ ok: false }, 404);
    return jsonResponse({ ok: true, member, expiresAt: payload.exp });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const payload = await verifySessionToken(env, db.sessionSecret, extractBearer(req));
    if (payload) await kvPut(env, `revoked:${payload.jti}`, '1', 7 * 24 * 3600);
    return jsonResponse({ ok: true });
  }

  // 9. Admin Verify PIN & Config
  if (path === '/api/admin/verify-pin' && method === 'POST') {
    const ip = getClientIp(req);
    const lockRaw = await kvGet(env, `pinlock:${ip}`);
    const lock = safeJsonParse<{ failures: number; lockedUntil: number }>(lockRaw);
    if (lock && lock.lockedUntil > Date.now()) {
      const secs = Math.ceil((lock.lockedUntil - Date.now()) / 1000);
      return jsonResponse({ ok: false, error: `បញ្ចូល PIN ខុសច្រើនដង! សូមរង់ចាំ ${secs} វិនាទី` }, 429);
    }
    const body = await readJsonBody(req);
    const submittedPin = String(body.pin || '').trim();
    const expectedPin = String(db.secrets.adminPin || '1234').trim();
    if (!constantTimeEqualStrings(submittedPin, expectedPin)) {
      const failures = (lock?.failures || 0) + 1;
      if (failures >= 5) {
        await kvPut(env, `pinlock:${ip}`, JSON.stringify({ failures: 0, lockedUntil: Date.now() + 60_000 }), 120);
        return jsonResponse({ ok: false, error: 'បញ្ចូល PIN ខុស ៥ ដង! ត្រូវបានចាក់សោ ៦០ វិនាទី' }, 429);
      }
      await kvPut(env, `pinlock:${ip}`, JSON.stringify({ failures, lockedUntil: 0 }), 300);
      return jsonResponse({ ok: false, error: `លេខកូដ PIN មិនត្រឹមត្រូវ (នៅសល់ ${5 - failures} ដង)` }, 401);
    }
    await kvDelete(env, `pinlock:${ip}`);
    const adminToken = await signSessionToken(db.sessionSecret, 'owner-admin', 'admin', 12 * 3600 * 1000);
    return jsonResponse({ ok: true, adminToken });
  }

  if (path === '/api/admin/config' && method === 'GET') {
    if (!(await requireAdmin(req, env, db))) {
      return jsonResponse({ ok: false, error: 'ទាមទារការអនុញ្ញាតពីម្ចាស់ហាង' }, 401);
    }
    return jsonResponse({ ok: true, secrets: db.secrets, members: db.members });
  }

  if (path === '/api/admin/config' && method === 'PUT') {
    if (!(await requireAdmin(req, env, db))) {
      return jsonResponse({ ok: false, error: 'ទាមទារការអនុញ្ញាតពីម្ចាស់ហាង' }, 401);
    }
    const body = await readJsonBody(req);
    const incoming = (body.secrets || {}) as Partial<AdminSecrets>;
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
    await saveDb(env, db);
    return jsonResponse({ ok: true, secrets: db.secrets });
  }

  // 10. Shop & Orders
  if (path === '/api/shop' && method === 'GET') {
    return jsonResponse({
      ok: true,
      storagePersistent: Boolean(env.CAFE_KV),
      menuItems: db.menuItems,
      toppings: db.toppings,
      shopSettings: db.shopSettings,
    });
  }

  if (path === '/api/shop' && method === 'PUT') {
    if (!(await requireAdmin(req, env, db))) {
      return jsonResponse({ ok: false, error: 'ទាមទារការអនុញ្ញាតពីម្ចាស់ហាង' }, 401);
    }
    const body = await readJsonBody(req);
    if (Array.isArray(body.menuItems)) db.menuItems = body.menuItems as Record<string, unknown>[];
    if (Array.isArray(body.toppings)) db.toppings = body.toppings as Record<string, unknown>[];
    if (body.shopSettings && typeof body.shopSettings === 'object') {
      db.shopSettings = body.shopSettings as Record<string, unknown>;
    }
    await saveDb(env, db);
    return jsonResponse({ ok: true, storagePersistent: Boolean(env.CAFE_KV) });
  }

  if (path === '/api/orders' && method === 'GET') {
    const sorted = [...db.orders].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return jsonResponse({ ok: true, orders: sorted });
  }

  if (path === '/api/orders' && method === 'POST') {
    const rawOrder = await readJsonBody(req);
    if (!rawOrder || typeof rawOrder.id !== 'string') {
      return jsonResponse({ ok: false, error: 'Invalid order payload' }, 400);
    }
    const order: Record<string, unknown> = { ...rawOrder };
    const idx = db.orders.findIndex((o) => o.id === order.id);
    const isNew = idx === -1;

    if (isNew && order.payment === 'KHQR / ABA') {
      const proof = await verifyPaymentProofToken(db.sessionSecret, order.paymentProofToken);
      const expectedGrandTotal = Number(order.grandTotal || 0);
      if (!proof || proof.amtUsd + 0.02 < expectedGrandTotal) {
        return jsonResponse(
          {
            ok: false,
            error:
              'ការទូទាត់ KHQR មិនទាន់បានផ្ទៀងផ្ទាត់ ឬចំនួនទឹកប្រាក់មិនត្រឹមត្រូវទេ! សូមទូទាត់ និងផ្ទៀងផ្ទាត់ការបង់ប្រាក់ជាមុនសិន។',
          },
          402
        );
      }
      const refKey = proof.ref && proof.ref !== '-' ? `ref:${proof.ref.toLowerCase()}` : '';
      const md5Key = proof.by === 'bakong_md5' && proof.md5 ? `md5:${proof.md5}` : '';
      if ((md5Key && isPaymentRefUsed(db, md5Key)) || (refKey && isPaymentRefUsed(db, refKey))) {
        return jsonResponse(
          { ok: false, error: 'ការទូទាត់ / លេខយោងប្រតិបត្តិការណ៍នេះត្រូវបានប្រើសម្រាប់ការកម្ម៉ង់មុនរួចហើយ!' },
          409
        );
      }
      markPaymentRefUsed(db, [md5Key, refKey]);
      await kvDelete(env, `pay:${proof.sid}`);

      order.paymentVerified = true;
      order.paymentVerifiedBy = proof.by;
      order.paymentPaidAmount = proof.amtCur;
      order.paymentCurrency = proof.cur;
      order.paymentRef = proof.ref;
      order.paymentMd5 = proof.md5;
    }
    delete order.paymentProofToken;

    if (isNew) {
      db.orders.unshift(order);
      const cust = (order.customer || {}) as Record<string, unknown>;
      const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
      const earnedPoints = items.reduce((sum, it) => sum + Math.max(1, Number(it.qty) || 1), 0);
      if (earnedPoints > 0) {
        const memberIdStr = cust.memberId !== undefined && cust.memberId !== null ? String(cust.memberId) : '';
        const phoneNorm = typeof cust.phone === 'string' && cust.phone.trim() ? normalizePhone(cust.phone) : '';
        const tgClean = typeof cust.tg === 'string' ? cust.tg.replace(/^@+/, '').trim().toLowerCase() : '';
        const matched = db.members.find(
          (m) =>
            (memberIdStr && String(m.id) === memberIdStr) ||
            (phoneNorm && m.phone && normalizePhone(m.phone) === phoneNorm) ||
            (tgClean && m.telegramUsername && m.telegramUsername.replace(/^@+/, '').toLowerCase() === tgClean)
        );
        if (matched) {
          matched.points = (matched.points || 0) + earnedPoints;
        }
      }

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
    } else {
      db.orders[idx] = order;
    }
    await saveDb(env, db);

    if (isNew) {
      const botToken = getEffectiveBotToken(env, db);
      const chatId = getEffectiveChatId(env, db);
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
        const payStatusLine =
          order.payment === 'KHQR / ABA' && order.paymentVerified
            ? `✅ <b>ទូទាត់ KHQR បានផ្ទៀងផ្ទាត់</b> (${
                order.paymentVerifiedBy === 'bakong_md5'
                  ? 'Bakong Auto'
                  : order.paymentVerifiedBy === 'telegram_owner'
                    ? 'Telegram Approved'
                    : 'Slip Verified'
              })${order.paymentRef ? ` · Ref: <code>${order.paymentRef}</code>` : ''}`
            : `💵 ទូទាត់៖ ${order.payment}`;
        const msg = `🔔 <b>កម្ម៉ង់ថ្មី ${order.id}</b> (${order.timestamp})\n👤 ${cust.name || '-'} (${cust.phone || '-'})\n${locTxt}\n\n${itemsTxt}\n\n💰 សរុប៖ <b>$${Number(order.grandTotal || 0).toFixed(2)}</b>\n${payStatusLine}`;
        await sendTelegramBotMessage(botToken, chatId, msg);
      }
    }
    return jsonResponse({ ok: true, order });
  }

  if (path.startsWith('/api/orders/') && path.endsWith('/feedback') && method === 'POST') {
    const orderId = decodeURIComponent(
      path.slice('/api/orders/'.length, path.length - '/feedback'.length)
    ).trim();
    const idx = db.orders.findIndex((o) => o.id === orderId);
    if (idx === -1) {
      return jsonResponse({ ok: false, error: 'រកមិនឃើញការកម្ម៉ង់នេះទេ' }, 404);
    }
    const existing = db.orders[idx];
    if (existing.status !== 'Completed') {
      return jsonResponse({ ok: false, error: 'អាចវាយតម្លៃបានតែការកម្ម៉ង់ដែលបានបញ្ចប់ប៉ុណ្ណោះ' }, 400);
    }

    const body = await readJsonBody(req);
    const rating = Math.round(Number(body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ ok: false, error: 'សូមជ្រើសរើសផ្កាយពី ១ ដល់ ៥' }, 400);
    }
    const comment = String(body.comment || '').trim().slice(0, 500);
    const cust = (existing.customer || {}) as Record<string, unknown>;
    const customerName = String(body.customerName || cust.name || '').trim() || undefined;

    const updated = {
      ...existing,
      feedback: {
        rating,
        comment,
        submittedAt: Date.now(),
        customerName,
      },
    };
    db.orders[idx] = updated;
    await saveDb(env, db);
    return jsonResponse({ ok: true, order: updated });
  }

  if (path.startsWith('/api/orders/') && method === 'DELETE') {
    if (!(await requireAdmin(req, env, db))) {
      return jsonResponse({ ok: false, error: 'ទាមទារការអនុញ្ញាតពីម្ចាស់ហាង' }, 401);
    }
    const orderId = decodeURIComponent(path.slice('/api/orders/'.length));
    db.orders = db.orders.filter((o) => o.id !== orderId);
    await saveDb(env, db);
    return jsonResponse({ ok: true });
  }

  if (path === '/api/resolve-map-link' && method === 'GET') {
    const rawUrl = (url.searchParams.get('url') || '').trim();
    if (!rawUrl || rawUrl.length > 1000) {
      return jsonResponse({ ok: false, error: 'តំណរ Google Maps មិនត្រឹមត្រូវ' }, 400);
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return jsonResponse({ ok: false, error: 'តំណរ Google Maps មិនត្រឹមត្រូវ' }, 400);
    }
    const allowedHosts = new Set([
      'maps.app.goo.gl',
      'goo.gl',
      'g.co',
      'maps.google.com',
      'google.com',
      'www.google.com',
    ]);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !allowedHosts.has(parsed.hostname.toLowerCase())
    ) {
      return jsonResponse({ ok: false, error: 'គាំទ្រតែតំណរ Google Maps ប៉ុណ្ណោះ' }, 400);
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
      return jsonResponse({ ok: true, ...direct, resolvedUrl: rawUrl });
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
        return jsonResponse({ ok: true, ...fromFinalUrl, resolvedUrl: finalUrl });
      }
      const html = (await resp.text()).slice(0, 60000);
      const fromHtml = extractFromString(html);
      if (fromHtml) {
        return jsonResponse({ ok: true, ...fromHtml, resolvedUrl: finalUrl });
      }
      return jsonResponse({ ok: false, error: 'រកមិនឃើញកូអរដោនេក្នុង Link នេះទេ' }, 404);
    } catch {
      return jsonResponse({ ok: false, error: 'មិនអាចបើក Link Google Maps បានទេ' }, 502);
    }
  }

  return jsonResponse({ ok: false, error: 'API endpoint not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env);
      } catch {
        return jsonResponse({ ok: false, error: 'ប្រព័ន្ធមានបញ្ហាបណ្តោះអាសន្ន សូមព្យាយាមម្តងទៀត' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

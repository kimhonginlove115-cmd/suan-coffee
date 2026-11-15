// Cloudflare Workers Full-Stack Backend for Emerald Brew Cafe
// Uses 100% Web Standards (crypto.subtle, fetch, KVNamespace) — zero Node.js built-ins required.

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

// ---- Database Load / Save ----
async function loadDb(env: Env): Promise<PersistedDatabase> {
  const envSecret = env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 ? env.SESSION_SECRET : '';
  const defaults: PersistedDatabase = {
    sessionSecret: envSecret || randomHex(32),
    members: [],
    orders: [],
    menuItems: null,
    toppings: null,
    shopSettings: null,
    secrets: {
      adminPin: env.ADMIN_PIN || '1234',
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      chatId: env.TELEGRAM_CHAT_ID || '',
      telegramGatewayToken: env.TELEGRAM_GATEWAY_TOKEN || '',
      twilioAccountSid: env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: env.TWILIO_AUTH_TOKEN || '',
      twilioFromNumber: env.TWILIO_FROM_NUMBER || '',
      smsWebhookUrl: env.SMS_WEBHOOK_URL || '',
      smsWebhookApiKey: env.SMS_WEBHOOK_API_KEY || '',
    },
    lastTelegramUpdateOffset: 0,
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
): Promise<boolean> {
  if (!botToken || !chatId) return false;
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
    const data = (await resp.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
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
    const botUsername = await resolveBotUsername(env, db, botToken);
    const phoneOtpChannel = detectPhoneOtpChannel(env, db);
    const botReady = Boolean(botToken && botUsername);
    return jsonResponse({
      ok: true,
      telegramWidgetReady: botReady,
      telegramBotReady: botReady,
      telegramContactReady: botReady,
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
    if (!botToken) {
      return jsonResponse({
        ok: true,
        linked: false,
        step: session.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
      });
    }

    try {
      const updRes = await fetchWithTimeout(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${db.lastTelegramUpdateOffset}&limit=30&timeout=0`,
        {},
        4500
      );
      const updData = (await updRes.json()) as {
        ok?: boolean;
        result?: Array<{
          update_id: number;
          message?: {
            text?: string;
            from?: { id: number; username?: string; first_name?: string };
            contact?: { phone_number?: string; first_name?: string; user_id?: number };
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
            if (matchedNonce) {
              const targetSess: TelegramLinkSession | null =
                matchedNonce === nonce
                  ? session
                  : safeJsonParse<TelegramLinkSession>(await kvGet(env, `tg:${matchedNonce}`));
              if (targetSess) {
                targetSess.startedByTelegramId = String(from.id);
                targetSess.verifiedUser = {
                  id: String(from.id),
                  username: from.username || '',
                  firstName: from.first_name || 'Telegram User',
                };
                await kvPut(env, `tg:${matchedNonce}`, JSON.stringify(targetSess), 600);
                await kvPut(env, `tg_user_active:${from.id}`, matchedNonce, 600);
                if (matchedNonce === nonce) session = targetSess;

                if (targetSess.mode === 'contact') {
                  await sendTelegramBotMessage(
                    botToken,
                    String(from.id),
                    `📱 <b>Emerald Brew Cafe</b>\nសូមចុចប៊ូតុង <b>«📱 ចុចផ្ញើលេខទូរស័ព្ទផ្ទៀងផ្ទាត់»</b> ខាងក្រោម ដើម្បីបញ្ជាក់លេខទូរស័ព្ទពិតរបស់អ្នកដោយឥតគិតថ្លៃ ១០០%!`,
                    {
                      keyboard: [[{ text: '📱 ចុចផ្ញើលេខទូរស័ព្ទផ្ទៀងផ្ទាត់ (Free)', request_contact: true }]],
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
          }

          if (msg.contact?.phone_number && Number(msg.contact.user_id) === Number(from.id)) {
            const verifiedPhone = normalizePhone(msg.contact.phone_number);
            if (isValidPhone(verifiedPhone)) {
              const activeNonce = await kvGet(env, `tg_user_active:${from.id}`);
              if (activeNonce) {
                const cand: TelegramLinkSession | null =
                  activeNonce === nonce
                    ? session
                    : safeJsonParse<TelegramLinkSession>(await kvGet(env, `tg:${activeNonce}`));
                if (cand) {
                  if (cand.mode === 'contact' && cand.startedByTelegramId === String(from.id)) {
                    cand.verifiedPhone = verifiedPhone;
                    cand.verifiedUser = cand.verifiedUser || {
                      id: String(from.id),
                      username: from.username || '',
                      firstName: from.first_name || msg.contact.first_name || 'Telegram User',
                    };
                    await kvPut(env, `tg:${activeNonce}`, JSON.stringify(cand), 600);
                    if (activeNonce === nonce) session = cand;
                  }
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
        if (offsetChanged) await saveDb(env, db);
      }

      if (session.mode === 'login' && session.verifiedUser) return finalize(session);
      if (session.mode === 'contact' && session.verifiedUser && session.verifiedPhone) return finalize(session);
    } catch {
      // ignore transient poll error
    }

    return jsonResponse({
      ok: true,
      linked: false,
      step: session.startedByTelegramId ? 'awaiting_contact' : 'awaiting_start',
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
    return jsonResponse({ ok: true });
  }

  if (path === '/api/orders' && method === 'GET') {
    const sorted = [...db.orders].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return jsonResponse({ ok: true, orders: sorted });
  }

  if (path === '/api/orders' && method === 'POST') {
    const order = await readJsonBody(req);
    if (!order || typeof order.id !== 'string') {
      return jsonResponse({ ok: false, error: 'Invalid order payload' }, 400);
    }
    const idx = db.orders.findIndex((o) => o.id === order.id);
    const isNew = idx === -1;
    if (isNew) db.orders.unshift(order);
    else db.orders[idx] = order;
    await saveDb(env, db);

    if (isNew) {
      const botToken = getEffectiveBotToken(env, db);
      const chatId = (db.secrets.chatId || env.TELEGRAM_CHAT_ID || '').trim();
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
        await sendTelegramBotMessage(botToken, chatId, msg);
      }
    }
    return jsonResponse({ ok: true, order });
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

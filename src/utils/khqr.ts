import jsQR from 'jsqr';
import QRCode from 'qrcode';

export interface TlvNode {
  tag: string;
  value: string;
}

export function tlv(tag: string, value: string): string {
  const safeVal = String(value ?? '').slice(0, 99);
  const len = String(safeVal.length).padStart(2, '0');
  return `${tag}${len}${safeVal}`;
}

// Standard EMVCo / NBC Bakong CRC-16/CCITT-FALSE (polynomial 0x1021, initial 0xFFFF)
export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function parseEmvTlv(raw: string): TlvNode[] {
  const s = (raw || '').trim();
  const nodes: TlvNode[] = [];
  let idx = 0;
  while (idx + 4 <= s.length) {
    const tag = s.slice(idx, idx + 2);
    const lenStr = s.slice(idx + 2, idx + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) return [];
    const len = parseInt(lenStr, 10);
    if (idx + 4 + len > s.length) return [];
    const value = s.slice(idx + 4, idx + 4 + len);
    nodes.push({ tag, value });
    idx += 4 + len;
  }
  if (idx !== s.length) return [];
  return nodes;
}

export function isValidEmvKhqr(raw: string): boolean {
  const s = (raw || '').trim();
  if (!s.startsWith('000201') || s.length < 24) return false;
  const nodes = parseEmvTlv(s);
  if (!nodes.length) return false;
  const hasMerchantTag = nodes.some((n) => {
    const num = Number(n.tag);
    return num >= 26 && num <= 51;
  });
  const crcNode = nodes.find((n) => n.tag === '63');
  if (!hasMerchantTag || !crcNode || crcNode.value.length !== 4) return false;
  const withoutCrcValue = s.slice(0, -4);
  return crc16CcittFalse(withoutCrcValue) === crcNode.value.toUpperCase();
}

export function extractKhqrSummary(raw: string): {
  valid: boolean;
  bakongId: string;
  merchantName: string;
  merchantCity: string;
  currency: 'USD' | 'KHR';
} {
  const nodes = parseEmvTlv(raw);
  if (!nodes.length) {
    return { valid: false, bakongId: '', merchantName: '', merchantCity: '', currency: 'USD' };
  }
  const tag29or30 = nodes.find((n) => n.tag === '29' || n.tag === '30');
  let bakongId = '';
  if (tag29or30) {
    const sub = parseEmvTlv(tag29or30.value);
    const idSub = sub.find((s) => s.tag === '00');
    bakongId = idSub?.value || '';
  }
  const merchantName = nodes.find((n) => n.tag === '59')?.value || '';
  const merchantCity = nodes.find((n) => n.tag === '60')?.value || '';
  const curCode = nodes.find((n) => n.tag === '53')?.value || '840';
  return {
    valid: isValidEmvKhqr(raw),
    bakongId,
    merchantName,
    merchantCity,
    currency: curCode === '116' ? 'KHR' : 'USD',
  };
}

function toAsciiMerchantText(input: string | undefined, fallback: string, maxLen: number): string {
  const ascii = (input || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const val = ascii || fallback;
  return val.slice(0, maxLen);
}

export interface DynamicKhqrResult {
  payload: string;
  isOfficialEmv: boolean;
  formattedAmount: string;
  currency: 'USD' | 'KHR';
  currencyLabel: string;
  merchantDisplay: string;
  bakongIdDisplay: string;
}

export function buildDynamicKhqr(opts: {
  basePayload?: string;
  bakongId?: string;
  merchantName?: string;
  merchantCity?: string;
  amountUsd: number;
  currency?: 'USD' | 'KHR';
  khrRate?: number;
  billNumber?: string;
  timestampMs?: number;
}): DynamicKhqrResult {
  const currency: 'USD' | 'KHR' = opts.currency === 'KHR' ? 'KHR' : 'USD';
  const rate = opts.khrRate && opts.khrRate > 0 ? opts.khrRate : 4100;
  const safeUsd = Math.max(0, Number(opts.amountUsd) || 0);

  const amountStr =
    currency === 'KHR'
      ? String(Math.max(100, Math.round((safeUsd * rate) / 100) * 100))
      : safeUsd.toFixed(2);
  const formattedAmount =
    currency === 'KHR'
      ? `${Number(amountStr).toLocaleString('en-US')} ៛`
      : `$${amountStr}`;
  const currencyCode = currency === 'KHR' ? '116' : '840';

  const cleanBase = (opts.basePayload || '').trim();
  const cleanBakongId = toAsciiMerchantText(opts.bakongId, '', 60).replace(/\s+/g, '');
  const fallbackMerchant = toAsciiMerchantText(opts.merchantName, 'EMERALD BREW CAFE', 25);
  const cleanBill = toAsciiMerchantText(opts.billNumber, '', 20);
  const tsPart =
    typeof opts.timestampMs === 'number' && Number.isFinite(opts.timestampMs) && opts.timestampMs > 0
      ? tlv('99', tlv('00', String(Math.floor(opts.timestampMs))))
      : '';

  // Mode A: Clone official uploaded/pasted bank KHQR and upgrade it to Dynamic Amount
  if (cleanBase && isValidEmvKhqr(cleanBase)) {
    const parsed = parseEmvTlv(cleanBase);
    const summary = extractKhqrSummary(cleanBase);
    const merchantDisplay = summary.merchantName || fallbackMerchant;
    const cityDisplay = toAsciiMerchantText(
      parsed.find((n) => n.tag === '60')?.value,
      opts.merchantCity || 'Phnom Penh',
      15
    );

    const outNodes: TlvNode[] = [];
    let insertedDynamicCore = false;

    for (const node of parsed) {
      if (node.tag === '00' || node.tag === '01' || node.tag === '53' || node.tag === '54' || node.tag === '63' || node.tag === '99') {
        continue;
      }
      if (node.tag === '59' && !node.value) continue;
      if (node.tag === '60') continue;
      if (node.tag === '58' && !insertedDynamicCore) {
        outNodes.push({ tag: '53', value: currencyCode });
        if (safeUsd > 0) outNodes.push({ tag: '54', value: amountStr });
        outNodes.push({ tag: '58', value: 'KH' });
        insertedDynamicCore = true;
        continue;
      }
      if (node.tag === '62' && cleanBill) {
        const subNodes = parseEmvTlv(node.value).filter((s) => s.tag !== '01');
        subNodes.unshift({ tag: '01', value: cleanBill });
        outNodes.push({ tag: '62', value: subNodes.map((s) => tlv(s.tag, s.value)).join('') });
        continue;
      }
      outNodes.push(node);
    }

    if (!insertedDynamicCore) {
      outNodes.push({ tag: '53', value: currencyCode });
      if (safeUsd > 0) outNodes.push({ tag: '54', value: amountStr });
      outNodes.push({ tag: '58', value: 'KH' });
    }

    if (!outNodes.some((n) => n.tag === '59')) {
      outNodes.push({ tag: '59', value: merchantDisplay });
    }
    outNodes.push({ tag: '60', value: cityDisplay });
    if (cleanBill && !outNodes.some((n) => n.tag === '62')) {
      outNodes.push({ tag: '62', value: tlv('01', cleanBill) });
    }

    // Reorder tags numerically to guarantee strict EMVCo parser compatibility
    const orderedBody = [
      tlv('00', '01'),
      tlv('01', safeUsd > 0 ? '12' : '11'),
      ...outNodes.sort((a, b) => Number(a.tag) - Number(b.tag)).map((n) => tlv(n.tag, n.value)),
      tsPart,
    ].join('');

    const withCrcPrefix = `${orderedBody}6304`;
    const crc = crc16CcittFalse(withCrcPrefix);
    return {
      payload: `${withCrcPrefix}${crc}`,
      isOfficialEmv: true,
      formattedAmount,
      currency,
      currencyLabel: currency,
      merchantDisplay,
      bakongIdDisplay: summary.bakongId,
    };
  }

  // Mode B: Build official Bakong KHQR directly from Bakong Account ID (e.g. username@aba)
  if (cleanBakongId && cleanBakongId.includes('@')) {
    const cityDisplay = toAsciiMerchantText(opts.merchantCity, 'Phnom Penh', 15);
    const parts = [
      tlv('00', '01'),
      tlv('01', safeUsd > 0 ? '12' : '11'),
      tlv('29', tlv('00', cleanBakongId)),
      tlv('52', '5999'),
      tlv('53', currencyCode),
      ...(safeUsd > 0 ? [tlv('54', amountStr)] : []),
      tlv('58', 'KH'),
      tlv('59', fallbackMerchant),
      tlv('60', cityDisplay),
      ...(cleanBill ? [tlv('62', tlv('01', cleanBill))] : []),
      tsPart,
    ].join('');

    const withCrcPrefix = `${parts}6304`;
    const crc = crc16CcittFalse(withCrcPrefix);
    return {
      payload: `${withCrcPrefix}${crc}`,
      isOfficialEmv: true,
      formattedAmount,
      currency,
      currencyLabel: currency,
      merchantDisplay: fallbackMerchant,
      bakongIdDisplay: cleanBakongId,
    };
  }

  return {
    payload: '',
    isOfficialEmv: false,
    formattedAmount,
    currency,
    currencyLabel: currency,
    merchantDisplay: fallbackMerchant,
    bakongIdDisplay: '',
  };
}

function scanImageWithMaxDim(
  img: HTMLImageElement,
  maxDim: number,
  inversionAttempts: 'dontInvert' | 'onlyInvert' | 'attemptBoth'
): string | null {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  canvas.width = 0;
  canvas.height = 0;
  const code = jsQR(imageData.data, w, h, { inversionAttempts });
  const text = code?.data?.trim() || '';
  return text.startsWith('000201') ? text : null;
}

export async function decodeKhqrFromImageFile(file: File): Promise<string | null> {
  if (file.size > 15 * 1024 * 1024) return null;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;
    const timeoutId = window.setTimeout(() => done(null), 10000);

    const done = (val: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
      resolve(val);
    };

    img.onerror = () => done(null);
    img.onload = async () => {
      try {
        await new Promise((r) => setTimeout(r, 16));
        if (settled) return;
        const pass1 = scanImageWithMaxDim(img, 560, 'dontInvert');
        if (pass1) return done(pass1);

        await new Promise((r) => setTimeout(r, 16));
        if (settled) return;
        const pass2 = scanImageWithMaxDim(img, 820, 'onlyInvert');
        return done(pass2);
      } catch {
        return done(null);
      }
    };
    img.src = objectUrl;
  });
}

export async function downloadBrandedKhqrPng(opts: {
  payload: string;
  merchantDisplay: string;
  formattedAmount: string;
  bankInfo?: string;
  filename?: string;
}): Promise<boolean> {
  if (!opts.payload) return false;
  try {
    const qrDataUrl = await QRCode.toDataURL(opts.payload, {
      width: 340,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    const qrImg = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = qrDataUrl;
    });

    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 660;
    const ctx = c.getContext('2d');
    if (!ctx) return false;

    // Background card
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, 480, 660);

    // Outer white rounded card
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(24, 24, 432, 612);

    // Official KHQR Red Header
    ctx.fillStyle = '#E1232E';
    ctx.fillRect(24, 24, 432, 86);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KHQR', 240, 78);

    // Merchant name & exact dynamic amount
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(opts.merchantDisplay.slice(0, 26), 240, 150);

    ctx.fillStyle = '#E1232E';
    ctx.font = 'bold 34px monospace';
    ctx.fillText(opts.formattedAmount, 240, 196);

    // Dashed divider
    ctx.strokeStyle = '#CBD5E1';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(48, 222);
    ctx.lineTo(432, 222);
    ctx.stroke();
    ctx.setLineDash([]);

    // QR Code
    ctx.drawImage(qrImg, 70, 240, 340, 340);

    // Footer bank info
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(
      (opts.bankInfo || 'Scan with ABA, ACLEDA, Bakong or any KHQR App').slice(0, 46),
      240,
      608
    );

    const a = document.createElement('a');
    a.download = opts.filename || 'KHQR-Payment.png';
    a.href = c.toDataURL('image/png');
    a.click();
    return true;
  } catch {
    return false;
  }
}

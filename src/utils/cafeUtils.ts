import type React from 'react';
import type { MenuItem, Order, ShopSettings, Topping } from '../types';

import heroBannerImg from '../assets/images/cafe_hero_banner_1794711441891.jpg';
import logoEmblemImg from '../assets/images/cafe_logo_emblem_1794711441103.jpg';
import icedLatteImg from '../assets/images/drink_iced_latte_1794711443556.jpg';
import ujiMatchaImg from '../assets/images/drink_uji_matcha_1794711442460.jpg';
import brownSugarImg from '../assets/images/drink_brown_sugar_1794711442457.jpg';
import spicyNoodlesImg from '../assets/images/food_spicy_noodles_1794711444044.jpg';
import butterCroissantImg from '../assets/images/food_butter_croissant_1794711444430.jpg';

export const CAFE_ASSETS = {
  heroBanner: heroBannerImg,
  logoEmblem: logoEmblemImg,
  icedLatte: icedLatteImg,
  ujiMatcha: ujiMatchaImg,
  brownSugar: brownSugarImg,
  spicyNoodles: spicyNoodlesImg,
  butterCroissant: butterCroissantImg,
};

const LEGACY_ASSET_MAP: Record<string, string> = {
  '/src/assets/images/cafe_hero_banner_1794711441891.jpg': heroBannerImg,
  '/src/assets/images/cafe_logo_emblem_1794711441103.jpg': logoEmblemImg,
  '/src/assets/images/drink_iced_latte_1794711443556.jpg': icedLatteImg,
  '/src/assets/images/drink_uji_matcha_1794711442460.jpg': ujiMatchaImg,
  '/src/assets/images/drink_brown_sugar_1794711442457.jpg': brownSugarImg,
  '/src/assets/images/food_spicy_noodles_1794711444044.jpg': spicyNoodlesImg,
  '/src/assets/images/food_butter_croissant_1794711444430.jpg': butterCroissantImg,
};

export function resolveAssetUrl(src: string | undefined | null, fallback: string = icedLatteImg): string {
  const clean = typeof src === 'string' ? src.trim() : '';
  if (!clean) return fallback;
  return LEGACY_ASSET_MAP[clean] || clean;
}

export function handleImgFallback(
  e: React.SyntheticEvent<HTMLImageElement>,
  fallback: string = icedLatteImg
): void {
  const el = e.currentTarget;
  if (el.dataset.fbApplied === '1') return;
  el.dataset.fbApplied = '1';
  el.src = fallback;
}

export const DEFAULT_MENU: MenuItem[] = [
  {
    id: 1,
    type: 'drink',
    name: 'Iced Latte Emerald',
    price: 2.5,
    discount: 0,
    category: 'Coffee',
    img: CAFE_ASSETS.icedLatte,
    desc: 'កាហ្វេអារ៉ាប៊ីកា លាយទឹកដោះគោស្រស់',
    available: true,
  },
  {
    id: 2,
    type: 'drink',
    name: 'Uji Matcha Latte',
    price: 3.0,
    discount: 15,
    category: 'Matcha',
    img: CAFE_ASSETS.ujiMatcha,
    desc: 'ម្សៅតែបៃតងជប៉ុនសុទ្ធ',
    available: true,
  },
  {
    id: 3,
    type: 'drink',
    name: 'Brown Sugar Milk Tea',
    price: 2.25,
    discount: 0,
    category: 'Milk Tea',
    img: CAFE_ASSETS.brownSugar,
    desc: 'តែទឹកដោះគោស្ករត្នោត និងគុជខ្មៅ',
    available: true,
  },
  {
    id: 4,
    type: 'food',
    name: 'មីហឹរកូរ៉េពងមាន់',
    price: 3.5,
    discount: 10,
    category: 'Food & Noodles',
    img: CAFE_ASSETS.spicyNoodles,
    desc: 'មីហឹរឈ្ងុយឆ្ងាញ់ បន្ថែមពងមាន់ទន់',
    available: true,
  },
  {
    id: 5,
    type: 'food',
    name: 'នំ Croissant ប័រស្រួយ',
    price: 2.0,
    discount: 0,
    category: 'Bakery & Snacks',
    img: CAFE_ASSETS.butterCroissant,
    desc: 'នំដុតថ្មីៗឈ្ងុយប័របារាំង',
    available: true,
  },
];

export const DEFAULT_TOPPINGS: Topping[] = [
  { id: 101, name: 'គុជខ្មៅ (Black Pearl)', price: 0.5, available: true },
  { id: 102, name: 'ឈីសហ្វូម (Cheese Foam)', price: 0.75, available: true },
  { id: 103, name: 'Extra Espresso Shot', price: 0.75, available: true },
];

export const DEFAULT_SETTINGS: ShopSettings = {
  brandTitle: 'EMERALD BREW CAFE',
  shopName: 'កាហ្វេពិសេស និងអាហារស្រស់ៗប្រចាំថ្ងៃ',
  logoImg: CAFE_ASSETS.logoEmblem,
  bannerImg: CAFE_ASSETS.heroBanner,
  khqrImg: '',
  khqrBakongId: '',
  khqrPayload: '',
  khqrMerchantName: 'EMERALD BREW CAFE',
  khqrCurrency: 'USD',
  khqrKhrRate: 4100,
  bankInfo: '',
  promoCode: 'CAFE10',
  promoPercent: 10,
  tgUsername: '',
  botUsername: '',
  facebookUrl: '',
  tiktokUrl: '',
  instagramUrl: '',
  youtubeUrl: '',
  phoneHotline: '',
  firebaseUrl: '',
  isOpen: true,
  deliveryMode: 'distance',
  baseFee: 0.5,
  deliveryRatePerKm: 0.5,
  freeDeliveryOver: 15,
  lat: 11.5564,
  lng: 104.9282,
};

const memoryFallback: Record<string, unknown> = {};

export function safeGet<T>(key: string, def: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : def;
  } catch {
    return key in memoryFallback ? (memoryFallback[key] as T) : def;
  }
}

export function safeSet<T>(key: string, value: T): boolean {
  memoryFallback[key] = value;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    const val = memoryFallback[`_ss_${key}`];
    return typeof val === 'string' ? val : null;
  }
}

export function safeSessionSet(key: string, value: string): void {
  memoryFallback[`_ss_${key}`] = value;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Fallback already stored in memoryFallback
  }
}

export function safeSessionDel(key: string): void {
  delete memoryFallback[`_ss_${key}`];
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function normalizeMenuItems(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return DEFAULT_MENU;
  return raw
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
    .map((m, idx) => ({
      id: (m.id as number | string) ?? `item-${idx}`,
      type: m.type === 'food' ? 'food' : 'drink',
      name: String(m.name || 'Menu Item'),
      price: Math.max(0, Number(m.price) || 0),
      discount: Math.min(90, Math.max(0, Number(m.discount) || 0)),
      category: String(m.category || 'Coffee'),
      img: resolveAssetUrl(typeof m.img === 'string' ? m.img : '', CAFE_ASSETS.icedLatte),
      desc: String(m.desc || ''),
      available: m.available !== false,
    }));
}

export function normalizeToppings(raw: unknown): Topping[] {
  if (!Array.isArray(raw)) return DEFAULT_TOPPINGS;
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
    .map((t, idx) => ({
      id: (t.id as number | string) ?? `top-${idx}`,
      name: String(t.name || 'Topping'),
      price: Math.max(0, Number(t.price) || 0),
      available: t.available !== false,
    }));
}

export function normalizeShopSettings(raw: unknown, fallback: ShopSettings = DEFAULT_SETTINGS): ShopSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<ShopSettings>) : {};
  const merged = { ...fallback, ...obj };
  return {
    ...merged,
    logoImg: resolveAssetUrl(merged.logoImg, CAFE_ASSETS.logoEmblem),
    bannerImg: resolveAssetUrl(merged.bannerImg, CAFE_ASSETS.heroBanner),
    lat: parseFloat(String(merged.lat)) || fallback.lat,
    lng: parseFloat(String(merged.lng)) || fallback.lng,
    khqrKhrRate: Number(merged.khqrKhrRate) > 0 ? Number(merged.khqrKhrRate) : 4100,
  };
}

export function normalizeOrders(raw: unknown): Order[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => Boolean(o && typeof o === 'object' && o.id))
    .map((o) => {
      const cust = (o.customer && typeof o.customer === 'object' ? o.customer : {}) as Record<string, unknown>;
      const items = Array.isArray(o.items) ? o.items : [];
      const coords =
        cust.coords && typeof cust.coords === 'object'
          ? {
              lat: Number((cust.coords as Record<string, unknown>).lat) || DEFAULT_SETTINGS.lat,
              lng: Number((cust.coords as Record<string, unknown>).lng) || DEFAULT_SETTINGS.lng,
            }
          : undefined;
      const driverCoords =
        o.driverCoords && typeof o.driverCoords === 'object'
          ? {
              lat: Number((o.driverCoords as Record<string, unknown>).lat) || DEFAULT_SETTINGS.lat,
              lng: Number((o.driverCoords as Record<string, unknown>).lng) || DEFAULT_SETTINGS.lng,
            }
          : null;
      return {
        id: String(o.id),
        createdAt: Number(o.createdAt) || 0,
        timestamp: String(o.timestamp || ''),
        type: o.type === 'dinein' ? 'dinein' : 'delivery',
        items: items.map((it: Record<string, unknown>, idx) => ({
          cartId: Number(it?.cartId) || idx,
          name: String(it?.name || 'Item'),
          img: resolveAssetUrl(typeof it?.img === 'string' ? it.img : '', CAFE_ASSETS.icedLatte),
          qty: Math.max(1, Number(it?.qty) || 1),
          unitPrice: Math.max(0, Number(it?.unitPrice) || 0),
          options: String(it?.options || ''),
        })),
        payment: o.payment === 'KHQR / ABA' ? 'KHQR / ABA' : 'Cash',
        subtotal: Number(o.subtotal) || 0,
        promoDisc: Number(o.promoDisc) || 0,
        fee: Number(o.fee) || 0,
        grandTotal: Number(o.grandTotal) || 0,
        customer: {
          name: String(cust.name || '-'),
          phone: String(cust.phone || ''),
          tg: String(cust.tg || ''),
          addressName: cust.addressName ? String(cust.addressName) : undefined,
          addressNote: cust.addressNote ? String(cust.addressNote) : undefined,
          coords,
          distanceKm: cust.distanceKm ? String(cust.distanceKm) : undefined,
          tableNum: cust.tableNum as number | string | undefined,
        },
        driverCoords,
        status:
          o.status === 'Brewing' || o.status === 'Ready' || o.status === 'Completed'
            ? o.status
            : 'Pending',
      };
    });
}

export function getDiscountedPrice(item: Pick<MenuItem, 'price' | 'discount'>): number {
  const p = Number(item.price) || 0;
  const d = parseFloat(String(item.discount)) || 0;
  return p * (1 - d / 100);
}

export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeDeliveryFee(settings: ShopSettings, dKm: number, subtotal: number): number {
  if (settings.deliveryMode === 'free') return 0;
  if (settings.freeDeliveryOver > 0 && subtotal >= settings.freeDeliveryOver) return 0;
  if (settings.deliveryMode === 'flat') return parseFloat(String(settings.baseFee)) || 0;
  const raw =
    (parseFloat(String(settings.baseFee)) || 0) +
    dKm * (parseFloat(String(settings.deliveryRatePerKm)) || 0);
  return Math.round(raw * 4) / 4;
}

export function getFirebaseBase(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/(shop|orders)?\.json$/i, '').replace(/\/+$/, '');
}

export function compressImageFile(
  file: File,
  maxDim: number,
  onSuccess: (dataUrl: string) => void,
  onError: (msg: string) => void
): void {
  if (file.size > 15 * 1024 * 1024) {
    onError('រូបភាពធំពេក (>15MB)! សូមជ្រើសរើសរូបតូចជាងនេះ');
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  let settled = false;
  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    onError('ការបង្រួមរូបភាពចំណាយពេលយូរពេក!');
  }, 10000);

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    img.onload = null;
    img.onerror = null;
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  };

  img.onerror = () => {
    if (settled) return;
    settled = true;
    cleanup();
    onError('ប្រភេទរូបភាពនេះមិនគាំទ្រទេ!');
  };

  img.onload = () => {
    if (settled) return;
    settled = true;
    try {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) {
        cleanup();
        onError('មិនអាចអានទំហំរូបភាពបានទេ!');
        return;
      }
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no ctx');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      canvas.width = 0;
      canvas.height = 0;
      cleanup();
      onSuccess(dataUrl);
    } catch {
      cleanup();
      onError('មិនអាចបង្រួមរូបភាពបានទេ!');
    }
  };

  img.src = objectUrl;
}

export function extractCoordsFromMapText(raw: string): { lat: number; lng: number } | null {
  const text = (raw || '').trim();
  if (!text) return null;

  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // keep raw text if malformed URI escape
  }

  const patterns = [
    /!3d(-?\d{1,2}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/,
    /@(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    /[?&](?:q|ll|destination|center|sll)=(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    /(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
  ];

  for (const re of patterns) {
    const m = decoded.match(re) || text.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

export function playDingSound(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.45);
    o.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {
    // ignore audio block
  }
}

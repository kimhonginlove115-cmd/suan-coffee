import type React from 'react';
import type { CategoryPreset, MenuItem, Order, ShopSettings, Topping } from '../types';

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
    name: 'ឡាតេទឹកកកពិសេស (Iced Latte)',
    nameEn: 'Signature Iced Latte',
    price: 2.5,
    discount: 0,
    category: 'Coffee',
    categoryEn: 'Coffee',
    img: CAFE_ASSETS.icedLatte,
    desc: 'កាហ្វេអារ៉ាប៊ីកា លាយទឹកដោះគោស្រស់',
    descEn: 'Signature Arabica espresso blended with fresh chilled milk',
    available: true,
    featured: true,
  },
  {
    id: 2,
    type: 'drink',
    name: 'ម៉ាត់ឆាឡាតេជប៉ុន (Uji Matcha)',
    nameEn: 'Uji Matcha Latte',
    price: 3.0,
    discount: 15,
    category: 'Matcha',
    categoryEn: 'Matcha',
    img: CAFE_ASSETS.ujiMatcha,
    desc: 'ម្សៅតែបៃតងជប៉ុនសុទ្ធ',
    descEn: 'Authentic ceremonial-grade Japanese green tea latte',
    available: true,
    featured: true,
  },
  {
    id: 3,
    type: 'drink',
    name: 'តែទឹកដោះគោស្ករត្នោត',
    nameEn: 'Brown Sugar Milk Tea',
    price: 2.25,
    discount: 0,
    category: 'Milk Tea',
    categoryEn: 'Milk Tea',
    img: CAFE_ASSETS.brownSugar,
    desc: 'តែទឹកដោះគោស្ករត្នោត និងគុជខ្មៅ',
    descEn: 'Rich brown sugar syrup swirled with fresh milk and boba pearls',
    available: true,
  },
  {
    id: 4,
    type: 'food',
    name: 'មីហឹរកូរ៉េពងមាន់',
    nameEn: 'Korean Spicy Egg Noodles',
    price: 3.5,
    discount: 10,
    category: 'Food & Noodles',
    categoryEn: 'Food & Noodles',
    img: CAFE_ASSETS.spicyNoodles,
    desc: 'មីហឹរឈ្ងុយឆ្ងាញ់ បន្ថែមពងមាន់ទន់',
    descEn: 'Savory spicy Korean noodles topped with a soft-boiled egg',
    available: true,
  },
  {
    id: 5,
    type: 'food',
    name: 'នំ Croissant ប័រស្រួយ',
    nameEn: 'Flaky Butter Croissant',
    price: 2.0,
    discount: 0,
    category: 'Bakery & Snacks',
    categoryEn: 'Bakery & Snacks',
    img: CAFE_ASSETS.butterCroissant,
    desc: 'នំដុតថ្មីៗឈ្ងុយប័របារាំង',
    descEn: 'Freshly baked golden French butter croissant',
    available: true,
  },
];

export const DEFAULT_TOPPINGS: Topping[] = [
  { id: 101, name: 'គុជខ្មៅ (Black Pearl)', nameEn: 'Black Pearl Boba', price: 0.5, available: true },
  { id: 102, name: 'ឈីសហ្វូម (Cheese Foam)', nameEn: 'Cheese Foam', price: 0.75, available: true },
  { id: 103, name: 'បន្ថែម Espresso ១ ស៊ុត', nameEn: 'Extra Espresso Shot', price: 0.75, available: true },
];

export const DEFAULT_CATEGORY_PRESETS: CategoryPreset[] = [
  { value: 'Coffee', valueEn: 'Coffee', labelKm: 'កាហ្វេ (Coffee)', labelEn: 'Coffee' },
  { value: 'Matcha', valueEn: 'Matcha', labelKm: 'ម៉ាត់ឆា (Matcha)', labelEn: 'Matcha' },
  { value: 'Milk Tea', valueEn: 'Milk Tea', labelKm: 'តែទឹកដោះគោ (Milk Tea)', labelEn: 'Milk Tea' },
  { value: 'Smoothie & Soda', valueEn: 'Smoothie & Soda', labelKm: 'ស្មូទី & សូដា (Smoothie & Soda)', labelEn: 'Smoothie & Soda' },
  { value: 'Food & Noodles', valueEn: 'Food & Noodles', labelKm: 'មី & អាហារ (Food & Noodles)', labelEn: 'Food & Noodles' },
  { value: 'Bakery & Snacks', valueEn: 'Bakery & Snacks', labelKm: 'នំ & អាហារសម្រន់ (Bakery & Snacks)', labelEn: 'Bakery & Snacks' },
];

export const DEFAULT_SETTINGS: ShopSettings = {
  brandTitle: 'SUAN COFFEE',
  shopName: 'កាហ្វេពិសេស និងអាហារស្រស់ៗប្រចាំថ្ងៃ',
  logoImg: CAFE_ASSETS.logoEmblem,
  bannerImg: CAFE_ASSETS.heroBanner,
  khqrImg: '',
  khqrBakongId: '',
  khqrPayload: '',
  khqrMerchantName: 'SUAN COFFEE',
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
  tableCount: 10,
  categoryPresets: DEFAULT_CATEGORY_PRESETS,
  unpaidVoiceAlertAudio: '',
  unpaidVoiceAlertText: '',
  unpaidAutoAlertEnabled: false,
  unpaidAlertMinutes: 10,
  autoScheduleEnabled: false,
  openTime: '07:00',
  closeTime: '20:30',
  closedDays: [],
  loyaltyEnabled: true,
  loyaltyRewardPoints: 10,
  loyaltyRewardAmountUsd: 2.5,
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

export function safeDel(key: string): void {
  delete memoryFallback[key];
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
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
    .map((m, idx) => {
      const id = (m.id as number | string) ?? `item-${idx}`;
      const name = String(m.name || 'Menu Item');
      const presetMatch = DEFAULT_MENU.find(
        (d) =>
          String(d.id) === String(id) ||
          d.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      return {
        id,
        type: m.type === 'food' ? 'food' : 'drink',
        name,
        nameEn:
          typeof m.nameEn === 'string' && m.nameEn.trim()
            ? m.nameEn.trim()
            : presetMatch?.nameEn,
        price: Math.max(0, Number(m.price) || 0),
        discount: Math.min(90, Math.max(0, Number(m.discount) || 0)),
        category: String(m.category || 'Coffee'),
        categoryEn:
          typeof m.categoryEn === 'string' && m.categoryEn.trim()
            ? m.categoryEn.trim()
            : presetMatch?.categoryEn,
        img: resolveAssetUrl(typeof m.img === 'string' ? m.img : '', CAFE_ASSETS.icedLatte),
        desc: String(m.desc || ''),
        descEn:
          typeof m.descEn === 'string' && m.descEn.trim()
            ? m.descEn.trim()
            : presetMatch?.descEn,
        available: m.available !== false,
        featured: typeof m.featured === 'boolean' ? m.featured : Boolean(presetMatch?.featured),
        ...(typeof m.stockQty === 'number' && Number.isFinite(m.stockQty) && m.stockQty >= 0
          ? { stockQty: Math.round(m.stockQty) }
          : {}),
      };
    });
}

export function normalizeToppings(raw: unknown): Topping[] {
  if (!Array.isArray(raw)) return DEFAULT_TOPPINGS;
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
    .map((t, idx) => {
      const id = (t.id as number | string) ?? `top-${idx}`;
      const name = String(t.name || 'Topping');
      const presetMatch = DEFAULT_TOPPINGS.find(
        (d) =>
          String(d.id) === String(id) ||
          d.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      return {
        id,
        name,
        nameEn:
          typeof t.nameEn === 'string' && t.nameEn.trim()
            ? t.nameEn.trim()
            : presetMatch?.nameEn,
        price: Math.max(0, Number(t.price) || 0),
        available: t.available !== false,
      };
    });
}

export function normalizeCategoryPresets(raw: unknown): CategoryPreset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: CategoryPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<CategoryPreset>;
    const val = String(obj.value || '').trim().slice(0, 60);
    if (!val) continue;
    const key = val.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const valEn = String(obj.valueEn || val).trim().slice(0, 60) || val;
    const labelKm = String(obj.labelKm || val).trim().slice(0, 80) || val;
    const labelEn = String(obj.labelEn || valEn).trim().slice(0, 80) || valEn;
    out.push({ value: val, valueEn: valEn, labelKm, labelEn });
  }
  return out;
}

export function normalizeShopSettings(raw: unknown, fallback: ShopSettings = DEFAULT_SETTINGS): ShopSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<ShopSettings>) : {};
  const merged = { ...fallback, ...obj };
  const normalizedPresets =
    'categoryPresets' in obj ? normalizeCategoryPresets(obj.categoryPresets) : undefined;
  return {
    ...merged,
    logoImg: resolveAssetUrl(merged.logoImg, CAFE_ASSETS.logoEmblem),
    bannerImg: resolveAssetUrl(merged.bannerImg, CAFE_ASSETS.heroBanner),
    lat: parseFloat(String(merged.lat)) || fallback.lat,
    lng: parseFloat(String(merged.lng)) || fallback.lng,
    khqrKhrRate: Number(merged.khqrKhrRate) > 0 ? Number(merged.khqrKhrRate) : 4100,
    tableCount: Math.min(100, Math.max(1, Math.round(Number(merged.tableCount) || fallback.tableCount || 10))),
    categoryPresets:
      normalizedPresets !== undefined
        ? normalizedPresets
        : fallback.categoryPresets || DEFAULT_CATEGORY_PRESETS,
    unpaidVoiceAlertAudio:
      typeof merged.unpaidVoiceAlertAudio === 'string' && merged.unpaidVoiceAlertAudio.startsWith('data:audio/')
        ? merged.unpaidVoiceAlertAudio
        : '',
    unpaidVoiceAlertText:
      typeof merged.unpaidVoiceAlertText === 'string' ? merged.unpaidVoiceAlertText.slice(0, 260) : '',
    unpaidAutoAlertEnabled: Boolean(merged.unpaidAutoAlertEnabled),
    unpaidAlertMinutes: Math.min(60, Math.max(1, Math.round(Number(merged.unpaidAlertMinutes) || 10))),
    autoScheduleEnabled: Boolean(merged.autoScheduleEnabled),
    openTime:
      typeof merged.openTime === 'string' && /^\d{2}:\d{2}$/.test(merged.openTime.trim())
        ? merged.openTime.trim()
        : '07:00',
    closeTime:
      typeof merged.closeTime === 'string' && /^\d{2}:\d{2}$/.test(merged.closeTime.trim())
        ? merged.closeTime.trim()
        : '20:30',
    closedDays: Array.isArray(merged.closedDays)
      ? Array.from(
          new Set(
            merged.closedDays
              .map((d) => Number(d))
              .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          )
        )
      : [],
    loyaltyEnabled: merged.loyaltyEnabled !== false,
    loyaltyRewardPoints: Math.min(100, Math.max(1, Math.round(Number(merged.loyaltyRewardPoints) || 10))),
    loyaltyRewardAmountUsd: Math.min(50, Math.max(0.25, Number(merged.loyaltyRewardAmountUsd) || 2.5)),
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
      const fbRaw =
        o.feedback && typeof o.feedback === 'object' ? (o.feedback as Record<string, unknown>) : null;
      const fbRating = fbRaw ? Math.min(5, Math.max(1, Math.round(Number(fbRaw.rating) || 0))) : 0;
      const feedback =
        fbRaw && fbRating >= 1
          ? {
              rating: fbRating,
              comment: String(fbRaw.comment || '').trim(),
              submittedAt: Number(fbRaw.submittedAt) || Number(o.createdAt) || Date.now(),
              customerName: fbRaw.customerName ? String(fbRaw.customerName) : undefined,
            }
          : undefined;
      const diRaw =
        o.driverInfo && typeof o.driverInfo === 'object'
          ? (o.driverInfo as Record<string, unknown>)
          : null;
      const driverInfo = diRaw
        ? {
            name: diRaw.name ? String(diRaw.name).trim() : undefined,
            phone: diRaw.phone ? String(diRaw.phone).trim() : undefined,
            note: diRaw.note ? String(diRaw.note).trim() : undefined,
            pickedUpAt: diRaw.pickedUpAt ? Number(diRaw.pickedUpAt) : undefined,
            arrivedAt: diRaw.arrivedAt ? Number(diRaw.arrivedAt) : undefined,
            deliveredAt: diRaw.deliveredAt ? Number(diRaw.deliveredAt) : undefined,
          }
        : undefined;
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
        paymentVerified: typeof o.paymentVerified === 'boolean' ? o.paymentVerified : undefined,
        paymentVerifiedBy:
          o.paymentVerifiedBy === 'bakong_md5' ||
          o.paymentVerifiedBy === 'telegram_owner' ||
          o.paymentVerifiedBy === 'web_admin' ||
          o.paymentVerifiedBy === 'auto_slip_ocr' ||
          o.paymentVerifiedBy === 'slip_ref'
            ? o.paymentVerifiedBy
            : undefined,
        paymentRef: typeof o.paymentRef === 'string' ? o.paymentRef : undefined,
        paymentBankName: typeof o.paymentBankName === 'string' ? o.paymentBankName : undefined,
        paymentSlipHash: typeof o.paymentSlipHash === 'string' ? o.paymentSlipHash : undefined,
        paymentPaidAmount:
          typeof o.paymentPaidAmount === 'number' ? o.paymentPaidAmount : undefined,
        paymentCurrency: o.paymentCurrency === 'KHR' || o.paymentCurrency === 'USD' ? o.paymentCurrency : undefined,
        paymentSlipImg: typeof o.paymentSlipImg === 'string' ? o.paymentSlipImg : undefined,
        subtotal: Number(o.subtotal) || 0,
        promoDisc: Number(o.promoDisc) || 0,
        ...(Number(o.loyaltyPointsUsed) > 0 ? { loyaltyPointsUsed: Math.round(Number(o.loyaltyPointsUsed)) } : {}),
        ...(Number(o.loyaltyDisc) > 0 ? { loyaltyDisc: Number(o.loyaltyDisc) } : {}),
        fee: Number(o.fee) || 0,
        grandTotal: Number(o.grandTotal) || 0,
        customer: {
          memberId: cust.memberId as string | number | undefined,
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
        driverInfo,
        status:
          o.status === 'Brewing' || o.status === 'Ready' || o.status === 'Completed'
            ? o.status
            : 'Pending',
        confirmedAt: typeof o.confirmedAt === 'number' ? o.confirmedAt : undefined,
        confirmedBy: o.confirmedBy === 'telegram' || o.confirmedBy === 'website' ? o.confirmedBy : undefined,
        tgMessageId: typeof o.tgMessageId === 'number' ? o.tgMessageId : undefined,
        feedback,
        unpaidAlertAt: typeof o.unpaidAlertAt === 'number' ? o.unpaidAlertAt : undefined,
        unpaidAlertCount: typeof o.unpaidAlertCount === 'number' ? o.unpaidAlertCount : undefined,
      };
    });
}

export function getDiscountedPrice(item: Pick<MenuItem, 'price' | 'discount'>): number {
  const p = Number(item.price) || 0;
  const d = parseFloat(String(item.discount)) || 0;
  return p * (1 - d / 100);
}

export function getPhnomPenhClock(now: Date = new Date()): { weekday: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Phnom_Penh',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const wdStr = parts.find((p) => p.type === 'weekday')?.value || '';
    const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
    const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10) % 60;
    return {
      weekday: wdMap[wdStr] ?? now.getDay(),
      minutes: hh * 60 + mm,
    };
  } catch {
    // UTC+7 fallback
    const utcMs = now.getTime() + 7 * 60 * 60 * 1000;
    const d = new Date(utcMs);
    return {
      weekday: d.getUTCDay(),
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  }
}

export function getShopScheduleStatus(
  settings: Pick<ShopSettings, 'isOpen' | 'autoScheduleEnabled' | 'openTime' | 'closeTime' | 'closedDays'>,
  now: Date = new Date()
): {
  isOpen: boolean;
  reason: 'manual_closed' | 'day_off' | 'outside_hours' | 'open';
  openTime: string;
  closeTime: string;
  autoActive: boolean;
} {
  const openTime =
    typeof settings.openTime === 'string' && /^\d{2}:\d{2}$/.test(settings.openTime)
      ? settings.openTime
      : '07:00';
  const closeTime =
    typeof settings.closeTime === 'string' && /^\d{2}:\d{2}$/.test(settings.closeTime)
      ? settings.closeTime
      : '20:30';
  const autoActive = Boolean(settings.autoScheduleEnabled);

  if (settings.isOpen === false) {
    return { isOpen: false, reason: 'manual_closed', openTime, closeTime, autoActive };
  }
  if (!autoActive) {
    return { isOpen: true, reason: 'open', openTime, closeTime, autoActive: false };
  }

  const { weekday, minutes } = getPhnomPenhClock(now);
  const closedDays = Array.isArray(settings.closedDays) ? settings.closedDays : [];
  if (closedDays.includes(weekday)) {
    return { isOpen: false, reason: 'day_off', openTime, closeTime, autoActive: true };
  }

  const [oH, oM] = openTime.split(':').map((n) => parseInt(n, 10) || 0);
  const [cH, cM] = closeTime.split(':').map((n) => parseInt(n, 10) || 0);
  const openMin = oH * 60 + oM;
  const closeMin = cH * 60 + cM;

  if (openMin === closeMin) {
    return { isOpen: true, reason: 'open', openTime, closeTime, autoActive: true };
  }

  const withinHours =
    openMin < closeMin
      ? minutes >= openMin && minutes < closeMin
      : minutes >= openMin || minutes < closeMin;

  return {
    isOpen: withinHours,
    reason: withinHours ? 'open' : 'outside_hours',
    openTime,
    closeTime,
    autoActive: true,
  };
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
  onError: (msg: string) => void,
  quality = 0.82
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
      const safeQuality = Math.min(0.95, Math.max(0.4, quality));
      const dataUrl = canvas.toDataURL('image/jpeg', safeQuality);
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

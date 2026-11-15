import type { MenuItem, ShopSettings, Topping } from '../types';

export const CAFE_ASSETS = {
  heroBanner: '/src/assets/images/cafe_hero_banner_1794711441891.jpg',
  logoEmblem: '/src/assets/images/cafe_logo_emblem_1794711441103.jpg',
  icedLatte: '/src/assets/images/drink_iced_latte_1794711443556.jpg',
  ujiMatcha: '/src/assets/images/drink_uji_matcha_1794711442460.jpg',
  brownSugar: '/src/assets/images/drink_brown_sugar_1794711442457.jpg',
  spicyNoodles: '/src/assets/images/food_spicy_noodles_1794711444044.jpg',
  butterCroissant: '/src/assets/images/food_butter_croissant_1794711444430.jpg',
};

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
  maxW: number,
  onSuccess: (dataUrl: string) => void,
  onError: (msg: string) => void
): void {
  const reader = new FileReader();
  reader.onerror = () => onError('មិនអាចអានរូបភាពបានទេ!');
  reader.onload = (e) => {
    const img = new Image();
    img.onerror = () => onError('ប្រភេទរូបភាពនេះមិនគាំទ្រទេ!');
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        onSuccess(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        onError('មិនអាចបង្រួមរូបភាពបានទេ!');
      }
    };
    img.src = String(e.target?.result || '');
  };
  reader.readAsDataURL(file);
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
  } catch {
    // ignore audio block
  }
}

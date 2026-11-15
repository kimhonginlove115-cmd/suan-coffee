import type { AppLang, MenuItem, OrderStatus, Topping } from '../types';
import { CAFE_ASSETS } from './cafeUtils';

export function getMenuName(item: Pick<MenuItem, 'name' | 'nameEn'>, lang: AppLang): string {
  if (lang === 'en') return (item.nameEn || '').trim() || item.name;
  return (item.name || '').trim() || item.nameEn || 'Menu Item';
}

export function getMenuDesc(item: Pick<MenuItem, 'desc' | 'descEn'>, lang: AppLang): string {
  if (lang === 'en') return (item.descEn || '').trim() || item.desc || '';
  return (item.desc || '').trim() || item.descEn || '';
}

const CATEGORY_KM_MAP: Record<string, string> = {
  all: 'ទាំងអស់',
  coffee: 'កាហ្វេ',
  matcha: 'ម៉ាត់ឆា',
  'milk tea': 'តែទឹកដោះគោ',
  'food & noodles': 'មី & អាហារ',
  'bakery & snacks': 'នំ & អាហារសម្រន់',
  'smoothie & soda': 'ស្មូទី & សូដា',
  tea: 'តែ',
};

const CATEGORY_EN_MAP: Record<string, string> = {
  all: 'All',
  'ទាំងអស់': 'All',
  'កាហ្វេ': 'Coffee',
  'ម៉ាត់ឆា': 'Matcha',
  'តែទឹកដោះគោ': 'Milk Tea',
  'មី & អាហារ': 'Food & Noodles',
  'នំ & អាហារសម្រន់': 'Bakery & Snacks',
  'ស្មូទី & សូដា': 'Smoothie & Soda',
  'តែ': 'Tea',
};

export function getMenuCategoryLabel(category: string, lang: AppLang, categoryEn?: string): string {
  const clean = (category || '').trim();
  if (!clean) return lang === 'en' ? 'Coffee' : 'កាហ្វេ';
  const key = clean.toLowerCase();
  if (lang === 'en') {
    if (categoryEn && categoryEn.trim()) return categoryEn.trim();
    return CATEGORY_EN_MAP[key] || clean;
  }
  return CATEGORY_KM_MAP[key] || clean;
}

export function getToppingName(t: Pick<Topping, 'name' | 'nameEn'>, lang: AppLang): string {
  if (lang === 'en') return (t.nameEn || '').trim() || t.name;
  return (t.name || '').trim() || t.nameEn || 'Topping';
}

export function getOrderStatusText(status: OrderStatus | string, lang: AppLang): string {
  if (lang === 'en') {
    switch (status) {
      case 'Pending':
        return 'Pending';
      case 'Brewing':
        return 'Preparing';
      case 'Ready':
        return 'Out for Delivery';
      case 'Completed':
        return 'Completed';
      default:
        return 'Pending';
    }
  }
  switch (status) {
    case 'Pending':
      return 'រង់ចាំហាងទទួល';
    case 'Brewing':
      return 'កំពុងរៀបចំ';
    case 'Ready':
      return 'កំពុងដឹកជញ្ជូន';
    case 'Completed':
      return 'បានបញ្ចប់';
    default:
      return 'រង់ចាំ';
  }
}

export const CATEGORY_PRESETS: Array<{ value: string; valueEn: string; labelKm: string; labelEn: string }> = [
  { value: 'Coffee', valueEn: 'Coffee', labelKm: 'កាហ្វេ (Coffee)', labelEn: 'Coffee' },
  { value: 'Matcha', valueEn: 'Matcha', labelKm: 'ម៉ាត់ឆា (Matcha)', labelEn: 'Matcha' },
  { value: 'Milk Tea', valueEn: 'Milk Tea', labelKm: 'តែទឹកដោះគោ (Milk Tea)', labelEn: 'Milk Tea' },
  { value: 'Smoothie & Soda', valueEn: 'Smoothie & Soda', labelKm: 'ស្មូទី & សូដា (Smoothie & Soda)', labelEn: 'Smoothie & Soda' },
  { value: 'Food & Noodles', valueEn: 'Food & Noodles', labelKm: 'មី & អាហារ (Food & Noodles)', labelEn: 'Food & Noodles' },
  { value: 'Bakery & Snacks', valueEn: 'Bakery & Snacks', labelKm: 'នំ & អាហារសម្រន់ (Bakery & Snacks)', labelEn: 'Bakery & Snacks' },
];

export interface MenuPresetTemplate {
  presetId: string;
  type: 'drink' | 'food';
  name: string;
  nameEn: string;
  price: number;
  discount: number;
  category: string;
  categoryEn: string;
  img: string;
  desc: string;
  descEn: string;
}

export const MENU_PRESET_TEMPLATES: MenuPresetTemplate[] = [
  {
    presetId: 'preset-americano',
    type: 'drink',
    name: 'អាមេរិកាណូទឹកកក',
    nameEn: 'Iced Americano',
    price: 2.0,
    discount: 0,
    category: 'Coffee',
    categoryEn: 'Coffee',
    img: CAFE_ASSETS.icedLatte,
    desc: 'កាហ្វេអារ៉ាប៊ីកាខ្មៅសុទ្ធ ក្លិនឈ្ងុយស្រស់ស្រាយ',
    descEn: 'Double shot Arabica espresso over chilled water and ice',
  },
  {
    presetId: 'preset-coconut-latte',
    type: 'drink',
    name: 'ឡាតេទឹកដូង',
    nameEn: 'Coconut Iced Latte',
    price: 2.75,
    discount: 0,
    category: 'Coffee',
    categoryEn: 'Coffee',
    img: CAFE_ASSETS.icedLatte,
    desc: 'កាហ្វេអេសប្រេសូ លាយទឹកដូងក្រអូប និងគ្រីមស្រស់',
    descEn: 'Smooth espresso layered with sweet aromatic coconut cream',
  },
  {
    presetId: 'preset-matcha-cloud',
    type: 'drink',
    name: 'ម៉ាត់ឆាគ្រីមឈីស',
    nameEn: 'Uji Matcha Cream Cloud',
    price: 3.25,
    discount: 10,
    category: 'Matcha',
    categoryEn: 'Matcha',
    img: CAFE_ASSETS.ujiMatcha,
    desc: 'តែបៃតងអ៊ូជីជប៉ុនសុទ្ធ បន្ថែមហ្វូមឈីសរសជាតិផ្អែមប្រៃ',
    descEn: 'Ceremonial Uji matcha topped with velvety cheese foam',
  },
  {
    presetId: 'preset-green-milk-tea',
    type: 'drink',
    name: 'តែបៃតងទឹកដោះគោគុជ',
    nameEn: 'Thai Green Milk Tea',
    price: 2.25,
    discount: 0,
    category: 'Milk Tea',
    categoryEn: 'Milk Tea',
    img: CAFE_ASSETS.brownSugar,
    desc: 'តែបៃតងថៃក្រអូប លាយទឹកដោះគោខាប់ស្រស់',
    descEn: 'Fragrant Thai green tea blended with creamy condensed milk',
  },
  {
    presetId: 'preset-passion-soda',
    type: 'drink',
    name: 'ផាសិនសូដា',
    nameEn: 'Passion Fruit Soda',
    price: 2.0,
    discount: 0,
    category: 'Smoothie & Soda',
    categoryEn: 'Smoothie & Soda',
    img: CAFE_ASSETS.ujiMatcha,
    desc: 'ផ្លែផាសិនស្រស់ លាយសូដាត្រជាក់ជួយបំបាត់ស្រេកទឹក',
    descEn: 'Fresh tangy passion fruit pulp with sparkling soda over ice',
  },
  {
    presetId: 'preset-spicy-beef-noodles',
    type: 'food',
    name: 'មីហឹរសាច់គោពងមាន់',
    nameEn: 'Spicy Beef Noodles',
    price: 4.0,
    discount: 0,
    category: 'Food & Noodles',
    categoryEn: 'Food & Noodles',
    img: CAFE_ASSETS.spicyNoodles,
    desc: 'មីកូរ៉េសាច់គោទន់ បន្ថែមពងមាន់ និងបន្លែស្រស់',
    descEn: 'Korean spicy noodles with tender sliced beef and soft egg',
  },
  {
    presetId: 'preset-ham-cheese-croissant',
    type: 'food',
    name: 'នំក្រូសង់ឈីសហែម',
    nameEn: 'Ham & Cheese Croissant',
    price: 2.75,
    discount: 0,
    category: 'Bakery & Snacks',
    categoryEn: 'Bakery & Snacks',
    img: CAFE_ASSETS.butterCroissant,
    desc: 'នំក្រូសង់ប័រស្រួយ ដុតក្តៅៗជាមួយឈីស និងសាច់ហែម',
    descEn: 'Flaky butter croissant baked warm with smoked ham and melted cheese',
  },
];

export const TEXT_DICTIONARY = {
  km: {
    menuNav: 'ម៉ឺនុយ',
    trackNav: 'តាមដានកម្ម៉ង់',
    locationNav: 'ទីតាំងដឹកជញ្ជូន',
    adminNav: 'គ្រប់គ្រងហាង',
    accountShort: 'គណនី',
    accountFull: 'គណនី / ភ្ជាប់ Telegram',
    shopClosedBanner: 'សូមអភ័យទោស! ហាងកំពុងបិទបណ្តោះអាសន្ន',
    dineInLabel: 'ញ៉ាំក្នុងហាង',
    tableNumLabel: 'តុលេខ',
    switchToDelivery: 'ប្តូរទៅដឹកជញ្ជូន',
    liveDriverBanner: 'អ្នកដឹកកំពុងធ្វើដំណើរ! ចុចមើល Live Map',
    openFastDelivery: 'កំពុងបើកលក់ · ដឹកជញ្ជូនរហ័ស',
    closedTemp: 'បិទបណ្តោះអាសន្ន',
    promoCodePrefix: 'កូដ',
    deliverToMap: 'ដឹកជញ្ជូនទៅ (ចុចបើកផែនទី)',
    searchPlaceholder: 'ស្វែងរកកាហ្វេ មី នំ ឬភេសជ្ជៈ...',
    bannerSubline: 'ឆុងថ្មីៗគ្រប់កែវ · ភ្ជាប់ Telegram ទទួលពិន្ទុបន្ថែម',
    menuHeading: 'ម៉ឺនុយ (Menu)',
    featuredHeading: 'ណែនាំពិសេស',
    itemsCountUnit: 'មុខ',
    outOfStock: 'អស់ស្តុក',
    noSearchResults: 'មិនមានទំនិញត្រូវនឹងការស្វែងរកទេ',
    connectWithShop: 'ភ្ជាប់ទំនាក់ទំនងជាមួយ',
    followPromo: 'តាមដានប្រូម៉ូសិនថ្មីៗ ឬទាក់ទងមកកាន់ហាងដោយផ្ទាល់',
    footerSecurity: 'សុវត្ថិភាពផ្លូវការ · Telegram & Phone OTP Verification',
    cartTitle: 'កន្ត្រកទំនិញ',
    orderNow: 'កម្ម៉ង់ឥឡូវ →',
    close: 'បិទ',
    cancel: 'បោះបង់',
    back: 'ត្រឡប់',
    save: 'រក្សាទុក',
    freeDeliveryAll: 'ដឹកជញ្ជូនហ្វ្រីគ្រប់ទីតាំង',
    freeDeliveryOver: 'ដឹកជញ្ជូនហ្វ្រីពេលកម្ម៉ង់ចាប់ពី',
    fastDelivery: 'សេវាដឹកជញ្ជូនរហ័សទាន់ចិត្ត',
    emptyCartHint: 'ចុចលើភេសជ្ជៈ ឬអាហារណាមួយដើម្បីដាក់ចូលកន្ត្រក',
    subtotalLabel: 'សរុបបណ្តោះអាសន្ន',
    proceedCheckout: 'បន្តទៅទូទាត់ / កម្ម៉ង់',
    deliveryTab: 'ដឹកជញ្ជូន',
    dineInTab: 'ញ៉ាំក្នុងហាង',
    clearSearch: 'សម្អាតការស្វែងរក',
    signatureCraft: 'ឆុងថ្មីៗប្រចាំថ្ងៃ',
  },
  en: {
    menuNav: 'Menu',
    trackNav: 'Track Order',
    locationNav: 'Delivery Map',
    adminNav: 'Shop Admin',
    accountShort: 'Account',
    accountFull: 'Account / Telegram',
    shopClosedBanner: 'Sorry! The shop is temporarily closed.',
    dineInLabel: 'Dine-In',
    tableNumLabel: 'Table',
    switchToDelivery: 'Switch to Delivery',
    liveDriverBanner: 'Driver is on the way! Tap to view Live Map',
    openFastDelivery: 'Open Now · Fast Delivery',
    closedTemp: 'Temporarily Closed',
    promoCodePrefix: 'Promo',
    deliverToMap: 'Deliver to (Tap to open map)',
    searchPlaceholder: 'Search coffee, noodles, pastries...',
    bannerSubline: 'Freshly brewed daily · Link Telegram to earn points',
    menuHeading: 'Menu',
    featuredHeading: 'Featured',
    itemsCountUnit: 'items',
    outOfStock: 'Sold Out',
    noSearchResults: 'No menu items match your search',
    connectWithShop: 'Connect with',
    followPromo: 'Follow our latest promos or contact the shop directly',
    footerSecurity: 'Official Security · Telegram & Phone OTP Verification',
    cartTitle: 'Shopping Cart',
    orderNow: 'Checkout →',
    close: 'Close',
    cancel: 'Cancel',
    back: 'Back',
    save: 'Save',
    freeDeliveryAll: 'Free delivery everywhere',
    freeDeliveryOver: 'Free delivery on orders over',
    fastDelivery: 'Fast & reliable delivery',
    emptyCartHint: 'Select any drink or food item from the menu to start your order',
    subtotalLabel: 'Subtotal',
    proceedCheckout: 'Proceed to Checkout',
    deliveryTab: 'Delivery',
    dineInTab: 'Dine-In',
    clearSearch: 'Clear search',
    signatureCraft: 'Freshly Crafted',
  },
} as const;

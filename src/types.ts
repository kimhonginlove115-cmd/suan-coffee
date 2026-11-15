export type AppLang = 'km' | 'en';
export type ItemType = 'drink' | 'food';
export type OrderType = 'delivery' | 'dinein';
export type OrderStatus = 'Pending' | 'Brewing' | 'Ready' | 'Completed';
export type DeliveryMode = 'distance' | 'flat' | 'free';
export type PaymentMethod = 'Cash' | 'KHQR / ABA';

export interface Coords {
  lat: number;
  lng: number;
}

export interface MenuItem {
  id: string | number;
  type: ItemType;
  name: string;
  nameEn?: string;
  price: number;
  discount: number;
  category: string;
  categoryEn?: string;
  img: string;
  desc: string;
  descEn?: string;
  available: boolean;
  featured?: boolean;
}

export interface Topping {
  id: string | number;
  name: string;
  nameEn?: string;
  price: number;
  available: boolean;
}

export interface CartItem {
  cartId: number;
  name: string;
  img: string;
  qty: number;
  unitPrice: number;
  options: string;
}

export interface OrderCustomer {
  memberId?: string | number;
  name: string;
  phone: string;
  tg?: string;
  addressName?: string;
  addressNote?: string;
  coords?: Coords;
  distanceKm?: string;
  tableNum?: number | string;
}

export interface OrderFeedback {
  rating: number;
  comment: string;
  submittedAt: number;
  customerName?: string;
}

export interface DriverInfo {
  name?: string;
  phone?: string;
  note?: string;
  pickedUpAt?: number;
  arrivedAt?: number;
  deliveredAt?: number;
}

export interface Order {
  id: string;
  createdAt: number;
  timestamp: string;
  type: OrderType;
  items: CartItem[];
  payment: PaymentMethod;
  subtotal: number;
  promoDisc: number;
  fee: number;
  grandTotal: number;
  customer: OrderCustomer;
  driverCoords: Coords | null;
  driverInfo?: DriverInfo;
  status: OrderStatus;
  feedback?: OrderFeedback;
}

export interface Member {
  id: string | number;
  name: string;
  phone: string;
  phoneVerified?: boolean;
  tg?: string;
  telegramUsername?: string;
  telegramId?: string;
  telegramPhotoUrl?: string;
  telegramVerified?: boolean;
  points: number;
  createdAt?: number;
  lastLoginAt?: number;
}

export interface ShopSettings {
  brandTitle: string;
  shopName: string;
  logoImg: string;
  bannerImg: string;
  khqrImg: string;
  khqrBakongId?: string;
  khqrPayload?: string;
  khqrMerchantName?: string;
  khqrCurrency?: 'USD' | 'KHR';
  khqrKhrRate?: number;
  bankInfo: string;
  promoCode: string;
  promoPercent: number;
  tgUsername: string;
  botUsername: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  instagramUrl?: string;
  youtubeUrl?: string;
  phoneHotline?: string;
  firebaseUrl: string;
  isOpen: boolean;
  deliveryMode: DeliveryMode;
  baseFee: number;
  deliveryRatePerKm: number;
  freeDeliveryOver: number;
  lat: number;
  lng: number;
}

export interface AdminSecretsConfig {
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

export interface AuthCapabilities {
  telegramWidgetReady: boolean;
  telegramBotReady: boolean;
  telegramContactReady: boolean;
  phoneOtpReady: boolean;
  phoneOtpChannel: 'telegram_gateway' | 'twilio' | 'sms_webhook' | 'none';
  botUsername: string;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from 'motion/react';
import {
  Armchair,
  ArrowRight,
  BellRing,
  Bike,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Coffee,
  Copy,
  Croissant,
  CupSoda,
  DollarSign,
  Globe,
  LayoutGrid,
  Leaf,
  Lock,
  MapPin,
  MessageSquare,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Tag,
  User,
  UtensilsCrossed,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AppLang,
  CartItem,
  Coords,
  DriverInfo,
  Member,
  MenuItem,
  Order,
  OrderStatus,
  OrderType,
  PaymentMethod,
  ShopReview,
  ShopSettings,
  Topping,
} from './types';
import {
  CAFE_ASSETS,
  DEFAULT_MENU,
  DEFAULT_SETTINGS,
  DEFAULT_TOPPINGS,
  computeDeliveryFee,
  fetchWithTimeout,
  getDiscountedPrice,
  getDistanceKm,
  getFirebaseBase,
  getShopScheduleStatus,
  handleImgFallback,
  normalizeMenuItems,
  normalizeOrders,
  normalizeShopSettings,
  normalizeToppings,
  resolveAssetUrl,
  safeDel,
  safeGet,
  safeSessionDel,
  safeSessionGet,
  safeSessionSet,
  safeSet,
} from './utils/cafeUtils';
import {
  TEXT_DICTIONARY,
  getMenuCategoryLabel,
  getMenuDesc,
  getMenuName,
  getOrderStatusText,
} from './utils/i18n';
import {
  buildUnpaidAlertMessage,
  initAudioUnlocker,
  playAdminAlertSound,
  playOrderConfirmedSound,
  playUnpaidVoiceAlert,
  stopUnpaidVoiceAlert,
  unlockAudio,
} from './utils/sound';
import { CoffeeCupSteamIllustration, DeliveryRiderIllustration } from './components/AnimatedIllustrations';
import { AuthModal } from './components/AuthModal';
import { LocationPickerModal } from './components/LocationPickerModal';
import { ItemCustomizerModal } from './components/ItemCustomizerModal';
import { CartModal, type VerifiedPaymentState } from './components/CartModal';
import { OrderTrackerModal, ReceiptModal } from './components/ReceiptAndTrackerModals';
import { DriverConsole, LiveTrackModal } from './components/LiveTrackAndDriver';
import { AdminDashboard, AdminPinModal } from './components/AdminDashboard';
import { TouchFeedbackLayer } from './components/TouchFeedbackLayer';
import { SocialLinksBar } from './components/SocialLinksBar';

function getCategoryIcon(cat: string) {
  const c = cat.toLowerCase();
  if (c === 'all') return <LayoutGrid className="w-3.5 h-3.5" />;
  if (c.includes('coffee') || c.includes('espresso') || c.includes('latte')) return <Coffee className="w-3.5 h-3.5" />;
  if (c.includes('matcha') || c.includes('tea') && !c.includes('milk')) return <Leaf className="w-3.5 h-3.5" />;
  if (c.includes('milk') || c.includes('soda') || c.includes('juice') || c.includes('smoothie'))
    return <CupSoda className="w-3.5 h-3.5" />;
  if (c.includes('food') || c.includes('noodle') || c.includes('rice')) return <UtensilsCrossed className="w-3.5 h-3.5" />;
  if (c.includes('bakery') || c.includes('cake') || c.includes('snack') || c.includes('croissant'))
    return <Croissant className="w-3.5 h-3.5" />;
  return <Tag className="w-3.5 h-3.5" />;
}

export default function App() {
  const shouldReduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothScrollProgress = useSpring(scrollYProgress, {
    stiffness: 240,
    damping: 32,
    restDelta: 0.001,
  });

  const [lang, setLang] = useState<AppLang>(() => {
    if (typeof window !== 'undefined') {
      const qLang = new URLSearchParams(window.location.search).get('lang');
      if (qLang === 'en' || qLang === 'km') return qLang;
    }
    const stored = safeGet<string>('cafe_lang_v15', 'km');
    return stored === 'en' ? 'en' : 'km';
  });
  const t = TEXT_DICTIONARY[lang];
  const isEn = lang === 'en';

  const [menuItems, setMenuItems] = useState<MenuItem[]>(() =>
    normalizeMenuItems(safeGet<MenuItem[]>('cafe_menu_v15', DEFAULT_MENU))
  );
  const [toppings, setToppings] = useState<Topping[]>(() =>
    normalizeToppings(safeGet<Topping[]>('cafe_toppings_v15', DEFAULT_TOPPINGS))
  );
  const [shopSettings, setShopSettings] = useState<ShopSettings>(() =>
    normalizeShopSettings(safeGet<Partial<ShopSettings>>('cafe_settings_v15', {}), DEFAULT_SETTINGS)
  );
  const [orders, setOrders] = useState<Order[]>(() =>
    normalizeOrders(safeGet<Order[]>('cafe_orders_v15', []))
  );
  const [shopReviews, setShopReviews] = useState<ShopReview[]>(() => {
    const stored = safeGet<ShopReview[]>('cafe_reviews_v15', []);
    return Array.isArray(stored) ? stored : [];
  });
  const [members, setMembers] = useState<Member[]>(() => {
    const stored = safeGet<Member[]>('cafe_members_v15', []);
    return Array.isArray(stored) ? stored : [];
  });
  const [currentMember, setCurrentMember] = useState<Member | null>(() =>
    safeGet<Member | null>('cafe_current_member_v15', null)
  );
  const [authToken, setAuthToken] = useState<string | null>(() => {
    const persisted = safeGet<string | null>('cafe_auth_token_v15', null);
    return persisted || safeSessionGet('cafe_auth_token');
  });
  const [adminToken, setAdminToken] = useState<string | null>(() => safeSessionGet('cafe_admin_token'));
  const isAdminUnlocked = Boolean(adminToken);

  const [viewMode, setViewMode] = useState<'customer' | 'admin' | 'driver'>(() =>
    safeSessionGet('cafe_admin_token') ? 'admin' : 'customer'
  );
  const [activeDriverOrderId, setActiveDriverOrderId] = useState<string | null>(null);
  const [liveTrackOrderId, setLiveTrackOrderId] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>(() => {
    const stored = safeGet<CartItem[]>('cafe_cart_v15', []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (i): i is CartItem =>
        Boolean(i && typeof i === 'object' && typeof i.name === 'string' && Number(i.qty) > 0)
    );
  });
  const [orderType, setOrderType] = useState<OrderType>(() => {
    const stored = safeGet<string>('cafe_order_type_v15', 'delivery');
    return stored === 'dinein' ? 'dinein' : 'delivery';
  });
  const [tableNumberFromQR, setTableNumberFromQR] = useState<number | null>(null);
  const [selectedTableNum, setSelectedTableNum] = useState<number>(() => {
    const stored = Number(safeGet<number>('cafe_table_num_v15', 1));
    return Number.isFinite(stored) && stored >= 1 ? Math.min(100, Math.round(stored)) : 1;
  });

  const maxTableCount = Math.min(100, Math.max(1, Number(shopSettings.tableCount) || 10));
  const isTableLocked = tableNumberFromQR !== null;
  const activeTableNum = isTableLocked
    ? tableNumberFromQR
    : Math.min(maxTableCount, Math.max(1, selectedTableNum));

  useEffect(() => {
    safeSet('cafe_table_num_v15', selectedTableNum);
  }, [selectedTableNum]);

  useEffect(() => {
    if (selectedTableNum > maxTableCount) {
      setSelectedTableNum(maxTableCount);
    }
  }, [selectedTableNum, maxTableCount]);

  useEffect(() => {
    if (isTableLocked && orderType !== 'dinein') {
      setOrderType('dinein');
    }
  }, [isTableLocked, orderType]);

  const [selectedCoords, setSelectedCoords] = useState<Coords>(() => {
    const stored = safeGet<{ coords?: Coords; addressName?: string } | null>('cafe_customer_loc_v15', null);
    if (
      stored?.coords &&
      Number.isFinite(Number(stored.coords.lat)) &&
      Number.isFinite(Number(stored.coords.lng))
    ) {
      return { lat: Number(stored.coords.lat), lng: Number(stored.coords.lng) };
    }
    return { lat: shopSettings.lat, lng: shopSettings.lng };
  });
  const [pickedAddressName, setPickedAddressName] = useState(() => {
    const stored = safeGet<{ coords?: Coords; addressName?: string } | null>('cafe_customer_loc_v15', null);
    if (stored?.addressName && typeof stored.addressName === 'string' && stored.addressName.trim()) {
      return stored.addressName;
    }
    return lang === 'en' ? 'Phnom Penh · Tap to pick location' : 'ភ្នំពេញ · ចុចរើសទីតាំង';
  });

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authPrefillPhone, setAuthPrefillPhone] = useState('');
  const [isPinOpen, setIsPinOpen] = useState(false);
  const [locationPickerState, setLocationPickerState] = useState<{
    open: boolean;
    purpose: 'customer' | 'shop';
  }>({ open: false, purpose: 'customer' });
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(() => {
    const storedCart = safeGet<CartItem[]>('cafe_cart_v15', []);
    const hasCart = Array.isArray(storedCart) && storedCart.some((i) => Number(i?.qty) > 0);
    return hasCart && safeGet<boolean>('cafe_cart_open_v15', false) === true;
  });
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [isReviewFormOpen, setIsReviewFormOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewName, setReviewName] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewTags, setReviewTags] = useState<string[]>([]);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [receiptState, setReceiptState] = useState<{ order: Order | null; tgUrl: string }>(() => {
    const savedId = safeSessionGet('cafe_last_receipt_id_v15');
    if (savedId) {
      const storedOrders = normalizeOrders(safeGet<Order[]>('cafe_orders_v15', []));
      const found = storedOrders.find((o) => o.id === savedId) || null;
      if (found) {
        return { order: found, tgUrl: '' };
      }
    }
    return { order: null, tgUrl: '' };
  });

  const [lastOrderCountState] = useState(0);
  void lastOrderCountState;
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [liveConfirmAlert, setLiveConfirmAlert] = useState<{
    orderId: string;
    status: OrderStatus;
    title: string;
    subtitle: string;
  } | null>(null);
  const [liveUnpaidAlert, setLiveUnpaidAlert] = useState<{
    orderId: string;
    tableNum?: string | number;
    amountUsd: number;
    customerName: string;
    messageText: string;
  } | null>(null);
  const [myOrderIds, setMyOrderIds] = useState<string[]>(() => {
    const stored = safeGet<string[]>('cafe_my_order_ids_v15', []);
    return Array.isArray(stored) ? stored : [];
  });
  const [serverPersistent, setServerPersistent] = useState(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOrderCountRef = useRef(orders.length);
  const isFetchingOrdersRef = useRef(false);
  const isFetchingShopRef = useRef(false);
  const clearingOrdersRef = useRef(false);
  const lastOrdersSigRef = useRef('');
  const lastShopSigRef = useRef('');
  const prevOrderStatusesRef = useRef<Map<string, OrderStatus>>(new Map());
  const prevUnpaidAlertAtRef = useRef<Map<string, number>>(new Map());
  const ordersInitializedRef = useRef(false);
  const myOrderIdsRef = useRef<string[]>(myOrderIds);
  const currentMemberRef = useRef<Member | null>(currentMember);
  const shopSettingsRef = useRef<ShopSettings>(shopSettings);

  useEffect(() => {
    myOrderIdsRef.current = myOrderIds;
    safeSet('cafe_my_order_ids_v15', myOrderIds);
  }, [myOrderIds]);

  useEffect(() => {
    currentMemberRef.current = currentMember;
  }, [currentMember]);

  useEffect(() => {
    shopSettingsRef.current = shopSettings;
  }, [shopSettings]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const handleRequestOrderTypeChange = useCallback(
    (nextType: OrderType) => {
      if (isTableLocked && nextType === 'delivery') {
        showToast(
          isEn
            ? `Locked to Table ${tableNumberFromQR} (Dine-In Only)`
            : `បានស្កេន QR តុលេខ ${tableNumberFromQR} — អាចកម្ម៉ង់ញ៉ាំនៅហាងតែប៉ុណ្ណោះ!`
        );
        setOrderType('dinein');
        return;
      }
      setOrderType(nextType);
    },
    [isTableLocked, tableNumberFromQR, isEn, showToast]
  );

  const showLiveOrderAlert = useCallback(
    (payload: { orderId: string; status: OrderStatus; title: string; subtitle: string }) => {
      setLiveConfirmAlert(payload);
      if (alertBannerTimerRef.current) clearTimeout(alertBannerTimerRef.current);
      alertBannerTimerRef.current = setTimeout(() => setLiveConfirmAlert(null), 9000);
    },
    []
  );

  useEffect(() => {
    const cleanupAudio = initAudioUnlocker();
    return () => {
      cleanupAudio();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (alertBannerTimerRef.current) clearTimeout(alertBannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    safeSet('cafe_cart_v15', cart);
    if (cart.length === 0) {
      if (isCartOpen) setIsCartOpen(false);
      safeDel('cafe_cart_open_v15');
      safeDel('cafe_checkout_state_v15');
    }
  }, [cart, isCartOpen]);

  useEffect(() => {
    safeSet('cafe_cart_open_v15', isCartOpen && cart.length > 0);
  }, [isCartOpen, cart.length]);

  useEffect(() => {
    safeSet('cafe_order_type_v15', orderType);
  }, [orderType]);

  useEffect(() => {
    safeSet('cafe_customer_loc_v15', {
      coords: selectedCoords,
      addressName: pickedAddressName,
    });
  }, [selectedCoords, pickedAddressName]);

  useEffect(() => {
    safeSet('cafe_lang_v15', lang);
    document.documentElement.lang = lang;
    setPickedAddressName((prev) => {
      if (lang === 'en' && prev === 'ភ្នំពេញ · ចុចរើសទីតាំង') {
        return 'Phnom Penh · Tap to pick location';
      }
      if (lang === 'km' && prev === 'Phnom Penh · Tap to pick location') {
        return 'ភ្នំពេញ · ចុចរើសទីតាំង';
      }
      return prev;
    });
  }, [lang]);

  useEffect(() => {
    safeSet('cafe_menu_v15', menuItems);
  }, [menuItems]);
  useEffect(() => {
    safeSet('cafe_toppings_v15', toppings);
  }, [toppings]);
  useEffect(() => {
    safeSet('cafe_settings_v15', shopSettings);
    const title = shopSettings.brandTitle?.trim() || 'SUAN COFFEE';
    const desc = shopSettings.shopName?.trim()
      ? `${shopSettings.shopName.trim()} · ${title}`
      : `${title} — កម្ម៉ង់កាហ្វេ និងអាហារ Online តាម KHQR`;
    document.title = title;
    const setMeta = (selector: string, val: string) => {
      const el = document.querySelector<HTMLMetaElement>(selector);
      if (el) el.content = val;
    };
    setMeta('meta[name="description"]', desc);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:site_name"]', title);
    setMeta('meta[property="og:description"]', desc);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', desc);
    if (shopSettings.logoImg) {
      const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (icon) icon.href = resolveAssetUrl(shopSettings.logoImg, CAFE_ASSETS.logoEmblem);
    }
  }, [shopSettings]);
  useEffect(() => {
    safeSet('cafe_orders_v15', orders);
  }, [orders]);
  useEffect(() => {
    safeSet('cafe_reviews_v15', shopReviews);
  }, [shopReviews]);
  useEffect(() => {
    safeSet('cafe_members_v15', members);
  }, [members]);
  useEffect(() => {
    safeSet('cafe_current_member_v15', currentMember);
    if (currentMember?.name) {
      setReviewName((prev) => (prev.trim() ? prev : currentMember.name));
    }
  }, [currentMember]);

  const handleRequireAdminReauth = useCallback(() => {
    setAdminToken(null);
    safeSessionDel('cafe_admin_token');
    setViewMode('customer');
    setIsPinOpen(true);
    showToast('សម័យប្រើប្រាស់ម្ចាស់ហាងផុតកំណត់ សូមបញ្ចូល PIN ម្តងទៀត');
  }, [showToast]);

  const syncShopEverywhere = useCallback(
    async (
      nextMenu: MenuItem[],
      nextToppings: Topping[],
      nextSettings: ShopSettings
    ): Promise<{ ok: boolean; persistent: boolean; reauth?: boolean }> => {
      let serverOk = false;
      let serverPersisted = false;
      let firebaseOk = false;

      if (adminToken) {
        try {
          const res = await fetchWithTimeout(
            '/api/shop',
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify({
                menuItems: nextMenu,
                toppings: nextToppings,
                shopSettings: nextSettings,
              }),
            },
            12000
          );
          if (res.status === 401) {
            handleRequireAdminReauth();
            return { ok: false, persistent: false, reauth: true };
          }
          if (res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              storagePersistent?: boolean;
            };
            serverOk = Boolean(data.ok ?? true);
            serverPersisted = data.storagePersistent !== false;
            setServerPersistent(serverPersisted);
          }
        } catch {
          // ignore and try Firebase fallback
        }
      }

      const b = getFirebaseBase(nextSettings.firebaseUrl);
      if (b) {
        try {
          const fbRes = await fetchWithTimeout(
            `${b}/shop.json`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                menuItems: nextMenu,
                toppings: nextToppings,
                shopSettings: nextSettings,
              }),
            },
            9000
          );
          if (fbRes.ok) firebaseOk = true;
        } catch {
          // ignore
        }
      }

      return {
        ok: serverOk || firebaseOk,
        persistent: serverPersisted || firebaseOk,
      };
    },
    [adminToken, handleRequireAdminReauth]
  );

  const syncOrderEverywhere = useCallback(
    async (
      order: Order,
      opts?: { asAdmin?: boolean }
    ): Promise<{
      ok: boolean;
      error?: string;
      order?: Order;
      requiresPhoneAuth?: boolean;
      phone?: string;
    }> => {
      let serverError: string | undefined;
      let savedOrder: Order | undefined;
      const bearer = opts?.asAdmin && adminToken ? adminToken : authToken;
      try {
        const res = await fetchWithTimeout(
          '/api/orders',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            },
            body: JSON.stringify(order),
          },
          10000
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          order?: Order;
          requiresPhoneAuth?: boolean;
          phone?: string;
        };
        if (!res.ok || data.ok === false) {
          serverError = data.error || 'ការបញ្ជាក់ការកម្ម៉ង់ត្រូវបានបដិសេធដោយ Server';
          return {
            ok: false,
            error: serverError,
            requiresPhoneAuth: Boolean(data.requiresPhoneAuth),
            phone: data.phone,
          };
        }
        savedOrder = data.order;
      } catch {
        if (order.payment === 'KHQR / ABA') {
          return {
            ok: false,
            error: 'មិនអាចភ្ជាប់ទៅ Server ដើម្បីផ្ទៀងផ្ទាត់ KHQR បានទេ សូមសាកល្បងម្តងទៀត!',
          };
        }
      }
      const b = getFirebaseBase(shopSettings.firebaseUrl);
      if (b) {
        try {
          const cleanOrder = { ...(savedOrder || order) };
          delete cleanOrder.paymentProofToken;
          await fetchWithTimeout(
            `${b}/orders/${encodeURIComponent(order.id)}.json`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cleanOrder),
            },
            8000
          );
        } catch {
          // ignore
        }
      }
      return { ok: true, order: savedOrder };
    },
    [shopSettings.firebaseUrl, authToken, adminToken]
  );

  const applyFetchedOrders = useCallback(
    (incoming: Order[]) => {
      const uniqueMap = new Map<string, Order>();
      for (const ord of incoming) {
        if (!ord?.id) continue;
        uniqueMap.set(ord.id, ord);
      }
      const sorted = Array.from(uniqueMap.values()).sort((a, b2) => (b2.createdAt || 0) - (a.createdAt || 0));
      const sig = sorted
        .map(
          (o) =>
            `${o.id}:${o.status}:${o.confirmedAt ?? ''}:${o.confirmedBy ?? ''}:${o.paymentVerified ? 1 : 0}:${o.unpaidAlertAt ?? ''}:${o.unpaidAlertCount ?? ''}:${o.driverCoords?.lat ?? ''},${o.driverCoords?.lng ?? ''}:${o.customer?.coords?.lat ?? ''},${o.customer?.coords?.lng ?? ''}:${o.driverInfo?.name ?? ''}:${o.driverInfo?.phone ?? ''}:${o.driverInfo?.arrivedAt ?? ''}:${o.feedback?.rating ?? ''}:${o.feedback?.submittedAt ?? ''}`
        )
        .join('|');

      if (ordersInitializedRef.current) {
        const prevMap = prevOrderStatusesRef.current;
        const prevAlertMap = prevUnpaidAlertAtRef.current;
        const member = currentMemberRef.current;
        const memberPhoneDigits = member?.phone ? member.phone.replace(/\D/g, '') : '';
        const myIds = myOrderIdsRef.current;
        const latestSettings = shopSettingsRef.current;

        for (const o of sorted) {
          const custPhoneDigits = o.customer?.phone ? o.customer.phone.replace(/\D/g, '') : '';
          const matchesTableQR =
            tableNumberFromQR !== null &&
            o.type === 'dinein' &&
            String(o.customer?.tableNum || '') === String(tableNumberFromQR);
          const isMine =
            myIds.includes(o.id) ||
            matchesTableQR ||
            Boolean(
              member &&
                ((o.customer?.memberId && String(o.customer.memberId) === String(member.id)) ||
                  (!o.customer?.memberId &&
                    member.phoneVerified &&
                    memberPhoneDigits &&
                    custPhoneDigits &&
                    memberPhoneDigits === custPhoneDigits))
            );

          const prevStatus = prevMap.get(o.id);
          if (prevStatus && prevStatus !== o.status) {
            if (isMine && (o.status === 'Brewing' || o.status === 'Ready' || o.status === 'Completed')) {
              playOrderConfirmedSound();
              if (o.status === 'Brewing') {
                showLiveOrderAlert({
                  orderId: o.id,
                  status: o.status,
                  title: isEn
                    ? `Order ${o.id} Confirmed!`
                    : `ហាងបានបញ្ជាក់ទទួលការកម្ម៉ង់ ${o.id}!`,
                  subtitle: isEn
                    ? `Shop confirmed (${o.confirmedBy === 'telegram' ? 'Telegram' : 'Website'}) · Preparing now`
                    : `បញ្ជាក់ដោយម្ចាស់ហាង (${o.confirmedBy === 'telegram' ? 'Telegram' : 'Website'}) · កំពុងរៀបចំជូនអ្នក`,
                });
                showToast(
                  isEn
                    ? `🔔 Order ${o.id} confirmed by shop!`
                    : `🔔 ហាងបានបញ្ជាក់ទទួលការកម្ម៉ង់ ${o.id} ហើយ!`
                );
              } else if (o.status === 'Ready') {
                showLiveOrderAlert({
                  orderId: o.id,
                  status: o.status,
                  title: isEn
                    ? `Order ${o.id} Ready / Dispatched!`
                    : `ការកម្ម៉ង់ ${o.id} រួចរាល់ / កំពុងដឹកជូន!`,
                  subtitle:
                    o.type === 'delivery'
                      ? isEn
                        ? 'Tap to track your driver live'
                        : 'ចុចដើម្បីមើលទីតាំងអ្នកដឹកជញ្ជូន'
                      : isEn
                        ? 'Ready at counter / table'
                        : 'ភេសជ្ជៈរួចរាល់សម្រាប់ជូនដល់តុហើយ',
                });
              } else if (o.status === 'Completed') {
                showLiveOrderAlert({
                  orderId: o.id,
                  status: o.status,
                  title: isEn ? `Order ${o.id} Completed!` : `ការកម្ម៉ង់ ${o.id} បានបញ្ចប់ជោគជ័យ!`,
                  subtitle: isEn ? 'Thank you for ordering!' : 'សូមអរគុណសម្រាប់ការគាំទ្រ!',
                });
              }
            }
          }

          const nextUnpaidAt = Number(o.unpaidAlertAt || 0);
          const prevUnpaidAt = prevAlertMap.get(o.id) || 0;
          if (!o.paymentVerified && nextUnpaidAt > prevUnpaidAt && isMine && !isAdminUnlocked) {
            const msg = buildUnpaidAlertMessage({
              text: latestSettings.unpaidVoiceAlertText,
              lang,
              tableNum: o.customer?.tableNum,
              amountUsd: o.grandTotal,
              customerName: o.customer?.name,
            });
            playUnpaidVoiceAlert({
              audioDataUri: latestSettings.unpaidVoiceAlertAudio,
              text: latestSettings.unpaidVoiceAlertText,
              lang,
              tableNum: o.customer?.tableNum,
              amountUsd: o.grandTotal,
              customerName: o.customer?.name,
            });
            setLiveUnpaidAlert({
              orderId: o.id,
              tableNum: o.customer?.tableNum,
              amountUsd: Number(o.grandTotal || 0),
              customerName: o.customer?.name || '-',
              messageText: msg,
            });
          }
        }
      }

      const nextStatusMap = new Map<string, OrderStatus>();
      const nextUnpaidMap = new Map<string, number>();
      for (const o of sorted) {
        nextStatusMap.set(o.id, o.status);
        if (o.unpaidAlertAt) nextUnpaidMap.set(o.id, o.unpaidAlertAt);
      }
      prevOrderStatusesRef.current = nextStatusMap;
      prevUnpaidAlertAtRef.current = nextUnpaidMap;
      ordersInitializedRef.current = true;

      if (sorted.length > lastOrderCountRef.current && isAdminUnlocked) {
        playAdminAlertSound();
        showToast(isEn ? '🔔 New order received!' : '🔔 មានការកម្ម៉ង់ថ្មីចូល!');
      }
      lastOrderCountRef.current = sorted.length;

      if (sig !== lastOrdersSigRef.current) {
        lastOrdersSigRef.current = sig;
        setOrders(sorted);
        setReceiptState((prev) => {
          if (!prev.order) return prev;
          const fresh = sorted.find((o) => o.id === prev.order?.id);
          if (!fresh) return prev;
          return { ...prev, order: fresh };
        });
      }
    },
    [isAdminUnlocked, isEn, lang, tableNumberFromQR, showToast, showLiveOrderAlert]
  );

  const fetchOrdersFromSources = useCallback(async () => {
    if (isFetchingOrdersRef.current || clearingOrdersRef.current) return;
    isFetchingOrdersRef.current = true;
    try {
      const b = getFirebaseBase(shopSettings.firebaseUrl);
      if (b) {
        try {
          const r = await fetchWithTimeout(`${b}/orders.json`, {}, 7000);
          if (r.ok) {
            const d = await r.json();
            if (d && typeof d === 'object') {
              const list = normalizeOrders(Object.values(d));
              applyFetchedOrders(list);
              return;
            }
          }
        } catch {
          // fallback to server
        }
      }

      try {
        const r = await fetchWithTimeout('/api/orders', {}, 8000);
        if (r.ok) {
          const data = (await r.json()) as { ok?: boolean; orders?: Order[] };
          if (data.ok && Array.isArray(data.orders)) {
            applyFetchedOrders(normalizeOrders(data.orders));
          }
        }
      } catch {
        // ignore network hiccup
      }
    } finally {
      isFetchingOrdersRef.current = false;
    }
  }, [shopSettings.firebaseUrl, applyFetchedOrders]);

  const handleAuthenticated = useCallback((member: Member, token: string | null) => {
    setCurrentMember(member);
    if (token) {
      setAuthToken(token);
      safeSet('cafe_auth_token_v15', token);
      safeSessionSet('cafe_auth_token', token);
    }
    setMembers((prev) => {
      const idx = prev.findIndex(
        (m) =>
          String(m.id) === String(member.id) ||
          (member.phone && m.phone === member.phone) ||
          (member.telegramId && m.telegramId === member.telegramId)
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...member };
        return copy;
      }
      return [member, ...prev];
    });
  }, []);

  const applyFetchedShop = useCallback(
    (payload: { menuItems?: unknown; toppings?: unknown; shopSettings?: unknown }) => {
      const nextMenu = Array.isArray(payload.menuItems) ? normalizeMenuItems(payload.menuItems) : null;
      const nextToppings = Array.isArray(payload.toppings)
        ? normalizeToppings(payload.toppings)
        : null;
      const hasSettings = Boolean(payload.shopSettings && typeof payload.shopSettings === 'object');

      const sig = JSON.stringify({
        m: nextMenu,
        t: nextToppings,
        s: hasSettings ? payload.shopSettings : null,
      });
      if (sig === lastShopSigRef.current) return;
      lastShopSigRef.current = sig;

      if (nextMenu) setMenuItems(nextMenu);
      if (nextToppings) setToppings(nextToppings);
      if (hasSettings) {
        setShopSettings((prev) =>
          normalizeShopSettings(payload.shopSettings as Partial<ShopSettings>, prev)
        );
      }
    },
    []
  );

  const fetchShopFromSources = useCallback(async () => {
    if (isFetchingShopRef.current) return;
    isFetchingShopRef.current = true;
    try {
      let serverData: {
        ok?: boolean;
        storagePersistent?: boolean;
        menuItems?: unknown;
        toppings?: unknown;
        shopSettings?: Record<string, unknown> | null;
      } | null = null;

      try {
        const r = await fetchWithTimeout('/api/shop', { cache: 'no-store' }, 9000);
        if (r.ok) {
          serverData = await r.json();
          if (serverData?.ok) {
            setServerPersistent(serverData.storagePersistent !== false);
          }
        }
      } catch {
        // ignore network hiccup
      }

      const candidateFbUrl =
        (serverData?.shopSettings && typeof serverData.shopSettings.firebaseUrl === 'string'
          ? serverData.shopSettings.firebaseUrl
          : '') || shopSettings.firebaseUrl;
      const b = getFirebaseBase(candidateFbUrl);

      let fbData: { menuItems?: unknown; toppings?: unknown; shopSettings?: unknown } | null = null;
      if (b && (!serverData?.storagePersistent || !serverData?.shopSettings)) {
        try {
          const fbRes = await fetchWithTimeout(`${b}/shop.json`, { cache: 'no-store' }, 7000);
          if (fbRes.ok) {
            const parsed = await fbRes.json();
            if (parsed && typeof parsed === 'object') {
              fbData = parsed as { menuItems?: unknown; toppings?: unknown; shopSettings?: unknown };
            }
          }
        } catch {
          // ignore Firebase fetch hiccup
        }
      }

      if (fbData && (!serverData?.storagePersistent || !serverData?.shopSettings)) {
        applyFetchedShop(fbData);
      } else if (serverData?.ok) {
        applyFetchedShop(serverData);
      }
    } finally {
      isFetchingShopRef.current = false;
    }
  }, [applyFetchedShop, shopSettings.firebaseUrl]);

  const fetchReviewsFromSources = useCallback(async () => {
    let loaded = false;
    try {
      const r = await fetchWithTimeout('/api/reviews', { cache: 'no-store' }, 8000);
      if (r.ok) {
        const data = (await r.json()) as { ok?: boolean; reviews?: ShopReview[] };
        if (data.ok && Array.isArray(data.reviews)) {
          setShopReviews(data.reviews);
          loaded = true;
        }
      }
    } catch {
      // ignore network hiccup
    }

    if (!loaded) {
      const b = getFirebaseBase(shopSettings.firebaseUrl);
      if (b) {
        try {
          const fbRes = await fetchWithTimeout(`${b}/reviews.json`, { cache: 'no-store' }, 7000);
          if (fbRes.ok) {
            const raw = await fbRes.json();
            if (raw && typeof raw === 'object') {
              const list = (Array.isArray(raw) ? raw : Object.values(raw))
                .filter((x): x is ShopReview => Boolean(x && typeof x === 'object' && 'rating' in x))
                .sort((a, b2) => (b2.submittedAt || 0) - (a.submittedAt || 0));
              setShopReviews(list);
            }
          }
        } catch {
          // ignore Firebase hiccup
        }
      }
    }
  }, [shopSettings.firebaseUrl]);

  // Load persisted shop data, check active session, and auto-verify Telegram Mini App
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const tbl = p.get('table');
    if (tbl) {
      const n = Math.max(1, parseInt(tbl, 10) || 1);
      setTableNumberFromQR(n);
      setOrderType('dinein');
    }
    const drv = p.get('driver');
    if (drv) {
      setActiveDriverOrderId(drv === '1' || drv === 'all' ? null : drv);
      setViewMode('driver');
    } else if (p.get('admin') === '1') {
      setIsPinOpen(true);
    }

    fetchShopFromSources();

    if (authToken) {
      fetchWithTimeout('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } }, 8000)
        .then(async (r) => {
          if (r.status === 401 || r.status === 404) return { invalid: true };
          if (!r.ok) return null;
          return r.json();
        })
        .then((data) => {
          if (data?.ok && data.member) {
            setCurrentMember(data.member);
          } else if (data?.invalid) {
            setAuthToken(null);
            setCurrentMember(null);
            safeDel('cafe_auth_token_v15');
            safeDel('cafe_current_member_v15');
            safeSessionDel('cafe_auth_token');
          }
        })
        .catch(() => {});
    }

    const tgWebApp = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram
      ?.WebApp;
    if (tgWebApp?.initData) {
      fetchWithTimeout(
        '/api/auth/telegram/verify-webapp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tgWebApp.initData }),
        },
        8000
      )
        .then((r) => r.json())
        .then((data) => {
          if (data?.ok && data.member) handleAuthenticated(data.member, data.token || null);
        })
        .catch(() => {});
    }

    fetchOrdersFromSources();
    fetchReviewsFromSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMyOrdersCount = useMemo(
    () =>
      orders.filter((o) => {
        if (o.status === 'Completed') return false;
        if (myOrderIds.includes(o.id)) return true;
        if (!currentMember) return false;
        const mPhone = currentMember.phone ? currentMember.phone.replace(/\D/g, '') : '';
        const cPhone = o.customer?.phone ? o.customer.phone.replace(/\D/g, '') : '';
        if (o.customer?.memberId) {
          return String(o.customer.memberId) === String(currentMember.id);
        }
        return Boolean(
          currentMember.phoneVerified && mPhone && cPhone && mPhone === cPhone
        );
      }).length,
    [orders, myOrderIds, currentMember]
  );
  const hasActiveMyOrders = activeMyOrdersCount > 0;

  useEffect(() => {
    if (
      !isAdminUnlocked &&
      !liveTrackOrderId &&
      viewMode !== 'driver' &&
      !isTrackerOpen &&
      !receiptState.order &&
      !hasActiveMyOrders
    ) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        fetchOrdersFromSources();
      }
    }, 3500);
    return () => clearInterval(timer);
  }, [
    isAdminUnlocked,
    liveTrackOrderId,
    viewMode,
    isTrackerOpen,
    receiptState.order,
    hasActiveMyOrders,
    fetchOrdersFromSources,
  ]);

  useEffect(() => {
    if (viewMode !== 'customer') return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        fetchShopFromSources();
        fetchReviewsFromSources();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [viewMode, fetchShopFromSources, fetchReviewsFromSources]);

  const handleLogout = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // ignore
      }
    }
    setCurrentMember(null);
    setAuthToken(null);
    safeDel('cafe_auth_token_v15');
    safeDel('cafe_current_member_v15');
    safeSessionDel('cafe_auth_token');
    setIsAuthOpen(false);
    showToast(lang === 'en' ? 'Signed out safely' : 'បានចាកចេញពីគណនីដោយសុវត្ថិភាព');
  };

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(menuItems.map((i) => i.category).filter(Boolean)))],
    [menuItems]
  );

  const filteredMenu = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menuItems.filter(
      (i) =>
        (selectedCategory === 'All' || i.category === selectedCategory) &&
        (!q ||
          (i.name || '').toLowerCase().includes(q) ||
          (i.nameEn || '').toLowerCase().includes(q) ||
          (i.category || '').toLowerCase().includes(q))
    );
  }, [menuItems, selectedCategory, searchQuery]);

  const isItemInStock = (item: MenuItem) =>
    item.available !== false && (typeof item.stockQty !== 'number' || item.stockQty > 0);

  const featuredMenu = useMemo(
    () => menuItems.filter((i) => i.featured && isItemInStock(i)),
    [menuItems]
  );

  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.qty, 0), [cart]);
  const distanceKm = useMemo(
    () => getDistanceKm(shopSettings.lat, shopSettings.lng, selectedCoords.lat, selectedCoords.lng),
    [shopSettings.lat, shopSettings.lng, selectedCoords.lat, selectedCoords.lng]
  );
  const estimatedDeliveryFee = useMemo(
    () => (orderType === 'delivery' ? computeDeliveryFee(shopSettings, distanceKm, cartSubtotal) : 0),
    [orderType, shopSettings, distanceKm, cartSubtotal]
  );

  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const shopScheduleStatus = useMemo(
    () => getShopScheduleStatus(shopSettings, new Date(nowTs)),
    [shopSettings, nowTs]
  );

  const shopClosedMessage = useMemo(() => {
    if (shopScheduleStatus.isOpen) return '';
    if (shopScheduleStatus.reason === 'day_off') {
      return isEn
        ? 'Shop is closed today (weekly day off). Please check back tomorrow!'
        : 'ហាងឈប់សម្រាកប្រចាំសប្តាហ៍ថ្ងៃនេះ — សូមត្រឡប់មកវិញនៅថ្ងៃស្អែក!';
    }
    if (shopScheduleStatus.reason === 'outside_hours') {
      return isEn
        ? `Shop is closed right now. Open daily ${shopScheduleStatus.openTime} – ${shopScheduleStatus.closeTime}.`
        : `ហាងកំពុងបិទតាមម៉ោងកំណត់ — បើកទទួលការកម្ម៉ង់ ${shopScheduleStatus.openTime} ដល់ ${shopScheduleStatus.closeTime}`;
    }
    return t.shopClosedBanner;
  }, [shopScheduleStatus, isEn, t.shopClosedBanner]);

  const activeLiveOrder = useMemo(
    () =>
      orders.find(
        (o) => o.type === 'delivery' && (o.status === 'Ready' || o.driverCoords) && o.status !== 'Completed'
      ),
    [orders]
  );

  const allCustomerReviews = useMemo(() => {
    const merged: ShopReview[] = [];
    const seenOrderIds = new Set<string>();
    const seenIds = new Set<string>();

    for (const r of shopReviews) {
      if (!r || !r.id || seenIds.has(r.id)) continue;
      seenIds.add(r.id);
      if (r.orderId) seenOrderIds.add(r.orderId);
      merged.push(r);
    }

    for (const o of orders) {
      if (!o.feedback || seenOrderIds.has(o.id)) continue;
      seenOrderIds.add(o.id);
      merged.push({
        id: `ORD-REV-${o.id}`,
        rating: Math.min(5, Math.max(1, Math.round(Number(o.feedback.rating) || 5))),
        comment: o.feedback.comment || '',
        customerName: o.feedback.customerName || o.customer?.name || (isEn ? 'Customer' : 'អតិថិជន'),
        orderId: o.id,
        submittedAt: Number(o.feedback.submittedAt) || Number(o.createdAt) || Date.now(),
      });
    }

    return merged.sort((a, b2) => (b2.submittedAt || 0) - (a.submittedAt || 0));
  }, [shopReviews, orders, isEn]);

  const averageShopRating = useMemo(() => {
    if (!allCustomerReviews.length) return 0;
    const total = allCustomerReviews.reduce((s, r) => s + Number(r.rating || 0), 0);
    return total / allCustomerReviews.length;
  }, [allCustomerReviews]);

  const ratingBreakdown = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    for (const r of allCustomerReviews) {
      const star = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))) as 1 | 2 | 3 | 4 | 5;
      counts[star] = (counts[star] || 0) + 1;
    }
    const total = allCustomerReviews.length || 1;
    return ([5, 4, 3, 2, 1] as const).map((star) => ({
      star,
      count: counts[star],
      percent: Math.round((counts[star] / total) * 100),
    }));
  }, [allCustomerReviews]);
  const latestActiveOrder = useMemo(
    () =>
      orders.find(
        (o) => myOrderIds.includes(o.id) && o.status !== 'Completed' && o.id !== activeLiveOrder?.id
      ) || null,
    [orders, myOrderIds, activeLiveOrder?.id]
  );
  const cartQtyByItemName = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cart) {
      map.set(c.name, (map.get(c.name) || 0) + (c.qty || 1));
    }
    return map;
  }, [cart]);
  const liveTrackOrder = useMemo(
    () => orders.find((o) => o.id === liveTrackOrderId) || null,
    [orders, liveTrackOrderId]
  );
  const activeDriverOrder = useMemo(
    () => orders.find((o) => o.id === activeDriverOrderId) || null,
    [orders, activeDriverOrderId]
  );

  const handleCopyPromoCode = () => {
    const code = shopSettings.promoCode?.trim();
    if (!code) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    showToast(
      isEn
        ? `Copied promo code ${code} (-${shopSettings.promoPercent}%)!`
        : `បានចម្លងកូដបញ្ចុះតម្លៃ ${code} (-${shopSettings.promoPercent}%) រួចរាល់!`
    );
  };

  const handleAddToCart = (payload: {
    name: string;
    img: string;
    qty: number;
    unitPrice: number;
    options: string;
  }) => {
    setCart((prev) => [...prev, { cartId: Date.now() + Math.random(), ...payload }]);
    showToast(isEn ? 'Added to cart!' : 'បានដាក់ចូលកន្ត្រកហើយ!');
  };

  const handleChangeCartQty = (idx: number, delta: number) => {
    setCart((prev) => {
      if (!prev[idx]) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + delta };
      if (next[idx].qty <= 0) next.splice(idx, 1);
      return next;
    });
  };

  const handleReorder = (pastOrder: Order) => {
    if (!pastOrder.items || !pastOrder.items.length) return;
    const baseTime = Date.now();
    const reorderedItems: CartItem[] = pastOrder.items.map((item, idx) => ({
      cartId: baseTime + idx + Math.random(),
      name: item.name,
      img: item.img,
      qty: Math.max(1, Number(item.qty) || 1),
      unitPrice: Number(item.unitPrice) || 0,
      options: item.options || 'ធម្មតា',
    }));
    setCart((prev) => [...prev, ...reorderedItems]);
    setIsAuthOpen(false);
    setIsCartOpen(true);
    showToast(`✓ បានដាក់ទំនិញពី ${pastOrder.id} ចូលកន្ត្រកហើយ!`);
  };

  const handleSubmitOrder = async (payload: {
    sendTg: boolean;
    payment: PaymentMethod;
    promoDisc: number;
    loyaltyPointsUsed?: number;
    loyaltyDisc?: number;
    fee: number;
    subtotal: number;
    grandTotal: number;
    paymentVerification?: VerifiedPaymentState;
    customer: Order['customer'];
  }): Promise<boolean> => {
    if (!shopScheduleStatus.isOpen) {
      showToast(shopClosedMessage || t.shopClosedBanner);
      return false;
    }

    const pv = payload.paymentVerification;
    if (payload.payment === 'KHQR / ABA' && !pv?.proofToken) {
      showToast(
        isEn
          ? 'Please verify KHQR payment amount before placing order!'
          : 'សូមផ្ទៀងផ្ទាត់ការទូទាត់ KHQR ជាមុនសិន!'
      );
      return false;
    }

    const finalOrderType: OrderType = isTableLocked ? 'dinein' : orderType;
    const customerPayload: Order['customer'] = {
      ...(currentMember ? { ...payload.customer, memberId: currentMember.id } : payload.customer),
      ...(isTableLocked ? { tableNum: tableNumberFromQR } : {}),
    };

    const loyaltyPtsReq = Math.max(0, Math.round(Number(payload.loyaltyPointsUsed) || 0));
    const loyaltyDiscReq = Math.max(0, Number(payload.loyaltyDisc) || 0);

    const orderForServer: Order = {
      id: `ORD-${String(Date.now()).slice(-4)}${Math.floor(10 + Math.random() * 89)}`,
      createdAt: Date.now(),
      timestamp: new Date().toLocaleTimeString('km-KH', { hour: '2-digit', minute: '2-digit' }),
      type: finalOrderType,
      items: [...cart],
      payment: payload.payment,
      subtotal: payload.subtotal,
      promoDisc: payload.promoDisc,
      ...(loyaltyPtsReq > 0 && loyaltyDiscReq > 0
        ? { loyaltyPointsUsed: loyaltyPtsReq, loyaltyDisc: loyaltyDiscReq }
        : {}),
      fee: finalOrderType === 'delivery' ? payload.fee : 0,
      grandTotal: payload.grandTotal,
      customer: customerPayload,
      driverCoords: null,
      status: 'Pending',
      ...(pv
        ? {
            paymentVerified: true,
            paymentVerifiedBy: pv.verifiedBy,
            paymentPaidAmount: pv.paidAmount,
            paymentCurrency: pv.currency,
            paymentRef: pv.transactionRef,
            paymentBankName: pv.bankName,
            paymentSlipHash: pv.slipHash,
            paymentMd5: pv.md5,
            paymentSlipImg: pv.slipImg,
            paymentProofToken: pv.proofToken,
          }
        : {}),
    };

    const syncRes = await syncOrderEverywhere(orderForServer);
    if (!syncRes.ok) {
      showToast(syncRes.error || 'ការបញ្ជាក់ការកម្ម៉ង់មិនជោគជ័យទេ');
      if (syncRes.requiresPhoneAuth) {
        if (syncRes.phone) setAuthPrefillPhone(syncRes.phone);
        setIsAuthOpen(true);
      }
      return false;
    }

    const cleanOrder: Order = { ...(syncRes.order || orderForServer) };
    delete cleanOrder.paymentProofToken;

    const earnedPoints = cart.reduce((s, i) => s + i.qty, 0);
    const usedLoyaltyPts = Math.max(
      0,
      Math.round(Number(cleanOrder.loyaltyPointsUsed ?? payload.loyaltyPointsUsed) || 0)
    );
    if (currentMember) {
      handleAuthenticated(
        {
          ...currentMember,
          points: Math.max(0, (currentMember.points || 0) - usedLoyaltyPts) + earnedPoints,
        },
        authToken
      );
    }

    setOrders((prev) => [cleanOrder, ...prev.filter((o) => o.id !== cleanOrder.id)]);
    setMyOrderIds((prev) => [cleanOrder.id, ...prev.filter((id) => id !== cleanOrder.id)].slice(0, 30));
    prevOrderStatusesRef.current.set(cleanOrder.id, cleanOrder.status);
    ordersInitializedRef.current = true;
    lastOrderCountRef.current += 1;
    safeDel('cafe_checkout_state_v15');
    safeDel('cafe_cart_open_v15');
    setCart([]);
    setIsCartOpen(false);

    const itemsTxt = cleanOrder.items
      .map((i) => `• ${i.qty}x ${i.name} (${i.options}) = $${(i.unitPrice * i.qty).toFixed(2)}`)
      .join('\n');
    const locTxt =
      cleanOrder.type === 'dinein'
        ? `🪑 តុលេខ ${cleanOrder.customer.tableNum}`
        : `📍 ${cleanOrder.customer.addressName}${
            cleanOrder.customer.coords
              ? `\n🗺 https://maps.google.com/?q=${cleanOrder.customer.coords.lat},${cleanOrder.customer.coords.lng}`
              : ''
          }`;
    const uname = (shopSettings.tgUsername || '').replace('@', '').trim();
    const loyaltyLine =
      Number(cleanOrder.loyaltyDisc) > 0
        ? `\n🎁 ប្តូរពិន្ទុ (${cleanOrder.loyaltyPointsUsed || 0} ★)៖ -$${Number(cleanOrder.loyaltyDisc).toFixed(2)}`
        : '';
    const verifiedLine = cleanOrder.paymentVerified
      ? `\n✅ បានផ្ទៀងផ្ទាត់ KHQR${cleanOrder.paymentRef ? ` (Ref: ${cleanOrder.paymentRef})` : ''}`
      : '';
    const tgUrl = uname
      ? `https://t.me/${uname}?text=${encodeURIComponent(
          `☕ កម្ម៉ង់ថ្មី ${cleanOrder.id}\n👤 ${cleanOrder.customer.name} (${cleanOrder.customer.phone || '-'})\n${locTxt}\n\n${itemsTxt}${loyaltyLine}\n\n💵 សរុប៖ $${cleanOrder.grandTotal.toFixed(2)} (${cleanOrder.payment})${verifiedLine}`
        )}`
      : '';

    safeSessionSet('cafe_last_receipt_id_v15', cleanOrder.id);
    setReceiptState({ order: cleanOrder, tgUrl });
    if (payload.sendTg && tgUrl) {
      showToast(
        isEn
          ? 'Receipt ready — tap "Send Receipt to Shop Telegram" below.'
          : 'វិក្កយបត្ររួចរាល់ — ចុចប៊ូតុងផ្ញើទៅ Telegram ហាងខាងក្រោម!'
      );
    }
    return true;
  };

  const handleUpdateOrderStatus = (orderId: string, status: OrderStatus) => {
    unlockAudio();
    prevOrderStatusesRef.current.set(orderId, status);
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updated: Order = {
          ...o,
          status,
          confirmedAt: o.confirmedAt || (status !== 'Pending' ? Date.now() : undefined),
          confirmedBy: status !== 'Pending' ? 'website' : o.confirmedBy,
        };
        syncOrderEverywhere(updated, { asAdmin: true });
        return updated;
      })
    );
  };

  const handleMarkOrderPaid = async (orderId: string) => {
    unlockAudio();
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    const updated: Order = {
      ...target,
      paymentVerified: true,
      paymentVerifiedBy: 'web_admin',
      paymentPaidAmount: Number(target.grandTotal || 0),
      paymentCurrency: 'USD',
    };
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    await syncOrderEverywhere(updated, { asAdmin: true });
    showToast(
      isEn
        ? `✓ Marked ${orderId} as Paid!`
        : `✓ បានបញ្ជាក់ថាទទួលលុយពី ${orderId} រួចរាល់!`
    );
  };

  const handleSendUnpaidVoiceAlert = async (order: Order) => {
    const alertAt = Date.now();
    prevUnpaidAlertAtRef.current.set(order.id, alertAt);
    const updated: Order = {
      ...order,
      unpaidAlertAt: alertAt,
      unpaidAlertCount: (order.unpaidAlertCount || 0) + 1,
    };
    setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    await syncOrderEverywhere(updated, { asAdmin: true });
    showToast(
      isEn
        ? `🔊 Sent unpaid voice & Telegram alert for ${order.id}!`
        : `🔊 បានហៅសំលេង & ផ្ញើសារដាស់តឿនភ្ញៀវ (${order.id}) ភ្លេចគិតលុយ!`
    );
  };

  const deleteOrderFromBackends = async (orderIds: string[]) => {
    const fb = getFirebaseBase(shopSettings.firebaseUrl);
    const tasks: Promise<unknown>[] = [];
    for (const id of orderIds) {
      if (adminToken) {
        tasks.push(
          fetchWithTimeout(
            `/api/orders/${encodeURIComponent(id)}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${adminToken}` },
            },
            8000
          )
        );
      }
      if (fb) {
        tasks.push(
          fetchWithTimeout(`${fb}/orders/${encodeURIComponent(id)}.json`, { method: 'DELETE' }, 8000)
        );
      }
    }
    if (tasks.length > 0) await Promise.allSettled(tasks);
  };

  const handleDeleteOrder = async (orderId: string) => {
    clearingOrdersRef.current = true;
    setOrders((prev) => {
      const next = prev.filter((o) => o.id !== orderId);
      lastOrderCountRef.current = next.length;
      return next;
    });
    prevOrderStatusesRef.current.delete(orderId);
    try {
      await deleteOrderFromBackends([orderId]);
    } finally {
      clearingOrdersRef.current = false;
    }
    showToast(isEn ? `Deleted order ${orderId}` : `បានលុបការកម្ម៉ង់ ${orderId} រួចរាល់!`);
  };

  const handleSendOrderToTelegram = async (orderId: string): Promise<boolean> => {
    if (!adminToken) {
      handleRequireAdminReauth();
      return false;
    }
    try {
      const res = await fetchWithTimeout(
        `/api/orders/${encodeURIComponent(orderId)}/send-telegram`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        },
        12000
      );
      if (res.status === 401) {
        handleRequireAdminReauth();
        return false;
      }
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        showToast(
          data?.error ||
            (isEn
              ? 'Could not send receipt to Telegram'
              : 'មិនអាចផ្ញើវិក្កយបត្រទៅ Telegram បានទេ!')
        );
        return false;
      }
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...data.order } : o)));
      }
      showToast(
        data.sentSlip
          ? isEn
            ? `✓ Sent receipt & bank slip (${orderId}) to Telegram!`
            : `✓ បានផ្ញើវិក្កយបត្រ & រូប Slip (${orderId}) ទៅ Telegram ហាងរួចរាល់!`
          : isEn
            ? `✓ Sent receipt (${orderId}) to Telegram!`
            : `✓ បានផ្ញើវិក្កយបត្រ (${orderId}) ទៅ Telegram ហាងរួចរាល់!`
      );
      return true;
    } catch {
      showToast(isEn ? 'Could not reach server' : 'មិនអាចភ្ជាប់ទៅ Server បានទេ');
      return false;
    }
  };

  const handleSubmitOrderFeedback = async (
    orderId: string,
    rating: number,
    comment: string
  ): Promise<boolean> => {
    const cleanRating = Math.min(5, Math.max(1, Math.round(rating)));
    const cleanComment = comment.trim().slice(0, 500);
    const localFeedback = {
      rating: cleanRating,
      comment: cleanComment,
      submittedAt: Date.now(),
      customerName: currentMember?.name,
    };

    try {
      const res = await fetchWithTimeout(
        `/api/orders/${encodeURIComponent(orderId)}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating: cleanRating,
            comment: cleanComment,
            customerName: currentMember?.name,
          }),
        },
        8000
      );
      if (res.ok) {
        const data = await res.json();
        const savedOrder = data?.order as Order | undefined;
        const savedFeedback = savedOrder?.feedback || localFeedback;
        setOrders((prev) =>
          prev.map((o) => {
            if (o.id !== orderId) return o;
            const updated: Order = {
              ...o,
              feedback: savedFeedback,
            };
            const fb = getFirebaseBase(shopSettings.firebaseUrl);
            if (fb) {
              fetch(`${fb}/orders/${encodeURIComponent(updated.id)}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
              }).catch(() => {});
            }
            return updated;
          })
        );
        setReceiptState((prev) =>
          prev.order?.id === orderId
            ? { ...prev, order: { ...prev.order, feedback: savedFeedback } }
            : prev
        );
        showToast(isEn ? '✓ Thank you for your rating!' : '✓ សូមអរគុណសម្រាប់ការវាយតម្លៃរបស់អ្នក!');
        return true;
      }
      const errData = await res.json().catch(() => null);
      if (res.status === 400) {
        showToast(
          errData?.error ||
            (isEn
              ? 'Only paid or completed orders can be rated'
              : 'អាចវាយតម្លៃបានតែការកម្ម៉ង់ដែលទូទាត់រួច ឬបានបញ្ចប់ប៉ុណ្ណោះ')
        );
        return false;
      }
    } catch {
      // Fall back to local + Firebase sync if server unreachable
    }

    const target = orders.find((o) => o.id === orderId);
    if (!target || (target.status !== 'Completed' && target.paymentVerified !== true)) {
      showToast(
        isEn
          ? 'Only paid or completed orders can be rated'
          : 'អាចវាយតម្លៃបានតែការកម្ម៉ង់ដែលទូទាត់រួច ឬបានបញ្ចប់ប៉ុណ្ណោះ'
      );
      return false;
    }

    const updatedOrder: Order = { ...target, feedback: localFeedback };
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
    setReceiptState((prev) =>
      prev.order?.id === orderId ? { ...prev, order: updatedOrder } : prev
    );
    await syncOrderEverywhere(updatedOrder);
    showToast(isEn ? '✓ Thank you for your rating!' : '✓ សូមអរគុណសម្រាប់ការវាយតម្លៃរបស់អ្នក!');
    return true;
  };

  const handleSubmitShopReview = async (payload: {
    rating: number;
    comment: string;
    customerName?: string;
    tags?: string[];
    orderId?: string;
  }): Promise<boolean> => {
    const cleanRating = Math.min(5, Math.max(1, Math.round(Number(payload.rating) || 5)));
    const cleanComment = (payload.comment || '').trim().slice(0, 500);
    const cleanName =
      (payload.customerName || currentMember?.name || '').trim().slice(0, 60) ||
      (isEn ? 'Guest Customer' : 'ភ្ញៀវ');
    const cleanTags = Array.isArray(payload.tags) ? payload.tags.slice(0, 6) : [];
    const fallbackReview: ShopReview = {
      id: `REV-${Date.now().toString(36).toUpperCase()}`,
      rating: cleanRating,
      comment: cleanComment,
      customerName: cleanName,
      tags: cleanTags.length ? cleanTags : undefined,
      orderId: payload.orderId,
      submittedAt: Date.now(),
    };

    try {
      const res = await fetchWithTimeout(
        '/api/reviews',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating: cleanRating,
            comment: cleanComment,
            customerName: cleanName,
            tags: cleanTags,
            orderId: payload.orderId,
          }),
        },
        8000
      );
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; review?: ShopReview };
        const saved = data.review || fallbackReview;
        setShopReviews((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
        const fb = getFirebaseBase(shopSettings.firebaseUrl);
        if (fb) {
          fetch(`${fb}/reviews/${encodeURIComponent(saved.id)}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saved),
          }).catch(() => {});
        }
        showToast(isEn ? '✓ Thank you for reviewing us!' : '✓ សូមអរគុណសម្រាប់ការវាយតម្លៃហាងរបស់យើង!');
        return true;
      }
    } catch {
      // Fallback to local + Firebase sync if server unreachable
    }

    setShopReviews((prev) => [fallbackReview, ...prev]);
    const fb = getFirebaseBase(shopSettings.firebaseUrl);
    if (fb) {
      fetch(`${fb}/reviews/${encodeURIComponent(fallbackReview.id)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackReview),
      }).catch(() => {});
    }
    showToast(isEn ? '✓ Review saved!' : '✓ បានផ្ញើការវាយតម្លៃរួចរាល់!');
    return true;
  };

  const handleDeleteShopReview = async (reviewId: string) => {
    setShopReviews((prev) => prev.filter((r) => r.id !== reviewId));
    const fb = getFirebaseBase(shopSettings.firebaseUrl);
    if (fb) {
      fetch(`${fb}/reviews/${encodeURIComponent(reviewId)}.json`, { method: 'DELETE' }).catch(
        () => {}
      );
    }
    try {
      const res = await fetchWithTimeout(
        `/api/reviews/${encodeURIComponent(reviewId)}`,
        {
          method: 'DELETE',
          headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
        },
        8000
      );
      if (res.status === 401) {
        handleRequireAdminReauth();
        return;
      }
      showToast(isEn ? 'Review deleted' : 'បានលុបការវាយតម្លៃរួចរាល់');
    } catch {
      showToast(isEn ? 'Review removed locally' : 'បានលុបការវាយតម្លៃ');
    }
  };

  const handleUpdateDriverCoords = (orderId: string, coords: Coords, status?: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updated = { ...o, driverCoords: coords, status: status || o.status };
        syncOrderEverywhere(updated);
        return updated;
      })
    );
  };

  const handleUpdateDriverInfo = (orderId: string, info: DriverInfo, nextStatus?: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updated: Order = {
          ...o,
          driverInfo: { ...o.driverInfo, ...info },
          driverCoords: o.driverCoords || { lat: shopSettings.lat, lng: shopSettings.lng },
          status: nextStatus || o.status,
        };
        syncOrderEverywhere(updated);
        return updated;
      })
    );
  };

  const handleUpdateCustomerCoords = (orderId: string, coords: Coords) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updated = { ...o, customer: { ...o.customer, coords } };
        syncOrderEverywhere(updated);
        return updated;
      })
    );
  };

  const handleOpenDriverConsole = (orderId: string) => {
    setLiveTrackOrderId(null);
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId || o.driverCoords) return o;
        const updated = {
          ...o,
          driverCoords: { lat: shopSettings.lat, lng: shopSettings.lng },
          status: 'Ready' as OrderStatus,
        };
        syncOrderEverywhere(updated);
        return updated;
      })
    );
    setActiveDriverOrderId(orderId);
    setViewMode('driver');
  };

  const handleOpenDriverPortal = () => {
    setLiveTrackOrderId(null);
    setActiveDriverOrderId(null);
    setViewMode('driver');
  };

  const promoSummaryText =
    shopSettings.deliveryMode === 'free'
      ? t.freeDeliveryAll
      : shopSettings.freeDeliveryOver > 0
        ? `${t.freeDeliveryOver} $${shopSettings.freeDeliveryOver}`
        : t.fastDelivery;

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-slate-800 overflow-x-clip">
      <TouchFeedbackLayer />
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl max-w-[92vw] truncate"
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {liveUnpaidAlert && (
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="fixed top-14 sm:top-5 left-1/2 -translate-x-1/2 z-[98] w-[94vw] max-w-lg bg-red-600 text-white border-2 border-amber-300 rounded-2xl p-3.5 sm:p-4 shadow-2xl space-y-2.5"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-300 text-red-900 flex items-center justify-center shrink-0">
                <Volume2 className="w-5 h-5 animate-pulse" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-xs sm:text-sm font-bold">
                  {isEn
                    ? `🚨 Payment Reminder — Order ${liveUnpaidAlert.orderId}`
                    : `🚨 សូមមេត្តាអញ្ជើញទូទាត់ប្រាក់! (${liveUnpaidAlert.orderId})`}
                </p>
                <p className="text-[11px] sm:text-xs text-red-50 leading-relaxed mt-0.5">
                  {liveUnpaidAlert.messageText}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopUnpaidVoiceAlert();
                  setLiveUnpaidAlert(null);
                }}
                aria-label={isEn ? 'Dismiss' : 'បិទ'}
                className="text-red-100 hover:text-white p-1 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  playUnpaidVoiceAlert({
                    audioDataUri: shopSettings.unpaidVoiceAlertAudio,
                    text: shopSettings.unpaidVoiceAlertText,
                    lang,
                    tableNum: liveUnpaidAlert.tableNum,
                    amountUsd: liveUnpaidAlert.amountUsd,
                    customerName: liveUnpaidAlert.customerName,
                  })
                }
                className="bg-amber-300 hover:bg-amber-200 text-slate-900 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{isEn ? 'Play Voice Again' : '🔊 ស្តាប់សារសំលេង'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetOrd = orders.find((o) => o.id === liveUnpaidAlert.orderId);
                  stopUnpaidVoiceAlert();
                  setLiveUnpaidAlert(null);
                  if (targetOrd) {
                    setReceiptState({ order: targetOrd, tgUrl: '' });
                  } else {
                    setIsTrackerOpen(true);
                  }
                }}
                className="bg-white hover:bg-red-50 text-red-700 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>{isEn ? 'View Bill & Pay Now' : 'មើលវិក្កយបត្រ / ទូទាត់ឥឡូវ'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {liveConfirmAlert && (
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="fixed top-14 sm:top-5 left-1/2 -translate-x-1/2 z-[95] w-[92vw] max-w-md bg-[#0D4A3E] text-white border border-amber-300/60 rounded-2xl p-3.5 shadow-2xl flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5 animate-bounce" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs sm:text-sm font-bold truncate">{liveConfirmAlert.title}</p>
              <p className="text-[11px] text-emerald-100 truncate mt-0.5">{liveConfirmAlert.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const targetOrd = orders.find((o) => o.id === liveConfirmAlert.orderId);
                setLiveConfirmAlert(null);
                if (targetOrd?.type === 'delivery' && targetOrd.status === 'Ready') {
                  setLiveTrackOrderId(targetOrd.id);
                } else {
                  setIsTrackerOpen(true);
                }
              }}
              className="bg-white text-[#0D4A3E] px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0"
            >
              {isEn ? 'View' : 'មើល'}
            </button>
            <button
              type="button"
              onClick={() => setLiveConfirmAlert(null)}
              aria-label={isEn ? 'Dismiss' : 'បិទ'}
              className="text-emerald-200 hover:text-white p-1 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {viewMode === 'driver' && (
          <motion.div
            key="view-driver"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <DriverConsole
              lang={lang}
              onChangeLang={setLang}
              order={activeDriverOrder}
              orders={orders}
              shopSettings={shopSettings}
              onSelectOrder={(id) => setActiveDriverOrderId(id)}
              onExit={() => setViewMode(isAdminUnlocked ? 'admin' : 'customer')}
              onUpdateDriverCoords={handleUpdateDriverCoords}
              onUpdateDriverInfo={handleUpdateDriverInfo}
              onCompleteDelivery={(id) => {
                handleUpdateDriverInfo(id, { deliveredAt: Date.now() }, 'Completed');
                showToast(isEn ? '✅ Delivery completed!' : '✅ បានបញ្ចប់ការដឹកជញ្ជូន!');
                const nextRemaining = orders.find(
                  (o) => o.type === 'delivery' && o.status !== 'Completed' && o.id !== id
                );
                setActiveDriverOrderId(nextRemaining ? nextRemaining.id : null);
              }}
              onToast={showToast}
            />
          </motion.div>
        )}

        {viewMode === 'admin' && (
          <motion.div
            key="view-admin"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <AdminDashboard
          lang={lang}
          onChangeLang={setLang}
          adminToken={adminToken}
          serverPersistent={serverPersistent}
          menuItems={menuItems}
          toppings={toppings}
          orders={orders}
          shopReviews={shopReviews}
          members={members}
          shopSettings={shopSettings}
          onExit={() => {
            setAdminToken(null);
            safeSessionDel('cafe_admin_token');
            setViewMode('customer');
          }}
          onRequireReauth={handleRequireAdminReauth}
          onUpdateShopSettings={async (next) => {
            setShopSettings(next);
            const res = await syncShopEverywhere(menuItems, toppings, next);
            if (!res.ok && !res.reauth) {
              showToast(
                isEn
                  ? '⚠️ Cannot reach server (saved locally only)'
                  : '⚠️ មិនអាចផ្ទុកទិន្នន័យទៅ Server បានទេ (រក្សាទុកតែក្នុងទូរស័ព្ទនេះ)'
              );
            }
            return res;
          }}
          onUpdateMenu={async (next) => {
            setMenuItems(next);
            const res = await syncShopEverywhere(next, toppings, shopSettings);
            if (!res.ok && !res.reauth) {
              showToast(
                isEn
                  ? '⚠️ Cannot upload menu to server (check connection)'
                  : '⚠️ មិនអាចផ្ទុកម៉ឺនុយទៅ Server បានទេ (សូមពិនិត្យការតភ្ជាប់)'
              );
            }
            return res;
          }}
          onUpdateToppings={async (next) => {
            setToppings(next);
            return syncShopEverywhere(menuItems, next, shopSettings);
          }}
          onUpdateOrderStatus={handleUpdateOrderStatus}
          onUpdateOrderDriverInfo={handleUpdateDriverInfo}
          onMarkOrderPaid={handleMarkOrderPaid}
          onSendUnpaidVoiceAlert={handleSendUnpaidVoiceAlert}
          onSendOrderToTelegram={handleSendOrderToTelegram}
          onDeleteOrder={handleDeleteOrder}
          onDeleteReview={handleDeleteShopReview}
          onClearCompletedOrders={async () => {
            const completed = orders.filter((o) => o.status === 'Completed');
            const remaining = orders.filter((o) => o.status !== 'Completed');
            clearingOrdersRef.current = true;
            setOrders(remaining);
            lastOrderCountRef.current = remaining.length;
            try {
              if (completed.length > 0) {
                await deleteOrderFromBackends(completed.map((o) => o.id));
              }
            } finally {
              clearingOrdersRef.current = false;
            }
            showToast(isEn ? 'Cleared completed orders!' : 'បានសម្អាត Order ដែលរួចរាល់!');
          }}
          onOpenDriverConsole={handleOpenDriverConsole}
          onOpenDriverPortal={handleOpenDriverPortal}
          onOpenShopMapPicker={() => setLocationPickerState({ open: true, purpose: 'shop' })}
            onOpenTableView={(tNum) => {
              setTableNumberFromQR(tNum);
              setOrderType('dinein');
              setAdminToken(null);
              safeSessionDel('cafe_admin_token');
              setViewMode('customer');
            }}
            onToast={showToast}
          />
          </motion.div>
        )}

        {viewMode === 'customer' && (
          <motion.div
            key="view-customer"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="min-h-screen flex flex-col justify-between pb-24 lg:pb-10"
          >
          <div>
            <header className="sticky top-0 z-30 bg-white/92 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_12px_rgba(15,23,42,0.04)]">
              <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-8">
                <a
                  href="#top"
                  className="flex items-center gap-2 sm:gap-2.5 text-sm sm:text-lg font-bold tracking-tight text-[#0D4A3E] min-w-0 flex-1 sm:flex-initial group"
                >
                  <img
                    src={resolveAssetUrl(shopSettings.logoImg, CAFE_ASSETS.logoEmblem)}
                    alt={shopSettings.brandTitle}
                    referrerPolicy="no-referrer"
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.logoEmblem)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border border-amber-400/70 bg-[#0D4A3E] shrink-0 transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="truncate whitespace-nowrap">{shopSettings.brandTitle}</span>
                </a>

                <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
                  <a
                    href="#menu-section"
                    className="nav-link-underline hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    {t.menuNav}
                  </a>
                  <a
                    href="#reviews-section"
                    className="nav-link-underline hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
                  >
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                    <span>{isEn ? 'Reviews' : 'វាយតម្លៃ'}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setIsTrackerOpen(true)}
                    className="nav-link-underline hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                  >
                    <span>{t.trackNav}</span>
                    {activeMyOrdersCount > 0 && (
                      <span className="bg-amber-400 text-slate-900 font-mono-num text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        {activeMyOrdersCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isTableLocked) {
                        showToast(
                          isEn
                            ? `Locked to Table ${tableNumberFromQR} (Dine-In Only)`
                            : `បានស្កេន QR តុលេខ ${tableNumberFromQR} — កម្ម៉ង់ញ៉ាំនៅហាងតែប៉ុណ្ណោះ!`
                        );
                        return;
                      }
                      setLocationPickerState({ open: true, purpose: 'customer' });
                    }}
                    className={`nav-link-underline transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                      isTableLocked ? 'text-amber-700 font-bold' : 'hover:text-[#0D4A3E]'
                    }`}
                  >
                    {isTableLocked && <Lock className="w-3.5 h-3.5" />}
                    <span>
                      {isTableLocked
                        ? `${t.tableNumLabel} ${tableNumberFromQR}`
                        : t.locationNav}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdminUnlocked) setViewMode('admin');
                      else setIsPinOpen(true);
                    }}
                    className="nav-link-underline hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    {t.adminNav}
                  </button>
                </nav>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <motion.button
                    type="button"
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
                    onClick={() => setLang(isEn ? 'km' : 'en')}
                    aria-label="Switch language"
                    className="h-9 sm:min-h-[40px] px-2.5 flex items-center gap-1 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-[11px] sm:text-xs font-bold whitespace-nowrap shrink-0"
                  >
                    <Globe className="w-3.5 h-3.5 text-[#0D4A3E]" />
                    <span>{isEn ? 'ខ្មែរ' : 'EN'}</span>
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}
                    onClick={() => setIsTrackerOpen(true)}
                    aria-label={t.trackNav}
                    className="relative md:hidden h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 text-[#0D4A3E] bg-[#F4F8F6] hover:bg-[#E8F2EF]"
                  >
                    <ReceiptText className="w-4 h-4" />
                    {activeMyOrdersCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-amber-400 text-slate-900 font-mono-num text-[9px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center shadow-xs">
                        {activeMyOrdersCount}
                      </span>
                    )}
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}
                    onClick={() => {
                      if (isAdminUnlocked) setViewMode('admin');
                      else setIsPinOpen(true);
                    }}
                    aria-label={t.adminNav}
                    className="md:hidden h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
                    onClick={() => setIsAuthOpen(true)}
                    className="h-9 sm:min-h-[40px] px-2.5 sm:px-4 bg-[#0D4A3E] hover:bg-[#09352C] text-white text-[11px] sm:text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 shadow-sm"
                  >
                    <User className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span className="sm:hidden">
                      {currentMember ? currentMember.name.split(' ')[0] : t.accountShort}
                    </span>
                    <span className="hidden sm:inline">
                      {currentMember
                        ? `${currentMember.name.split(' ')[0]} · ★${currentMember.points || 0}`
                        : t.accountFull}
                    </span>
                  </motion.button>
                </div>
              </div>
              {!shouldReduceMotion && (
                <motion.div
                  style={{ scaleX: smoothScrollProgress }}
                  className="origin-left h-[2px] w-full bg-gradient-to-r from-[#0D4A3E] via-amber-400 to-[#0D4A3E]/80"
                />
              )}
            </header>

            <main id="top" className="max-w-7xl mx-auto px-3 sm:px-6 pt-3 sm:pt-6 space-y-5 sm:space-y-8">
              <AnimatePresence>
                {!shopScheduleStatus.isOpen && (
                  <motion.div
                    initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                    className="bg-red-600 text-white px-4 py-3 rounded-2xl text-xs font-bold text-center"
                  >
                    {shopClosedMessage || t.shopClosedBanner}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {isTableLocked && (
                  <motion.div
                    initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                    className="bg-amber-400 text-slate-900 px-3.5 py-2.5 rounded-2xl text-xs flex flex-wrap items-center justify-between gap-2 font-bold shadow-sm"
                  >
                    <span className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        🪑 {t.dineInLabel} · {t.tableNumLabel} {tableNumberFromQR}
                      </span>
                    </span>
                    <span className="bg-slate-900 text-amber-300 px-2.5 py-1 rounded-lg text-[11px] inline-flex items-center gap-1 shrink-0">
                      <Lock className="w-3 h-3" />
                      <span>{isEn ? 'Table Locked · Dine-In Only' : 'ចាក់សោតុ · ញ៉ាំនៅហាងតែប៉ុណ្ណោះ'}</span>
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {activeLiveOrder && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setLiveTrackOrderId(activeLiveOrder.id)}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 px-3.5 py-2.5 rounded-2xl text-xs flex items-center justify-between gap-2 font-bold shadow-sm transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <DeliveryRiderIllustration />
                    <span className="truncate">
                      {activeLiveOrder.driverInfo?.arrivedAt
                        ? isEn
                          ? `🎉 Driver arrived! Tap to view (${activeLiveOrder.id})`
                          : `🎉 អ្នកដឹកមកដល់ទីតាំងអ្នកហើយ! ចុចមើល (${activeLiveOrder.id})`
                        : `${t.liveDriverBanner} (${activeLiveOrder.id})`}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </motion.button>
              )}

              {latestActiveOrder && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setReceiptState({ order: latestActiveOrder, tgUrl: '' })}
                  className="w-full bg-white hover:bg-slate-50 border border-[#0D4A3E]/20 text-slate-900 px-3.5 py-2.5 rounded-2xl text-xs flex items-center justify-between gap-2 shadow-xs transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <ReceiptText className="w-4 h-4 text-[#0D4A3E] shrink-0" />
                    <span className="truncate font-semibold">
                      <span className="font-mono-num text-[#0D4A3E] font-bold">{latestActiveOrder.id}</span>
                      {' · '}
                      {getOrderStatusText(latestActiveOrder.status, lang)}
                    </span>
                  </span>
                  <span className="text-[11px] font-bold text-[#0D4A3E] shrink-0 inline-flex items-center gap-1">
                    <span>{isEn ? 'View Bill' : 'មើលវិក្កយបត្រ'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </motion.button>
              )}

              <section className="grid lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                  className="lg:col-span-7 bg-[#0D4A3E] text-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 flex flex-col justify-between gap-4 sm:gap-6 relative overflow-hidden shadow-md"
                >
                  <div
                    aria-hidden="true"
                    className="hero-glow-drift pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-amber-400/12 blur-2xl"
                  />
                  <div
                    aria-hidden="true"
                    className="hero-glow-drift pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-emerald-300/10 blur-2xl"
                  />

                  <div className="relative z-10 flex items-center justify-between gap-3 sm:grid sm:grid-cols-12 sm:gap-6">
                    <div className="sm:col-span-8 space-y-2 sm:space-y-3 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs font-medium text-emerald-200">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                          <span>
                            {shopScheduleStatus.isOpen
                              ? shopScheduleStatus.autoActive
                                ? `${isEn ? 'Open until' : 'បើកដល់ម៉ោង'} ${shopScheduleStatus.closeTime}`
                                : t.openFastDelivery
                              : shopScheduleStatus.autoActive
                                ? isEn
                                  ? `Closed (${shopScheduleStatus.openTime}–${shopScheduleStatus.closeTime})`
                                  : `បិទ (${shopScheduleStatus.openTime}–${shopScheduleStatus.closeTime})`
                                : t.closedTemp}
                          </span>
                        </span>
                        <a
                          href="#reviews-section"
                          className="inline-flex items-center gap-1 text-amber-200 hover:text-amber-100 transition-colors"
                        >
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
                          <span className="font-mono-num font-bold">
                            {allCustomerReviews.length > 0
                              ? `${averageShopRating.toFixed(1)} (${allCustomerReviews.length})`
                              : isEn
                                ? 'Rate Us'
                                : 'វាយតម្លៃហាង'}
                          </span>
                        </a>
                        {shopSettings.promoCode && shopSettings.promoPercent > 0 && (
                          <button
                            type="button"
                            onClick={handleCopyPromoCode}
                            className="inline-flex items-center gap-1 bg-amber-400/20 hover:bg-amber-400/30 border border-amber-300/35 text-amber-200 px-2 py-0.5 rounded-lg font-mono-num text-[11px] font-bold transition-colors"
                          >
                            <Copy className="w-3 h-3" />
                            <span>
                              {shopSettings.promoCode} (-{shopSettings.promoPercent}%)
                            </span>
                          </button>
                        )}
                      </div>
                      <motion.h1
                        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.12 }}
                        className="text-xl sm:text-4xl lg:text-[42px] font-bold leading-[1.15] text-balance"
                      >
                        {shopSettings.brandTitle}
                      </motion.h1>
                      <motion.p
                        initial={shouldReduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.4, delay: 0.18 }}
                        className="text-xs sm:text-sm lg:text-base text-emerald-100/90 max-w-xl line-clamp-2"
                      >
                        {shopSettings.shopName} · {promoSummaryText}
                      </motion.p>
                    </div>

                    <div className="sm:col-span-4 flex justify-center shrink-0">
                      <CoffeeCupSteamIllustration className="w-20 h-16 sm:w-36 sm:h-32 lg:w-44 lg:h-36" />
                    </div>
                  </div>

                  <div className="relative z-10 grid sm:grid-cols-2 gap-2.5 sm:gap-3 pt-1">
                    <motion.button
                      type="button"
                      whileHover={shouldReduceMotion || isTableLocked ? undefined : { y: -2 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                      onClick={() => {
                        if (isTableLocked) {
                          showToast(
                            isEn
                              ? `Locked to Table ${tableNumberFromQR} (Dine-In Only)`
                              : `បានស្កេន QR តុលេខ ${tableNumberFromQR} — មិនអាចប្តូរទីតាំងដឹកជញ្ជូនបានទេ!`
                          );
                          return;
                        }
                        setLocationPickerState({ open: true, purpose: 'customer' });
                      }}
                      className="text-left bg-white/12 hover:bg-white/20 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl sm:rounded-2xl flex items-center gap-2.5 border border-white/15 transition-colors"
                    >
                      <div className="bg-amber-400 text-slate-900 p-1.5 sm:p-2 rounded-lg sm:rounded-xl shrink-0">
                        {isTableLocked ? <Lock className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] sm:text-[11px] text-emerald-200">
                          {isTableLocked ? t.dineInLabel : t.deliverToMap}
                        </p>
                        <p className="text-xs font-bold truncate">
                          {isTableLocked
                            ? `${t.tableNumLabel} ${tableNumberFromQR} (${isEn ? 'Locked' : 'ចាក់សោ'})`
                            : pickedAddressName}
                        </p>
                      </div>
                      {!isTableLocked && <ChevronDown className="w-4 h-4 text-emerald-200 shrink-0" />}
                    </motion.button>

                    <div className="relative flex items-center">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t.searchPlaceholder}
                        className="w-full h-full min-h-[44px] sm:min-h-[48px] bg-white text-slate-900 placeholder-slate-400 text-base sm:text-sm pl-10 pr-9 py-2 rounded-xl sm:rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          aria-label={t.clearSearch}
                          className="absolute right-2.5 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="lg:col-span-5 group card-sheen relative rounded-2xl sm:rounded-3xl overflow-hidden h-48 sm:h-64 lg:h-full lg:min-h-[300px] bg-slate-900 shadow-md"
                >
                  <img
                    src={resolveAssetUrl(shopSettings.bannerImg, CAFE_ASSETS.heroBanner)}
                    alt={shopSettings.brandTitle}
                    referrerPolicy="no-referrer"
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.heroBanner)}
                    className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-4 sm:p-7 flex flex-col justify-between">
                    <div className="flex justify-end">
                      <a
                        href="#menu-section"
                        className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-md hover:bg-white/25 text-white text-[11px] font-semibold px-3 py-1.5 rounded-xl border border-white/20 transition-colors"
                      >
                        <span>{t.signatureCraft}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <div>
                      <p className="text-[11px] sm:text-xs font-semibold text-amber-300 truncate">
                        {promoSummaryText}
                      </p>
                      <p className="text-white font-bold text-sm sm:text-xl mt-0.5 sm:mt-1 leading-snug text-balance">
                        {t.bannerSubline}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </section>

              {featuredMenu.length > 0 && selectedCategory === 'All' && !searchQuery.trim() && (
                <motion.section
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.15 }}
                  transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
                      <h2 className="font-bold text-slate-900 text-sm sm:text-lg">{t.featuredHeading}</h2>
                    </div>
                    <span className="hidden lg:inline text-xs text-slate-500 font-mono-num">
                      {featuredMenu.length} {t.itemsCountUnit}
                    </span>
                  </div>

                  {/* Mobile horizontal scroll strip */}
                  <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1 lg:hidden">
                    {featuredMenu.map((item, idx) => {
                      const fp = getDiscountedPrice(item);
                      const displayName = getMenuName(item, lang);
                      return (
                        <motion.button
                          key={`feat-mob-${item.id}`}
                          type="button"
                          initial={shouldReduceMotion ? false : { opacity: 0, x: 14 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true, amount: 0.2 }}
                          transition={{ duration: 0.28, delay: Math.min(idx * 0.05, 0.2) }}
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                          onClick={() => setCustomizingItem(item)}
                          className="shrink-0 w-56 sm:w-64 bg-white border border-amber-200/80 rounded-2xl p-2.5 flex items-center gap-3 text-left hover:shadow-md transition-shadow"
                        >
                          <img
                            src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                            alt={displayName}
                            referrerPolicy="no-referrer"
                            onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                            className="w-14 h-14 rounded-xl object-cover shrink-0 bg-slate-100"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs text-slate-900 truncate">{displayName}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {getMenuCategoryLabel(item.category, lang, item.categoryEn)}
                            </p>
                            <p className="font-bold text-xs font-mono-num text-[#0D4A3E] mt-0.5">
                              ${fp.toFixed(2)}
                            </p>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Desktop clean 4-column showcase grid */}
                  <div className="hidden lg:grid lg:grid-cols-4 gap-4">
                    {featuredMenu.slice(0, 4).map((item, idx) => {
                      const fp = getDiscountedPrice(item);
                      const displayName = getMenuName(item, lang);
                      return (
                        <motion.button
                          key={`feat-desk-${item.id}`}
                          type="button"
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true, amount: 0.2 }}
                          transition={{ duration: 0.3, delay: idx * 0.05 }}
                          whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                          onClick={() => setCustomizingItem(item)}
                          className="group card-sheen bg-white border border-slate-200/90 hover:border-[#0D4A3E]/35 rounded-2xl p-3 flex items-center gap-3.5 text-left hover:shadow-md transition-all"
                        >
                          <img
                            src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                            alt={displayName}
                            referrerPolicy="no-referrer"
                            onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                            className="w-16 h-16 rounded-xl object-cover shrink-0 bg-slate-100 transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-slate-500 truncate">
                              {getMenuCategoryLabel(item.category, lang, item.categoryEn)}
                            </p>
                            <p className="font-bold text-sm text-slate-900 truncate mt-0.5">{displayName}</p>
                            <p className="font-bold text-sm font-mono-num text-[#0D4A3E] mt-1">
                              ${fp.toFixed(2)}
                            </p>
                          </div>
                          <span className="w-8 h-8 rounded-xl bg-[#E8F2EF] group-hover:bg-[#0D4A3E] text-[#0D4A3E] group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                            <Plus className="w-4 h-4" />
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.section>
              )}

              {/* Mobile Quick Order Mode & Table Bar (Effortless 1-Tap Switch before Cart) */}
              <section className="lg:hidden bg-white border border-slate-200/90 rounded-2xl p-2.5 space-y-2 shadow-xs">
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                  {(
                    [
                      { id: 'delivery' as const, label: t.deliveryTab, Icon: Bike },
                      { id: 'dinein' as const, label: t.dineInTab, Icon: Armchair },
                    ] as const
                  ).map(({ id, label, Icon }) => {
                    const active = orderType === id;
                    const lockedOut = isTableLocked && id === 'delivery';
                    return (
                      <button
                        key={`mob-mode-${id}`}
                        type="button"
                        onClick={() => handleRequestOrderTypeChange(id)}
                        className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                          lockedOut
                            ? 'text-slate-400 cursor-not-allowed opacity-70'
                            : active
                              ? 'bg-white text-[#0D4A3E] shadow-xs'
                              : 'text-slate-500'
                        }`}
                      >
                        {lockedOut ? <Lock className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
                {orderType === 'dinein' ? (
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                      {isTableLocked && <Lock className="w-3 h-3 text-amber-600" />}
                      <span>{t.tableNumLabel}:</span>
                    </span>
                    {isTableLocked ? (
                      <span className="font-mono-num text-xs font-bold text-[#0D4A3E] bg-[#E8F2EF] px-2.5 py-1 rounded-lg">
                        #{activeTableNum} ({isEn ? 'QR Locked' : 'ចាក់សោ QR'})
                      </span>
                    ) : (
                      <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar max-w-[70%]">
                        {Array.from({ length: Math.min(maxTableCount, 20) }, (_, idx) => idx + 1).map((tNo) => (
                          <button
                            key={`mob-t-${tNo}`}
                            type="button"
                            onClick={() => setSelectedTableNum(tNo)}
                            className={`min-w-[30px] h-7 px-2 rounded-lg text-[11px] font-bold font-mono-num shrink-0 transition-colors ${
                              selectedTableNum === tNo
                                ? 'bg-[#0D4A3E] text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {tNo}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLocationPickerState({ open: true, purpose: 'customer' })}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1 text-left rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#0D4A3E] shrink-0" />
                      <span className="truncate font-semibold text-slate-800">{pickedAddressName}</span>
                    </span>
                    <span className="text-[11px] font-bold font-mono-num text-[#0D4A3E] shrink-0">
                      {estimatedDeliveryFee === 0
                        ? isEn
                          ? 'Free'
                          : 'ដឹកហ្វ្រី'
                        : `$${estimatedDeliveryFee.toFixed(2)}`}
                    </span>
                  </button>
                )}
              </section>

              <section id="menu-section" className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start pt-1">
                <div className="lg:col-span-8 xl:col-span-9 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <h2 className="font-bold text-slate-900 text-base sm:text-xl">{t.menuHeading}</h2>
                      <span className="text-xs text-slate-500 font-mono-num">
                        {filteredMenu.length} {t.itemsCountUnit}
                      </span>
                    </div>

                    <div className="flex gap-1.5 overflow-x-auto hide-scrollbar pb-1 max-w-full">
                      {categories.map((cat) => {
                        const active = selectedCategory === cat;
                        return (
                          <motion.button
                            key={cat}
                            type="button"
                            whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                            whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
                            onClick={() => setSelectedCategory(cat)}
                            className={`relative px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 shrink-0 ${
                              active
                                ? 'text-white'
                                : 'bg-white text-slate-600 border border-slate-200 hover:border-[#0D4A3E]/40 hover:text-slate-900'
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="activeCategoryTab"
                                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                                className="absolute inset-0 bg-[#0D4A3E] rounded-xl -z-0 shadow-sm"
                              />
                            )}
                            <span className="relative z-10 flex items-center gap-1.5">
                              {getCategoryIcon(cat)}
                              <span>
                                {cat === 'All' ? (isEn ? 'All' : 'ទាំងអស់') : getMenuCategoryLabel(cat, lang)}
                              </span>
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {!filteredMenu.length ? (
                    <div className="bg-white rounded-3xl border border-slate-200 py-14 text-center text-slate-400 text-sm">
                      {t.noSearchResults}
                    </div>
                  ) : (
                    <motion.div
                      layout={!shouldReduceMotion}
                      className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5"
                    >
                      <AnimatePresence mode="popLayout">
                        {filteredMenu.map((item, idx) => {
                          const finalPrice = getDiscountedPrice(item);
                          const hasDisc = item.discount > 0;
                          const displayName = getMenuName(item, lang);
                          const displayDesc = getMenuDesc(item, lang);
                          const catLabel = getMenuCategoryLabel(item.category, lang, item.categoryEn);
                          const inStock = isItemInStock(item);
                          const inCartQty =
                            (cartQtyByItemName.get(item.name) || 0) +
                            (item.nameEn && item.nameEn !== item.name ? cartQtyByItemName.get(item.nameEn) || 0 : 0);
                          return (
                            <motion.article
                              key={item.id}
                              layout={!shouldReduceMotion}
                              initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.24, delay: Math.min(idx * 0.025, 0.2) }}
                              whileHover={shouldReduceMotion || !inStock ? undefined : { y: -3 }}
                              whileTap={shouldReduceMotion || !inStock ? undefined : { scale: 0.98 }}
                              onClick={() => {
                                if (inStock) {
                                  setCustomizingItem(item);
                                } else {
                                  showToast(
                                    isEn
                                      ? 'Sorry, this item is currently sold out.'
                                      : 'សូមអភ័យទោស! មុខទំនិញនេះអស់ស្តុកបណ្តោះអាសន្ន។'
                                  );
                                }
                              }}
                              className={`group bg-white rounded-2xl p-2.5 sm:p-3.5 border border-slate-200/90 flex flex-col justify-between transition-all hover:shadow-md hover:border-[#0D4A3E]/30 ${
                                inStock ? 'cursor-pointer' : 'opacity-65'
                              }`}
                            >
                              <div>
                                <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 mb-2.5 sm:mb-3 relative">
                                  <img
                                    src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                                    alt={displayName}
                                    referrerPolicy="no-referrer"
                                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                                  />
                                  {!inStock && (
                                    <div className="absolute inset-0 bg-slate-900/55 flex items-center justify-center p-2">
                                      <span className="bg-red-600 text-white font-bold text-[11px] px-2.5 py-1 rounded-lg shadow">
                                        {t.outOfStock}
                                      </span>
                                    </div>
                                  )}
                                  {hasDisc && (
                                    <span className="absolute top-2 left-2 bg-amber-400 text-slate-900 font-bold font-mono-num text-[10px] px-2 py-0.5 rounded-lg shadow-sm inline-flex items-center gap-1">
                                      -{item.discount}%
                                    </span>
                                  )}
                                  {item.featured && !hasDisc && inStock && (
                                    <span className="absolute top-2 left-2 bg-[#0D4A3E]/90 text-amber-300 font-bold text-[10px] px-2 py-0.5 rounded-lg shadow-sm">
                                      {isEn ? 'Popular' : 'ពេញនិយម'}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                                  <span className="truncate">{catLabel}</span>
                                  {inStock && typeof item.stockQty === 'number' && item.stockQty > 0 && item.stockQty <= 5 && (
                                    <span className="text-amber-700 font-semibold font-mono-num shrink-0">
                                      · {isEn ? `${item.stockQty} left` : `នៅសល់ ${item.stockQty}`}
                                    </span>
                                  )}
                                  {!inStock && (
                                    <span className="text-red-600 font-semibold shrink-0">· {t.outOfStock}</span>
                                  )}
                                </p>
                                <h3 className="font-semibold text-xs sm:text-base text-slate-900 mt-0.5 line-clamp-1">
                                  {displayName}
                                </h3>
                                {displayDesc && (
                                  <p className="text-[10px] sm:text-xs text-slate-500 line-clamp-1 mt-0.5">
                                    {displayDesc}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center justify-between mt-2.5 sm:mt-3 pt-2 border-t border-slate-100">
                                <div className="font-mono-num">
                                  <span className="font-bold text-sm sm:text-base text-[#0D4A3E]">
                                    ${finalPrice.toFixed(2)}
                                  </span>
                                  {hasDisc && (
                                    <span className="text-[11px] sm:text-xs text-slate-400 line-through ml-1">
                                      ${Number(item.price).toFixed(2)}
                                    </span>
                                  )}
                                </div>
                                <motion.button
                                  type="button"
                                  whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}
                                  disabled={!inStock}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCustomizingItem(item);
                                  }}
                                  aria-label={`${isEn ? 'Order' : 'កម្ម៉ង់'} ${displayName}`}
                                  className={`min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl text-white flex items-center justify-center disabled:bg-slate-300 transition-all shadow-xs ${
                                    inCartQty > 0
                                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 px-2.5 gap-1 font-mono-num text-xs font-bold'
                                      : 'bg-[#0D4A3E] hover:bg-[#09352C]'
                                  }`}
                                >
                                  <Plus className="w-4 h-4 shrink-0" />
                                  {inCartQty > 0 && <span>{inCartQty}</span>}
                                </motion.button>
                              </div>
                            </motion.article>
                          );
                        })}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </div>

                {/* Desktop Sticky Order Bag Sidebar */}
                <aside className="hidden lg:flex lg:flex-col lg:col-span-4 xl:col-span-3 sticky top-24 bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
                  <div className="bg-[#0D4A3E] text-white px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <ShoppingBag className="w-4 h-4 text-amber-300" />
                      <h3 className="font-bold text-sm">{t.cartTitle}</h3>
                    </div>
                    <motion.span
                      key={cartCount}
                      initial={shouldReduceMotion ? false : { scale: 0.7 }}
                      animate={{ scale: 1 }}
                      className="bg-amber-400 text-slate-900 font-mono-num text-xs font-bold px-2 py-0.5 rounded-lg"
                    >
                      {cartCount}
                    </motion.span>
                  </div>

                  <div className="p-4 space-y-3.5">
                    {/* Order Mode Segmented Switch */}
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                      {(
                        [
                          { id: 'delivery' as const, label: t.deliveryTab, Icon: Bike },
                          { id: 'dinein' as const, label: t.dineInTab, Icon: Armchair },
                        ] as const
                      ).map(({ id, label, Icon }) => {
                        const active = orderType === id;
                        const lockedOut = isTableLocked && id === 'delivery';
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => handleRequestOrderTypeChange(id)}
                            className={`relative py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                              lockedOut
                                ? 'text-slate-400 cursor-not-allowed opacity-70'
                                : active
                                  ? 'text-[#0D4A3E]'
                                  : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="desktopOrderType"
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                className="absolute inset-0 bg-white rounded-lg shadow-sm"
                              />
                            )}
                            <span className="relative z-10 flex items-center gap-1.5">
                              {lockedOut ? <Lock className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                              <span>{label}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <AnimatePresence mode="wait">
                      {orderType === 'delivery' ? (
                        <motion.button
                          key="sidebar-delivery"
                          type="button"
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={shouldReduceMotion ? undefined : { opacity: 0, y: -6 }}
                          transition={{ duration: 0.18 }}
                          onClick={() => setLocationPickerState({ open: true, purpose: 'customer' })}
                          className="w-full text-left bg-[#F4F8F6] hover:bg-[#E8F2EF] border border-emerald-900/10 rounded-xl px-3 py-2.5 flex items-center gap-2 transition-colors"
                        >
                          <MapPin className="w-4 h-4 text-[#0D4A3E] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-[#0D4A3E] truncate">{pickedAddressName}</p>
                            <p className="text-[10px] text-slate-500 font-mono-num">
                              {distanceKm.toFixed(2)} km ·{' '}
                              {estimatedDeliveryFee === 0
                                ? isEn
                                  ? 'Free delivery'
                                  : 'ដឹកជញ្ជូនហ្វ្រី'
                                : `$${estimatedDeliveryFee.toFixed(2)}`}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </motion.button>
                      ) : (
                        <motion.div
                          key="sidebar-dinein"
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={shouldReduceMotion ? undefined : { opacity: 0, y: -6 }}
                          transition={{ duration: 0.18 }}
                          className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-bold text-amber-950">
                            <span className="flex items-center gap-1.5">
                              {isTableLocked && <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />}
                              <span>{t.dineInLabel}</span>
                            </span>
                            <span className="font-mono-num bg-white border border-amber-200 px-2 py-0.5 rounded-lg text-[#0D4A3E]">
                              {t.tableNumLabel} {activeTableNum}
                            </span>
                          </div>
                          {isTableLocked ? (
                            <p className="text-[10px] font-semibold text-amber-800">
                              {isEn
                                ? 'Scanned Table QR — table & dine-in mode locked.'
                                : 'ស្កេនពី QR តុ — ចាក់សោលេខតុ & ញ៉ាំនៅហាងតែប៉ុណ្ណោះ។'}
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold text-amber-900">
                                  {isEn ? 'Select Table:' : 'ជ្រើសរើសលេខតុ៖'}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTableNum((n) => Math.max(1, n - 1))}
                                    aria-label={isEn ? 'Previous table' : 'បន្ថយលេខតុ'}
                                    className="w-6 h-6 rounded-md bg-white border border-amber-200 hover:bg-amber-100 flex items-center justify-center text-amber-900"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <input
                                    type="number"
                                    min={1}
                                    max={maxTableCount}
                                    value={selectedTableNum}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      if (Number.isFinite(v)) {
                                        setSelectedTableNum(Math.min(maxTableCount, Math.max(1, v)));
                                      }
                                    }}
                                    className="w-11 text-center bg-white border border-amber-200 rounded-md py-0.5 text-xs font-bold font-mono-num text-[#0D4A3E]"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTableNum((n) => Math.min(maxTableCount, n + 1))}
                                    aria-label={isEn ? 'Next table' : 'បន្ថែមលេខតុ'}
                                    className="w-6 h-6 rounded-md bg-white border border-amber-200 hover:bg-amber-100 flex items-center justify-center text-amber-900"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                                {Array.from({ length: maxTableCount }, (_, idx) => idx + 1).map((tNo) => (
                                  <button
                                    key={`sb-t-${tNo}`}
                                    type="button"
                                    onClick={() => setSelectedTableNum(tNo)}
                                    className={`min-w-[28px] h-6 px-1.5 rounded-md text-[11px] font-bold font-mono-num transition-colors ${
                                      selectedTableNum === tNo
                                        ? 'bg-[#0D4A3E] text-white shadow-xs'
                                        : 'bg-white border border-amber-200/80 text-amber-950 hover:bg-amber-100'
                                    }`}
                                  >
                                    {tNo}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Items List or Empty State */}
                    {cart.length === 0 ? (
                      <div className="py-8 px-2 text-center space-y-2 border-t border-slate-100">
                        <div className="w-11 h-11 rounded-2xl bg-[#E8F2EF] text-[#0D4A3E] flex items-center justify-center mx-auto">
                          <Coffee className="w-5 h-5" />
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">{t.emptyCartHint}</p>
                        <p className="text-[11px] font-semibold text-[#0D4A3E]">{promoSummaryText}</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-0.5 border-t border-slate-100 pt-3">
                        <AnimatePresence initial={false}>
                          {cart.map((item, idx) => (
                            <motion.div
                              key={item.cartId}
                              initial={shouldReduceMotion ? false : { opacity: 0, x: 12 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={shouldReduceMotion ? undefined : { opacity: 0, x: -12 }}
                              transition={{ duration: 0.2 }}
                              className="bg-slate-50 rounded-xl p-2.5 flex items-center justify-between gap-2"
                            >
                              <img
                                src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                                className="w-10 h-10 rounded-lg object-cover shrink-0 bg-white"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-xs text-slate-900 truncate">{item.name}</p>
                                <p className="text-[10px] text-slate-500 truncate">{item.options}</p>
                                <p className="text-[11px] font-bold font-mono-num text-[#0D4A3E] mt-0.5">
                                  ${(item.unitPrice * item.qty).toFixed(2)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleChangeCartQty(idx, -1)}
                                  aria-label={isEn ? 'Decrease' : 'បន្ថយ'}
                                  className="w-6 h-6 rounded-md bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="text-xs font-bold font-mono-num w-4 text-center">{item.qty}</span>
                                <button
                                  type="button"
                                  onClick={() => handleChangeCartQty(idx, 1)}
                                  aria-label={isEn ? 'Increase' : 'បន្ថែម'}
                                  className="w-6 h-6 rounded-md bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    )}

                    {cart.length > 0 && (
                      <div className="border-t border-slate-200 pt-3 space-y-3">
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between text-slate-600">
                            <span>{t.subtotalLabel}</span>
                            <span className="font-mono-num font-semibold">${cartSubtotal.toFixed(2)}</span>
                          </div>
                          {orderType === 'delivery' && (
                            <div className="flex justify-between text-slate-600">
                              <span>{isEn ? 'Delivery' : 'ថ្លៃដឹកជញ្ជូន'}</span>
                              <span className="font-mono-num font-semibold text-[#0D4A3E]">
                                {estimatedDeliveryFee === 0
                                  ? isEn
                                    ? 'Free'
                                    : 'ហ្វ្រី'
                                  : `$${estimatedDeliveryFee.toFixed(2)}`}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between text-sm font-bold text-slate-900 pt-1">
                            <span>{isEn ? 'Estimated Total' : 'សរុបប៉ាន់ស្មាន'}</span>
                            <span className="font-mono-num text-[#0D4A3E]">
                              ${(cartSubtotal + estimatedDeliveryFee).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <motion.button
                          type="button"
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                          onClick={() => setIsCartOpen(true)}
                          className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                        >
                          <span>{t.proceedCheckout}</span>
                          <ArrowRight className="w-4 h-4" />
                        </motion.button>
                      </div>
                    )}
                  </div>
                </aside>
              </section>

              {/* Customer Ratings & Reviews Section */}
              <section id="reviews-section" className="pt-2">
                <div className="bg-white border border-slate-200/90 rounded-2xl sm:rounded-3xl p-4 sm:p-7 space-y-5 shadow-xs">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                      <div className="flex items-center gap-3.5">
                        <div className="bg-[#E8F2EF] text-[#0D4A3E] rounded-2xl px-4 py-3 text-center shrink-0">
                          <p className="text-2xl sm:text-3xl font-bold font-mono-num leading-none">
                            {allCustomerReviews.length > 0 ? averageShopRating.toFixed(1) : '5.0'}
                          </p>
                          <div className="flex items-center justify-center gap-0.5 mt-1.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`w-3.5 h-3.5 ${
                                  s <= Math.round(allCustomerReviews.length > 0 ? averageShopRating : 5)
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <h2 className="font-bold text-slate-900 text-base sm:text-xl">
                            {isEn ? 'Customer Ratings & Reviews' : 'ការវាយតម្លៃ & មតិអតិថិជន'}
                          </h2>
                          <p className="text-xs text-slate-500 font-mono-num">
                            {allCustomerReviews.length > 0
                              ? isEn
                                ? `Based on ${allCustomerReviews.length} customer reviews`
                                : `ផ្អែកលើការវាយតម្លៃសរុប ${allCustomerReviews.length} នាក់`
                              : isEn
                                ? 'Be the first to share your experience!'
                                : 'សូមចូលរួមវាយតម្លៃបទពិសោធន៍របស់អ្នកជាមួយហាងយើង!'}
                          </p>
                        </div>
                      </div>

                      {allCustomerReviews.length > 0 && (
                        <div className="hidden sm:grid grid-cols-1 gap-1 min-w-[180px]">
                          {ratingBreakdown.map((row) => (
                            <div key={row.star} className="flex items-center gap-2 text-[11px] font-mono-num">
                              <span className="w-6 text-slate-600 font-semibold text-right">{row.star}★</span>
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-400 rounded-full transition-all"
                                  style={{ width: `${row.percent}%` }}
                                />
                              </div>
                              <span className="w-6 text-slate-400 text-right">{row.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const shareUrl = `${window.location.origin}/?shop=suan#reviews-section`;
                          if (navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(shareUrl).catch(() => {});
                          }
                          showToast(
                            isEn
                              ? 'Shop & Reviews link copied!'
                              : 'បានចម្លង Link ហាង & ការវាយតម្លៃរួចរាល់!'
                          );
                        }}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs px-3.5 py-3 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5 text-[#0D4A3E]" />
                        <span>{isEn ? 'Copy Link' : 'ចម្លង Link'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsReviewFormOpen((v) => !v)}
                        className="bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold text-xs px-4 py-3 rounded-xl inline-flex items-center justify-center gap-2 transition-colors shrink-0 shadow-xs"
                      >
                        <MessageSquare className="w-4 h-4 text-amber-300" />
                        <span>
                          {isReviewFormOpen
                            ? isEn
                              ? 'Close Form'
                              : 'បិទទម្រង់វាយតម្លៃ'
                            : isEn
                              ? 'Write a Review'
                              : 'សរសេរការវាយតម្លៃ'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isReviewFormOpen && (
                      <motion.form
                        initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (submittingReview) return;
                          setSubmittingReview(true);
                          try {
                            const ok = await handleSubmitShopReview({
                              rating: reviewRating,
                              comment: reviewComment,
                              customerName: reviewName,
                              tags: reviewTags,
                            });
                            if (ok) {
                              setReviewComment('');
                              setReviewTags([]);
                              setReviewRating(5);
                              setIsReviewFormOpen(false);
                            }
                          } finally {
                            setSubmittingReview(false);
                          }
                        }}
                        className="bg-[#F6F8F7] border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-slate-900">
                              {isEn ? 'How was your experience?' : 'តើអ្នកពេញចិត្តកម្រិតណាដែរ?'}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {reviewRating === 5
                                ? isEn
                                  ? 'Excellent!'
                                  : 'ល្អឥតខ្ចោះ! (5/5)'
                                : reviewRating === 4
                                  ? isEn
                                    ? 'Very Good'
                                    : 'ល្អណាស់ (4/5)'
                                  : reviewRating === 3
                                    ? isEn
                                      ? 'Good'
                                      : 'ល្អ (3/5)'
                                    : reviewRating === 2
                                      ? isEn
                                        ? 'Fair'
                                        : 'មធ្យម (2/5)'
                                      : isEn
                                        ? 'Needs Improvement'
                                        : 'គួរកែលម្អ (1/5)'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setReviewRating(star)}
                                aria-label={`${star} stars`}
                                className="p-1.5 rounded-lg hover:bg-white transition-transform hover:scale-110"
                              >
                                <Star
                                  className={`w-6 h-6 ${
                                    star <= reviewRating
                                      ? 'fill-amber-400 text-amber-400'
                                      : 'text-slate-300'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-[11px] font-semibold text-slate-600">
                            {isEn ? 'Quick Highlights (Optional):' : 'ចំណុចដែលអ្នកពេញចិត្ត (ចុចរើសបាន)៖'}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(isEn
                              ? ['Great Coffee', 'Fast Service', 'Friendly Staff', 'Clean & Cozy']
                              : ['កាហ្វេឆ្ងាញ់', 'សេវាកម្មរហ័ស', 'បុគ្គលិករួសរាយ', 'ហាងស្អាត']
                            ).map((tagLabel) => {
                              const active = reviewTags.includes(tagLabel);
                              return (
                                <button
                                  key={tagLabel}
                                  type="button"
                                  onClick={() =>
                                    setReviewTags((prev) =>
                                      prev.includes(tagLabel)
                                        ? prev.filter((x) => x !== tagLabel)
                                        : [...prev, tagLabel]
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 border transition-colors ${
                                    active
                                      ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                                      : 'bg-white text-slate-600 border-slate-200 hover:border-[#0D4A3E]/40'
                                  }`}
                                >
                                  {active && <Check className="w-3 h-3" />}
                                  <span>{tagLabel}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-3">
                          <input
                            type="text"
                            maxLength={60}
                            value={reviewName}
                            onChange={(e) => setReviewName(e.target.value)}
                            placeholder={isEn ? 'Your name (optional)' : 'ឈ្មោះរបស់អ្នក (មិនបាច់ដាក់ក៏បាន)'}
                            className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-base sm:text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0D4A3E]"
                          />
                          <input
                            type="text"
                            maxLength={500}
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder={
                              isEn
                                ? 'Share a short comment about drinks or service...'
                                : 'សរសេរមតិយោបល់អំពីរសជាតិ ឬសេវាកម្ម...'
                            }
                            className="sm:col-span-2 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-base sm:text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0D4A3E]"
                          />
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setIsReviewFormOpen(false)}
                            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors"
                          >
                            {isEn ? 'Cancel' : 'បោះបង់'}
                          </button>
                          <button
                            type="submit"
                            disabled={submittingReview}
                            className="bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold px-5 py-2 rounded-xl text-xs disabled:opacity-50 transition-colors"
                          >
                            {submittingReview
                              ? isEn
                                ? 'Submitting...'
                                : 'កំពុងផ្ញើ...'
                              : isEn
                                ? 'Submit Review'
                                : 'ផ្ញើការវាយតម្លៃ'}
                          </button>
                        </div>
                      </motion.form>
                    )}
                  </AnimatePresence>

                  {allCustomerReviews.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 space-y-1">
                      <p>
                        {isEn
                          ? 'No customer reviews yet. Tap "Write a Review" above to share your thoughts!'
                          : 'មិនទាន់មានការវាយតម្លៃនៅឡើយទេ — ចុចប៊ូតុង «សរសេរការវាយតម្លៃ» ខាងលើដើម្បីផ្តល់ពិន្ទុដំបូង!'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                        {(showAllReviews ? allCustomerReviews : allCustomerReviews.slice(0, 6)).map(
                          (rev) => (
                            <article
                              key={rev.id}
                              className="bg-[#F9FBFA] border border-slate-200/80 rounded-2xl p-4 flex flex-col justify-between gap-2.5"
                            >
                              <div className="space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-bold text-xs text-slate-900 truncate">
                                      {rev.customerName || (isEn ? 'Customer' : 'អតិថិជន')}
                                    </p>
                                    <p className="text-[11px] text-slate-400 font-mono-num">
                                      {new Date(rev.submittedAt).toLocaleDateString()}
                                      {rev.orderId
                                        ? ` · ${isEn ? 'Verified Order' : 'អតិថិជនបានកម្ម៉ង់'}`
                                        : ''}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                      <Star
                                        key={s}
                                        className={`w-3.5 h-3.5 ${
                                          s <= rev.rating
                                            ? 'fill-amber-400 text-amber-400'
                                            : 'text-slate-200'
                                        }`}
                                      />
                                    ))}
                                  </div>
                                </div>

                                {rev.tags && rev.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {rev.tags.map((tg) => (
                                      <span
                                        key={tg}
                                        className="bg-white border border-slate-200 text-slate-600 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                                      >
                                        {tg}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {rev.comment && (
                                  <p className="text-xs text-slate-700 leading-relaxed">{rev.comment}</p>
                                )}
                              </div>
                            </article>
                          )
                        )}
                      </div>
                      {allCustomerReviews.length > 6 && (
                        <div className="text-center pt-1">
                          <button
                            type="button"
                            onClick={() => setShowAllReviews((v) => !v)}
                            className="text-xs font-bold text-[#0D4A3E] hover:underline"
                          >
                            {showAllReviews
                              ? isEn
                                ? 'Show Fewer Reviews'
                                : 'បង្ហាញតិចជាងនេះ'
                              : isEn
                                ? `View All ${allCustomerReviews.length} Reviews`
                                : `មើលការវាយតម្លៃទាំង ${allCustomerReviews.length}`}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            </main>
          </div>

          <motion.footer
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.35 }}
            className="max-w-7xl mx-auto w-full px-3 sm:px-6 mt-10 pt-6 border-t border-slate-200 space-y-4"
          >
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
              <div className="space-y-0.5">
                <p className="font-bold text-sm text-[#0D4A3E]">
                  {t.connectWithShop} {shopSettings.brandTitle}
                </p>
                <p className="text-xs text-slate-500">{t.followPromo}</p>
              </div>
              <SocialLinksBar lang={lang} shopSettings={shopSettings} variant="footer" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-1">
              <span>{shopSettings.brandTitle}</span>
              <span>{t.footerSecurity}</span>
            </div>
          </motion.footer>

          {/* Mobile Floating Cart Bar (Hidden on Desktop where sticky sidebar is visible) */}
          <AnimatePresence>
            {cartCount > 0 && (
              <motion.button
                type="button"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                transition={{ type: 'spring', damping: 24, stiffness: 320 }}
                onClick={() => setIsCartOpen(true)}
                className="lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 w-[92%] max-w-md bg-[#0D4A3E] hover:bg-[#09352C] text-white px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between z-40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-white/15 p-2 rounded-xl relative">
                    <ShoppingBag className="w-5 h-5" />
                    <motion.span
                      key={cartCount}
                      initial={{ scale: 0.6 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1.5 -right-1.5 bg-amber-400 text-slate-900 font-mono-num text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-full"
                    >
                      {cartCount}
                    </motion.span>
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] text-emerald-200">{t.cartTitle}</p>
                    <p className="font-bold font-mono-num text-sm">${cartSubtotal.toFixed(2)}</p>
                  </div>
                </div>
                <span className="bg-white text-[#0D4A3E] font-bold text-xs px-3.5 py-2 rounded-xl">
                  {t.orderNow}
                </span>
              </motion.button>
            )}
          </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AuthModal
        lang={lang}
        isOpen={isAuthOpen}
        onClose={() => {
          setIsAuthOpen(false);
          setAuthPrefillPhone('');
        }}
        currentMember={currentMember}
        authToken={authToken}
        shopSettings={shopSettings}
        orders={orders}
        myOrderIds={myOrderIds}
        prefillPhone={authPrefillPhone}
        onAuthenticated={handleAuthenticated}
        onLogout={handleLogout}
        onReorder={handleReorder}
        onSubmitFeedback={handleSubmitOrderFeedback}
        onRefreshOrders={fetchOrdersFromSources}
        onOpenLiveTrack={(orderId) => {
          setIsAuthOpen(false);
          setLiveTrackOrderId(orderId);
        }}
        onToast={showToast}
      />

      <AdminPinModal
        lang={lang}
        isOpen={isPinOpen}
        onClose={() => setIsPinOpen(false)}
        onSuccess={(token) => {
          setIsPinOpen(false);
          setAdminToken(token);
          safeSessionSet('cafe_admin_token', token);
          setViewMode('admin');
        }}
      />

      <LocationPickerModal
        lang={lang}
        isOpen={locationPickerState.open}
        purpose={locationPickerState.purpose}
        shopSettings={shopSettings}
        initialCoords={selectedCoords}
        initialAddress={pickedAddressName}
        cartSubtotal={cartSubtotal}
        onClose={() => setLocationPickerState((s) => ({ ...s, open: false }))}
        onConfirmCustomer={(coords, addr) => {
          setSelectedCoords(coords);
          setPickedAddressName(addr);
        }}
        onConfirmShop={(coords) => {
          const next = { ...shopSettings, lat: coords.lat, lng: coords.lng };
          setShopSettings(next);
          syncShopEverywhere(menuItems, toppings, next);
          showToast(isEn ? 'Shop location updated!' : 'បានកំណត់ទីតាំងហាងរួចរាល់!');
        }}
        onToast={showToast}
      />

      <ItemCustomizerModal
        lang={lang}
        item={customizingItem}
        toppings={toppings}
        onClose={() => setCustomizingItem(null)}
        onAddToCart={handleAddToCart}
      />

      <CartModal
        lang={lang}
        isOpen={isCartOpen}
        cart={cart}
        orderType={orderType}
        shopSettings={shopSettings}
        currentMember={currentMember}
        pickedAddressName={pickedAddressName}
        selectedCoords={selectedCoords}
        distanceKm={distanceKm}
        initialTableNum={activeTableNum}
        isTableLocked={isTableLocked}
        maxTableCount={maxTableCount}
        isShopOpenEffective={shopScheduleStatus.isOpen}
        shopClosedMessage={shopClosedMessage}
        onOpenAuth={() => {
          setIsCartOpen(false);
          setIsAuthOpen(true);
        }}
        onChangeTableNum={(n) => {
          if (!isTableLocked) {
            setSelectedTableNum(Math.min(maxTableCount, Math.max(1, n)));
          }
        }}
        onClose={() => setIsCartOpen(false)}
        onChangeOrderType={handleRequestOrderTypeChange}
        onChangeQty={handleChangeCartQty}
        onOpenLocationPicker={() => {
          if (isTableLocked) return;
          setLocationPickerState({ open: true, purpose: 'customer' });
        }}
        onSubmitOrder={handleSubmitOrder}
        onToast={showToast}
      />

      <ReceiptModal
        lang={lang}
        order={receiptState.order}
        tgUrl={receiptState.tgUrl}
        shopSettings={shopSettings}
        onSubmitFeedback={handleSubmitOrderFeedback}
        onToast={showToast}
        onClose={() => {
          safeSessionDel('cafe_last_receipt_id_v15');
          setReceiptState({ order: null, tgUrl: '' });
        }}
        onOpenLiveTrack={(id) => {
          safeSessionDel('cafe_last_receipt_id_v15');
          setReceiptState({ order: null, tgUrl: '' });
          setLiveTrackOrderId(id);
        }}
      />

      <OrderTrackerModal
        lang={lang}
        isOpen={isTrackerOpen}
        orders={orders}
        onClose={() => setIsTrackerOpen(false)}
        onSelectOrder={(ord) => {
          setIsTrackerOpen(false);
          setReceiptState({ order: ord, tgUrl: '' });
        }}
        onOpenLiveTrack={(id) => {
          setIsTrackerOpen(false);
          setLiveTrackOrderId(id);
        }}
      />

      <LiveTrackModal
        lang={lang}
        order={liveTrackOrder}
        shopSettings={shopSettings}
        onClose={() => setLiveTrackOrderId(null)}
        onUpdateCustomerCoords={handleUpdateCustomerCoords}
        onToast={showToast}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  Coffee,
  Croissant,
  CupSoda,
  Globe,
  LayoutGrid,
  Leaf,
  MapPin,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  User,
  UtensilsCrossed,
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
  ShopSettings,
  Topping,
} from './types';
import {
  CAFE_ASSETS,
  DEFAULT_MENU,
  DEFAULT_SETTINGS,
  DEFAULT_TOPPINGS,
  fetchWithTimeout,
  getDiscountedPrice,
  getDistanceKm,
  getFirebaseBase,
  handleImgFallback,
  normalizeMenuItems,
  normalizeOrders,
  normalizeShopSettings,
  normalizeToppings,
  playDingSound,
  resolveAssetUrl,
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
} from './utils/i18n';
import { CoffeeCupSteamIllustration, DeliveryRiderIllustration } from './components/AnimatedIllustrations';
import { AuthModal } from './components/AuthModal';
import { LocationPickerModal } from './components/LocationPickerModal';
import { ItemCustomizerModal } from './components/ItemCustomizerModal';
import { CartModal } from './components/CartModal';
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
  const [members, setMembers] = useState<Member[]>(() => {
    const stored = safeGet<Member[]>('cafe_members_v15', []);
    return Array.isArray(stored) ? stored : [];
  });
  const [currentMember, setCurrentMember] = useState<Member | null>(() =>
    safeGet<Member | null>('cafe_current_member_v15', null)
  );
  const [authToken, setAuthToken] = useState<string | null>(() => safeSessionGet('cafe_auth_token'));
  const [adminToken, setAdminToken] = useState<string | null>(() => safeSessionGet('cafe_admin_token'));
  const isAdminUnlocked = Boolean(adminToken);

  const [viewMode, setViewMode] = useState<'customer' | 'admin' | 'driver'>(() =>
    safeSessionGet('cafe_admin_token') ? 'admin' : 'customer'
  );
  const [activeDriverOrderId, setActiveDriverOrderId] = useState<string | null>(null);
  const [liveTrackOrderId, setLiveTrackOrderId] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [tableNumberFromQR, setTableNumberFromQR] = useState<number | null>(null);

  const [selectedCoords, setSelectedCoords] = useState<Coords>({
    lat: shopSettings.lat,
    lng: shopSettings.lng,
  });
  const [pickedAddressName, setPickedAddressName] = useState(() =>
    lang === 'en' ? 'Phnom Penh · Tap to pick location' : 'ភ្នំពេញ · ចុចរើសទីតាំង'
  );

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isPinOpen, setIsPinOpen] = useState(false);
  const [locationPickerState, setLocationPickerState] = useState<{
    open: boolean;
    purpose: 'customer' | 'shop';
  }>({ open: false, purpose: 'customer' });
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [receiptState, setReceiptState] = useState<{ order: Order | null; tgUrl: string }>({
    order: null,
    tgUrl: '',
  });

  const [lastOrderCountState] = useState(0);
  void lastOrderCountState;
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [serverPersistent, setServerPersistent] = useState(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOrderCountRef = useRef(orders.length);
  const isFetchingOrdersRef = useRef(false);
  const isFetchingShopRef = useRef(false);
  const clearingOrdersRef = useRef(false);
  const lastOrdersSigRef = useRef('');
  const lastShopSigRef = useRef('');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (cart.length === 0 && isCartOpen) {
      setIsCartOpen(false);
    }
  }, [cart.length, isCartOpen]);

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
    document.title = shopSettings.brandTitle || 'Emerald Brew Cafe';
  }, [shopSettings]);
  useEffect(() => {
    safeSet('cafe_orders_v15', orders);
  }, [orders]);
  useEffect(() => {
    safeSet('cafe_members_v15', members);
  }, [members]);
  useEffect(() => {
    safeSet('cafe_current_member_v15', currentMember);
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
    async (order: Order) => {
      try {
        await fetchWithTimeout(
          '/api/orders',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order),
          },
          10000
        );
      } catch {
        // ignore
      }
      const b = getFirebaseBase(shopSettings.firebaseUrl);
      if (b) {
        try {
          await fetchWithTimeout(
            `${b}/orders/${encodeURIComponent(order.id)}.json`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(order),
            },
            8000
          );
        } catch {
          // ignore
        }
      }
    },
    [shopSettings.firebaseUrl]
  );

  const applyFetchedOrders = useCallback(
    (incoming: Order[]) => {
      const sorted = [...incoming].sort((a, b2) => (b2.createdAt || 0) - (a.createdAt || 0));
      const sig = sorted
        .map(
          (o) =>
            `${o.id}:${o.status}:${o.driverCoords?.lat ?? ''},${o.driverCoords?.lng ?? ''}:${o.customer?.coords?.lat ?? ''},${o.customer?.coords?.lng ?? ''}:${o.driverInfo?.name ?? ''}:${o.driverInfo?.phone ?? ''}:${o.driverInfo?.arrivedAt ?? ''}:${o.feedback?.rating ?? ''}:${o.feedback?.submittedAt ?? ''}`
        )
        .join('|');
      if (sorted.length > lastOrderCountRef.current && isAdminUnlocked) {
        playDingSound();
        showToast(isEn ? '🔔 New order received!' : '🔔 មានការកម្ម៉ង់ថ្មីចូល!');
      }
      lastOrderCountRef.current = sorted.length;
      if (sig !== lastOrdersSigRef.current) {
        lastOrdersSigRef.current = sig;
        setOrders(sorted);
      }
    },
    [isAdminUnlocked, isEn, showToast]
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
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.ok && data.member) setCurrentMember(data.member);
          else {
            setAuthToken(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdminUnlocked && !liveTrackOrderId && viewMode !== 'driver') return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        fetchOrdersFromSources();
      }
    }, 3500);
    return () => clearInterval(timer);
  }, [isAdminUnlocked, liveTrackOrderId, viewMode, fetchOrdersFromSources]);

  useEffect(() => {
    if (viewMode !== 'customer') return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        fetchShopFromSources();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [viewMode, fetchShopFromSources]);

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
    safeSessionDel('cafe_auth_token');
    setIsAuthOpen(false);
    showToast('បានចាកចេញពីគណនីដោយសុវត្ថិភាព');
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

  const featuredMenu = useMemo(() => menuItems.filter((i) => i.featured && i.available), [menuItems]);

  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.qty, 0), [cart]);
  const distanceKm = useMemo(
    () => getDistanceKm(shopSettings.lat, shopSettings.lng, selectedCoords.lat, selectedCoords.lng),
    [shopSettings.lat, shopSettings.lng, selectedCoords.lat, selectedCoords.lng]
  );

  const activeLiveOrder = useMemo(
    () =>
      orders.find(
        (o) => o.type === 'delivery' && (o.status === 'Ready' || o.driverCoords) && o.status !== 'Completed'
      ),
    [orders]
  );
  const liveTrackOrder = useMemo(
    () => orders.find((o) => o.id === liveTrackOrderId) || null,
    [orders, liveTrackOrderId]
  );
  const activeDriverOrder = useMemo(
    () => orders.find((o) => o.id === activeDriverOrderId) || null,
    [orders, activeDriverOrderId]
  );

  const handleAddToCart = (payload: {
    name: string;
    img: string;
    qty: number;
    unitPrice: number;
    options: string;
  }) => {
    setCart((prev) => [...prev, { cartId: Date.now() + Math.random(), ...payload }]);
    showToast('បានដាក់ចូលកន្ត្រកហើយ!');
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
    fee: number;
    subtotal: number;
    grandTotal: number;
    customer: Order['customer'];
  }) => {
    const earnedPoints = cart.reduce((s, i) => s + i.qty, 0);
    if (currentMember) {
      handleAuthenticated(
        { ...currentMember, points: (currentMember.points || 0) + earnedPoints },
        authToken
      );
    }

    const customerPayload: Order['customer'] = currentMember
      ? { ...payload.customer, memberId: currentMember.id }
      : payload.customer;

    const newOrder: Order = {
      id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: Date.now(),
      timestamp: new Date().toLocaleTimeString('km-KH', { hour: '2-digit', minute: '2-digit' }),
      type: orderType,
      items: [...cart],
      payment: payload.payment,
      subtotal: payload.subtotal,
      promoDisc: payload.promoDisc,
      fee: payload.fee,
      grandTotal: payload.grandTotal,
      customer: customerPayload,
      driverCoords: null,
      status: 'Pending',
    };

    setOrders((prev) => [newOrder, ...prev]);
    lastOrderCountRef.current += 1;
    setCart([]);
    setIsCartOpen(false);

    await syncOrderEverywhere(newOrder);

    const itemsTxt = newOrder.items
      .map((i) => `• ${i.qty}x ${i.name} (${i.options}) = $${(i.unitPrice * i.qty).toFixed(2)}`)
      .join('\n');
    const locTxt =
      newOrder.type === 'dinein'
        ? `🪑 តុលេខ ${newOrder.customer.tableNum}`
        : `📍 ${newOrder.customer.addressName}${
            newOrder.customer.coords
              ? `\n🗺 https://maps.google.com/?q=${newOrder.customer.coords.lat},${newOrder.customer.coords.lng}`
              : ''
          }`;
    const uname = (shopSettings.tgUsername || '').replace('@', '').trim();
    const tgUrl = uname
      ? `https://t.me/${uname}?text=${encodeURIComponent(
          `☕ កម្ម៉ង់ថ្មី ${newOrder.id}\n👤 ${newOrder.customer.name} (${newOrder.customer.phone || '-'})\n${locTxt}\n\n${itemsTxt}\n\n💵 សរុប៖ $${newOrder.grandTotal.toFixed(2)} (${newOrder.payment})`
        )}`
      : '';

    setReceiptState({ order: newOrder, tgUrl });
    if (payload.sendTg && tgUrl) {
      try {
        window.open(tgUrl, '_blank', 'noopener,noreferrer');
      } catch {
        // receipt modal already provides direct <a> fallback
      }
    }
  };

  const handleUpdateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updated = { ...o, status };
        syncOrderEverywhere(updated);
        return updated;
      })
    );
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
        setOrders((prev) =>
          prev.map((o) => {
            if (o.id !== orderId) return o;
            const updated: Order = {
              ...o,
              feedback: savedOrder?.feedback || localFeedback,
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
        showToast('✓ សូមអរគុណសម្រាប់ការវាយតម្លៃរបស់អ្នក!');
        return true;
      }
      const errData = await res.json().catch(() => null);
      if (res.status === 400) {
        showToast(errData?.error || 'អាចវាយតម្លៃបានតែការកម្ម៉ង់ដែលបានបញ្ចប់ប៉ុណ្ណោះ');
        return false;
      }
    } catch {
      // Fall back to local + Firebase sync if server unreachable
    }

    const target = orders.find((o) => o.id === orderId);
    if (!target || target.status !== 'Completed') {
      showToast('អាចវាយតម្លៃបានតែការកម្ម៉ង់ដែលបានបញ្ចប់ប៉ុណ្ណោះ');
      return false;
    }

    const updatedOrder: Order = { ...target, feedback: localFeedback };
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
    await syncOrderEverywhere(updatedOrder);
    showToast('✓ សូមអរគុណសម្រាប់ការវាយតម្លៃរបស់អ្នក!');
    return true;
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

      {viewMode === 'driver' && (
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
      )}

      {viewMode === 'admin' && (
        <AdminDashboard
          lang={lang}
          onChangeLang={setLang}
          adminToken={adminToken}
          serverPersistent={serverPersistent}
          menuItems={menuItems}
          toppings={toppings}
          orders={orders}
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
          onClearCompletedOrders={async () => {
            const completed = orders.filter((o) => o.status === 'Completed');
            const remaining = orders.filter((o) => o.status !== 'Completed');
            clearingOrdersRef.current = true;
            setOrders(remaining);
            lastOrderCountRef.current = remaining.length;
            try {
              if (adminToken && completed.length > 0) {
                await Promise.allSettled(
                  completed.map((o) =>
                    fetchWithTimeout(
                      `/api/orders/${encodeURIComponent(o.id)}`,
                      {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${adminToken}` },
                      },
                      8000
                    )
                  )
                );
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
      )}

      {viewMode === 'customer' && (
        <div className="min-h-screen flex flex-col justify-between pb-24">
          <div>
            <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
              <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-6">
                <a
                  href="#top"
                  className="flex items-center gap-2 sm:gap-2.5 text-sm sm:text-lg font-bold tracking-tight text-[#0D4A3E] min-w-0 flex-1 sm:flex-initial"
                >
                  <img
                    src={resolveAssetUrl(shopSettings.logoImg, CAFE_ASSETS.logoEmblem)}
                    alt={shopSettings.brandTitle}
                    referrerPolicy="no-referrer"
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.logoEmblem)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border border-amber-400/70 bg-[#0D4A3E] shrink-0"
                  />
                  <span className="truncate">{shopSettings.brandTitle}</span>
                </a>

                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
                  <a
                    href="#menu-section"
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    {t.menuNav}
                  </a>
                  <button
                    type="button"
                    onClick={() => setIsTrackerOpen(true)}
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    {t.trackNav}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationPickerState({ open: true, purpose: 'customer' })}
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    {t.locationNav}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdminUnlocked) setViewMode('admin');
                      else setIsPinOpen(true);
                    }}
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
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
                    className="md:hidden h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 text-[#0D4A3E] bg-[#F4F8F6] hover:bg-[#E8F2EF]"
                  >
                    <ReceiptText className="w-4 h-4" />
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
            </header>

            <main id="top" className="max-w-7xl mx-auto px-3 sm:px-6 pt-3 sm:pt-5 space-y-4 sm:space-y-6">
              {shopSettings.isOpen === false && (
                <div className="bg-red-600 text-white px-4 py-3 rounded-2xl text-xs font-bold text-center">
                  {t.shopClosedBanner}
                </div>
              )}

              {tableNumberFromQR !== null && (
                <div className="bg-amber-400 text-slate-900 px-3.5 py-2.5 rounded-2xl text-xs flex items-center justify-between gap-2 font-bold">
                  <span>
                    🪑 {t.dineInLabel} · {t.tableNumLabel} {tableNumberFromQR}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTableNumberFromQR(null);
                      setOrderType('delivery');
                    }}
                    className="bg-slate-900 text-white px-3 py-1 rounded-lg text-[11px] shrink-0"
                  >
                    {t.switchToDelivery}
                  </button>
                </div>
              )}

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
                      {t.liveDriverBanner} ({activeLiveOrder.id})
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </motion.button>
              )}

              <section className="grid lg:grid-cols-12 gap-3.5 sm:gap-5 items-stretch">
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="lg:col-span-7 bg-[#0D4A3E] text-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 flex flex-col justify-between gap-3.5 sm:gap-5 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 sm:grid sm:grid-cols-12 sm:gap-4">
                    <div className="sm:col-span-8 space-y-1.5 sm:space-y-3 min-w-0">
                      <p className="text-[11px] sm:text-xs font-medium text-emerald-200 truncate flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            shopSettings.isOpen !== false ? 'bg-emerald-300 animate-pulse' : 'bg-red-400'
                          }`}
                        />
                        <span className="truncate">
                          {shopSettings.isOpen !== false ? t.openFastDelivery : t.closedTemp}
                          {shopSettings.promoCode && shopSettings.promoPercent > 0
                            ? ` · ${t.promoCodePrefix} ${shopSettings.promoCode} (-${shopSettings.promoPercent}%)`
                            : ''}
                        </span>
                      </p>
                      <h1 className="text-xl sm:text-4xl font-bold leading-tight text-balance">
                        {shopSettings.brandTitle}
                      </h1>
                      <p className="text-xs sm:text-sm text-emerald-100/90 max-w-xl line-clamp-2">
                        {shopSettings.shopName} · {promoSummaryText}
                      </p>
                      <SocialLinksBar lang={lang} shopSettings={shopSettings} variant="hero" />
                    </div>

                    <div className="sm:col-span-4 flex justify-center shrink-0">
                      <CoffeeCupSteamIllustration className="w-20 h-16 sm:w-44 sm:h-36" />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2.5 sm:gap-3 pt-1">
                    <motion.button
                      type="button"
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                      onClick={() => setLocationPickerState({ open: true, purpose: 'customer' })}
                      className="text-left bg-white/12 hover:bg-white/20 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl sm:rounded-2xl flex items-center gap-2.5 border border-white/15 transition-colors"
                    >
                      <div className="bg-amber-400 text-slate-900 p-1.5 sm:p-2 rounded-lg sm:rounded-xl shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] sm:text-[11px] text-emerald-200">
                          {tableNumberFromQR ? t.dineInLabel : t.deliverToMap}
                        </p>
                        <p className="text-xs font-bold truncate">
                          {tableNumberFromQR ? `${t.tableNumLabel} ${tableNumberFromQR}` : pickedAddressName}
                        </p>
                      </div>
                      <ChevronDown className="w-4 h-4 text-emerald-200 shrink-0" />
                    </motion.button>

                    <div className="relative flex items-center">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t.searchPlaceholder}
                        className="w-full h-full min-h-[44px] sm:min-h-[48px] bg-white text-slate-900 placeholder-slate-400 text-base sm:text-sm pl-10 pr-4 py-2 rounded-xl sm:rounded-2xl focus:outline-none"
                      />
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
                  transition={{ duration: 0.4, delay: 0.05 }}
                  className="lg:col-span-5 relative rounded-2xl sm:rounded-3xl overflow-hidden h-44 sm:h-60 lg:h-full lg:min-h-[280px] bg-slate-900"
                >
                  <img
                    src={resolveAssetUrl(shopSettings.bannerImg, CAFE_ASSETS.heroBanner)}
                    alt={shopSettings.brandTitle}
                    referrerPolicy="no-referrer"
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.heroBanner)}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-4 sm:p-6 flex flex-col justify-end">
                    <p className="text-[11px] sm:text-xs font-semibold text-amber-300 truncate">
                      {promoSummaryText}
                    </p>
                    <p className="text-white font-bold text-sm sm:text-lg mt-0.5 sm:mt-1 leading-snug">
                      {t.bannerSubline}
                    </p>
                  </div>
                </motion.div>
              </section>

              {featuredMenu.length > 0 && selectedCategory === 'All' && !searchQuery.trim() && (
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
                    <h2 className="font-bold text-slate-900 text-sm sm:text-base">{t.featuredHeading}</h2>
                  </div>
                  <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
                    {featuredMenu.map((item) => {
                      const fp = getDiscountedPrice(item);
                      const displayName = getMenuName(item, lang);
                      return (
                        <button
                          key={`feat-${item.id}`}
                          type="button"
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
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section id="menu-section" className="space-y-3 sm:space-y-4 pt-1 sm:pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
                  <div className="flex items-center gap-2.5 sm:gap-3">
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
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.93 }}
                          onClick={() => setSelectedCategory(cat)}
                          className={`relative px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                            active
                              ? 'text-white'
                              : 'bg-white text-slate-600 border border-slate-200 hover:border-[#0D4A3E]/40'
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
                            <span>{cat === 'All' ? (isEn ? 'All' : 'ទាំងអស់') : getMenuCategoryLabel(cat, lang)}</span>
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
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                    {filteredMenu.map((item, idx) => {
                      const finalPrice = getDiscountedPrice(item);
                      const hasDisc = item.discount > 0;
                      const displayName = getMenuName(item, lang);
                      const displayDesc = getMenuDesc(item, lang);
                      const catLabel = getMenuCategoryLabel(item.category, lang, item.categoryEn);
                      return (
                        <motion.article
                          key={item.id}
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.25) }}
                          whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                          whileTap={shouldReduceMotion || !item.available ? undefined : { scale: 0.965 }}
                          onClick={() => {
                            if (item.available) setCustomizingItem(item);
                          }}
                          className={`group bg-white rounded-2xl p-2.5 sm:p-3.5 border border-slate-200/90 flex flex-col justify-between transition-shadow hover:shadow-lg ${
                            item.available ? 'cursor-pointer' : 'opacity-60'
                          }`}
                        >
                          <div>
                            <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 mb-2.5 sm:mb-3 relative">
                              <img
                                src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                                alt={displayName}
                                referrerPolicy="no-referrer"
                                onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                              {hasDisc && (
                                <span className="absolute top-2 left-2 bg-amber-400 text-slate-900 font-bold font-mono-num text-[10px] px-2 py-0.5 rounded-lg shadow-sm inline-flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  -{item.discount}%
                                </span>
                              )}
                              {item.featured && !hasDisc && (
                                <span className="absolute top-2 left-2 bg-[#0D4A3E]/90 text-amber-300 font-bold text-[10px] px-2 py-0.5 rounded-lg shadow-sm inline-flex items-center gap-1">
                                  <Star className="w-2.5 h-2.5 fill-amber-300" />
                                  <span>{isEn ? 'Pick' : 'ពិសេស'}</span>
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] sm:text-[11px] text-slate-500 truncate flex items-center gap-1">
                              {item.type === 'food' ? (
                                <UtensilsCrossed className="w-3 h-3 text-amber-600 shrink-0" />
                              ) : (
                                <Coffee className="w-3 h-3 text-[#0D4A3E] shrink-0" />
                              )}
                              <span className="truncate">
                                {catLabel}
                                {!item.available ? ` · ${t.outOfStock}` : ''}
                              </span>
                            </p>
                            <h3 className="font-semibold text-xs sm:text-base text-slate-900 mt-0.5 line-clamp-1">
                              {displayName}
                            </h3>
                            {displayDesc && (
                              <p className="text-[10px] sm:text-[11px] text-slate-500 line-clamp-1 mt-0.5">
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
                              whileTap={shouldReduceMotion ? undefined : { scale: 0.88 }}
                              disabled={!item.available}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCustomizingItem(item);
                              }}
                              aria-label={`${isEn ? 'Order' : 'កម្ម៉ង់'} ${displayName}`}
                              className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl bg-[#0D4A3E] hover:bg-[#09352C] text-white flex items-center justify-center disabled:bg-slate-300 transition-colors shadow-sm"
                            >
                              <Plus className="w-4 h-4" />
                            </motion.button>
                          </div>
                        </motion.article>
                      );
                    })}
                  </div>
                )}
              </section>
            </main>
          </div>

          <footer className="max-w-7xl mx-auto w-full px-3 sm:px-6 mt-10 pt-6 border-t border-slate-200 space-y-4">
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
          </footer>

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
                className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 w-[92%] max-w-md bg-[#0D4A3E] hover:bg-[#09352C] text-white px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between z-40 transition-colors"
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
        </div>
      )}

      <AuthModal
        lang={lang}
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentMember={currentMember}
        authToken={authToken}
        shopSettings={shopSettings}
        orders={orders}
        onAuthenticated={handleAuthenticated}
        onLogout={handleLogout}
        onReorder={handleReorder}
        onSubmitFeedback={handleSubmitOrderFeedback}
        onRefreshOrders={fetchOrdersFromSources}
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
        initialTableNum={tableNumberFromQR || 1}
        onClose={() => setIsCartOpen(false)}
        onChangeOrderType={setOrderType}
        onChangeQty={handleChangeCartQty}
        onOpenLocationPicker={() => setLocationPickerState({ open: true, purpose: 'customer' })}
        onSubmitOrder={handleSubmitOrder}
        onToast={showToast}
      />

      <ReceiptModal
        lang={lang}
        order={receiptState.order}
        tgUrl={receiptState.tgUrl}
        shopSettings={shopSettings}
        onClose={() => setReceiptState({ order: null, tgUrl: '' })}
        onOpenLiveTrack={(id) => {
          setReceiptState({ order: null, tgUrl: '' });
          setLiveTrackOrderId(id);
        }}
      />

      <OrderTrackerModal
        lang={lang}
        isOpen={isTrackerOpen}
        orders={orders}
        onClose={() => setIsTrackerOpen(false)}
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
        onOpenDriverConsole={handleOpenDriverConsole}
        onToast={showToast}
      />
    </div>
  );
}

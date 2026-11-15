import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  MapPin,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  User,
} from 'lucide-react';
import type {
  CartItem,
  Coords,
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
import { CoffeeCupSteamIllustration, DeliveryRiderIllustration } from './components/AnimatedIllustrations';
import { AuthModal } from './components/AuthModal';
import { LocationPickerModal } from './components/LocationPickerModal';
import { ItemCustomizerModal } from './components/ItemCustomizerModal';
import { CartModal } from './components/CartModal';
import { OrderTrackerModal, ReceiptModal } from './components/ReceiptAndTrackerModals';
import { DriverConsole, LiveTrackModal } from './components/LiveTrackAndDriver';
import { AdminDashboard, AdminPinModal } from './components/AdminDashboard';

export default function App() {
  const shouldReduceMotion = useReducedMotion();

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
  const [ordersLoadedOnce, setOrdersLoadedOnce] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [tableNumberFromQR, setTableNumberFromQR] = useState<number | null>(null);

  const [selectedCoords, setSelectedCoords] = useState<Coords>({
    lat: shopSettings.lat,
    lng: shopSettings.lng,
  });
  const [pickedAddressName, setPickedAddressName] = useState('ភ្នំពេញ · ចុចរើសទីតាំង');

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

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOrderCountRef = useRef(orders.length);
  const isFetchingOrdersRef = useRef(false);
  const clearingOrdersRef = useRef(false);
  const lastOrdersSigRef = useRef('');

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

  const syncShopEverywhere = useCallback(
    async (nextMenu: MenuItem[], nextToppings: Topping[], nextSettings: ShopSettings) => {
      if (adminToken) {
        try {
          await fetchWithTimeout(
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
            10000
          );
        } catch {
          // ignore
        }
      }
      const b = getFirebaseBase(nextSettings.firebaseUrl);
      if (b) {
        try {
          await fetchWithTimeout(
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
            8000
          );
        } catch {
          // ignore
        }
      }
    },
    [adminToken]
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
            `${o.id}:${o.status}:${o.driverCoords?.lat ?? ''},${o.driverCoords?.lng ?? ''}:${o.customer?.coords?.lat ?? ''},${o.customer?.coords?.lng ?? ''}`
        )
        .join('|');
      if (sorted.length > lastOrderCountRef.current && isAdminUnlocked) {
        playDingSound();
        showToast('🔔 មានការកម្ម៉ង់ថ្មីចូល!');
      }
      lastOrderCountRef.current = sorted.length;
      if (sig !== lastOrdersSigRef.current) {
        lastOrdersSigRef.current = sig;
        setOrders(sorted);
      }
      setOrdersLoadedOnce(true);
    },
    [isAdminUnlocked, showToast]
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
      } finally {
        setOrdersLoadedOnce(true);
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
      setActiveDriverOrderId(drv);
      setViewMode('driver');
    } else if (p.get('admin') === '1') {
      setIsPinOpen(true);
    }

    // Load shop menu/settings from persistent server DB
    fetchWithTimeout('/api/shop', {}, 9000)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.ok) return;
        if (Array.isArray(data.menuItems)) setMenuItems(normalizeMenuItems(data.menuItems));
        if (Array.isArray(data.toppings)) setToppings(normalizeToppings(data.toppings));
        if (data.shopSettings) {
          setShopSettings((prev) => normalizeShopSettings(data.shopSettings, prev));
        }
      })
      .catch(() => {});

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
        (i.name || '').toLowerCase().includes(q)
    );
  }, [menuItems, selectedCategory, searchQuery]);

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
      customer: payload.customer,
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

  const promoSummaryText =
    shopSettings.deliveryMode === 'free'
      ? 'ដឹកជញ្ជូនហ្វ្រីគ្រប់ទីតាំង'
      : shopSettings.freeDeliveryOver > 0
        ? `ដឹកជញ្ជូនហ្វ្រីពេលកម្ម៉ង់ចាប់ពី $${shopSettings.freeDeliveryOver} ឡើងទៅ`
        : 'សេវាដឹកជញ្ជូនរហ័សទាន់ចិត្ត';

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-slate-800">
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

      {viewMode === 'driver' && activeDriverOrder && (
        <DriverConsole
          order={activeDriverOrder}
          shopSettings={shopSettings}
          onExit={() => setViewMode(isAdminUnlocked ? 'admin' : 'customer')}
          onUpdateDriverCoords={handleUpdateDriverCoords}
          onCompleteDelivery={(id) => {
            handleUpdateOrderStatus(id, 'Completed');
            showToast('✅ បានបញ្ចប់ការដឹកជញ្ជូន!');
            setViewMode(isAdminUnlocked ? 'admin' : 'customer');
          }}
          onToast={showToast}
        />
      )}

      {viewMode === 'driver' && !activeDriverOrder && (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-3xl border border-slate-200 p-6 text-center space-y-3 shadow-lg">
            <p className="text-3xl">🛵</p>
            <h2 className="font-bold text-base text-slate-900">
              {ordersLoadedOnce
                ? `រកមិនឃើញការកម្ម៉ង់ ${activeDriverOrderId || ''} ទេ`
                : 'កំពុងទាញយកព័ត៌មានដឹកជញ្ជូន...'}
            </h2>
            <p className="text-xs text-slate-500">
              {ordersLoadedOnce
                ? 'ការកម្ម៉ង់នេះប្រហែលត្រូវបានលុប ឬផុតកំណត់ហើយ។'
                : 'សូមរង់ចាំបន្តិច...'}
            </p>
            <button
              type="button"
              onClick={() => setViewMode(isAdminUnlocked ? 'admin' : 'customer')}
              className="w-full bg-[#0D4A3E] text-white font-bold py-2.5 rounded-xl text-xs"
            >
              ត្រឡប់ទៅទំព័រដើម
            </button>
          </div>
        </div>
      )}

      {viewMode === 'admin' && (
        <AdminDashboard
          adminToken={adminToken}
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
          onRequireReauth={() => {
            setAdminToken(null);
            safeSessionDel('cafe_admin_token');
            setViewMode('customer');
            setIsPinOpen(true);
            showToast('សម័យប្រើប្រាស់ម្ចាស់ហាងផុតកំណត់ សូមបញ្ចូល PIN ម្តងទៀត');
          }}
          onUpdateShopSettings={async (next) => {
            setShopSettings(next);
            await syncShopEverywhere(menuItems, toppings, next);
          }}
          onUpdateMenu={(next) => {
            setMenuItems(next);
            syncShopEverywhere(next, toppings, shopSettings);
          }}
          onUpdateToppings={(next) => {
            setToppings(next);
            syncShopEverywhere(menuItems, next, shopSettings);
          }}
          onUpdateOrderStatus={handleUpdateOrderStatus}
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
            showToast('បានសម្អាត Order ដែលរួចរាល់!');
          }}
          onOpenDriverConsole={handleOpenDriverConsole}
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
            <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
                <a
                  href="#top"
                  className="flex items-center gap-2.5 text-base sm:text-lg font-bold tracking-tight text-[#0D4A3E] whitespace-nowrap shrink-0"
                >
                  <img
                    src={resolveAssetUrl(shopSettings.logoImg, CAFE_ASSETS.logoEmblem)}
                    alt={shopSettings.brandTitle}
                    referrerPolicy="no-referrer"
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.logoEmblem)}
                    className="w-9 h-9 rounded-full object-cover border border-amber-400/70 bg-[#0D4A3E]"
                  />
                  <span>{shopSettings.brandTitle}</span>
                </a>

                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
                  <a
                    href="#menu-section"
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    ម៉ឺនុយ
                  </a>
                  <button
                    type="button"
                    onClick={() => setIsTrackerOpen(true)}
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    តាមដានកម្ម៉ង់
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationPickerState({ open: true, purpose: 'customer' })}
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    ទីតាំងដឹកជញ្ជូន
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdminUnlocked) setViewMode('admin');
                      else setIsPinOpen(true);
                    }}
                    className="hover:text-[#0D4A3E] transition-colors whitespace-nowrap shrink-0"
                  >
                    គ្រប់គ្រងហាង
                  </button>
                </nav>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsTrackerOpen(true)}
                    aria-label="តាមដានកម្ម៉ង់"
                    className="md:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-700"
                  >
                    <Receipt className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdminUnlocked) setViewMode('admin');
                      else setIsPinOpen(true);
                    }}
                    aria-label="សម្រាប់ម្ចាស់ហាង"
                    className="md:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-700"
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAuthOpen(true)}
                    className="min-h-[40px] px-4 py-2 bg-[#0D4A3E] hover:bg-[#09352C] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <User className="w-3.5 h-3.5 text-amber-300" />
                    <span>
                      {currentMember
                        ? `${currentMember.name.split(' ')[0]} · ★${currentMember.points || 0}`
                        : 'គណនី / ភ្ជាប់ Telegram'}
                    </span>
                  </button>
                </div>
              </div>
            </header>

            <main id="top" className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 space-y-6">
              {shopSettings.isOpen === false && (
                <div className="bg-red-600 text-white px-4 py-3 rounded-2xl text-xs font-bold text-center">
                  សូមអភ័យទោស! ហាងកំពុងបិទបណ្តោះអាសន្ន
                </div>
              )}

              {tableNumberFromQR !== null && (
                <div className="bg-amber-400 text-slate-900 px-4 py-2.5 rounded-2xl text-xs flex items-center justify-between font-bold">
                  <span>🪑 ញ៉ាំក្នុងហាង · តុលេខ {tableNumberFromQR}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTableNumberFromQR(null);
                      setOrderType('delivery');
                    }}
                    className="bg-slate-900 text-white px-3 py-1 rounded-lg text-[11px]"
                  >
                    ប្តូរទៅដឹកជញ្ជូន
                  </button>
                </div>
              )}

              {activeLiveOrder && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setLiveTrackOrderId(activeLiveOrder.id)}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 px-4 py-2.5 rounded-2xl text-xs flex items-center justify-between font-bold shadow-sm transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <DeliveryRiderIllustration />
                    <span>អ្នកដឹកកំពុងធ្វើដំណើរ! ចុចមើល Live Map ({activeLiveOrder.id})</span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </motion.button>
              )}

              <section className="grid lg:grid-cols-12 gap-5 items-stretch">
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="lg:col-span-7 bg-[#0D4A3E] text-white rounded-3xl p-6 sm:p-8 flex flex-col justify-between gap-5 relative overflow-hidden"
                >
                  <div className="grid sm:grid-cols-12 gap-4 items-center">
                    <div className="sm:col-span-8 space-y-3">
                      <p className="text-xs font-medium text-emerald-200">
                        {shopSettings.isOpen !== false ? 'កំពុងបើកលក់ · ដឹកជញ្ជូនរហ័ស' : 'បិទបណ្តោះអាសន្ន'}
                        {shopSettings.promoCode && shopSettings.promoPercent > 0
                          ? ` · កូដ ${shopSettings.promoCode} (-${shopSettings.promoPercent}%)`
                          : ''}
                      </p>
                      <h1 className="text-2xl sm:text-4xl font-bold leading-tight text-balance">
                        {shopSettings.brandTitle}
                      </h1>
                      <p className="text-sm text-emerald-100/90 max-w-xl">
                        {shopSettings.shopName} · {promoSummaryText}
                      </p>
                    </div>

                    <div className="sm:col-span-4 flex justify-center">
                      <CoffeeCupSteamIllustration className="w-36 h-28 sm:w-44 sm:h-36" />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setLocationPickerState({ open: true, purpose: 'customer' })}
                      className="text-left bg-white/12 hover:bg-white/20 px-3.5 py-2.5 rounded-2xl flex items-center gap-2.5 border border-white/15 transition-colors"
                    >
                      <div className="bg-amber-400 text-slate-900 p-2 rounded-xl shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-emerald-200">
                          {tableNumberFromQR ? 'ញ៉ាំក្នុងហាង' : 'ដឹកជញ្ជូនទៅ (ចុចបើកផែនទី)'}
                        </p>
                        <p className="text-xs font-bold truncate">
                          {tableNumberFromQR ? `តុលេខ ${tableNumberFromQR}` : pickedAddressName}
                        </p>
                      </div>
                      <ChevronDown className="w-4 h-4 text-emerald-200 shrink-0" />
                    </button>

                    <div className="relative flex items-center">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ស្វែងរកកាហ្វេ មី នំ ឬភេសជ្ជៈ..."
                        className="w-full h-full min-h-[48px] bg-white text-slate-900 placeholder-slate-400 text-sm pl-10 pr-4 py-2.5 rounded-2xl focus:outline-none"
                      />
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 }}
                  className="lg:col-span-5 relative rounded-3xl overflow-hidden min-h-[220px] lg:h-full bg-slate-900"
                >
                  <img
                    src={resolveAssetUrl(shopSettings.bannerImg, CAFE_ASSETS.heroBanner)}
                    alt={shopSettings.brandTitle}
                    referrerPolicy="no-referrer"
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.heroBanner)}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-6 flex flex-col justify-end">
                    <p className="text-xs font-semibold text-amber-300">{promoSummaryText}</p>
                    <p className="text-white font-bold text-lg mt-1">
                      ឆុងថ្មីៗគ្រប់កែវ · ភ្ជាប់ Telegram ទទួលពិន្ទុបន្ថែម
                    </p>
                  </div>
                </motion.div>
              </section>

              <section id="menu-section" className="space-y-4 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="font-bold text-slate-900 text-lg sm:text-xl">ម៉ឺនុយ (Menu)</h2>
                    <span className="text-xs text-slate-500 font-mono-num">{filteredMenu.length} មុខ</span>
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto hide-scrollbar pb-1 max-w-full">
                    {categories.map((cat) => {
                      const active = selectedCategory === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedCategory(cat)}
                          className={`relative px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                            active
                              ? 'text-white'
                              : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="activeCategoryTab"
                              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                              className="absolute inset-0 bg-[#0D4A3E] rounded-xl -z-0"
                            />
                          )}
                          <span className="relative z-10">{cat === 'All' ? 'ទាំងអស់' : cat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!filteredMenu.length ? (
                  <div className="bg-white rounded-3xl border border-slate-200 py-14 text-center text-slate-400 text-sm">
                    មិនមានទំនិញត្រូវនឹងការស្វែងរកទេ
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                    {filteredMenu.map((item, idx) => {
                      const finalPrice = getDiscountedPrice(item);
                      const hasDisc = item.discount > 0;
                      return (
                        <motion.article
                          key={item.id}
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.25) }}
                          whileHover={shouldReduceMotion ? undefined : { y: -3 }}
                          className={`bg-white rounded-2xl p-3.5 border border-slate-200/90 flex flex-col justify-between transition-shadow hover:shadow-md ${
                            !item.available ? 'opacity-60' : ''
                          }`}
                        >
                          <div>
                            <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 mb-3 relative">
                              <img
                                src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {item.type === 'food' ? 'អាហារ/នំ' : 'ភេសជ្ជៈ'} · {item.category}
                              {!item.available ? ' · អស់ស្តុក' : hasDisc ? ` · បញ្ចុះ ${item.discount}%` : ''}
                            </p>
                            <h3 className="font-semibold text-sm sm:text-base text-slate-900 mt-0.5 line-clamp-1">
                              {item.name}
                            </h3>
                          </div>

                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
                            <div className="font-mono-num">
                              <span className="font-bold text-base text-[#0D4A3E]">
                                ${finalPrice.toFixed(2)}
                              </span>
                              {hasDisc && (
                                <span className="text-xs text-slate-400 line-through ml-1.5">
                                  ${Number(item.price).toFixed(2)}
                                </span>
                              )}
                            </div>
                            <motion.button
                              type="button"
                              whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
                              disabled={!item.available}
                              onClick={() => setCustomizingItem(item)}
                              aria-label={`កម្ម៉ង់ ${item.name}`}
                              className="min-w-[40px] min-h-[40px] rounded-xl bg-[#0D4A3E] hover:bg-[#09352C] text-white flex items-center justify-center disabled:bg-slate-300 transition-colors"
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

          <footer className="max-w-7xl mx-auto w-full px-4 sm:px-6 mt-12 pt-6 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{shopSettings.brandTitle}</span>
            <span>សុវត្ថិភាពផ្លូវការ · Telegram & Phone OTP Verification</span>
          </footer>

          <AnimatePresence>
            {cartCount > 0 && (
              <motion.button
                type="button"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                transition={{ type: 'spring', damping: 24, stiffness: 320 }}
                onClick={() => setIsCartOpen(true)}
                className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-md bg-[#0D4A3E] hover:bg-[#09352C] text-white px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between z-40 transition-colors"
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
                    <p className="text-[11px] text-emerald-200">កន្ត្រកទំនិញ</p>
                    <p className="font-bold font-mono-num text-sm">${cartSubtotal.toFixed(2)}</p>
                  </div>
                </div>
                <span className="bg-white text-[#0D4A3E] font-bold text-xs px-3.5 py-2 rounded-xl">
                  កម្ម៉ង់ឥឡូវ →
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentMember={currentMember}
        authToken={authToken}
        shopSettings={shopSettings}
        onAuthenticated={handleAuthenticated}
        onLogout={handleLogout}
        onToast={showToast}
      />

      <AdminPinModal
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
          showToast('បានកំណត់ទីតាំងហាងរួចរាល់!');
        }}
        onToast={showToast}
      />

      <ItemCustomizerModal
        item={customizingItem}
        toppings={toppings}
        onClose={() => setCustomizingItem(null)}
        onAddToCart={handleAddToCart}
      />

      <CartModal
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
        isOpen={isTrackerOpen}
        orders={orders}
        onClose={() => setIsTrackerOpen(false)}
        onOpenLiveTrack={(id) => {
          setIsTrackerOpen(false);
          setLiveTrackOrderId(id);
        }}
      />

      <LiveTrackModal
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

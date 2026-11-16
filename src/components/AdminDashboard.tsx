import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  CheckSquare,
  ClipboardList,
  Coffee,
  Copy,
  DollarSign,
  Globe,
  Layers,
  Lock,
  MessageSquare,
  Plus,
  Printer,
  QrCode,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react';
import type {
  AdminSecretsConfig,
  AppLang,
  DeliveryMode,
  DriverInfo,
  ItemType,
  Member,
  MenuItem,
  Order,
  OrderStatus,
  ShopSettings,
  Topping,
} from '../types';
import {
  CAFE_ASSETS,
  compressImageFile,
  fetchWithTimeout,
  getDiscountedPrice,
  getFirebaseBase,
  handleImgFallback,
  resolveAssetUrl,
} from '../utils/cafeUtils';
import {
  CATEGORY_PRESETS,
  MENU_PRESET_TEMPLATES,
  getMenuCategoryLabel,
  getMenuName,
  getOrderStatusText,
  getToppingName,
} from '../utils/i18n';
import {
  buildDynamicKhqr,
  decodeKhqrFromImageFile,
  extractKhqrSummary,
  isValidEmvKhqr,
} from '../utils/khqr';

interface PinModalProps {
  lang?: AppLang;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (adminToken: string) => void;
}

export function AdminPinModal({ lang = 'km', isOpen, onClose, onSuccess }: PinModalProps) {
  const isEn = lang === 'en';
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetchWithTimeout(
        '/api/admin/verify-pin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pin.trim() }),
        },
        10000
      );
      const data = await res.json();
      if (data.ok && data.adminToken) {
        onSuccess(data.adminToken);
      } else {
        setError(data.error || (isEn ? 'Incorrect PIN!' : 'PIN មិនត្រឹមត្រូវ!'));
      }
    } catch {
      setError(
        isEn
          ? 'Could not reach server to verify PIN'
          : 'មិនអាចភ្ជាប់ទៅ Server ដើម្បីផ្ទៀងផ្ទាត់ PIN បានទេ'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xs rounded-3xl p-6 text-center shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-[#E8F2EF] text-[#0D4A3E] flex items-center justify-center mx-auto mb-2">
          <Lock className="w-5 h-5" />
        </div>
        <h3 className="font-bold text-lg text-slate-900">
          {isEn ? 'Shop Owner Login' : 'ចូលគ្រប់គ្រងហាង'}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {isEn ? 'Enter owner PIN ' : 'បញ្ចូលលេខកូដ PIN ម្ចាស់ហាង '}
          <span className="text-[#0D4A3E] font-bold">
            {isEn ? '(Default: 1234)' : '(កូដដំបូង: 1234)'}
          </span>
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="w-full text-center text-2xl tracking-[0.5em] font-mono-num font-bold border-2 border-slate-200 focus:border-[#0D4A3E] rounded-2xl py-2.5 outline-none"
          />
          {error && <p className="text-xs text-red-600 font-bold">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 py-2.5 rounded-xl text-xs font-bold text-slate-700"
            >
              {isEn ? 'Cancel' : 'បោះបង់'}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-[#0D4A3E] text-white py-2.5 rounded-xl text-xs font-bold"
            >
              {loading ? '...' : isEn ? 'Unlock' : 'ចូល'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SyncResult {
  ok: boolean;
  persistent: boolean;
  reauth?: boolean;
}

interface AdminDashboardProps {
  lang?: AppLang;
  onChangeLang?: (lang: AppLang) => void;
  adminToken: string | null;
  serverPersistent?: boolean;
  menuItems: MenuItem[];
  toppings: Topping[];
  orders: Order[];
  members: Member[];
  shopSettings: ShopSettings;
  onExit: () => void;
  onRequireReauth: () => void;
  onUpdateShopSettings: (next: ShopSettings) => Promise<SyncResult | void> | void;
  onUpdateMenu: (next: MenuItem[]) => Promise<SyncResult | void> | void;
  onUpdateToppings: (next: Topping[]) => Promise<SyncResult | void> | void;
  onUpdateOrderStatus: (orderId: string, status: OrderStatus) => void;
  onUpdateOrderDriverInfo: (orderId: string, info: DriverInfo, nextStatus?: OrderStatus) => void;
  onClearCompletedOrders: () => void;
  onOpenDriverConsole: (orderId: string) => void;
  onOpenDriverPortal: () => void;
  onOpenShopMapPicker: () => void;
  onOpenTableView: (tableNum: number) => void;
  onToast: (msg: string) => void;
}

type AdminTab = 'orders' | 'feedback' | 'menu' | 'qr' | 'members' | 'settings';

const EMPTY_SECRETS: AdminSecretsConfig = {
  adminPin: '1234',
  botToken: '',
  chatId: '',
  bakongToken: '',
  telegramGatewayToken: '',
  twilioAccountSid: '',
  twilioAuthToken: '',
  twilioFromNumber: '',
  smsWebhookUrl: '',
  smsWebhookApiKey: '',
};

const STOCK_IMAGE_CHOICES: Array<{ labelKm: string; labelEn: string; url: string }> = [
  { labelKm: 'ឡាតេ', labelEn: 'Iced Latte', url: CAFE_ASSETS.icedLatte },
  { labelKm: 'ម៉ាត់ឆា', labelEn: 'Matcha', url: CAFE_ASSETS.ujiMatcha },
  { labelKm: 'តែគុជ', labelEn: 'Milk Tea', url: CAFE_ASSETS.brownSugar },
  { labelKm: 'មីហឹរ', labelEn: 'Noodles', url: CAFE_ASSETS.spicyNoodles },
  { labelKm: 'នំក្រូសង់', labelEn: 'Croissant', url: CAFE_ASSETS.butterCroissant },
];

export function AdminDashboard({
  lang = 'km',
  onChangeLang,
  adminToken,
  serverPersistent = true,
  menuItems,
  toppings,
  orders,
  members,
  shopSettings,
  onExit,
  onRequireReauth,
  onUpdateShopSettings,
  onUpdateMenu,
  onUpdateToppings,
  onUpdateOrderStatus,
  onUpdateOrderDriverInfo,
  onClearCompletedOrders,
  onOpenDriverConsole,
  onOpenDriverPortal,
  onOpenShopMapPicker,
  onOpenTableView,
  onToast,
}: AdminDashboardProps) {
  const isEn = lang === 'en';
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [orderFilter, setOrderFilter] = useState<'All' | OrderStatus>('All');

  // Inline driver assignment draft per order
  const [driverDrafts, setDriverDrafts] = useState<Record<string, { name: string; phone: string }>>({});

  // Menu form state (bilingual + featured + category)
  const [editId, setEditId] = useState<string>('');
  const [itemType, setItemType] = useState<ItemType>('drink');
  const [itemName, setItemName] = useState('');
  const [itemNameEn, setItemNameEn] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemDiscount, setItemDiscount] = useState('0');
  const [itemCat, setItemCat] = useState('');
  const [itemCatEn, setItemCatEn] = useState('');
  const [itemImg, setItemImg] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemDescEn, setItemDescEn] = useState('');
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemFeatured, setItemFeatured] = useState(false);

  // Preset menu selector & menu list filters / bulk selection
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuTypeFilter, setMenuTypeFilter] = useState<'all' | ItemType>('all');
  const [menuCatFilter, setMenuCatFilter] = useState<string>('All');
  const [selectedMenuIds, setSelectedMenuIds] = useState<string[]>([]);

  // Topping form state (bilingual)
  const [newTopName, setNewTopName] = useState('');
  const [newTopNameEn, setNewTopNameEn] = useState('');
  const [newTopPrice, setNewTopPrice] = useState('');

  // QR generator state
  const [qrTableCount, setQrTableCount] = useState(6);
  const [qrBaseUrl, setQrBaseUrl] = useState(() =>
    typeof window !== 'undefined' && window.location.href.startsWith('http')
      ? window.location.href.split('?')[0]
      : 'https://emerald-brew.cafe'
  );
  const [qrWifiText, setQrWifiText] = useState('Free Wi-Fi: 12345678');
  const [qrDataUrls, setQrDataUrls] = useState<Record<number, string>>({});

  // Settings & server secrets draft
  const [draft, setDraft] = useState<ShopSettings>(shopSettings);
  const [secrets, setSecrets] = useState<AdminSecretsConfig>(EMPTY_SECRETS);
  const [serverMembers, setServerMembers] = useState<Member[]>(members);
  const [savingSettings, setSavingSettings] = useState(false);
  const [khqrPreviewUrl, setKhqrPreviewUrl] = useState('');
  const [generatingQRs, setGeneratingQRs] = useState(false);
  const [confirmClearMenu, setConfirmClearMenu] = useState(false);
  const [decodingKhqr, setDecodingKhqr] = useState(false);
  const [previewSlipUrl, setPreviewSlipUrl] = useState<string | null>(null);
  const menuFormRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(shopSettings);
  }, [shopSettings]);

  const sampleDynamicKhqr = useMemo(
    () =>
      buildDynamicKhqr({
        basePayload: draft.khqrPayload,
        bakongId: draft.khqrBakongId,
        merchantName: draft.khqrMerchantName || draft.brandTitle,
        amountUsd: 1.5,
        currency: draft.khqrCurrency || 'USD',
        khrRate: draft.khqrKhrRate || 4100,
        billNumber: 'TEST01',
      }),
    [
      draft.khqrPayload,
      draft.khqrBakongId,
      draft.khqrMerchantName,
      draft.brandTitle,
      draft.khqrCurrency,
      draft.khqrKhrRate,
    ]
  );

  useEffect(() => {
    if (!sampleDynamicKhqr.isOfficialEmv) {
      setKhqrPreviewUrl((prev) => (prev === '' ? prev : ''));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      QRCode.toDataURL(sampleDynamicKhqr.payload, {
        width: 140,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
        .then((url) => {
          if (!cancelled) setKhqrPreviewUrl((prev) => (prev === url ? prev : url));
        })
        .catch(() => {
          if (!cancelled) setKhqrPreviewUrl((prev) => (prev === '' ? prev : ''));
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sampleDynamicKhqr.isOfficialEmv, sampleDynamicKhqr.payload]);

  useEffect(() => {
    if (!adminToken) return;
    const ctrl = new AbortController();
    fetchWithTimeout(
      '/api/admin/config',
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: ctrl.signal,
      },
      10000
    )
      .then((r) => {
        if (r.status === 401) {
          onRequireReauth();
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.ok) {
          if (data.secrets) setSecrets({ ...EMPTY_SECRETS, ...data.secrets });
          if (Array.isArray(data.members) && data.members.length > 0) setServerMembers(data.members);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [adminToken, onRequireReauth]);

  const displayedMembers = serverMembers.length > 0 ? serverMembers : members;
  const totalRevenue = orders.reduce((s, o) => s + Number(o.grandTotal || 0), 0);
  const pendingCount = orders.filter((o) => o.status === 'Pending').length;
  const activeDeliveryCount = orders.filter((o) => o.type === 'delivery' && o.status !== 'Completed').length;
  const filteredOrders = orderFilter === 'All' ? orders : orders.filter((o) => o.status === orderFilter);

  const feedbackOrders = useMemo(
    () =>
      orders
        .filter((o) => Boolean(o.feedback && o.feedback.rating >= 1))
        .sort((a, b) => Number(b.feedback?.submittedAt || 0) - Number(a.feedback?.submittedAt || 0)),
    [orders]
  );
  const averageRating = useMemo(() => {
    if (!feedbackOrders.length) return 0;
    const sum = feedbackOrders.reduce((s, o) => s + Number(o.feedback?.rating || 0), 0);
    return sum / feedbackOrders.length;
  }, [feedbackOrders]);

  const existingCategories = useMemo(
    () => Array.from(new Set(menuItems.map((m) => m.category).filter(Boolean))),
    [menuItems]
  );

  const filteredMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (menuTypeFilter !== 'all' && item.type !== menuTypeFilter) return false;
      if (menuCatFilter !== 'All' && item.category !== menuCatFilter) return false;
      if (!q) return true;
      return (
        (item.name || '').toLowerCase().includes(q) ||
        (item.nameEn || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q) ||
        (item.categoryEn || '').toLowerCase().includes(q)
      );
    });
  }, [menuItems, menuSearch, menuTypeFilter, menuCatFilter]);

  const existingMenuNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const m of menuItems) {
      if (m.name) set.add(m.name.trim().toLowerCase());
      if (m.nameEn) set.add(m.nameEn.trim().toLowerCase());
    }
    return set;
  }, [menuItems]);

  const generateQRs = async () => {
    if (generatingQRs) return;
    const count = Math.min(50, Math.max(1, Number(qrTableCount) || 6));
    const base = qrBaseUrl.trim().split('?')[0].split('#')[0] || 'https://emerald-brew.cafe';
    setGeneratingQRs(true);
    try {
      const next: Record<number, string> = {};
      for (let i = 1; i <= count; i++) {
        try {
          next[i] = await QRCode.toDataURL(`${base}?table=${i}`, {
            width: 160,
            margin: 1,
            color: { dark: '#0D4A3E', light: '#FFFFFF' },
          });
        } catch {
          // ignore
        }
      }
      setQrDataUrls(next);
    } finally {
      setGeneratingQRs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'qr') generateQRs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const downloadSticker = (tableNum: number) => {
    const dataUrl = qrDataUrls[tableNum];
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 520;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 400, 520);
      ctx.fillStyle = '#0D4A3E';
      ctx.fillRect(0, 0, 400, 110);
      ctx.strokeStyle = '#0D4A3E';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 392, 512);
      ctx.fillStyle = '#FCD34D';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(shopSettings.brandTitle, 200, 40);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(`TABLE ${tableNum} · តុលេខ ${tableNum}`, 200, 82);
      ctx.drawImage(img, 85, 145, 230, 230);
      ctx.fillStyle = '#0D4A3E';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('SCAN TO ORDER · ស្កេនដើម្បីកម្ម៉ង់', 200, 425);
      ctx.fillStyle = '#6B7280';
      ctx.font = '14px sans-serif';
      ctx.fillText(qrWifiText, 200, 460);
      const a = document.createElement('a');
      a.download = `QR-Table-${tableNum}.png`;
      a.href = c.toDataURL('image/png');
      a.click();
    };
    img.src = dataUrl;
  };

  const resetMenuForm = () => {
    setEditId('');
    setItemType('drink');
    setItemName('');
    setItemNameEn('');
    setItemPrice('');
    setItemDiscount('0');
    setItemCat('');
    setItemCatEn('');
    setItemImg('');
    setItemDesc('');
    setItemDescEn('');
    setItemAvailable(true);
    setItemFeatured(false);
  };

  const notifyMenuSyncResult = (res: SyncResult | void, okMessage: string) => {
    if (res && res.reauth) return;
    if (res && !res.ok) return;
    if (res && !res.persistent) {
      onToast(
        isEn
          ? 'Saved locally! Connect CAFE_KV or Firebase so customers see updates.'
          : 'បានរក្សាទុក! ប៉ុន្តែត្រូវភ្ជាប់ CAFE_KV ឬ Firebase ទើបអ្នកផ្សេងឃើញ'
      );
    } else {
      onToast(okMessage);
    }
  };

  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKm = itemName.trim();
    const cleanEn = itemNameEn.trim();
    if (!cleanKm && !cleanEn) {
      onToast(isEn ? 'Please enter an item name' : 'សូមបញ្ចូលឈ្មោះទំនិញ');
      return;
    }

    const price = parseFloat(itemPrice) || 0;
    const discount = parseInt(itemDiscount, 10) || 0;
    const category = itemCat.trim() || itemCatEn.trim() || 'Coffee';
    const categoryEn = itemCatEn.trim() || category;

    let nextMenu: MenuItem[];
    if (editId) {
      nextMenu = menuItems.map((m) =>
        String(m.id) === editId
          ? {
              ...m,
              type: itemType,
              name: cleanKm || cleanEn,
              nameEn: cleanEn || cleanKm,
              price,
              discount,
              category,
              categoryEn,
              desc: itemDesc.trim(),
              descEn: itemDescEn.trim(),
              img: itemImg || m.img,
              available: itemAvailable,
              featured: itemFeatured,
            }
          : m
      );
    } else {
      const newItem: MenuItem = {
        id: Date.now(),
        type: itemType,
        name: cleanKm || cleanEn,
        nameEn: cleanEn || cleanKm,
        price,
        discount,
        category,
        categoryEn,
        img: itemImg || CAFE_ASSETS.icedLatte,
        desc: itemDesc.trim(),
        descEn: itemDescEn.trim(),
        available: itemAvailable,
        featured: itemFeatured,
      };
      nextMenu = [newItem, ...menuItems];
    }
    resetMenuForm();
    const res = await onUpdateMenu(nextMenu);
    notifyMenuSyncResult(
      res,
      isEn ? '✓ Menu item saved & synced across devices!' : '✓ បានរក្សាទុកទំនិញ និងចែករំលែកគ្រប់ឧបករណ៍!'
    );
  };

  const startEditItem = (item: MenuItem) => {
    setEditId(String(item.id));
    setItemType(item.type || 'drink');
    setItemName(item.name || '');
    setItemNameEn(item.nameEn || '');
    setItemPrice(String(item.price));
    setItemDiscount(String(item.discount || 0));
    setItemCat(item.category || '');
    setItemCatEn(item.categoryEn || item.category || '');
    setItemImg(item.img || '');
    setItemDesc(item.desc || '');
    setItemDescEn(item.descEn || '');
    setItemAvailable(item.available !== false);
    setItemFeatured(Boolean(item.featured));
    window.setTimeout(() => {
      menuFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleDuplicateItem = async (item: MenuItem) => {
    const copy: MenuItem = {
      ...item,
      id: Date.now() + Math.floor(Math.random() * 1000),
      name: `${item.name} (${isEn ? 'Copy' : 'ចម្លង'})`,
      nameEn: item.nameEn ? `${item.nameEn} (Copy)` : undefined,
    };
    const res = await onUpdateMenu([copy, ...menuItems]);
    notifyMenuSyncResult(res, isEn ? '✓ Duplicated menu item!' : '✓ បានចម្លងទំនិញថ្មី!');
  };

  const handleAddSelectedPresets = async () => {
    if (!selectedPresetIds.length) return;
    const picked = MENU_PRESET_TEMPLATES.filter((p) => selectedPresetIds.includes(p.presetId));
    if (!picked.length) return;
    const baseTime = Date.now();
    const additions: MenuItem[] = picked.map((p, idx) => ({
      id: baseTime + idx,
      type: p.type,
      name: p.name,
      nameEn: p.nameEn,
      price: p.price,
      discount: p.discount,
      category: p.category,
      categoryEn: p.categoryEn,
      img: p.img,
      desc: p.desc,
      descEn: p.descEn,
      available: true,
      featured: false,
    }));
    const nextMenu = [...additions, ...menuItems];
    setSelectedPresetIds([]);
    setShowPresetPicker(false);
    const res = await onUpdateMenu(nextMenu);
    notifyMenuSyncResult(
      res,
      isEn
        ? `✓ Added ${additions.length} items to menu!`
        : `✓ បានបន្ថែមម៉ឺនុយចំនួន ${additions.length} មុខ!`
    );
  };

  const toggleMenuSelection = (id: string | number) => {
    const key = String(id);
    setSelectedMenuIds((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const handleBulkMenuAction = async (action: 'available' | 'soldout' | 'featured' | 'delete') => {
    if (!selectedMenuIds.length) return;
    const idSet = new Set(selectedMenuIds);
    let nextMenu: MenuItem[];
    if (action === 'available') {
      nextMenu = menuItems.map((m) => (idSet.has(String(m.id)) ? { ...m, available: true } : m));
    } else if (action === 'soldout') {
      nextMenu = menuItems.map((m) => (idSet.has(String(m.id)) ? { ...m, available: false } : m));
    } else if (action === 'featured') {
      nextMenu = menuItems.map((m) => (idSet.has(String(m.id)) ? { ...m, featured: !m.featured } : m));
    } else {
      nextMenu = menuItems.filter((m) => !idSet.has(String(m.id)));
    }
    const count = selectedMenuIds.length;
    setSelectedMenuIds([]);
    const res = await onUpdateMenu(nextMenu);
    notifyMenuSyncResult(
      res,
      isEn ? `✓ Updated ${count} selected items!` : `✓ បានកែប្រែទំនិញ ${count} មុខជោគជ័យ!`
    );
  };

  const handleAddTopping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopName.trim() && !newTopNameEn.trim()) return;
    const res = await onUpdateToppings([
      ...toppings,
      {
        id: Date.now(),
        name: newTopName.trim() || newTopNameEn.trim(),
        nameEn: newTopNameEn.trim() || newTopName.trim(),
        price: parseFloat(newTopPrice) || 0,
        available: true,
      },
    ]);
    setNewTopName('');
    setNewTopNameEn('');
    setNewTopPrice('');
    if (res && !res.ok) return;
    onToast(isEn ? '✓ Added topping!' : 'បានបន្ថែម Topping!');
  };

  const handleSaveDriverAssignment = (o: Order) => {
    const draftDriver = driverDrafts[o.id];
    const nextName = (draftDriver?.name ?? o.driverInfo?.name ?? '').trim();
    const nextPhone = (draftDriver?.phone ?? o.driverInfo?.phone ?? '').trim();
    onUpdateOrderDriverInfo(o.id, {
      ...o.driverInfo,
      name: nextName,
      phone: nextPhone,
    });
    onToast(
      isEn
        ? `✓ Updated driver info for ${o.id}`
        : `✓ បានរក្សាទុកព័ត៌មានអ្នកដឹកសម្រាប់ ${o.id}`
    );
  };

  const handleSaveAllSettings = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      if (adminToken) {
        const res = await fetchWithTimeout(
          '/api/admin/config',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ secrets }),
          },
          12000
        );
        if (res.status === 401) {
          onRequireReauth();
          return;
        }
      }
      const shopRes = await onUpdateShopSettings(draft);
      if (shopRes && shopRes.reauth) return;
      if (shopRes && !shopRes.ok) return;
      if (shopRes && !shopRes.persistent) {
        onToast(
          isEn
            ? 'Saved locally! Connect CAFE_KV or Firebase for shared image/menu storage.'
            : 'បានរក្សាទុក! (ត្រូវភ្ជាប់ CAFE_KV ឬ Firebase ទើបអ្នកផ្សេងឃើញរូបថ្មី)'
        );
      } else {
        onToast(
          isEn
            ? '✓ Shop settings & images saved successfully!'
            : '✓ បានរក្សាទុកការកំណត់ហាង និងរូបភាពជោគជ័យ!'
        );
      }
    } catch {
      onToast(isEn ? 'Error saving settings' : 'មានបញ្ហាក្នុងការរក្សាទុកការកំណត់');
    } finally {
      setSavingSettings(false);
    }
  };

  const escapeHtml = (str: unknown) =>
    String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const printOrderReceipt = (o: Order) => {
    const cust = o.customer || { name: '-', phone: '-' };
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(o.id)}</title></head><body style="font-family:monospace;padding:12px;margin:0;"><h3 style="text-align:center;margin:0;">${escapeHtml(shopSettings.brandTitle)}</h3><p style="text-align:center;font-size:11px;">${escapeHtml(o.id)} | ${escapeHtml(o.timestamp)}</p><hr><p style="font-size:12px;">${isEn ? 'Customer' : 'ភ្ញៀវ'}: ${escapeHtml(cust.name)} (${escapeHtml(cust.phone)})<br>${o.type === 'dinein' ? `${isEn ? 'Table' : 'តុលេខ'}: ` + escapeHtml(cust.tableNum || 1) : escapeHtml(cust.addressName || '')}</p><hr>${o.items.map((i) => `<div style="font-size:12px;margin-bottom:4px;">${i.qty}x ${escapeHtml(i.name)} - $${(i.unitPrice * i.qty).toFixed(2)}<br><small>${escapeHtml(i.options)}</small></div>`).join('')}<hr><p style="font-weight:bold;text-align:right;">${isEn ? 'Total' : 'សរុប'}: $${Number(o.grandTotal || 0).toFixed(2)} (${escapeHtml(o.payment)})</p></body></html>`;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 1500);
        return;
      }
      iframe.remove();
    } catch {
      // ignore and notify user
    }
    onToast(isEn ? 'Cannot open print dialog on this device' : 'មិនអាចបើកផ្ទាំង Print លើឧបករណ៍នេះបានទេ');
  };

  const deliveryPreview = (() => {
    if (draft.deliveryMode === 'free') {
      return isEn ? 'Preview: Free delivery $0.00!' : 'គំរូ៖ ដឹកជញ្ជូនហ្វ្រី $0.00!';
    }
    if (draft.deliveryMode === 'flat') {
      return isEn
        ? `Preview: Flat fee $${Number(draft.baseFee || 0).toFixed(2)}${
            draft.freeDeliveryOver > 0 ? ` (Free over $${draft.freeDeliveryOver})` : ''
          }`
        : `គំរូ៖ ថ្លៃដឹកថេរ $${Number(draft.baseFee || 0).toFixed(2)}${
            draft.freeDeliveryOver > 0 ? ` (ហ្វ្រីពេលទិញលើស $${draft.freeDeliveryOver})` : ''
          }`;
    }
    const ex = Math.round(((Number(draft.baseFee) || 0) + 2 * (Number(draft.deliveryRatePerKm) || 0)) * 4) / 4;
    return isEn
      ? `Preview: 2 km delivery = $${ex.toFixed(2)}${
          draft.freeDeliveryOver > 0 ? ` | Over $${draft.freeDeliveryOver} = Free` : ''
        }`
      : `គំរូ៖ ដឹក 2 km = $${ex.toFixed(2)}${
          draft.freeDeliveryOver > 0 ? ` | ទិញលើស $${draft.freeDeliveryOver} = ហ្វ្រី` : ''
        }`;
  })();

  const baseShareUrl =
    typeof window !== 'undefined' ? window.location.href.split('?')[0] : 'https://emerald-brew.cafe';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 pb-24 space-y-4 sm:space-y-5 overflow-x-clip">
      <div className="no-print bg-slate-900 text-white p-3 sm:p-4 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="inline-flex items-center gap-1.5 font-bold text-xs sm:text-sm truncate">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{isEn ? 'Shop Admin' : 'គ្រប់គ្រងហាង'}</span>
          </span>
          <button
            type="button"
            onClick={() => onUpdateShopSettings({ ...shopSettings, isOpen: shopSettings.isOpen === false })}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold shrink-0 flex items-center gap-1.5 ${
              shopSettings.isOpen !== false ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                shopSettings.isOpen !== false ? 'bg-emerald-200 animate-pulse' : 'bg-red-200'
              }`}
            />
            <span>
              {shopSettings.isOpen !== false
                ? isEn
                  ? 'Shop Open'
                  : 'ហាងបើកលក់'
                : isEn
                  ? 'Shop Closed'
                  : 'ហាងកំពុងបិទ'}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onChangeLang && (
            <button
              type="button"
              onClick={() => onChangeLang(isEn ? 'km' : 'en')}
              className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold inline-flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5 text-amber-300" />
              <span>{isEn ? 'ខ្មែរ' : 'EN'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className="bg-red-500 hover:bg-red-600 text-white px-3 sm:px-4 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>{isEn ? 'Exit to Shop' : 'ចេញទៅមើលហាង'}</span>
          </button>
        </div>
      </div>

      {!serverPersistent && !getFirebaseBase(shopSettings.firebaseUrl) && (
        <div className="no-print bg-amber-50 border border-amber-300 text-amber-950 p-3.5 rounded-2xl text-xs space-y-1.5">
          <p className="font-bold">
            {isEn
              ? '⚠️ Persistent storage (Cloudflare KV or Firebase) is not connected yet!'
              : '⚠️ មិនទាន់បានភ្ជាប់ Database ផ្ទុកទិន្នន័យអចិន្ត្រៃយ៍ (Cloudflare KV ឬ Firebase) ទេ!'}
          </p>
          <p className="text-[11px] leading-relaxed">
            {isEn
              ? 'Without persistent storage, edited images and menus may not appear on other users’ devices. Connect either option:'
              : 'បើមិនទាន់ភ្ជាប់ទេ រូបភាព និងម៉ឺនុយដែលអ្នកកែប្រែអាចមិនបង្ហាញលើទូរស័ព្ទអ្នកផ្សេងឡើយ។ សូមភ្ជាប់តាមវិធីមួយណាក៏បាន៖'}
          </p>
          <ul className="text-[11px] list-disc pl-4 space-y-0.5">
            <li>
              <strong>{isEn ? 'Option 1:' : 'វិធីទី ១៖'}</strong>{' '}
              {isEn
                ? 'In Cloudflare Workers → Settings → Bindings → add KV Namespace named '
                : 'ក្នុង Cloudflare Workers → Settings → Bindings → បន្ថែម KV Namespace ឈ្មោះ '}
              <code className="font-mono-num bg-amber-100 px-1 rounded">CAFE_KV</code>
            </li>
            <li>
              <strong>{isEn ? 'Option 2:' : 'វិធីទី ២៖'}</strong>{' '}
              {isEn
                ? 'Open the Settings tab and paste your Firebase Realtime DB URL, then click Save.'
                : 'ចូលផ្ទាំង «កំណត់ហាង» ហើយបិទភ្ជាប់ Firebase Realtime DB URL រួចចុច រក្សាទុក (ដំណើរការភ្លាម ១០០%)។'}
            </li>
          </ul>
        </div>
      )}

      {/* KPIs */}
      <div className="no-print grid grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-white p-2.5 sm:p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">
              {isEn ? 'Total Revenue' : 'ចំណូលសរុប'}
            </p>
            <p className="text-base sm:text-xl font-bold font-mono-num text-[#0D4A3E] mt-0.5 truncate">
              ${totalRevenue.toFixed(2)}
            </p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-xl bg-[#E8F2EF] text-[#0D4A3E] items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white p-2.5 sm:p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">
              {isEn ? 'Orders' : 'ការកម្ម៉ង់'}
            </p>
            <p className="text-base sm:text-xl font-bold font-mono-num text-slate-900 mt-0.5">{orders.length}</p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-xl bg-amber-50 text-amber-600 items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white p-2.5 sm:p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">
              {isEn ? 'Members' : 'សមាជិក'}
            </p>
            <p className="text-base sm:text-xl font-bold font-mono-num text-slate-900 mt-0.5">
              {displayedMembers.length}
            </p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-xl bg-sky-50 text-sky-600 items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print flex gap-1.5 sm:gap-2 overflow-x-auto hide-scrollbar pb-2 border-b border-slate-200">
        {(
          [
            [
              'orders',
              `${isEn ? 'Orders' : 'ការកម្ម៉ង់'}${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
              <ClipboardList key="i-o" className="w-3.5 h-3.5" />,
            ],
            [
              'feedback',
              `${isEn ? 'Feedback' : 'មតិភ្ញៀវ'}${feedbackOrders.length > 0 ? ` (${feedbackOrders.length})` : ''}`,
              <Star key="i-f" className="w-3.5 h-3.5" />,
            ],
            [
              'menu',
              isEn ? 'Menu & Toppings' : 'ម៉ឺនុយ & Topping',
              <Coffee key="i-m" className="w-3.5 h-3.5" />,
            ],
            [
              'qr',
              isEn ? 'Table QR' : 'QR បិទតាមតុ',
              <QrCode key="i-q" className="w-3.5 h-3.5" />,
            ],
            [
              'members',
              isEn ? 'Members' : 'សមាជិក',
              <Users key="i-u" className="w-3.5 h-3.5" />,
            ],
            [
              'settings',
              isEn ? 'Settings, KHQR & Socials' : 'កំណត់ហាង, KHQR & បណ្តាញសង្គម',
              <SlidersHorizontal key="i-s" className="w-3.5 h-3.5" />,
            ],
          ] as Array<[AdminTab, string, React.ReactNode]>
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors shrink-0 flex items-center gap-1.5 ${
              activeTab === id ? 'bg-[#0D4A3E] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {/* Driver Portal Dispatch Banner */}
          <div className="bg-[#E8F2EF] border border-[#0D4A3E]/20 rounded-2xl p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#0D4A3E] text-white flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#0D4A3E] truncate">
                  {isEn
                    ? `Delivery Driver Queue (${activeDeliveryCount} active)`
                    : `ប្រព័ន្ធអ្នកដឹកជញ្ជូន (${activeDeliveryCount} កំពុងរង់ចាំដឹក)`}
                </p>
                <p className="text-[11px] text-slate-600 truncate">
                  {isEn
                    ? 'Open all-in-one Driver Portal or share link with drivers'
                    : 'បើកផ្ទាំងអ្នកដឹករួម ឬផ្ញើ Link ទៅកាន់អ្នកដឹកជញ្ជូន'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenDriverPortal}
                className="bg-[#0D4A3E] hover:bg-[#09352C] text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <Truck className="w-3.5 h-3.5 text-amber-300" />
                <span>{isEn ? 'Open Driver Portal' : 'បើកផ្ទាំងអ្នកដឹក'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(`${baseShareUrl}?driver=1`);
                  onToast(
                    isEn ? '✓ Copied Driver Portal link!' : '✓ បាន Copy Link ផ្ទាំងអ្នកដឹករួចរាល់!'
                  );
                }}
                className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{isEn ? 'Copy Portal Link' : 'Copy Link អ្នកដឹក'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap justify-between items-center gap-2">
            <div className="flex gap-1.5 overflow-x-auto">
              {(['All', 'Pending', 'Brewing', 'Ready', 'Completed'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setOrderFilter(st)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${
                    orderFilter === st
                      ? 'bg-[#0D4A3E] text-white'
                      : 'bg-white border border-slate-200 text-slate-600'
                  }`}
                >
                  {st === 'All' ? (isEn ? 'All' : 'ទាំងអស់') : getOrderStatusText(st, lang)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClearCompletedOrders}
              className="text-xs text-red-600 font-semibold flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isEn ? 'Clear Completed' : 'សម្អាតដែលរួច'}</span>
            </button>
          </div>

          {!filteredOrders.length ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 text-sm">
              {isEn ? 'No orders yet' : 'មិនមានការកម្ម៉ង់ទេ'}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {filteredOrders.map((o) => {
                const cust = o.customer || { name: '-', phone: '-' };
                const dDraft = driverDrafts[o.id] || {
                  name: o.driverInfo?.name || '',
                  phone: o.driverInfo?.phone || '',
                };
                return (
                  <div key={o.id} className="min-w-0 bg-white p-4 rounded-2xl border border-slate-200 space-y-2.5">
                    <div className="flex justify-between gap-2">
                      <div>
                        <span className="font-bold font-mono-num text-[#0D4A3E]">{o.id}</span>
                        <span className="text-xs text-slate-500 ml-2">
                          {o.type === 'dinein'
                            ? `${isEn ? 'Table' : 'តុលេខ'} ${cust.tableNum || 1}`
                            : `${isEn ? 'Delivery' : 'ដឹក'} ${cust.distanceKm || '0'} km`}
                        </span>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {o.timestamp} · {cust.name} ({cust.phone}) · {o.payment}
                        </p>
                        {o.payment === 'KHQR / ABA' && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {o.paymentVerified ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-lg">
                                <ShieldCheck className="w-3 h-3 shrink-0" />
                                <span>
                                  {isEn ? 'Paid Verified' : 'ផ្ទៀងផ្ទាត់ប្រាក់រួច'}
                                  {o.paymentPaidAmount !== undefined
                                    ? ` (${
                                        o.paymentCurrency === 'KHR'
                                          ? `${Math.round(Number(o.paymentPaidAmount)).toLocaleString()} ៛`
                                          : `$${Number(o.paymentPaidAmount).toFixed(2)}`
                                      })`
                                    : ''}
                                  {o.paymentVerifiedBy === 'bakong_md5'
                                    ? ' · Bakong Auto'
                                    : o.paymentVerifiedBy === 'telegram_owner'
                                      ? ' · Telegram Bot'
                                      : o.paymentVerifiedBy === 'slip_ref'
                                        ? ' · Slip & TX'
                                        : ''}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-lg">
                                {isEn ? 'Unverified KHQR' : 'KHQR មិនទាន់ផ្ទៀងផ្ទាត់'}
                              </span>
                            )}
                            {o.paymentRef && (
                              <span className="text-[10px] font-mono-num text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">
                                Ref: {o.paymentRef}
                              </span>
                            )}
                            {o.paymentSlipImg && (
                              <button
                                type="button"
                                onClick={() => setPreviewSlipUrl(o.paymentSlipImg || null)}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-[#0D4A3E] bg-[#E8F2EF] hover:bg-[#d5ebe4] px-2 py-0.5 rounded-lg transition-colors"
                              >
                                <span>{isEn ? 'View Slip' : 'មើល Slip'}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="font-bold font-mono-num text-base shrink-0">
                        ${Number(o.grandTotal || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-xl text-xs space-y-0.5">
                      {o.items.map((i, idx) => (
                        <div key={idx}>
                          <strong>
                            {i.qty}x {i.name}
                          </strong>{' '}
                          ({i.options})
                        </div>
                      ))}
                    </div>

                    {cust.addressNote && (
                      <p className="text-xs text-amber-800 bg-amber-50 px-3 py-1.5 rounded-lg">
                        📝 {cust.addressNote}
                      </p>
                    )}

                    {o.type === 'delivery' && (
                      <div className="bg-sky-50 p-2.5 rounded-xl text-xs space-y-2 border border-sky-200/70">
                        <div className="flex justify-between gap-2">
                          <span className="truncate font-semibold text-slate-700">
                            {cust.addressName || (isEn ? 'Pinned Map Location' : 'ទីតាំងលើផែនទី')}
                          </span>
                          {cust.coords && (
                            <a
                              href={`https://maps.google.com/?q=${cust.coords.lat},${cust.coords.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold underline shrink-0 text-sky-700"
                            >
                              Google Maps ↗
                            </a>
                          )}
                        </div>

                        {/* Assign Driver Inline */}
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-1.5 items-center pt-1">
                          <input
                            type="text"
                            value={dDraft.name}
                            onChange={(e) =>
                              setDriverDrafts((prev) => ({
                                ...prev,
                                [o.id]: { ...dDraft, name: e.target.value },
                              }))
                            }
                            placeholder={isEn ? 'Driver name' : 'ឈ្មោះអ្នកដឹក'}
                            className="bg-white border border-sky-200 rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-[#0D4A3E]"
                          />
                          <input
                            type="tel"
                            value={dDraft.phone}
                            onChange={(e) =>
                              setDriverDrafts((prev) => ({
                                ...prev,
                                [o.id]: { ...dDraft, phone: e.target.value },
                              }))
                            }
                            placeholder={isEn ? 'Driver phone' : 'លេខអ្នកដឹក'}
                            className="bg-white border border-sky-200 rounded-lg px-2 py-1.5 text-[11px] font-mono-num outline-none focus:border-[#0D4A3E]"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveDriverAssignment(o)}
                            className="bg-[#0D4A3E] text-white px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0"
                          >
                            {isEn ? 'Assign' : 'កំណត់'}
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenDriverConsole(o.id)}
                            className="flex-1 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-1.5 rounded-lg text-xs"
                          >
                            🛵 {isEn ? 'Open Driver (Live GPS)' : 'បើកទម្រង់អ្នកដឹក (Live GPS)'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(`${baseShareUrl}?driver=${encodeURIComponent(o.id)}`);
                              onToast(
                                isEn
                                  ? 'Copied delivery driver link!'
                                  : 'Copy Link អ្នកដឹកជញ្ជូនរួចរាល់!'
                              );
                            }}
                            className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold"
                          >
                            Copy Link
                          </button>
                        </div>
                      </div>
                    )}

                    {o.feedback && (
                      <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-amber-900 flex items-center gap-1 text-[11px]">
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>{isEn ? 'Customer Rating' : 'មតិវាយតម្លៃភ្ញៀវ'}</span>
                          </span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`w-3.5 h-3.5 ${
                                  s <= o.feedback!.rating
                                    ? 'fill-amber-400 text-amber-500'
                                    : 'text-slate-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        {o.feedback.comment && (
                          <p className="text-[11px] text-slate-700 leading-relaxed">“{o.feedback.comment}”</p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-slate-100">
                      <select
                        value={o.status}
                        onChange={(e) => onUpdateOrderStatus(o.id, e.target.value as OrderStatus)}
                        className="text-xs font-bold border border-slate-200 rounded-xl px-2.5 py-1.5"
                      >
                        <option value="Pending">{getOrderStatusText('Pending', lang)}</option>
                        <option value="Brewing">{getOrderStatusText('Brewing', lang)}</option>
                        <option value="Ready">{getOrderStatusText('Ready', lang)}</option>
                        <option value="Completed">{getOrderStatusText('Completed', lang)}</option>
                      </select>
                      <div className="flex gap-2 items-center">
                        <button
                          type="button"
                          onClick={() => printOrderReceipt(o)}
                          className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print</span>
                        </button>
                        {cust.tg && (
                          <a
                            href={`https://t.me/${encodeURIComponent(cust.tg.replace('@', ''))}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-sky-600 font-bold underline"
                          >
                            Telegram
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Customer Feedback Tab */}
      {activeTab === 'feedback' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <Star className="w-6 h-6 fill-amber-400 text-amber-500" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#0D4A3E]">
                  {isEn
                    ? `Customer Ratings & Reviews (${feedbackOrders.length})`
                    : `ការវាយតម្លៃ & មតិយោបល់ភ្ញៀវ (${feedbackOrders.length})`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isEn
                    ? 'Collected from orders marked as Completed'
                    : 'ប្រមូលបានពីការកម្ម៉ង់ដែលបានបញ្ចប់ (Completed)'}
                </p>
              </div>
            </div>
            <div className="bg-[#E8F2EF] px-4 py-2 rounded-xl text-center">
              <p className="text-[10px] font-bold text-[#0D4A3E]">
                {isEn ? 'Average Score' : 'ពិន្ទុមធ្យម (Average)'}
              </p>
              <p className="text-lg font-bold font-mono-num text-[#0D4A3E]">
                ★ {feedbackOrders.length ? averageRating.toFixed(1) : '0.0'} / 5.0
              </p>
            </div>
          </div>

          {!feedbackOrders.length ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-500">
                {isEn ? 'No customer reviews yet' : 'មិនទាន់មានការវាយតម្លៃពីភ្ញៀវនៅឡើយទេ'}
              </p>
              <p className="text-xs text-slate-400">
                {isEn
                  ? 'Once an order is marked Completed, customers can submit star ratings and comments from their Profile.'
                  : 'ពេលការកម្ម៉ង់ត្រូវបានដាក់ជា «បានបញ្ចប់ (Completed)» ភ្ញៀវអាចផ្ញើផ្កាយ និងមតិក្នុងប្រវត្តិគណនីរបស់ពួកគេ។'}
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3.5">
              {feedbackOrders.map((o) => {
                const fb = o.feedback!;
                const dateLabel = fb.submittedAt
                  ? new Date(fb.submittedAt).toLocaleString(isEn ? 'en-US' : 'km-KH', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : o.timestamp;
                return (
                  <div
                    key={`fb-${o.id}`}
                    className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-900 truncate">
                          {fb.customerName || o.customer?.name || (isEn ? 'Customer' : 'ភ្ញៀវ')}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono-num">
                          {o.id} · {dateLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200/70 shrink-0">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`w-3.5 h-3.5 ${
                              s <= fb.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    {fb.comment ? (
                      <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl leading-relaxed">
                        “{fb.comment}”
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">
                        {isEn
                          ? `No written comment (${fb.rating}/5 stars)`
                          : `គ្មានមតិជាអក្សរ (ផ្តល់ពិន្ទុផ្កាយ ${fb.rating}/5)`}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 truncate">
                      {isEn ? 'Items: ' : 'ទំនិញ៖ '}
                      {o.items.map((it) => `${it.qty}x ${it.name}`).join(', ')}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Menu & Toppings Tab */}
      {activeTab === 'menu' && (
        <div className="space-y-4">
          {/* Top Bar for Quick Menu Selection (Presets) */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900">
                  {isEn
                    ? 'Quick Select Ready-Made Menu Items'
                    : 'ជ្រើសរើសម៉ឺនុយស្រាប់បន្ថែមចូលហាងលឿន'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {isEn
                    ? 'Pick drinks or foods with bilingual KM/EN names & add in one click'
                    : 'ធីកជ្រើសរើសភេសជ្ជៈ ឬអាហារដែលមានស្រាប់ (ខ្មែរ/អង់គ្លេស) ដាក់ចូលម៉ឺនុយភ្លាមៗ'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPresetPicker((prev) => !prev)}
              className="bg-[#0D4A3E] hover:bg-[#09352C] text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                {showPresetPicker
                  ? isEn
                    ? 'Hide Presets'
                    : 'បិទបញ្ជីម៉ឺនុយស្រាប់'
                  : isEn
                    ? 'Browse & Select Presets'
                    : 'ជ្រើសរើសម៉ឺនុយស្រាប់'}
              </span>
            </button>
          </div>

          {showPresetPicker && (
            <div className="bg-white p-4 rounded-2xl border-2 border-[#0D4A3E]/30 space-y-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#0D4A3E]">
                  {isEn
                    ? `Select items to add (${selectedPresetIds.length} selected)`
                    : `ធីកជ្រើសរើសម៉ឺនុយ (${selectedPresetIds.length} មុខ)`}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newOnes = MENU_PRESET_TEMPLATES.filter(
                        (p) =>
                          !existingMenuNameSet.has(p.name.toLowerCase()) &&
                          !existingMenuNameSet.has(p.nameEn.toLowerCase())
                      ).map((p) => p.presetId);
                      setSelectedPresetIds(newOnes);
                    }}
                    className="text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg"
                  >
                    {isEn ? 'Select All New' : 'រើសមុខថ្មីទាំងអស់'}
                  </button>
                  <button
                    type="button"
                    disabled={selectedPresetIds.length === 0}
                    onClick={handleAddSelectedPresets}
                    className="text-xs font-bold bg-[#0D4A3E] disabled:opacity-50 text-white px-3.5 py-1.5 rounded-xl flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {isEn
                        ? `Add Selected (${selectedPresetIds.length})`
                        : `ដាក់ចូលម៉ឺនុយ (${selectedPresetIds.length})`}
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {MENU_PRESET_TEMPLATES.map((tpl) => {
                  const checked = selectedPresetIds.includes(tpl.presetId);
                  const alreadyAdded =
                    existingMenuNameSet.has(tpl.name.toLowerCase()) ||
                    existingMenuNameSet.has(tpl.nameEn.toLowerCase());
                  return (
                    <button
                      key={tpl.presetId}
                      type="button"
                      onClick={() =>
                        setSelectedPresetIds((prev) =>
                          prev.includes(tpl.presetId)
                            ? prev.filter((id) => id !== tpl.presetId)
                            : [...prev, tpl.presetId]
                        )
                      }
                      className={`text-left p-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${
                        checked
                          ? 'bg-[#E8F2EF] border-[#0D4A3E]'
                          : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          checked ? 'bg-[#0D4A3E] border-[#0D4A3E] text-white' : 'bg-white border-slate-300'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <img
                        src={resolveAssetUrl(tpl.img, CAFE_ASSETS.icedLatte)}
                        alt={tpl.nameEn}
                        onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                        className="w-10 h-10 rounded-lg object-cover shrink-0 bg-white"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-xs text-slate-900 truncate">
                            {isEn ? tpl.nameEn : tpl.name}
                          </p>
                          {alreadyAdded && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                              {isEn ? 'Added' : 'មានហើយ'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {isEn ? tpl.name : tpl.nameEn} · ${tpl.price.toFixed(2)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
            {/* Left Column: Add/Edit Bilingual Item + Toppings */}
            <div className="min-w-0 space-y-4">
              <div ref={menuFormRef} className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200">
                <h3 className="font-bold text-sm mb-3 text-[#0D4A3E] break-words">
                  {editId
                    ? `${isEn ? 'Edit Item' : 'កែប្រែ'}៖ ${itemName || itemNameEn}`
                    : isEn
                      ? '+ Add New Drink / Food'
                      : '+ បន្ថែមភេសជ្ជៈ / អាហារថ្មី'}
                </h3>
                <form onSubmit={handleSaveMenuItem} className="space-y-2.5">
                  <select
                    value={itemType}
                    onChange={(e) => setItemType(e.target.value as ItemType)}
                    className="w-full min-w-0 px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white font-semibold"
                  >
                    <option value="drink">
                      {isEn
                        ? '☕ Drink (Hot/Iced, Size, Sugar, Ice, Topping)'
                        : '☕ ភេសជ្ជៈ (ក្តៅ/ត្រជាក់, Size, ផ្អែម, ទឹកកក, Topping)'}
                    </option>
                    <option value="food">
                      {isEn ? '🍜 Food / Noodles / Bakery' : '🍜 ចំណីអាហារ / មី / នំ'}
                    </option>
                  </select>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                        {isEn ? 'Name (Khmer) *' : 'ឈ្មោះភាសាខ្មែរ *'}
                      </label>
                      <input
                        type="text"
                        required={!itemNameEn.trim()}
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder={isEn ? 'e.g. កាហ្វេទឹកកក' : 'ឧ. កាហ្វេទឹកដោះគោទឹកកក'}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                        {isEn ? 'Name (English)' : 'ឈ្មោះភាសាអង់គ្លេស (EN)'}
                      </label>
                      <input
                        type="text"
                        value={itemNameEn}
                        onChange={(e) => setItemNameEn(e.target.value)}
                        placeholder="e.g. Iced Caramel Latte"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5 truncate">
                        {isEn ? 'Price ($) *' : 'តម្លៃ ($) *'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={itemPrice}
                        onChange={(e) => setItemPrice(e.target.value)}
                        placeholder="2.50"
                        className="w-full min-w-0 px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono-num"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5 truncate">
                        {isEn ? 'Discount %' : 'បញ្ចុះតម្លៃ %'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="90"
                        value={itemDiscount}
                        onChange={(e) => setItemDiscount(e.target.value)}
                        placeholder="0"
                        className="w-full min-w-0 px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono-num"
                      />
                    </div>
                  </div>

                  {/* Category quick-select + custom input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 block">
                      {isEn ? 'Category (Pick or Type)' : 'ប្រភេទមុខទំនិញ (ចុចរើស ឬវាយបញ្ចូល)'}
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {CATEGORY_PRESETS.map((c) => {
                        const selected = itemCat === c.value;
                        return (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => {
                              setItemCat(c.value);
                              setItemCatEn(c.valueEn);
                            }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                              selected
                                ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}
                          >
                            {isEn ? c.labelEn : c.labelKm}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      required
                      value={itemCat}
                      onChange={(e) => {
                        setItemCat(e.target.value);
                        if (!itemCatEn) setItemCatEn(e.target.value);
                      }}
                      placeholder={isEn ? 'Category e.g. Coffee, Matcha...' : 'ប្រភេទ (ឧ. Coffee, Matcha, Food & Noodles)'}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>

                  {/* Image URL + File + Quick Stock Photo Picker */}
                  <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                    <label className="text-[10px] font-bold text-slate-600 block">
                      {isEn ? 'Photo (URL, Upload, or Preset)' : 'រូបភាព (Link, Upload ឬរើសរូបស្រាប់)'}
                    </label>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {STOCK_IMAGE_CHOICES.map((st) => (
                        <button
                          key={st.labelEn}
                          type="button"
                          onClick={() => setItemImg(st.url)}
                          className={`shrink-0 p-1 rounded-lg border text-center ${
                            itemImg === st.url
                              ? 'border-[#0D4A3E] bg-[#E8F2EF]'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <img
                            src={st.url}
                            alt={st.labelEn}
                            className="w-9 h-9 rounded-md object-cover mx-auto"
                          />
                          <span className="text-[9px] font-bold block mt-0.5 text-slate-700">
                            {isEn ? st.labelEn : st.labelKm}
                          </span>
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      inputMode="url"
                      value={itemImg.startsWith('data:') ? '' : itemImg}
                      onChange={(e) => setItemImg(e.target.value)}
                      placeholder={isEn ? 'Image URL or /assets/...' : 'Link រូបភាព ឬ /assets/...'}
                      className="w-full min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                    />
                    <div className="flex items-center gap-2 min-w-0">
                      {itemImg && (
                        <img
                          src={resolveAssetUrl(itemImg, CAFE_ASSETS.icedLatte)}
                          alt="Preview"
                          onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                          className="w-10 h-10 rounded-lg object-cover border shrink-0 bg-white"
                        />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (f) compressImageFile(f, 400, (b) => setItemImg(b), onToast);
                        }}
                        className="text-xs min-w-0 flex-1 w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <textarea
                      rows={2}
                      value={itemDesc}
                      onChange={(e) => setItemDesc(e.target.value)}
                      placeholder={isEn ? 'Description (Khmer)...' : 'ពិពណ៌នា (ខ្មែរ)...'}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                    <textarea
                      rows={2}
                      value={itemDescEn}
                      onChange={(e) => setItemDescEn(e.target.value)}
                      placeholder={isEn ? 'Description (English)...' : 'ពិពណ៌នា (អង់គ្លេស EN)...'}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 pt-1 text-xs">
                    <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={itemAvailable}
                        onChange={(e) => setItemAvailable(e.target.checked)}
                        className="accent-[#0D4A3E] w-4 h-4"
                      />
                      <span>{isEn ? 'Available' : 'មានក្នុងស្តុក'}</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 font-semibold text-amber-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={itemFeatured}
                        onChange={(e) => setItemFeatured(e.target.checked)}
                        className="accent-amber-500 w-4 h-4"
                      />
                      <span>★ {isEn ? 'Featured' : 'ណែនាំពិសេស'}</span>
                    </label>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 bg-[#0D4A3E] text-white font-bold py-2.5 rounded-xl text-xs"
                    >
                      {editId
                        ? isEn
                          ? 'Save Changes'
                          : 'រក្សាទុកការកែប្រែ'
                        : isEn
                          ? '+ Add to Menu'
                          : '+ រក្សាទុកទំនិញថ្មី'}
                    </button>
                    {editId && (
                      <button
                        type="button"
                        onClick={resetMenuForm}
                        className="px-3 bg-slate-200 rounded-xl text-xs font-bold"
                      >
                        {isEn ? 'Cancel' : 'បោះបង់'}
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Toppings Section (Bilingual) */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200">
                <h3 className="font-bold text-sm mb-2 text-[#0D4A3E]">
                  {isEn ? 'Manage Toppings' : 'គ្រប់គ្រង Topping'}
                </h3>
                <form onSubmit={handleAddTopping} className="space-y-1.5 mb-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      required={!newTopNameEn.trim()}
                      value={newTopName}
                      onChange={(e) => setNewTopName(e.target.value)}
                      placeholder={isEn ? 'Name (Khmer)' : 'ឈ្មោះ (ខ្មែរ)'}
                      className="w-full min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs"
                    />
                    <input
                      type="text"
                      value={newTopNameEn}
                      onChange={(e) => setNewTopNameEn(e.target.value)}
                      placeholder={isEn ? 'Name (English)' : 'ឈ្មោះ (English)'}
                      className="w-full min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                  <div className="flex gap-1.5 min-w-0">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      required
                      value={newTopPrice}
                      onChange={(e) => setNewTopPrice(e.target.value)}
                      placeholder="$0.50"
                      className="min-w-0 flex-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs font-mono-num"
                    />
                    <button
                      type="submit"
                      className="bg-[#0D4A3E] text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap"
                    >
                      + {isEn ? 'Add' : 'បន្ថែម'}
                    </button>
                  </div>
                </form>
                <div className="space-y-1.5">
                  {toppings.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl text-xs"
                    >
                      <span className="truncate">
                        <strong>{getToppingName(t, lang)}</strong>{' '}
                        {t.nameEn && t.name && t.name !== t.nameEn && (
                          <span className="text-[10px] text-slate-400">
                            ({isEn ? t.name : t.nameEn})
                          </span>
                        )}{' '}
                        <span className="font-mono-num">(+${Number(t.price).toFixed(2)})</span>
                      </span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateToppings(
                              toppings.map((x) => (x.id === t.id ? { ...x, available: !x.available } : x))
                            )
                          }
                          className={`px-2 py-0.5 rounded font-bold ${
                            t.available ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {t.available ? (isEn ? 'In Stock' : 'មាន') : isEn ? 'Out' : 'អស់'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateToppings(toppings.filter((x) => x.id !== t.id))}
                          className="text-red-500 font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Menu List with Search, Filters, and Multi-Select Bulk Controls */}
            <div className="lg:col-span-2 min-w-0 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 h-fit space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <h3 className="font-bold text-sm">
                  {isEn ? `All Menu Items (${menuItems.length})` : `បញ្ជីទំនិញទាំងអស់ (${menuItems.length})`}
                </h3>
                {confirmClearMenu ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateMenu([]);
                        setConfirmClearMenu(false);
                        setSelectedMenuIds([]);
                        onToast(isEn ? 'Cleared all menu items!' : 'បានលុបម៉ឺនុយទាំងអស់!');
                      }}
                      className="text-xs bg-red-600 text-white font-bold px-3 py-1 rounded-xl whitespace-nowrap"
                    >
                      {isEn ? 'Confirm Clear' : 'បញ្ជាក់លុប'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearMenu(false)}
                      className="text-xs bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-xl whitespace-nowrap"
                    >
                      {isEn ? 'Cancel' : 'បោះបង់'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearMenu(true)}
                    className="text-xs bg-red-50 text-red-600 font-bold px-3 py-1 rounded-xl shrink-0 whitespace-nowrap"
                  >
                    {isEn ? 'Clear All' : 'លុបទាំងអស់'}
                  </button>
                )}
              </div>

              {/* Search & Filters */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      placeholder={isEn ? 'Search menu (KM / EN)...' : 'ស្វែងរកទំនិញ (ខ្មែរ / អង់គ្លេស)...'}
                      className="w-full min-w-0 pl-8 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs outline-none focus:border-[#0D4A3E]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {(
                      [
                        ['all', isEn ? 'All' : 'ទាំងអស់'],
                        ['drink', isEn ? 'Drinks' : 'ភេសជ្ជៈ'],
                        ['food', isEn ? 'Food' : 'អាហារ'],
                      ] as const
                    ).map(([tId, tLabel]) => (
                      <button
                        key={tId}
                        type="button"
                        onClick={() => setMenuTypeFilter(tId)}
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap ${
                          menuTypeFilter === tId
                            ? 'bg-[#0D4A3E] text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {tLabel}
                      </button>
                    ))}
                  </div>
                </div>

                {existingCategories.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto hide-scrollbar pb-1">
                    {['All', ...existingCategories].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setMenuCatFilter(c)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${
                          menuCatFilter === c
                            ? 'bg-amber-400 text-slate-900 font-bold'
                            : 'bg-slate-50 border border-slate-200 text-slate-600'
                        }`}
                      >
                        {c === 'All' ? (isEn ? 'All Categories' : 'គ្រប់ប្រភេទ') : getMenuCategoryLabel(c, lang)}
                      </button>
                    ))}
                  </div>
                )}

                {/* Bulk Multi-select Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 px-3 py-2 rounded-xl text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      const visibleIds = filteredMenuItems.map((m) => String(m.id));
                      const allSelected =
                        visibleIds.length > 0 && visibleIds.every((id) => selectedMenuIds.includes(id));
                      setSelectedMenuIds(allSelected ? [] : visibleIds);
                    }}
                    className="font-bold text-slate-700 inline-flex items-center gap-1.5"
                  >
                    {filteredMenuItems.length > 0 &&
                    filteredMenuItems.every((m) => selectedMenuIds.includes(String(m.id))) ? (
                      <CheckSquare className="w-4 h-4 text-[#0D4A3E]" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                    <span>
                      {isEn
                        ? `Select (${selectedMenuIds.length})`
                        : `ជ្រើសរើស (${selectedMenuIds.length})`}
                    </span>
                  </button>

                  {selectedMenuIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleBulkMenuAction('available')}
                        className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg font-bold"
                      >
                        {isEn ? 'Available' : 'ដាក់មាន'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkMenuAction('soldout')}
                        className="bg-amber-100 text-amber-800 px-2 py-1 rounded-lg font-bold"
                      >
                        {isEn ? 'Sold Out' : 'ដាក់អស់'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkMenuAction('featured')}
                        className="bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 rounded-lg font-bold"
                      >
                        ★ {isEn ? 'Featured' : 'ណែនាំ'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkMenuAction('delete')}
                        className="bg-red-100 text-red-700 px-2 py-1 rounded-lg font-bold"
                      >
                        {isEn ? 'Delete' : 'លុប'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                {!filteredMenuItems.length ? (
                  <p className="text-center text-xs text-slate-400 py-8">
                    {isEn ? 'No menu items match this filter.' : 'មិនមានទំនិញត្រូវនឹងការស្វែងរកទេ'}
                  </p>
                ) : (
                  filteredMenuItems.map((i) => {
                    const isChecked = selectedMenuIds.includes(String(i.id));
                    return (
                      <div
                        key={i.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 sm:p-3 border rounded-2xl transition-colors ${
                          isChecked ? 'border-[#0D4A3E] bg-[#E8F2EF]/40' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => toggleMenuSelection(i.id)}
                            aria-label="Select item"
                            className="text-slate-400 hover:text-[#0D4A3E] shrink-0 mt-0.5 sm:mt-0"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-[#0D4A3E]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                          <img
                            src={resolveAssetUrl(i.img, CAFE_ASSETS.icedLatte)}
                            alt={getMenuName(i, lang)}
                            onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                            className="w-11 h-11 rounded-xl object-cover bg-slate-100 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs text-slate-900 break-words leading-snug">
                              {getMenuName(i, lang)}{' '}
                              {i.nameEn && i.name && i.name !== i.nameEn && (
                                <span className="font-normal text-slate-400">
                                  ({isEn ? i.name : i.nameEn})
                                </span>
                              )}{' '}
                              {i.discount > 0 ? (
                                <span className="text-red-600 font-mono-num">(-{i.discount}%)</span>
                              ) : null}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5 break-words">
                              {i.type === 'food'
                                ? isEn
                                  ? '🍜 Food'
                                  : '🍜 អាហារ'
                                : isEn
                                  ? '☕ Drink'
                                  : '☕ ភេសជ្ជៈ'}{' '}
                              · {getMenuCategoryLabel(i.category, lang, i.categoryEn)} ·{' '}
                              <span className="font-bold font-mono-num text-[#0D4A3E]">
                                ${getDiscountedPrice(i).toFixed(2)}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                          <button
                            type="button"
                            title={isEn ? 'Toggle Featured' : 'ដាក់/ដក ណែនាំពិសេស'}
                            onClick={() =>
                              onUpdateMenu(
                                menuItems.map((x) => (x.id === i.id ? { ...x, featured: !x.featured } : x))
                              )
                            }
                            className={`p-1.5 rounded-lg border ${
                              i.featured
                                ? 'bg-amber-50 border-amber-300 text-amber-500'
                                : 'bg-white border-slate-200 text-slate-300 hover:text-amber-400'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${i.featured ? 'fill-amber-400' : ''}`} />
                          </button>
                          <button
                            type="button"
                            title={isEn ? 'Duplicate' : 'ចម្លង'}
                            onClick={() => handleDuplicateItem(i)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditItem(i)}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 whitespace-nowrap"
                          >
                            {isEn ? 'Edit' : 'កែប្រែ'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateMenu(
                                menuItems.map((x) => (x.id === i.id ? { ...x, available: !x.available } : x))
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${
                              i.available ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {i.available ? (isEn ? 'In Stock' : 'មាន') : isEn ? 'Sold Out' : 'អស់'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateMenu(menuItems.filter((x) => x.id !== i.id))}
                            className="px-2 py-1 text-red-600 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Tab */}
      {activeTab === 'qr' && (
        <div className="space-y-4">
          <div className="no-print bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-sm text-[#0D4A3E]">
                {isEn ? 'Table QR Codes' : 'QR Code បិទតាមតុ'}
              </h3>
              <button
                type="button"
                onClick={() => window.print()}
                className="bg-slate-900 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold"
              >
                Print QR
              </button>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={qrTableCount}
                onChange={(e) => setQrTableCount(Math.min(50, Math.max(1, Number(e.target.value) || 6)))}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs"
              />
              <input
                type="text"
                value={qrBaseUrl}
                onChange={(e) => setQrBaseUrl(e.target.value)}
                placeholder="Website Link"
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs"
              />
              <input
                type="text"
                value={qrWifiText}
                onChange={(e) => setQrWifiText(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs"
              />
            </div>
            <button
              type="button"
              disabled={generatingQRs}
              onClick={generateQRs}
              className="bg-[#0D4A3E] disabled:opacity-60 text-white px-4 py-2 rounded-xl text-xs font-bold"
            >
              {generatingQRs
                ? isEn
                  ? 'Generating QRs...'
                  : 'កំពុងបង្កើត QR...'
                : isEn
                  ? 'Generate QR Stickers'
                  : 'បង្កើត QR Stickers'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: Math.min(50, Math.max(1, qrTableCount)) }, (_, idx) => idx + 1).map((tNum) => (
              <div
                key={tNum}
                className="bg-white rounded-3xl border-2 border-[#0D4A3E] overflow-hidden shadow-sm flex flex-col items-center text-center"
              >
                <div className="w-full bg-[#0D4A3E] text-white py-3 px-4 flex items-center justify-center gap-2">
                  <img
                    src={resolveAssetUrl(shopSettings.logoImg, CAFE_ASSETS.logoEmblem)}
                    alt={shopSettings.brandTitle}
                    onError={(e) => handleImgFallback(e, CAFE_ASSETS.logoEmblem)}
                    className="w-8 h-8 rounded-full object-cover border border-amber-300"
                  />
                  <div className="text-left">
                    <p className="text-[10px] uppercase text-amber-300 font-bold">{shopSettings.brandTitle}</p>
                    <h4 className="text-sm font-bold">តុលេខ {tNum} · TABLE {tNum}</h4>
                  </div>
                </div>
                <div className="p-4 flex flex-col items-center">
                  {qrDataUrls[tNum] && (
                    <img
                      src={qrDataUrls[tNum]}
                      alt={`QR Table ${tNum}`}
                      className="w-36 h-36 p-2 bg-white border-2 border-[#E8F2EF] rounded-2xl mb-2"
                    />
                  )}
                  <p className="text-xs font-bold text-[#0D4A3E]">
                    {isEn ? 'SCAN TO ORDER' : 'ស្កេនដើម្បីកម្ម៉ង់'}
                  </p>
                  <p className="text-[11px] text-slate-500">{qrWifiText}</p>
                  <div className="no-print flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => downloadSticker(tNum)}
                      className="bg-[#E8F2EF] text-[#0D4A3E] px-3 py-1.5 rounded-xl text-xs font-bold"
                    >
                      Download PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenTableView(tNum)}
                      className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold"
                    >
                      {isEn ? `Preview Table ${tNum}` : `បើកមើលតុ ${tNum}`}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <h3 className="font-bold text-sm mb-3 text-[#0D4A3E]">
            {isEn
              ? `Registered Members (${displayedMembers.length})`
              : `បញ្ជីភ្ញៀវចុះឈ្មោះផ្លូវការ (${displayedMembers.length})`}
          </h3>
          {!displayedMembers.length ? (
            <p className="text-slate-400 text-sm text-center py-8">
              {isEn ? 'No registered members yet' : 'មិនទាន់មានសមាជិក'}
            </p>
          ) : (
            <div className="space-y-2">
              {displayedMembers.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 border border-slate-200 rounded-2xl"
                >
                  <div>
                    <p className="font-bold text-sm text-slate-900">
                      {m.name}{' '}
                      <span className="text-amber-600 text-xs font-mono-num">(★ {m.points || 0})</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {m.phone || (isEn ? 'No phone' : 'គ្មានលេខ')} {m.phoneVerified ? '✓ Phone Verified' : ''} ·{' '}
                      {m.telegramUsername || m.tg || (m.telegramId ? `TG #${m.telegramId}` : isEn ? 'No Telegram' : 'គ្មាន Telegram')}{' '}
                      {m.telegramVerified ? '✓ TG Verified' : ''}
                    </p>
                  </div>
                  {(m.telegramUsername || m.tg) && (
                    <a
                      href={`https://t.me/${encodeURIComponent((m.telegramUsername || m.tg || '').replace('@', ''))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-sky-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold"
                    >
                      {isEn ? 'Chat Telegram' : 'ឆាត Telegram'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <h3 className="font-bold text-sm text-[#0D4A3E] border-b border-slate-100 pb-2">
              {isEn ? '1. Shop Name, Branding & Images' : '១. ប្តូរឈ្មោះហាង និង រូបភាពហាង'}
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={draft.brandTitle}
                onChange={(e) => setDraft({ ...draft, brandTitle: e.target.value })}
                placeholder={isEn ? 'Shop Name' : 'ឈ្មោះហាង'}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold"
              />
              <input
                type="text"
                value={draft.shopName}
                onChange={(e) => setDraft({ ...draft, shopName: e.target.value })}
                placeholder={isEn ? 'Welcome Tagline' : 'ពាក្យស្វាគមន៍'}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs"
              />
            </div>

            <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <img
                src={resolveAssetUrl(draft.logoImg, CAFE_ASSETS.logoEmblem)}
                alt="Logo"
                onError={(e) => handleImgFallback(e, CAFE_ASSETS.logoEmblem)}
                className="w-14 h-14 rounded-full object-cover border shrink-0 bg-white"
              />
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-bold block">{isEn ? 'Shop Logo' : 'Logo ហាង'}</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (f)
                      compressImageFile(
                        f,
                        250,
                        (b) => {
                          setDraft((p) => ({ ...p, logoImg: b }));
                          onToast(
                            isEn
                              ? '✓ New logo ready! Click Save Settings below.'
                              : '✓ បានដាក់ Logo ថ្មី! សូមចុច «រក្សាទុក» ខាងក្រោម'
                          );
                        },
                        onToast
                      );
                  }}
                  className="text-xs w-full"
                />
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
              <label className="text-xs font-bold block">
                {isEn ? 'Shop Banner Image' : 'រូបផ្ទាំងមុខហាង (Banner)'}
              </label>
              <img
                src={resolveAssetUrl(draft.bannerImg, CAFE_ASSETS.heroBanner)}
                alt="Banner"
                onError={(e) => handleImgFallback(e, CAFE_ASSETS.heroBanner)}
                className="w-full h-24 rounded-xl object-cover border bg-white"
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = '';
                  if (f)
                    compressImageFile(
                      f,
                      650,
                      (b) => {
                        setDraft((p) => ({ ...p, bannerImg: b }));
                        onToast(
                          isEn
                            ? '✓ New banner ready! Click Save Settings below.'
                            : '✓ បានដាក់ Banner ថ្មី! សូមចុច «រក្សាទុក» ខាងក្រោម'
                        );
                      },
                      onToast
                    );
                }}
                className="text-xs w-full"
              />
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
              <label className="text-xs font-bold text-[#0D4A3E] flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5" />
                <span>
                  {isEn ? 'Social Media Links (Shown on storefront)' : 'លីងបណ្តាញសង្គមហាង (បង្ហាញលើវេបសាយ)'}
                </span>
              </label>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={draft.facebookUrl || ''}
                  onChange={(e) => setDraft({ ...draft, facebookUrl: e.target.value })}
                  placeholder="Facebook (https://facebook.com/...)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white min-w-0 w-full"
                />
                <input
                  type="text"
                  value={draft.tiktokUrl || ''}
                  onChange={(e) => setDraft({ ...draft, tiktokUrl: e.target.value })}
                  placeholder="TikTok (https://tiktok.com/@...)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
                <input
                  type="text"
                  value={draft.instagramUrl || ''}
                  onChange={(e) => setDraft({ ...draft, instagramUrl: e.target.value })}
                  placeholder="Instagram (https://instagram.com/...)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
                <input
                  type="text"
                  value={draft.tgUsername || ''}
                  onChange={(e) => setDraft({ ...draft, tgUsername: e.target.value })}
                  placeholder="Telegram (@channel or https://t.me/...)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
                <input
                  type="text"
                  value={draft.youtubeUrl || ''}
                  onChange={(e) => setDraft({ ...draft, youtubeUrl: e.target.value })}
                  placeholder="YouTube (https://youtube.com/@...)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
                <input
                  type="tel"
                  value={draft.phoneHotline || ''}
                  onChange={(e) => setDraft({ ...draft, phoneHotline: e.target.value })}
                  placeholder={isEn ? 'Shop Hotline (e.g. 012 345 678)' : 'លេខទូរស័ព្ទហាង (ឧ. 012 345 678)'}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white font-mono-num"
                />
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <h3 className="font-bold text-sm text-[#0D4A3E] border-b border-slate-100 pb-2">
              {isEn ? '2. Dynamic KHQR & Promo Code' : '២. KHQR ស្វ័យប្រវត្តិ (Dynamic Amount) & កូដ Promo'}
            </h3>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <div className="w-28 shrink-0 text-center space-y-1 mx-auto sm:mx-0">
                  {khqrPreviewUrl ? (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <div className="bg-[#E1232E] text-white text-[9px] font-bold py-0.5">
                        KHQR · $1.50
                      </div>
                      <img src={khqrPreviewUrl} alt="Dynamic KHQR Preview" className="w-24 h-24 mx-auto p-1" />
                    </div>
                  ) : draft.khqrImg ? (
                    <img
                      src={draft.khqrImg}
                      alt="Static KHQR"
                      className="w-24 h-24 rounded-xl object-contain border bg-white mx-auto"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-xl border bg-white flex items-center justify-center text-[10px] text-slate-400 mx-auto px-2">
                      Dynamic KHQR
                    </div>
                  )}
                  <p className="text-[10px] font-bold text-[#0D4A3E]">
                    {sampleDynamicKhqr.isOfficialEmv
                      ? isEn
                        ? '✓ Dynamic Ready'
                        : '✓ Dynamic ស្វ័យប្រវត្តិ'
                      : isEn
                        ? 'Static / Not set'
                        : 'Static / មិនទាន់កំណត់'}
                  </p>
                </div>

                <div className="flex-1 w-full space-y-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      {isEn
                        ? 'Option 1 (Easiest): Upload Bank KHQR Image (ABA / ACLEDA / Bakong)'
                        : 'វិធីទី ១ (ងាយបំផុត)៖ Upload រូប KHQR ធនាគារអ្នក (ABA / ACLEDA / Bakong)'}
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={decodingKhqr}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = '';
                        if (!f || decodingKhqr) return;
                        setDecodingKhqr(true);
                        try {
                          const decoded = await decodeKhqrFromImageFile(f);
                          if (decoded && isValidEmvKhqr(decoded)) {
                            const info = extractKhqrSummary(decoded);
                            setDraft((prev) => ({
                              ...prev,
                              khqrPayload: decoded,
                              khqrBakongId: info.bakongId || prev.khqrBakongId || '',
                              khqrMerchantName: info.merchantName || prev.khqrMerchantName || prev.brandTitle,
                              khqrCurrency: info.currency || prev.khqrCurrency || 'USD',
                            }));
                            onToast(
                              isEn
                                ? '✓ Decoded official KHQR — Dynamic Amount enabled!'
                                : '✓ ទាញយកកូដ KHQR ផ្លូវការស្វ័យប្រវត្តិ — បើក Dynamic Amount ជោគជ័យ!'
                            );
                          } else {
                            onToast(
                              isEn
                                ? 'Could not read QR automatically. Enter Bakong ID or paste 000201... below.'
                                : 'រូបនេះស្កេនកូដមិនច្បាស់! សូមបញ្ចូល Bakong ID ឬ Paste កូដ 000201... ខាងក្រោម'
                            );
                          }
                          compressImageFile(
                            f,
                            320,
                            (b) => setDraft((prev) => ({ ...prev, khqrImg: b })),
                            onToast
                          );
                        } finally {
                          setDecodingKhqr(false);
                        }
                      }}
                      className="text-xs w-full"
                    />
                    {decodingKhqr && (
                      <p className="text-[11px] font-bold text-amber-700 mt-1">
                        ⏳ {isEn ? 'Scanning KHQR payload...' : 'កំពុងស្កេនកូដ KHQR ពីរូបភាព...'}
                      </p>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        {isEn ? 'Option 2: Bakong ID' : 'វិធីទី ២៖ Bakong ID (ឧ. shop@aba / 012xxx@bkrt)'}
                      </label>
                      <input
                        type="text"
                        value={draft.khqrBakongId || ''}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setDraft((prev) => ({ ...prev, khqrBakongId: val }));
                        }}
                        placeholder="username@aba"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono-num bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        {isEn ? 'Merchant Name (ASCII)' : 'ឈ្មោះហាងលើ KHQR (អក្សរអង់គ្លេស)'}
                      </label>
                      <input
                        type="text"
                        maxLength={25}
                        value={draft.khqrMerchantName || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((prev) => ({ ...prev, khqrMerchantName: val }));
                        }}
                        placeholder="SUAN COFFEE"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        {isEn ? 'KHQR Currency' : 'រូបិយប័ណ្ណ KHQR'}
                      </label>
                      <select
                        value={draft.khqrCurrency || 'USD'}
                        onChange={(e) => {
                          const val = e.target.value === 'KHR' ? 'KHR' : 'USD';
                          setDraft((prev) => ({ ...prev, khqrCurrency: val }));
                        }}
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold bg-white"
                      >
                        <option value="USD">USD ($)</option>
                        <option value="KHR">KHR (៛)</option>
                      </select>
                    </div>
                    {draft.khqrCurrency === 'KHR' && (
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          {isEn ? 'Rate 1$ = (KHR)' : 'អត្រាប្តូរ 1$ = (៛)'}
                        </label>
                        <input
                          type="number"
                          min={3500}
                          step={50}
                          value={draft.khqrKhrRate || 4100}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 4100;
                            setDraft((prev) => ({ ...prev, khqrKhrRate: val }));
                          }}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono-num bg-white"
                        />
                      </div>
                    )}
                    <div className={draft.khqrCurrency === 'KHR' ? '' : 'sm:col-span-2'}>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        {isEn ? 'Bank Display Note' : 'ព័ត៌មានធនាគារបន្ថែម (បង្ហាញលើវិក្កយបត្រ)'}
                      </label>
                      <input
                        type="text"
                        value={draft.bankInfo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((prev) => ({ ...prev, bankInfo: val }));
                        }}
                        placeholder="ABA: SUAN COFFEE (001 234 567)"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      {isEn ? 'Raw KHQR Payload (000201...)' : 'កូដ KHQR ដើម (000201...)'}
                    </label>
                    <input
                      type="text"
                      value={draft.khqrPayload || ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setDraft((prev) => ({ ...prev, khqrPayload: val }));
                      }}
                      placeholder="000201010211..."
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[11px] font-mono-num bg-white"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-200/80">
                    <label className="text-[11px] font-bold text-[#0D4A3E] block mb-0.5">
                      {isEn
                        ? 'Bakong Open API Token (Auto Verify Paid Amount via MD5)'
                        : 'Bakong Open API Token (ផ្ទៀងផ្ទាត់ប្រាក់ចូល & ចំនួនទឹកប្រាក់ Auto តាម MD5)'}
                    </label>
                    <input
                      type="password"
                      value={secrets.bakongToken || ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setSecrets((prev) => ({ ...prev, bakongToken: val }));
                      }}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full px-2.5 py-1.5 border border-emerald-200 rounded-lg text-base sm:text-xs font-mono-num bg-white focus:outline-none focus:border-[#0D4A3E]"
                    />
                    <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      {isEn
                        ? 'Stored safely on server only. Checks Bakong NBC transaction MD5 + exact amount automatically every 2.5s; works alongside Telegram Bot approval.'
                        : 'រក្សាទុកសុវត្ថិភាពលើ Server តែប៉ុណ្ណោះ។ ប្រព័ន្ធនឹងឆែកប្រតិបត្តិការ Bakong NBC & ចំនួនប្រាក់ពិតស្វ័យប្រវត្តិរៀងរាល់ 2.5 វិនាទី និងធ្វើការរួមជាមួយការអនុម័តតាម Telegram Bot។'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
              <div>
                <label className="text-xs font-bold block">{isEn ? 'Promo Code' : 'លេខកូដ Promo'}</label>
                <input
                  type="text"
                  value={draft.promoCode}
                  onChange={(e) => setDraft({ ...draft, promoCode: e.target.value.toUpperCase() })}
                  className="w-full mt-1 px-3 py-1.5 border border-slate-200 rounded-xl text-xs uppercase font-bold"
                />
              </div>
              <div>
                <label className="text-xs font-bold block">{isEn ? 'Discount (%)' : 'បញ្ចុះតម្លៃ (%)'}</label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={draft.promoPercent}
                  onChange={(e) => setDraft({ ...draft, promoPercent: Number(e.target.value) || 0 })}
                  className="w-full mt-1 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold"
                />
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <h3 className="font-bold text-sm text-[#0D4A3E] border-b border-slate-100 pb-2">
              {isEn ? '3. Shop Location & Delivery Fees' : '៣. ទីតាំងហាង & តម្លៃដឹកជញ្ជូន'}
            </h3>
            <select
              value={draft.deliveryMode}
              onChange={(e) => setDraft({ ...draft, deliveryMode: e.target.value as DeliveryMode })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white font-bold"
            >
              <option value="distance">
                {isEn
                  ? 'By Map Distance ($ Base + $/km)'
                  : 'គិតតាមចម្ងាយផែនទី ($ ចាប់ផ្តើម + $/km)'}
              </option>
              <option value="flat">
                {isEn ? 'Flat Rate Everywhere' : 'តម្លៃថេរគ្រប់ទីតាំង (Flat Rate)'}
              </option>
              <option value="free">{isEn ? 'Free Delivery All Orders' : 'ដឹកជញ្ជូនហ្វ្រីទាំងអស់'}</option>
            </select>
            {draft.deliveryMode !== 'free' && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-bold block">
                    {draft.deliveryMode === 'flat'
                      ? isEn
                        ? 'Flat Fee ($)'
                        : 'តម្លៃថេរ ($)'
                      : isEn
                        ? 'Base ($)'
                        : 'ចាប់ផ្តើម ($)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={draft.baseFee}
                    onChange={(e) => setDraft({ ...draft, baseFee: Number(e.target.value) || 0 })}
                    className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                {draft.deliveryMode === 'distance' && (
                  <div>
                    <label className="text-[11px] font-bold block">
                      {isEn ? 'Per km ($)' : 'បន្ថែម ($/km)'}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={draft.deliveryRatePerKm}
                      onChange={(e) =>
                        setDraft({ ...draft, deliveryRatePerKm: Number(e.target.value) || 0 })
                      }
                      className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[11px] font-bold block">
                    {isEn ? 'Free Over ($)' : 'ហ្វ្រីលើស ($)'}
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={draft.freeDeliveryOver}
                    onChange={(e) => setDraft({ ...draft, freeDeliveryOver: Number(e.target.value) || 0 })}
                    className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>
            )}
            <div className="bg-[#E8F2EF] text-[#0D4A3E] px-3 py-2 rounded-xl text-xs font-bold">
              {deliveryPreview}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpenShopMapPicker}
                className="text-xs bg-[#0D4A3E] text-white font-bold px-3 py-1.5 rounded-lg"
              >
                📍 {isEn ? 'Pick Shop Location on Map' : 'រើសទីតាំងហាងលើ Map'}
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, lat: 11.5564, lng: 104.9282 })}
                className="text-xs bg-slate-100 px-2.5 py-1.5 rounded-lg"
              >
                {isEn ? 'Phnom Penh' : 'ភ្នំពេញ'}
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, lat: 13.3633, lng: 103.8564 })}
                className="text-xs bg-slate-100 px-2.5 py-1.5 rounded-lg"
              >
                {isEn ? 'Siem Reap' : 'សៀមរាប'}
              </button>
              <span className="text-[11px] text-slate-500 font-mono-num">
                ({Number(draft.lat).toFixed(5)}, {Number(draft.lng).toFixed(5)})
              </span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <h3 className="font-bold text-sm text-[#0D4A3E] border-b border-slate-100 pb-2">
              {isEn
                ? '4. Telegram Bot, Phone OTP API & Owner PIN'
                : '៤. ការតភ្ជាប់ Telegram Bot, Phone OTP API & PIN (រក្សាទុកសុវត្ថិភាពលើ Server)'}
            </h3>

            <div className="bg-sky-50 p-3.5 rounded-xl border border-sky-200 space-y-2">
              <p className="text-xs font-bold text-slate-900">
                {isEn
                  ? 'Official Telegram Bot (Free · Login, Contact Verification & Order Alerts)'
                  : 'Telegram Bot ផ្លូវការ (Free ១០០% · ចូលគណនី, ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ Share Contact & Order Alerts)'}
              </p>
              <div className="grid sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={draft.botUsername}
                  onChange={(e) => setDraft({ ...draft, botUsername: e.target.value.replace('@', '') })}
                  placeholder="Bot Username (no @)"
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                />
                <input
                  type="password"
                  value={secrets.botToken}
                  onChange={(e) => setSecrets({ ...secrets, botToken: e.target.value })}
                  placeholder="Bot Token (@BotFather)"
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                />
                <input
                  type="text"
                  value={secrets.chatId}
                  onChange={(e) => setSecrets({ ...secrets, chatId: e.target.value })}
                  placeholder="Group Chat ID"
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                />
              </div>
              <input
                type="text"
                value={draft.tgUsername}
                onChange={(e) => setDraft({ ...draft, tgUsername: e.target.value.replace('@', '') })}
                placeholder={
                  isEn
                    ? 'Shop Telegram Username for Order Receipts (no @)'
                    : 'Telegram Username ហាងសម្រាប់ភ្ជាប់វិក្កយបត្រ (អត់ @)'
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
              />
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
              <p className="text-xs font-bold text-slate-900">
                {isEn
                  ? 'Optional: SMS OTP Providers (Leave empty if using free Telegram Bot above)'
                  : 'ជម្រើសបន្ថែម៖ សេវាផ្ញើ SMS OTP (គិតថ្លៃតាមសារ — មិនចាំបាច់បំពេញបើប្រើ Telegram Free ខាងលើ)'}
              </p>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Telegram Gateway API Token
                </label>
                <input
                  type="password"
                  value={secrets.telegramGatewayToken}
                  onChange={(e) => setSecrets({ ...secrets, telegramGatewayToken: e.target.value })}
                  placeholder="Telegram Gateway Token"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                />
              </div>

              <div className="pt-1 border-t border-slate-200">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Twilio SMS API</label>
                <div className="grid sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={secrets.twilioAccountSid}
                    onChange={(e) => setSecrets({ ...secrets, twilioAccountSid: e.target.value })}
                    placeholder="Account SID"
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                  <input
                    type="password"
                    value={secrets.twilioAuthToken}
                    onChange={(e) => setSecrets({ ...secrets, twilioAuthToken: e.target.value })}
                    placeholder="Auth Token"
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                  <input
                    type="text"
                    value={secrets.twilioFromNumber}
                    onChange={(e) => setSecrets({ ...secrets, twilioFromNumber: e.target.value })}
                    placeholder="From (+1...)"
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>

              <div className="pt-1 border-t border-slate-200">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Custom SMS Gateway Webhook
                </label>
                <div className="grid sm:grid-cols-2 gap-2">
                  <input
                    type="url"
                    value={secrets.smsWebhookUrl}
                    onChange={(e) => setSecrets({ ...secrets, smsWebhookUrl: e.target.value })}
                    placeholder="https://your-sms-provider.com/send"
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                  <input
                    type="password"
                    value={secrets.smsWebhookApiKey}
                    onChange={(e) => setSecrets({ ...secrets, smsWebhookApiKey: e.target.value })}
                    placeholder="API Key / Bearer Token"
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>
            </div>

            <input
              type="url"
              value={draft.firebaseUrl}
              onChange={(e) => setDraft({ ...draft, firebaseUrl: e.target.value })}
              placeholder={isEn ? 'Firebase Realtime DB URL (optional)' : 'Firebase Realtime DB URL (ស្រេចចិត្ត)'}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
            />
            {getFirebaseBase(draft.firebaseUrl) && (
              <p className="text-[11px] text-emerald-700 font-semibold">
                ✓ {isEn ? 'Firebase URL configured' : 'Firebase URL ត្រូវបានកំណត់'}
              </p>
            )}

            <div>
              <label className="text-xs font-bold block mb-1">
                {isEn ? 'New Owner PIN' : 'លេខកូដ PIN ម្ចាស់ហាងថ្មី'}
              </label>
              <input
                type="password"
                maxLength={8}
                value={secrets.adminPin}
                onChange={(e) => setSecrets({ ...secrets, adminPin: e.target.value })}
                placeholder="PIN (1234)"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold font-mono-num"
              />
            </div>
          </div>

          <div className="sticky bottom-3 z-20 pt-2">
            <button
              type="button"
              disabled={savingSettings}
              onClick={handleSaveAllSettings}
              className="w-full bg-[#0D4A3E] hover:bg-[#09352C] disabled:opacity-70 text-white py-3.5 rounded-2xl text-sm font-bold shadow-xl border border-white/15"
            >
              {savingSettings
                ? isEn
                  ? 'Saving & Syncing...'
                  : 'កំពុងរក្សាទុក & បង្ហោះ...'
                : isEn
                  ? '💾 Save Official Settings (Sync to All Devices)'
                  : '💾 រក្សាទុកការកំណត់ផ្លូវការ (ចែករំលែកគ្រប់គ្នា)'}
            </button>
          </div>
        </div>
      )}

      {previewSlipUrl && (
        <div
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-[90] flex items-center justify-center p-4"
          onClick={() => setPreviewSlipUrl(null)}
        >
          <div
            className="bg-white rounded-3xl p-3 max-w-sm w-full space-y-2.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[#0D4A3E]">
                {isEn ? 'Payment Slip' : 'រូបភាពវិក្កយបត្រវេរប្រាក់ (Slip)'}
              </span>
              <button
                type="button"
                onClick={() => setPreviewSlipUrl(null)}
                className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200"
                aria-label={isEn ? 'Close' : 'បិទ'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={previewSlipUrl}
              alt="Payment Slip"
              className="w-full max-h-[70vh] object-contain rounded-2xl border border-slate-100 bg-slate-50"
            />
          </div>
        </div>
      )}
    </div>
  );
}

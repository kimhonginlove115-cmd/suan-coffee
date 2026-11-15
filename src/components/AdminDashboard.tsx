import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ClipboardList,
  Coffee,
  DollarSign,
  Lock,
  Printer,
  QrCode,
  Share2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  AdminSecretsConfig,
  DeliveryMode,
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
  buildDynamicKhqr,
  decodeKhqrFromImageFile,
  extractKhqrSummary,
  isValidEmvKhqr,
} from '../utils/khqr';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (adminToken: string) => void;
}

export function AdminPinModal({ isOpen, onClose, onSuccess }: PinModalProps) {
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
        setError(data.error || 'PIN មិនត្រឹមត្រូវ!');
      }
    } catch {
      setError('មិនអាចភ្ជាប់ទៅ Server ដើម្បីផ្ទៀងផ្ទាត់ PIN បានទេ');
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
        <h3 className="font-bold text-lg text-slate-900">ចូលគ្រប់គ្រងហាង</h3>
        <p className="text-xs text-slate-500 mt-1">
          បញ្ចូលលេខកូដ PIN ម្ចាស់ហាង <span className="text-[#0D4A3E] font-bold">(កូដដំបូង: 1234)</span>
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
              បោះបង់
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-[#0D4A3E] text-white py-2.5 rounded-xl text-xs font-bold"
            >
              {loading ? '...' : 'ចូល'}
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
  onClearCompletedOrders: () => void;
  onOpenDriverConsole: (orderId: string) => void;
  onOpenShopMapPicker: () => void;
  onOpenTableView: (tableNum: number) => void;
  onToast: (msg: string) => void;
}

type AdminTab = 'orders' | 'menu' | 'qr' | 'members' | 'settings';

const EMPTY_SECRETS: AdminSecretsConfig = {
  adminPin: '1234',
  botToken: '',
  chatId: '',
  telegramGatewayToken: '',
  twilioAccountSid: '',
  twilioAuthToken: '',
  twilioFromNumber: '',
  smsWebhookUrl: '',
  smsWebhookApiKey: '',
};

export function AdminDashboard({
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
  onClearCompletedOrders,
  onOpenDriverConsole,
  onOpenShopMapPicker,
  onOpenTableView,
  onToast,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [orderFilter, setOrderFilter] = useState<'All' | OrderStatus>('All');

  // Menu form state
  const [editId, setEditId] = useState<string>('');
  const [itemType, setItemType] = useState<ItemType>('drink');
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemDiscount, setItemDiscount] = useState('0');
  const [itemCat, setItemCat] = useState('');
  const [itemImg, setItemImg] = useState('');
  const [itemDesc, setItemDesc] = useState('');

  // Topping form state
  const [newTopName, setNewTopName] = useState('');
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
  const filteredOrders = orderFilter === 'All' ? orders : orders.filter((o) => o.status === orderFilter);

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

  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(itemPrice) || 0;
    const discount = parseInt(itemDiscount, 10) || 0;
    const category = itemCat.trim() || 'Coffee';

    let nextMenu: MenuItem[];
    if (editId) {
      nextMenu = menuItems.map((m) =>
        String(m.id) === editId
          ? {
              ...m,
              type: itemType,
              name: itemName.trim(),
              price,
              discount,
              category,
              desc: itemDesc.trim(),
              img: itemImg || m.img,
            }
          : m
      );
    } else {
      const newItem: MenuItem = {
        id: Date.now(),
        type: itemType,
        name: itemName.trim(),
        price,
        discount,
        category,
        img: itemImg || CAFE_ASSETS.icedLatte,
        desc: itemDesc.trim(),
        available: true,
      };
      nextMenu = [newItem, ...menuItems];
    }
    resetMenuForm();
    const res = await onUpdateMenu(nextMenu);
    if (res && res.reauth) return;
    if (res && !res.ok) return;
    if (res && !res.persistent) {
      onToast('បានរក្សាទុក! ប៉ុន្តែត្រូវភ្ជាប់ CAFE_KV ឬ Firebase ទើបអ្នកផ្សេងឃើញ');
    } else {
      onToast('✓ បានរក្សាទុកទំនិញ និងចែករំលែកគ្រប់ឧបករណ៍!');
    }
  };

  const resetMenuForm = () => {
    setEditId('');
    setItemType('drink');
    setItemName('');
    setItemPrice('');
    setItemDiscount('0');
    setItemCat('');
    setItemImg('');
    setItemDesc('');
  };

  const startEditItem = (item: MenuItem) => {
    setEditId(String(item.id));
    setItemType(item.type || 'drink');
    setItemName(item.name);
    setItemPrice(String(item.price));
    setItemDiscount(String(item.discount || 0));
    setItemCat(item.category);
    setItemImg(item.img);
    setItemDesc(item.desc || '');
  };

  const handleAddTopping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopName.trim()) return;
    const res = await onUpdateToppings([
      ...toppings,
      { id: Date.now(), name: newTopName.trim(), price: parseFloat(newTopPrice) || 0, available: true },
    ]);
    setNewTopName('');
    setNewTopPrice('');
    if (res && !res.ok) return;
    onToast('បានបន្ថែម Topping!');
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
        onToast('បានរក្សាទុក! (ត្រូវភ្ជាប់ CAFE_KV ឬ Firebase ទើបអ្នកផ្សេងឃើញរូបថ្មី)');
      } else {
        onToast('✓ បានរក្សាទុកការកំណត់ហាង និងរូបភាពជោគជ័យ!');
      }
    } catch {
      onToast('មានបញ្ហាក្នុងការរក្សាទុកការកំណត់');
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(o.id)}</title></head><body style="font-family:monospace;padding:12px;margin:0;"><h3 style="text-align:center;margin:0;">${escapeHtml(shopSettings.brandTitle)}</h3><p style="text-align:center;font-size:11px;">${escapeHtml(o.id)} | ${escapeHtml(o.timestamp)}</p><hr><p style="font-size:12px;">ភ្ញៀវ: ${escapeHtml(cust.name)} (${escapeHtml(cust.phone)})<br>${o.type === 'dinein' ? 'តុលេខ: ' + escapeHtml(cust.tableNum || 1) : escapeHtml(cust.addressName || '')}</p><hr>${o.items.map((i) => `<div style="font-size:12px;margin-bottom:4px;">${i.qty}x ${escapeHtml(i.name)} - $${(i.unitPrice * i.qty).toFixed(2)}<br><small>${escapeHtml(i.options)}</small></div>`).join('')}<hr><p style="font-weight:bold;text-align:right;">សរុប: $${Number(o.grandTotal || 0).toFixed(2)} (${escapeHtml(o.payment)})</p></body></html>`;

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
    onToast('មិនអាចបើកផ្ទាំង Print លើឧបករណ៍នេះបានទេ');
  };

  const deliveryPreview = (() => {
    if (draft.deliveryMode === 'free') return 'គំរូ៖ ដឹកជញ្ជូនហ្វ្រី $0.00!';
    if (draft.deliveryMode === 'flat')
      return `គំរូ៖ ថ្លៃដឹកថេរ $${Number(draft.baseFee || 0).toFixed(2)}${
        draft.freeDeliveryOver > 0 ? ` (ហ្វ្រីពេលទិញលើស $${draft.freeDeliveryOver})` : ''
      }`;
    const ex = Math.round(((Number(draft.baseFee) || 0) + 2 * (Number(draft.deliveryRatePerKm) || 0)) * 4) / 4;
    return `គំរូ៖ ដឹក 2 km = $${ex.toFixed(2)}${
      draft.freeDeliveryOver > 0 ? ` | ទិញលើស $${draft.freeDeliveryOver} = ហ្វ្រី` : ''
    }`;
  })();

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 pb-24 space-y-4 sm:space-y-5 overflow-x-clip">
      <div className="no-print bg-slate-900 text-white p-3 sm:p-4 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="inline-flex items-center gap-1.5 font-bold text-xs sm:text-sm truncate">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>គ្រប់គ្រងហាង</span>
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
            <span>{shopSettings.isOpen !== false ? 'ហាងបើកលក់' : 'ហាងកំពុងបិទ'}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="bg-red-500 hover:bg-red-600 text-white px-3 sm:px-4 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          <span>ចេញទៅមើលហាង</span>
        </button>
      </div>

      {!serverPersistent && !getFirebaseBase(shopSettings.firebaseUrl) && (
        <div className="no-print bg-amber-50 border border-amber-300 text-amber-950 p-3.5 rounded-2xl text-xs space-y-1.5">
          <p className="font-bold">
            ⚠️ មិនទាន់បានភ្ជាប់ Database ផ្ទុកទិន្នន័យអចិន្ត្រៃយ៍ (Cloudflare KV ឬ Firebase) ទេ!
          </p>
          <p className="text-[11px] leading-relaxed">
            បើមិនទាន់ភ្ជាប់ទេ រូបភាព និងម៉ឺនុយដែលអ្នកកែប្រែអាចមិនបង្ហាញលើទូរស័ព្ទអ្នកផ្សេងឡើយ។ សូមភ្ជាប់តាមវិធីមួយណាក៏បាន៖
          </p>
          <ul className="text-[11px] list-disc pl-4 space-y-0.5">
            <li>
              <strong>វិធីទី ១៖</strong> ក្នុង Cloudflare Workers → Settings → Bindings → បន្ថែម KV Namespace ឈ្មោះ{' '}
              <code className="font-mono-num bg-amber-100 px-1 rounded">CAFE_KV</code>
            </li>
            <li>
              <strong>វិធីទី ២៖</strong> ចូលផ្ទាំង <strong>«កំណត់ហាង»</strong> ហើយបិទភ្ជាប់{' '}
              <strong>Firebase Realtime DB URL</strong> រួចចុច រក្សាទុក (ដំណើរការភ្លាម ១០០%)។
            </li>
          </ul>
        </div>
      )}

      {/* KPIs */}
      <div className="no-print grid grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-white p-2.5 sm:p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">ចំណូលសរុប</p>
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
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">ការកម្ម៉ង់</p>
            <p className="text-base sm:text-xl font-bold font-mono-num text-slate-900 mt-0.5">{orders.length}</p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-xl bg-amber-50 text-amber-600 items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white p-2.5 sm:p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">សមាជិក</p>
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
            ['orders', `ការកម្ម៉ង់${pendingCount > 0 ? ` (${pendingCount})` : ''}`, <ClipboardList key="i-o" className="w-3.5 h-3.5" />],
            ['menu', 'ម៉ឺនុយ & Topping', <Coffee key="i-m" className="w-3.5 h-3.5" />],
            ['qr', 'QR បិទតាមតុ', <QrCode key="i-q" className="w-3.5 h-3.5" />],
            ['members', 'សមាជិក', <Users key="i-u" className="w-3.5 h-3.5" />],
            ['settings', 'កំណត់ហាង, KHQR & បណ្តាញសង្គម', <SlidersHorizontal key="i-s" className="w-3.5 h-3.5" />],
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
                  {st === 'All'
                    ? 'ទាំងអស់'
                    : st === 'Pending'
                      ? 'រង់ចាំ'
                      : st === 'Brewing'
                        ? 'កំពុងរៀបចំ'
                        : st === 'Ready'
                          ? 'កំពុងដឹក'
                          : 'រួចរាល់'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClearCompletedOrders}
              className="text-xs text-red-600 font-semibold flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>សម្អាតដែលរួច</span>
            </button>
          </div>

          {!filteredOrders.length ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 text-sm">
              មិនមានការកម្ម៉ង់ទេ
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {filteredOrders.map((o) => {
                const cust = o.customer || { name: '-', phone: '-' };
                const base = window.location.href.split('?')[0];
                return (
                  <div key={o.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2.5">
                    <div className="flex justify-between gap-2">
                      <div>
                        <span className="font-bold font-mono-num text-[#0D4A3E]">{o.id}</span>
                        <span className="text-xs text-slate-500 ml-2">
                          {o.type === 'dinein' ? `តុលេខ ${cust.tableNum || 1}` : `ដឹក ${cust.distanceKm || '0'} km`}
                        </span>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {o.timestamp} · {cust.name} ({cust.phone}) · {o.payment}
                        </p>
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
                      <div className="bg-sky-50 p-2.5 rounded-xl text-xs space-y-2">
                        <div className="flex justify-between gap-2">
                          <span className="truncate">{cust.addressName || 'ទីតាំងលើផែនទី'}</span>
                          {cust.coords && (
                            <a
                              href={`https://maps.google.com/?q=${cust.coords.lat},${cust.coords.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold underline shrink-0"
                            >
                              Google Maps ↗
                            </a>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenDriverConsole(o.id)}
                            className="flex-1 bg-amber-400 hover:bg-amber-500 font-bold py-1.5 rounded-lg text-xs"
                          >
                            🛵 បើកទម្រង់អ្នកដឹក (Live GPS)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(`${base}?driver=${encodeURIComponent(o.id)}`);
                              onToast('Copy Link អ្នកដឹកជញ្ជូនរួចរាល់!');
                            }}
                            className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold"
                          >
                            Copy Link
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-slate-100">
                      <select
                        value={o.status}
                        onChange={(e) => onUpdateOrderStatus(o.id, e.target.value as OrderStatus)}
                        className="text-xs font-bold border border-slate-200 rounded-xl px-2.5 py-1.5"
                      >
                        <option value="Pending">រង់ចាំទទួល</option>
                        <option value="Brewing">កំពុងរៀបចំ</option>
                        <option value="Ready">កំពុងដឹក</option>
                        <option value="Completed">បានបញ្ចប់</option>
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

      {/* Menu & Toppings Tab */}
      {activeTab === 'menu' && (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <h3 className="font-bold text-sm mb-3 text-[#0D4A3E]">
                {editId ? `កែប្រែ៖ ${itemName}` : '+ បញ្ចូលភេសជ្ជៈ / អាហារថ្មី'}
              </h3>
              <form onSubmit={handleSaveMenuItem} className="space-y-2.5">
                <select
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value as ItemType)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white font-semibold"
                >
                  <option value="drink">☕ ភេសជ្ជៈ (ក្តៅ/ត្រជាក់, Size, ផ្អែម, ទឹកកក, Topping)</option>
                  <option value="food">🍜 ចំណីអាហារ / មី / នំ</option>
                </select>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="ឈ្មោះទំនិញ *"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    placeholder="តម្លៃ ($) *"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={itemDiscount}
                    onChange={(e) => setItemDiscount(e.target.value)}
                    placeholder="បញ្ចុះ %"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <input
                  type="text"
                  required
                  value={itemCat}
                  onChange={(e) => setItemCat(e.target.value)}
                  placeholder="ប្រភេទ (ឧ. Coffee, Matcha, Food & Noodles)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <input
                  type="url"
                  value={itemImg.startsWith('data:') ? '' : itemImg}
                  onChange={(e) => setItemImg(e.target.value)}
                  placeholder="Link រូបភាព"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <div className="flex items-center gap-2">
                  {itemImg && (
                    <img
                      src={resolveAssetUrl(itemImg, CAFE_ASSETS.icedLatte)}
                      alt="Preview"
                      onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                      className="w-11 h-11 rounded-xl object-cover border shrink-0"
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
                    className="text-xs w-full"
                  />
                </div>
                <textarea
                  rows={2}
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  placeholder="ពិពណ៌នា..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 bg-[#0D4A3E] text-white font-bold py-2 rounded-xl text-xs"
                  >
                    {editId ? 'រក្សាទុកការកែប្រែ' : '+ រក្សាទុក'}
                  </button>
                  {editId && (
                    <button
                      type="button"
                      onClick={resetMenuForm}
                      className="px-3 bg-slate-200 rounded-xl text-xs font-bold"
                    >
                      បោះបង់
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <h3 className="font-bold text-sm mb-2 text-[#0D4A3E]">គ្រប់គ្រង Topping</h3>
              <form onSubmit={handleAddTopping} className="flex gap-1.5 mb-3">
                <input
                  type="text"
                  required
                  value={newTopName}
                  onChange={(e) => setNewTopName(e.target.value)}
                  placeholder="ឈ្មោះ Topping"
                  className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs"
                />
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  required
                  value={newTopPrice}
                  onChange={(e) => setNewTopPrice(e.target.value)}
                  placeholder="$0.5"
                  className="w-16 px-2 py-1.5 border border-slate-200 rounded-xl text-xs"
                />
                <button type="submit" className="bg-[#0D4A3E] text-white px-3 py-1.5 rounded-xl text-xs font-bold">
                  +
                </button>
              </form>
              <div className="space-y-1.5">
                {toppings.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl text-xs"
                  >
                    <span>
                      <strong>{t.name}</strong> (+${Number(t.price).toFixed(2)})
                    </span>
                    <div className="flex gap-1.5">
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
                        {t.available ? 'មាន' : 'អស់'}
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

          <div className="lg:col-span-2 bg-white p-4 rounded-2xl border border-slate-200 h-fit">
            <div className="flex justify-between items-center mb-3 gap-2">
              <h3 className="font-bold text-sm">បញ្ជីទំនិញទាំងអស់ ({menuItems.length})</h3>
              {confirmClearMenu ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateMenu([]);
                      setConfirmClearMenu(false);
                      onToast('បានលុបម៉ឺនុយទាំងអស់!');
                    }}
                    className="text-xs bg-red-600 text-white font-bold px-3 py-1 rounded-xl"
                  >
                    បញ្ជាក់លុប
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearMenu(false)}
                    className="text-xs bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-xl"
                  >
                    បោះបង់
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearMenu(true)}
                  className="text-xs bg-red-50 text-red-600 font-bold px-3 py-1 rounded-xl"
                >
                  លុបទាំងអស់
                </button>
              )}
            </div>
            <div className="space-y-2.5">
              {menuItems.map((i) => (
                <div
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 border border-slate-200 rounded-2xl"
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={resolveAssetUrl(i.img, CAFE_ASSETS.icedLatte)}
                      alt={i.name}
                      onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                      className="w-11 h-11 rounded-xl object-cover bg-slate-100"
                    />
                    <div>
                      <p className="font-bold text-xs">
                        {i.name} {i.discount > 0 ? `(-${i.discount}%)` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {i.type === 'food' ? '🍜 អាហារ' : '☕ ភេសជ្ជៈ'} · {i.category} · $
                        {getDiscountedPrice(i).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEditItem(i)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800"
                    >
                      កែប្រែ
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateMenu(
                          menuItems.map((x) => (x.id === i.id ? { ...x, available: !x.available } : x))
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                        i.available ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {i.available ? 'មាន' : 'អស់'}
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
              ))}
            </div>
          </div>
        </div>
      )}

      {/* QR Tab */}
      {activeTab === 'qr' && (
        <div className="space-y-4">
          <div className="no-print bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-sm text-[#0D4A3E]">QR Code បិទតាមតុ</h3>
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
                placeholder="Link Website"
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
              {generatingQRs ? 'កំពុងបង្កើត QR...' : 'បង្កើត QR Stickers'}
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
                  <p className="text-xs font-bold text-[#0D4A3E]">ស្កេនដើម្បីកម្ម៉ង់</p>
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
                      បើកមើលតុ {tNum}
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
            បញ្ជីភ្ញៀវចុះឈ្មោះផ្លូវការ ({displayedMembers.length})
          </h3>
          {!displayedMembers.length ? (
            <p className="text-slate-400 text-sm text-center py-8">មិនទាន់មានសមាជិក</p>
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
                      {m.phone || 'គ្មានលេខ'} {m.phoneVerified ? '✓ Phone Verified' : ''} ·{' '}
                      {m.telegramUsername || m.tg || (m.telegramId ? `TG #${m.telegramId}` : 'គ្មាន Telegram')}{' '}
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
                      ឆាត Telegram
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
              ១. ប្តូរឈ្មោះហាង និង រូបភាពហាង
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={draft.brandTitle}
                onChange={(e) => setDraft({ ...draft, brandTitle: e.target.value })}
                placeholder="ឈ្មោះហាង"
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold"
              />
              <input
                type="text"
                value={draft.shopName}
                onChange={(e) => setDraft({ ...draft, shopName: e.target.value })}
                placeholder="ពាក្យស្វាគមន៍"
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
                <label className="text-xs font-bold block">Logo ហាង</label>
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
                          onToast('✓ បានដាក់ Logo ថ្មី! សូមចុច «រក្សាទុក» ខាងក្រោម');
                        },
                        onToast
                      );
                  }}
                  className="text-xs w-full"
                />
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
              <label className="text-xs font-bold block">រូបផ្ទាំងមុខហាង (Banner)</label>
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
                        onToast('✓ បានដាក់ Banner ថ្មី! សូមចុច «រក្សាទុក» ខាងក្រោម');
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
                <span>លីងបណ្តាញសង្គមហាង (បង្ហាញលើវេបសាយ)</span>
              </label>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  type="url"
                  value={draft.facebookUrl || ''}
                  onChange={(e) => setDraft({ ...draft, facebookUrl: e.target.value })}
                  placeholder="Facebook (https://facebook.com/...)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
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
                  placeholder="Telegram (@channel ឬ https://t.me/...)"
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
                  placeholder="លេខទូរស័ព្ទហាង (ឧ. 012 345 678)"
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white font-mono-num"
                />
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <h3 className="font-bold text-sm text-[#0D4A3E] border-b border-slate-100 pb-2">
              ២. KHQR ស្វ័យប្រវត្តិ (Dynamic Amount) & កូដ Promo
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
                    {sampleDynamicKhqr.isOfficialEmv ? '✓ Dynamic ស្វ័យប្រវត្តិ' : 'Static / មិនទាន់កំណត់'}
                  </p>
                </div>

                <div className="flex-1 w-full space-y-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      វិធីទី ១ (ងាយបំផុត)៖ Upload រូប KHQR ធនាគារអ្នក (ABA / ACLEDA / Bakong)
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
                            onToast('✓ ទាញយកកូដ KHQR ផ្លូវការស្វ័យប្រវត្តិ — បើក Dynamic Amount ជោគជ័យ!');
                          } else {
                            onToast('រូបនេះស្កេនកូដមិនច្បាស់! សូមបញ្ចូល Bakong ID ឬ Paste កូដ 000201... ខាងក្រោម');
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
                        ⏳ កំពុងស្កេនកូដ KHQR ពីរូបភាព...
                      </p>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        វិធីទី ២៖ Bakong ID (ឧ. shop@aba / 012xxx@bkrt)
                      </label>
                      <input
                        type="text"
                        value={draft.khqrBakongId || ''}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setDraft((prev) => ({ ...prev, khqrBakongId: val }));
                        }}
                        placeholder="username@aba ឬ 012345678@bkrt"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono-num bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        ឈ្មោះហាងលើ KHQR (អក្សរអង់គ្លេស)
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
                        រូបិយប័ណ្ណ KHQR
                      </label>
                      <select
                        value={draft.khqrCurrency || 'USD'}
                        onChange={(e) => {
                          const val = e.target.value === 'KHR' ? 'KHR' : 'USD';
                          setDraft((prev) => ({ ...prev, khqrCurrency: val }));
                        }}
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold bg-white"
                      >
                        <option value="USD">ដុល្លារ (USD $)</option>
                        <option value="KHR">រៀល (KHR ៛)</option>
                      </select>
                    </div>
                    {draft.khqrCurrency === 'KHR' && (
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          អត្រាប្តូរ 1$ = (៛)
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
                        ព័ត៌មានធនាគារបន្ថែម (បង្ហាញលើវិក្កយបត្រ)
                      </label>
                      <input
                        type="text"
                        value={draft.bankInfo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((prev) => ({ ...prev, bankInfo: val }));
                        }}
                        placeholder="ឧ. ABA: SUAN COFFEE (001 234 567)"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      កូដ KHQR ដើម (បំពេញស្វ័យប្រវត្តិពេល Upload រូប ឬ Paste 000201...)
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
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
              <div>
                <label className="text-xs font-bold block">លេខកូដ Promo</label>
                <input
                  type="text"
                  value={draft.promoCode}
                  onChange={(e) => setDraft({ ...draft, promoCode: e.target.value.toUpperCase() })}
                  className="w-full mt-1 px-3 py-1.5 border border-slate-200 rounded-xl text-xs uppercase font-bold"
                />
              </div>
              <div>
                <label className="text-xs font-bold block">បញ្ចុះតម្លៃ (%)</label>
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
              ៣. ទីតាំងហាង & តម្លៃដឹកជញ្ជូន
            </h3>
            <select
              value={draft.deliveryMode}
              onChange={(e) => setDraft({ ...draft, deliveryMode: e.target.value as DeliveryMode })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white font-bold"
            >
              <option value="distance">គិតតាមចម្ងាយផែនទី ($ ចាប់ផ្តើម + $/km)</option>
              <option value="flat">តម្លៃថេរគ្រប់ទីតាំង (Flat Rate)</option>
              <option value="free">ដឹកជញ្ជូនហ្វ្រីទាំងអស់</option>
            </select>
            {draft.deliveryMode !== 'free' && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-bold block">
                    {draft.deliveryMode === 'flat' ? 'តម្លៃថេរ ($)' : 'ចាប់ផ្តើម ($)'}
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
                    <label className="text-[11px] font-bold block">បន្ថែម ($/km)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={draft.deliveryRatePerKm}
                      onChange={(e) => setDraft({ ...draft, deliveryRatePerKm: Number(e.target.value) || 0 })}
                      className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[11px] font-bold block">ហ្វ្រីលើស ($)</label>
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
                📍 រើសទីតាំងហាងលើ Map
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, lat: 11.5564, lng: 104.9282 })}
                className="text-xs bg-slate-100 px-2.5 py-1.5 rounded-lg"
              >
                ភ្នំពេញ
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, lat: 13.3633, lng: 103.8564 })}
                className="text-xs bg-slate-100 px-2.5 py-1.5 rounded-lg"
              >
                សៀមរាប
              </button>
              <span className="text-[11px] text-slate-500 font-mono-num">
                ({Number(draft.lat).toFixed(5)}, {Number(draft.lng).toFixed(5)})
              </span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
            <h3 className="font-bold text-sm text-[#0D4A3E] border-b border-slate-100 pb-2">
              ៤. ការតភ្ជាប់ Telegram Bot, Phone OTP API & PIN (រក្សាទុកសុវត្ថិភាពលើ Server)
            </h3>

            <div className="bg-sky-50 p-3.5 rounded-xl border border-sky-200 space-y-2">
              <p className="text-xs font-bold text-slate-900">
                Telegram Bot ផ្លូវការ (Free ១០០% · ចូលគណនី, ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ Share Contact & Order Alerts)
              </p>
              <div className="grid sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={draft.botUsername}
                  onChange={(e) => setDraft({ ...draft, botUsername: e.target.value.replace('@', '') })}
                  placeholder="Bot Username (អត់ @)"
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
                placeholder="Telegram Username ហាងសម្រាប់ភ្ជាប់វិក្កយបត្រ (អត់ @)"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
              />
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
              <p className="text-xs font-bold text-slate-900">
                ជម្រើសបន្ថែម៖ សេវាផ្ញើ SMS OTP (គិតថ្លៃតាមសារ — មិនចាំបាច់បំពេញបើប្រើ Telegram Free ខាងលើ)
              </p>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  ជម្រើសទី ១៖ Telegram Gateway API Token (ផ្ញើ OTP ផ្លូវការតាមលេខទូរស័ព្ទ)
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
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  ជម្រើសទី ២៖ Twilio SMS API
                </label>
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
                  ជម្រើសទី ៣៖ Custom SMS Gateway Webhook (PlasGate / MekongSMS)
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
              placeholder="Firebase Realtime DB URL (ស្រេចចិត្ត)"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
            />
            {getFirebaseBase(draft.firebaseUrl) && (
              <p className="text-[11px] text-emerald-700 font-semibold">✓ Firebase URL ត្រូវបានកំណត់</p>
            )}

            <div>
              <label className="text-xs font-bold block mb-1">លេខកូដ PIN ម្ចាស់ហាងថ្មី</label>
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
              {savingSettings ? 'កំពុងរក្សាទុក & បង្ហោះ...' : '💾 រក្សាទុកការកំណត់ផ្លូវការ (ចែករំលែកគ្រប់គ្នា)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

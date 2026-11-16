import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import { Check, Download, MapPin, Phone, Search, Send, ShieldCheck, X } from 'lucide-react';
import type { AppLang, Order, ShopSettings } from '../types';
import { buildDynamicKhqr, downloadBrandedKhqrPng } from '../utils/khqr';
import { getOrderStatusText } from '../utils/i18n';

interface ReceiptModalProps {
  lang?: AppLang;
  order: Order | null;
  tgUrl: string;
  shopSettings: ShopSettings;
  onClose: () => void;
  onOpenLiveTrack: (orderId: string) => void;
}

export function ReceiptModal({
  lang = 'km',
  order,
  tgUrl,
  shopSettings,
  onClose,
  onOpenLiveTrack,
}: ReceiptModalProps) {
  const isEn = lang === 'en';
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const dynamicKhqr = useMemo(() => {
    if (!order || order.payment !== 'KHQR / ABA') return null;
    return buildDynamicKhqr({
      basePayload: shopSettings.khqrPayload,
      bakongId: shopSettings.khqrBakongId,
      merchantName: shopSettings.khqrMerchantName || shopSettings.brandTitle,
      amountUsd: Number(order.grandTotal || 0),
      currency: shopSettings.khqrCurrency || 'USD',
      khrRate: shopSettings.khqrKhrRate || 4100,
      billNumber: order.id,
      timestampMs: order.createdAt,
    });
  }, [order, shopSettings]);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!dynamicKhqr?.isOfficialEmv || !canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, dynamicKhqr.payload, {
      width: 148,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }).catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [dynamicKhqr]);

  return (
    <AnimatePresence>
      {order && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm z-[75] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="bg-white w-full max-w-sm rounded-3xl p-5 space-y-3 shadow-2xl text-center max-h-[90vh] overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 340, damping: 18 }}
              className="w-14 h-14 bg-[#E8F2EF] text-[#0D4A3E] rounded-full flex items-center justify-center mx-auto"
            >
              <Check className="w-7 h-7 stroke-[2.8]" />
            </motion.div>
            <h3 className="font-bold text-lg text-[#0D4A3E]">
              {isEn ? 'Order Confirmed!' : 'កម្ម៉ង់បានជោគជ័យ!'}
            </h3>
            <p className="text-xs text-slate-500 font-mono-num">
              {order.id} · {isEn ? 'Time' : 'ម៉ោង'} {order.timestamp}
            </p>

            <div className="bg-slate-50 p-3.5 rounded-2xl text-left text-xs space-y-1.5 max-h-40 overflow-y-auto">
              {order.items.map((i, idx) => (
                <div key={idx} className="flex justify-between gap-2">
                  <span>
                    {i.qty}x {i.name} <span className="text-slate-400">({i.options})</span>
                  </span>
                  <span className="font-mono-num shrink-0">${(i.unitPrice * i.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="text-xs text-slate-600 space-y-1 px-1">
              {order.promoDisc > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>{isEn ? 'Promo Discount:' : 'បញ្ចុះតម្លៃ Promo៖'}</span>
                  <span className="font-mono-num">-${Number(order.promoDisc).toFixed(2)}</span>
                </div>
              )}
              {order.type === 'delivery' && (
                <div className="flex justify-between">
                  <span>{isEn ? 'Delivery Fee:' : 'ថ្លៃដឹកជញ្ជូន៖'}</span>
                  <span className="font-mono-num">${Number(order.fee || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm text-slate-900 pt-1 border-t border-slate-100">
                <span>
                  {isEn ? 'Total' : 'សរុប'} ({order.payment}){isEn ? ':' : '៖'}
                </span>
                <span className="font-mono-num text-[#0D4A3E]">
                  ${Number(order.grandTotal || 0).toFixed(2)}
                </span>
              </div>
              {order.paymentVerified && (
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] font-bold text-emerald-700">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>{isEn ? 'Payment Verified' : 'បានផ្ទៀងផ្ទាត់ប្រាក់រួចរាល់'}</span>
                  </span>
                  {order.paymentRef && (
                    <span className="font-mono-num text-[10px] text-slate-500">
                      Ref: {order.paymentRef}
                    </span>
                  )}
                </div>
              )}
            </div>

            {order.payment === 'KHQR / ABA' && dynamicKhqr?.isOfficialEmv && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-[195px] mx-auto">
                  <div className="bg-[#E1232E] text-white py-1 px-2.5 flex items-center justify-between text-[10px] font-bold">
                    <span>KHQR</span>
                    <span>{order.id}</span>
                  </div>
                  <div className="p-2.5 space-y-1">
                    <p className="text-base font-extrabold font-mono-num text-[#E1232E]">
                      {dynamicKhqr.formattedAmount}
                    </p>
                    <div className="flex justify-center">
                      <canvas ref={qrCanvasRef} className="rounded bg-white" />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadBrandedKhqrPng({
                      payload: dynamicKhqr.payload,
                      merchantDisplay: dynamicKhqr.merchantDisplay,
                      formattedAmount: dynamicKhqr.formattedAmount,
                      bankInfo: shopSettings.bankInfo,
                      filename: `KHQR-${order.id}.png`,
                    })
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 hover:text-slate-950 underline"
                >
                  <Download className="w-3 h-3 text-[#E1232E]" />
                  <span>{isEn ? 'Save Receipt KHQR' : 'រក្សាទុករូប KHQR វិក្កយបត្រ'}</span>
                </button>
              </div>
            )}

            <div className="space-y-2 pt-2">
              {order.type === 'delivery' && (
                <button
                  type="button"
                  onClick={() => onOpenLiveTrack(order.id)}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <MapPin className="w-4 h-4" />
                  <span>{isEn ? 'Track Driver on Live Map' : 'មើលទីតាំងអ្នកដឹក Live Map'}</span>
                </button>
              )}
              {tgUrl && (
                <a
                  href={tgUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Send Receipt to Shop Telegram' : 'ផ្ញើវិក្កយបត្រទៅ Telegram ហាង'}</span>
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs"
              >
                {isEn ? 'Close' : 'បិទ'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface OrderTrackerModalProps {
  lang?: AppLang;
  isOpen: boolean;
  orders: Order[];
  onClose: () => void;
  onOpenLiveTrack: (orderId: string) => void;
}

const STATUS_BADGE_CLS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Brewing: 'bg-sky-100 text-sky-800',
  Ready: 'bg-emerald-100 text-[#0D4A3E]',
  Completed: 'bg-slate-100 text-slate-600',
};

export function OrderTrackerModal({
  lang = 'km',
  isOpen,
  orders,
  onClose,
  onOpenLiveTrack,
}: OrderTrackerModalProps) {
  const isEn = lang === 'en';
  const [filterMode, setFilterMode] = useState<'active' | 'all'>('all');
  const [query, setQuery] = useState('');

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (filterMode === 'active' && o.status === 'Completed') return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        (o.customer?.name || '').toLowerCase().includes(q) ||
        (o.customer?.phone || '').toLowerCase().includes(q)
      );
    });
  }, [orders, filterMode, query]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 overflow-hidden shadow-2xl flex flex-col max-h-[88dvh]"
          >
            <div className="flex justify-between items-center mb-3 shrink-0">
              <div>
                <h3 className="font-bold text-base text-[#0D4A3E]">
                  {isEn ? 'Order Tracking & Live Map' : 'តាមដានការកម្ម៉ង់ & Live Map'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {isEn ? 'Real-time order updates' : 'ពិនិត្យស្ថានភាពកម្ម៉ង់ភ្លាមៗ'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close' : 'បិទ'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-100 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {orders.length > 0 && (
              <div className="space-y-2 mb-3 shrink-0">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={isEn ? 'Search ORD-xxxx or phone...' : 'ស្វែងរក ORD-xxxx ឬលេខទូរស័ព្ទ...'}
                      className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-base sm:text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0D4A3E]"
                    />
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                        filterMode === 'all' ? 'bg-white text-[#0D4A3E] shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      {isEn ? 'All' : 'ទាំងអស់'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('active')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                        filterMode === 'active' ? 'bg-white text-[#0D4A3E] shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      {isEn ? 'Active' : 'កំពុងដំណើរ'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-y-auto space-y-3 pr-0.5 flex-1">
              {!filteredOrders.length ? (
                <p className="text-center text-slate-400 py-10 text-sm">
                  {isEn ? 'No orders found' : 'មិនទាន់មានការកម្ម៉ង់ទេ'}
                </p>
              ) : (
                filteredOrders.slice(0, 12).map((o) => {
                  const statusCls = STATUS_BADGE_CLS[o.status] || STATUS_BADGE_CLS.Pending;
                  return (
                    <div key={o.id} className="border border-slate-200 rounded-2xl p-3.5 text-xs space-y-2">
                      <div className="flex justify-between items-center gap-2 font-bold">
                        <span className="font-mono-num text-slate-900">
                          {o.id} · {o.timestamp}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${statusCls}`}>
                          {getOrderStatusText(o.status, lang)}
                        </span>
                      </div>
                      <div className="text-slate-600 space-y-0.5">
                        {o.items.map((i, idx) => (
                          <div key={idx}>
                            {i.qty}x {i.name} ({i.options})
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between font-bold text-[#0D4A3E] pt-1.5 border-t border-slate-100">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span>
                            {o.type === 'dinein'
                              ? `${isEn ? 'Table' : 'តុ'} ${o.customer?.tableNum || 1} · ${o.payment}`
                              : o.payment}
                          </span>
                          {o.paymentVerified && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                              <ShieldCheck className="w-3 h-3 shrink-0" />
                              <span>{isEn ? 'Paid' : 'បានបង់'}</span>
                            </span>
                          )}
                        </span>
                        <span className="font-mono-num">${Number(o.grandTotal || 0).toFixed(2)}</span>
                      </div>
                      {o.paymentVerified && o.paymentRef && (
                        <p className="text-[10px] font-mono-num text-slate-400">
                          Ref: {o.paymentRef}
                        </p>
                      )}
                      {o.type === 'delivery' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenLiveTrack(o.id)}
                            className="flex-1 bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5"
                          >
                            <MapPin className="w-3.5 h-3.5 text-amber-300" />
                            <span>
                              {o.status === 'Completed'
                                ? isEn
                                  ? 'View Delivery Details'
                                  : 'មើលព័ត៌មានដឹកជញ្ជូន'
                                : isEn
                                  ? 'Track Live Map'
                                  : 'តាមដានលើ Live Map'}
                            </span>
                          </button>
                          {o.driverInfo?.phone && o.status !== 'Completed' && (
                            <a
                              href={`tel:${o.driverInfo.phone}`}
                              className="px-3 py-2 bg-[#E8F2EF] text-[#0D4A3E] rounded-xl text-xs font-bold flex items-center gap-1 shrink-0"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              <span>{isEn ? 'Call' : 'តេ'}</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import { Armchair, Banknote, Bike, Download, MapPin, Minus, Plus, QrCode, Send, X } from 'lucide-react';
import type { CartItem, Coords, Member, OrderType, PaymentMethod, ShopSettings } from '../types';
import { CAFE_ASSETS, computeDeliveryFee, handleImgFallback, resolveAssetUrl } from '../utils/cafeUtils';
import { buildDynamicKhqr, downloadBrandedKhqrPng } from '../utils/khqr';

interface CartModalProps {
  isOpen: boolean;
  cart: CartItem[];
  orderType: OrderType;
  shopSettings: ShopSettings;
  currentMember: Member | null;
  pickedAddressName: string;
  selectedCoords: Coords;
  distanceKm: number;
  initialTableNum: number;
  onClose: () => void;
  onChangeOrderType: (t: OrderType) => void;
  onChangeQty: (idx: number, delta: number) => void;
  onOpenLocationPicker: () => void;
  onSubmitOrder: (payload: {
    sendTg: boolean;
    payment: PaymentMethod;
    promoDisc: number;
    fee: number;
    subtotal: number;
    grandTotal: number;
    customer: {
      name: string;
      phone: string;
      tg: string;
      addressName?: string;
      addressNote?: string;
      coords?: Coords;
      distanceKm?: string;
      tableNum?: number | string;
    };
  }) => void;
  onToast: (msg: string) => void;
}

export function CartModal({
  isOpen,
  cart,
  orderType,
  shopSettings,
  currentMember,
  pickedAddressName,
  selectedCoords,
  distanceKm,
  initialTableNum,
  onClose,
  onChangeOrderType,
  onChangeQty,
  onOpenLocationPicker,
  onSubmitOrder,
  onToast,
}: CartModalProps) {
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromoPct, setAppliedPromoPct] = useState(0);
  const [payment, setPayment] = useState<PaymentMethod>('Cash');
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custTg, setCustTg] = useState('');
  const [addressNote, setAddressNote] = useState('');
  const [tableNum, setTableNum] = useState(initialTableNum || 1);
  const [dineInPhone, setDineInPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const khqrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (currentMember) {
      setCustName((prev) => prev || currentMember.name || '');
      setCustPhone((prev) => prev || currentMember.phone || '');
      setCustTg((prev) => prev || currentMember.telegramUsername || currentMember.tg || '');
      setDineInPhone((prev) => prev || currentMember.phone || currentMember.telegramUsername || '');
    }
  }, [currentMember]);

  useEffect(() => {
    setTableNum(initialTableNum || 1);
  }, [initialTableNum]);

  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const promoDisc = subtotal * (appliedPromoPct / 100);
  const computedFee = computeDeliveryFee(shopSettings, distanceKm, Math.max(0, subtotal - promoDisc));
  const fee = orderType === 'delivery' ? computedFee : 0;
  const grandTotal = Math.max(0, subtotal - promoDisc + fee);

  const dynamicKhqr = useMemo(
    () =>
      buildDynamicKhqr({
        basePayload: shopSettings.khqrPayload,
        bakongId: shopSettings.khqrBakongId,
        merchantName: shopSettings.khqrMerchantName || shopSettings.brandTitle,
        amountUsd: grandTotal,
        currency: shopSettings.khqrCurrency || 'USD',
        khrRate: shopSettings.khqrKhrRate || 4100,
        billNumber: `TBL${tableNum}`,
      }),
    [
      shopSettings.khqrPayload,
      shopSettings.khqrBakongId,
      shopSettings.khqrMerchantName,
      shopSettings.brandTitle,
      shopSettings.khqrCurrency,
      shopSettings.khqrKhrRate,
      grandTotal,
      tableNum,
    ]
  );

  // Render crisp EMVCo Dynamic KHQR whenever grandTotal or payment changes
  useEffect(() => {
    const canvas = khqrCanvasRef.current;
    if (!isOpen || payment !== 'KHQR / ABA' || !dynamicKhqr.isOfficialEmv || !canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, dynamicKhqr.payload, {
      width: 176,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }).catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, payment, dynamicKhqr]);

  const handleApplyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (shopSettings.promoCode && code === shopSettings.promoCode.toUpperCase() && shopSettings.promoPercent > 0) {
      setAppliedPromoPct(shopSettings.promoPercent);
      onToast(`បញ្ចុះតម្លៃ ${shopSettings.promoPercent}% ជោគជ័យ!`);
    } else {
      setAppliedPromoPct(0);
      onToast('លេខកូដ Promo មិនត្រឹមត្រូវទេ!');
    }
  };

  const handleSubmit = async (sendTg: boolean) => {
    if (submitting) return;
    if (!cart.length) {
      onToast('កន្ត្រកទំនិញទទេ!');
      return;
    }
    if (shopSettings.isOpen === false) {
      onToast('សូមអភ័យទោស! ហាងកំពុងបិទបណ្តោះអាសន្ន។');
      return;
    }

    if (orderType === 'delivery') {
      if (!custName.trim() || !custPhone.trim()) {
        onToast('សូមបំពេញឈ្មោះ និងលេខទូរស័ព្ទ!');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (orderType === 'delivery') {
        await onSubmitOrder({
          sendTg,
          payment,
          promoDisc,
          fee,
          subtotal,
          grandTotal,
          customer: {
            name: custName.trim(),
            phone: custPhone.trim(),
            tg: custTg.trim(),
            addressName: pickedAddressName,
            addressNote: addressNote.trim(),
            coords: selectedCoords,
            distanceKm: distanceKm.toFixed(2),
          },
        });
      } else {
        await onSubmitOrder({
          sendTg,
          payment,
          promoDisc,
          fee: 0,
          subtotal,
          grandTotal,
          customer: {
            name: currentMember ? currentMember.name : `ភ្ញៀវតុលេខ ${tableNum}`,
            phone: dineInPhone.trim(),
            tg: currentMember ? currentMember.telegramUsername || currentMember.tg || '' : '',
            tableNum,
          },
        });
      }
      setAppliedPromoPct(0);
      setPromoInput('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto shadow-2xl max-h-[92dvh]"
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-lg text-[#0D4A3E]">បញ្ជាក់ការកម្ម៉ង់</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="បិទ"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-100 rounded-full hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-44 overflow-y-auto">
              {cart.map((item, idx) => (
                <div key={item.cartId} className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-slate-900 truncate">{item.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{item.options}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onChangeQty(idx, -1)}
                      aria-label="បន្ថយ"
                      className="w-7 h-7 bg-white border border-slate-200 rounded-lg flex items-center justify-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-xs font-bold font-mono-num w-5 text-center">{item.qty}</span>
                    <button
                      type="button"
                      onClick={() => onChangeQty(idx, 1)}
                      aria-label="បន្ថែម"
                      className="w-7 h-7 bg-white border border-slate-200 rounded-lg flex items-center justify-center"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <span className="font-bold text-xs font-mono-num text-[#0D4A3E] ml-1">
                      ${(item.unitPrice * item.qty).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-1.5">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder="លេខកូដបញ្ចុះតម្លៃ (Promo Code)"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs uppercase focus:outline-none focus:border-[#0D4A3E]"
              />
              <button
                type="button"
                onClick={handleApplyPromo}
                className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
              >
                ប្រើកូដ
              </button>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeOrderType('delivery')}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                  orderType === 'delivery'
                    ? 'border-[#0D4A3E] bg-[#E8F2EF] text-[#0D4A3E]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <Bike className="w-4 h-4" />
                <span>ដឹកជញ្ជូន</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeOrderType('dinein')}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                  orderType === 'dinein'
                    ? 'border-[#0D4A3E] bg-[#E8F2EF] text-[#0D4A3E]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <Armchair className="w-4 h-4" />
                <span>ញ៉ាំក្នុងហាង</span>
              </button>
            </div>

            {orderType === 'delivery' ? (
              <div className="mt-3 space-y-2">
                <div className="bg-[#E8F2EF] p-2.5 rounded-xl flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-4 h-4 text-[#0D4A3E] shrink-0" />
                    <p className="text-xs font-bold text-[#0D4A3E] truncate">
                      {pickedAddressName} ({distanceKm.toFixed(2)} km)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenLocationPicker}
                    className="bg-[#0D4A3E] text-white px-3 py-1.5 rounded-lg text-xs font-bold shrink-0"
                  >
                    បើកផែនទី
                  </button>
                </div>
                <input
                  type="text"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="ឈ្មោះ *"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-[#0D4A3E]"
                />
                <input
                  type="tel"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="លេខទូរស័ព្ទ *"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono-num focus:outline-none focus:border-[#0D4A3E]"
                />
                <input
                  type="text"
                  value={custTg}
                  onChange={(e) => setCustTg(e.target.value)}
                  placeholder="Telegram (@username)"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-[#0D4A3E]"
                />
                <input
                  type="text"
                  value={addressNote}
                  onChange={(e) => setAddressNote(e.target.value)}
                  placeholder="លេខផ្ទះ / ផ្លូវ / ចំណាំបន្ថែម..."
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-[#0D4A3E]"
                />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <label className="text-[11px] font-semibold text-slate-600 block">លេខតុ</label>
                <input
                  type="number"
                  min={1}
                  value={tableNum}
                  onChange={(e) => setTableNum(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-bold font-mono-num text-[#0D4A3E]"
                />
                <input
                  type="tel"
                  value={dineInPhone}
                  onChange={(e) => setDineInPhone(e.target.value)}
                  placeholder="លេខទូរស័ព្ទ / Telegram (ស្រេចចិត្ត)"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
              {(['Cash', 'KHQR / ABA'] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPayment(pm)}
                  className={`border rounded-xl p-2.5 flex items-center justify-center gap-1.5 transition-colors ${
                    payment === pm
                      ? 'border-[#0D4A3E] bg-[#E8F2EF] text-[#0D4A3E]'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  {pm === 'Cash' ? (
                    <>
                      <Banknote className="w-4 h-4" />
                      <span>សាច់ប្រាក់ (Cash)</span>
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4 text-[#E1232E]" />
                      <span>KHQR / ABA</span>
                    </>
                  )}
                </button>
              ))}
            </div>

            {payment === 'KHQR / ABA' && (
              <div className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center space-y-2.5">
                {dynamicKhqr.isOfficialEmv ? (
                  <>
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden max-w-[230px] mx-auto shadow-sm">
                      <div className="bg-[#E1232E] text-white py-1.5 px-3 flex items-center justify-between">
                        <span className="font-extrabold text-xs tracking-wider">KHQR</span>
                        <span className="text-[10px] font-semibold bg-white/20 px-1.5 py-0.5 rounded">
                          Dynamic Amount
                        </span>
                      </div>
                      <div className="p-3 space-y-1.5">
                        <p className="text-[11px] font-bold text-slate-700 truncate">
                          {dynamicKhqr.merchantDisplay}
                        </p>
                        <p className="text-xl font-extrabold font-mono-num text-[#E1232E]">
                          {dynamicKhqr.formattedAmount}
                        </p>
                        <div className="border-t border-dashed border-slate-200 pt-2 flex justify-center">
                          <canvas ref={khqrCanvasRef} className="rounded-lg bg-white" />
                        </div>
                        {dynamicKhqr.bakongIdDisplay && (
                          <p className="text-[10px] text-slate-500 font-mono-num truncate">
                            {dynamicKhqr.bakongIdDisplay}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await downloadBrandedKhqrPng({
                          payload: dynamicKhqr.payload,
                          merchantDisplay: dynamicKhqr.merchantDisplay,
                          formattedAmount: dynamicKhqr.formattedAmount,
                          bankInfo: shopSettings.bankInfo,
                          filename: `KHQR-${grandTotal.toFixed(2)}.png`,
                        });
                        if (ok) onToast('បានរក្សាទុករូប KHQR ចូលទូរស័ព្ទហើយ!');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-[#E1232E]" />
                      <span>រក្សាទុករូប KHQR (ស្កេនពី Gallery)</span>
                    </button>
                    {shopSettings.bankInfo && (
                      <p className="text-[11px] font-bold text-slate-700">{shopSettings.bankInfo}</p>
                    )}
                  </>
                ) : shopSettings.khqrImg ? (
                  <>
                    <p className="text-xs font-bold text-slate-900">
                      ស្កេន KHQR ដើម្បីទូទាត់៖{' '}
                      <span className="text-red-600 font-mono-num text-sm">${grandTotal.toFixed(2)}</span>
                    </p>
                    <img
                      src={shopSettings.khqrImg}
                      alt="KHQR Code"
                      referrerPolicy="no-referrer"
                      className="w-36 h-36 mx-auto rounded-xl object-contain bg-white border p-1"
                    />
                    {shopSettings.bankInfo && (
                      <p className="text-[11px] font-bold text-slate-700">{shopSettings.bankInfo}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                    មិនទាន់បានកំណត់ Bakong ID ឬ KHQR ហាងទេ។ សូមម្ចាស់ហាងបញ្ចូលក្នុង គ្រប់គ្រងហាង → ការកំណត់។
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 bg-slate-50 p-3 rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span>ទំនិញ៖</span>
                <span className="font-mono-num">${subtotal.toFixed(2)}</span>
              </div>
              {promoDisc > 0 && (
                <div className="flex justify-between text-red-600 font-bold">
                  <span>បញ្ចុះតម្លៃ Promo៖</span>
                  <span className="font-mono-num">-${promoDisc.toFixed(2)}</span>
                </div>
              )}
              {orderType === 'delivery' && (
                <div className="flex justify-between">
                  <span>ថ្លៃដឹកជញ្ជូន៖</span>
                  <span className="font-mono-num">
                    {fee === 0 ? (
                      <span className="text-emerald-700 font-bold">ហ្វ្រី ($0.00)</span>
                    ) : (
                      `$${fee.toFixed(2)}`
                    )}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base text-[#0D4A3E] border-t border-slate-200 pt-1.5">
                <span>សរុប៖</span>
                <span className="font-mono-num">${grandTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit(false)}
                className="w-full bg-[#0D4A3E] hover:bg-[#09352C] disabled:opacity-60 text-white font-bold py-3 rounded-2xl text-sm transition-colors active:scale-[0.98]"
              >
                {submitting ? 'កំពុងបញ្ជូន...' : 'បញ្ជាក់ការកម្ម៉ង់'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit(true)}
                className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>កម្ម៉ង់ & ផ្ញើចូល Telegram ហាង</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

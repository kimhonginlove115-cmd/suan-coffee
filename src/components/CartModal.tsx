import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Armchair,
  Banknote,
  Bike,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  MapPin,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { AppLang, CartItem, Coords, Member, OrderType, PaymentMethod, ShopSettings } from '../types';
import {
  CAFE_ASSETS,
  compressImageFile,
  computeDeliveryFee,
  fetchWithTimeout,
  handleImgFallback,
  resolveAssetUrl,
} from '../utils/cafeUtils';
import { buildDynamicKhqr, downloadBrandedKhqrPng } from '../utils/khqr';
import { md5Hex } from '../utils/md5';
import { playPaymentVerifiedSound, unlockAudio } from '../utils/sound';

export interface VerifiedPaymentState {
  sessionId: string;
  proofToken: string;
  verifiedBy: 'bakong_md5' | 'telegram_owner' | 'web_admin' | 'auto_slip_ocr' | 'slip_ref';
  paidAmount: number;
  currency: 'USD' | 'KHR';
  transactionRef: string;
  bankName?: string;
  slipHash?: string;
  md5: string;
  slipImg?: string;
}

interface CartModalProps {
  lang?: AppLang;
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
    paymentVerification?: VerifiedPaymentState;
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
  }) => Promise<boolean | void> | boolean | void;
  onToast: (msg: string) => void;
}

function makeBillNonce(): string {
  return `PAY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function CartModal({
  lang = 'km',
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
  const isEn = lang === 'en';
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

  // Payment Verification State (KHQR Auto Verification)
  const [billMeta, setBillMeta] = useState<{ billNumber: string; timestampMs: number }>(() => ({
    billNumber: makeBillNonce(),
    timestampMs: Date.now(),
  }));
  const [paySessionId, setPaySessionId] = useState<string | null>(null);
  const [payMd5, setPayMd5] = useState('');
  const [payExpiresAt, setPayExpiresAt] = useState(0);
  const [payCountdown, setPayCountdown] = useState(0);
  const [payStatus, setPayStatus] = useState<
    'idle' | 'creating' | 'pending' | 'awaiting_owner' | 'verified' | 'amount_mismatch' | 'rejected' | 'expired'
  >('idle');
  const [payError, setPayError] = useState('');
  const [verifyCaps, setVerifyCaps] = useState<{ bakong: boolean; telegram: boolean; slipAuto: boolean }>({
    bakong: false,
    telegram: false,
    slipAuto: false,
  });
  const [verifiedPayment, setVerifiedPayment] = useState<VerifiedPaymentState | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);
  const [sendingTgVerify, setSendingTgVerify] = useState(false);
  const [verifyingSlip, setVerifyingSlip] = useState(false);
  const [needsOwnerFallback, setNeedsOwnerFallback] = useState(false);
  const [paymentRefInput, setPaymentRefInput] = useState('');
  const [slipImgData, setSlipImgData] = useState('');
  const activeSessionKeyRef = useRef<string>('');

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
        billNumber: billMeta.billNumber,
        timestampMs: billMeta.timestampMs,
      }),
    [
      shopSettings.khqrPayload,
      shopSettings.khqrBakongId,
      shopSettings.khqrMerchantName,
      shopSettings.brandTitle,
      shopSettings.khqrCurrency,
      shopSettings.khqrKhrRate,
      grandTotal,
      billMeta.billNumber,
      billMeta.timestampMs,
    ]
  );

  const resetPaymentSession = useCallback(() => {
    activeSessionKeyRef.current = '';
    setVerifiedPayment(null);
    setPaySessionId(null);
    setPayMd5('');
    setPayExpiresAt(0);
    setPayStatus('idle');
    setPayError('');
    setNeedsOwnerFallback(false);
    setPaymentRefInput('');
    setSlipImgData('');
  }, []);

  // Reset only when the entire cart becomes empty
  useEffect(() => {
    if (cart.length === 0) {
      resetPaymentSession();
      setBillMeta({ billNumber: makeBillNonce(), timestampMs: Date.now() });
    }
  }, [cart.length, resetPaymentSession]);

  // Create KHQR payment session only when total/currency/bill/QR changes (keep session across close & reopen)
  useEffect(() => {
    if (!isOpen || payment !== 'KHQR / ABA' || grandTotal <= 0) return;

    const khqrCurr = shopSettings.khqrCurrency === 'KHR' ? 'KHR' : 'USD';
    const sessionKey = `${grandTotal.toFixed(2)}|${khqrCurr}|${billMeta.billNumber}|${dynamicKhqr.payload}`;
    const stillValid =
      activeSessionKeyRef.current === sessionKey &&
      Boolean(paySessionId) &&
      payStatus !== 'expired' &&
      (payExpiresAt === 0 || Date.now() < payExpiresAt);

    if (stillValid) {
      return;
    }

    let cancelled = false;
    activeSessionKeyRef.current = sessionKey;
    setVerifiedPayment(null);
    setPaySessionId(null);
    setPayError('');
    setPayStatus('creating');

    const expectedCurrAmount =
      khqrCurr === 'KHR' ? Math.max(100, Math.round(dynamicKhqr.amount)) : Number(grandTotal.toFixed(2));

    const controller = new AbortController();
    fetchWithTimeout(
      '/api/payments/khqr/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUsd: Number(grandTotal.toFixed(2)),
          amountCurrency: expectedCurrAmount,
          currency: khqrCurr,
          khqrPayload: dynamicKhqr.isOfficialEmv ? dynamicKhqr.payload : '',
          billNumber: billMeta.billNumber,
          customerName: custName.trim() || currentMember?.name || '',
          customerPhone: (orderType === 'delivery' ? custPhone : dineInPhone).trim() || currentMember?.phone || '',
        }),
        signal: controller.signal,
      },
      9000
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && data.sessionId) {
          setPaySessionId(data.sessionId);
          setPayMd5(data.md5 || (dynamicKhqr.isOfficialEmv ? md5Hex(dynamicKhqr.payload) : ''));
          setVerifyCaps({
            bakong: Boolean(data.bakongVerifyReady),
            telegram: Boolean(data.telegramOrderVerifyReady),
            slipAuto: Boolean(data.slipAutoVerifyReady),
          });
          setPayExpiresAt(Date.now() + (Number(data.expiresInSeconds) || 600) * 1000);
          setPayStatus('pending');
        } else {
          activeSessionKeyRef.current = '';
          setPayStatus('pending');
          setPayError(data?.error || '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          activeSessionKeyRef.current = '';
          setPayStatus('pending');
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Intentionally reset only when amount/currency/QR/bill changes; preserve state across modal close/reopen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    payment,
    grandTotal,
    dynamicKhqr.payload,
    dynamicKhqr.isOfficialEmv,
    billMeta.billNumber,
    shopSettings.khqrCurrency,
  ]);

  // Countdown timer for active KHQR session
  useEffect(() => {
    if (!isOpen || payment !== 'KHQR / ABA' || !payExpiresAt || payStatus === 'verified') {
      setPayCountdown(0);
      return;
    }
    const update = () => {
      const left = Math.max(0, Math.ceil((payExpiresAt - Date.now()) / 1000));
      setPayCountdown(left);
      if (left <= 0) {
        setPayStatus('expired');
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isOpen, payment, payExpiresAt, payStatus]);

  const checkPaymentStatus = useCallback(
    async (manual = false) => {
      if (!paySessionId || payStatus === 'verified' || payStatus === 'expired') return;
      if (manual) setCheckingNow(true);
      try {
        const res = await fetchWithTimeout(
          '/api/payments/khqr/check',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: paySessionId }),
          },
          8000
        );
        if (res.status === 404) {
          setPayStatus('expired');
          return;
        }
        const data = await res.json();
        if (data?.ok && data.verified && data.proofToken) {
          setPayStatus('verified');
          setPayError('');
          setVerifiedPayment({
            sessionId: paySessionId,
            proofToken: data.proofToken,
            verifiedBy: data.verifiedBy || 'bakong_md5',
            paidAmount: Number(data.paidAmount || dynamicKhqr.amount),
            currency: data.currency === 'KHR' ? 'KHR' : 'USD',
            transactionRef: data.transactionRef || billMeta.billNumber,
            md5: payMd5,
            slipImg: slipImgData || undefined,
          });
          playPaymentVerifiedSound();
          onToast(
            isEn
              ? '✅ Payment & exact amount verified!'
              : '✅ បានផ្ទៀងផ្ទាត់ការទូទាត់ & ចំនួនលុយគ្រប់ជោគជ័យ!'
          );
          return;
        }
        if (data?.status === 'amount_mismatch') {
          setPayStatus('amount_mismatch');
          setPayError(
            data.error ||
              (isEn ? 'Paid amount does not match bill total!' : 'ចំនួនទឹកប្រាក់មិនគ្រប់តាមវិក្កយបត្រទេ!')
          );
        } else if (data?.status === 'rejected') {
          setPayStatus('rejected');
          setPayError(
            data.error ||
              (isEn ? 'Payment was not received yet.' : 'មិនទាន់ឃើញទឹកប្រាក់ចូលធនាគារទេ!')
          );
        } else if (data?.status === 'awaiting_owner') {
          setPayStatus('awaiting_owner');
          setPayError('');
        }
      } catch {
        // ignore transient poll hiccup
      } finally {
        if (manual) setCheckingNow(false);
      }
    },
    [paySessionId, payStatus, dynamicKhqr.amount, billMeta.billNumber, payMd5, slipImgData, onToast, isEn]
  );

  // Automatic polling every 2.5s when Bakong, Telegram Bot, or Website Admin approval can arrive
  useEffect(() => {
    if (
      !isOpen ||
      payment !== 'KHQR / ABA' ||
      !paySessionId ||
      payStatus === 'verified' ||
      payStatus === 'expired'
    ) {
      return;
    }

    checkPaymentStatus(false);
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        checkPaymentStatus(false);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [isOpen, payment, paySessionId, payStatus, checkPaymentStatus]);

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

  const handleRegenerateQr = () => {
    unlockAudio();
    resetPaymentSession();
    setBillMeta({ billNumber: makeBillNonce(), timestampMs: Date.now() });
  };

  const handleRequestTelegramVerify = async () => {
    unlockAudio();
    if (!paySessionId || sendingTgVerify) return;
    setPayError('');
    setSendingTgVerify(true);
    try {
      const summary = cart.map((i) => `${i.qty}x ${i.name}`).join(', ');
      const res = await fetchWithTimeout(
        '/api/payments/khqr/request-telegram-verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: paySessionId,
            paymentRef: paymentRefInput.trim(),
            slipImg: slipImgData,
            customerName: custName.trim() || currentMember?.name || (orderType === 'dinein' ? `ភ្ញៀវតុលេខ ${tableNum}` : 'ភ្ញៀវ'),
            customerPhone: (orderType === 'delivery' ? custPhone : dineInPhone).trim() || currentMember?.phone || '',
            orderSummary: summary,
          }),
        },
        12000
      );
      const data = await res.json();
      if (!data.ok) {
        setPayError(data.error || 'មិនអាចផ្ញើទៅ Telegram ហាងបានទេ');
        return;
      }
      setPayStatus('awaiting_owner');
      onToast(
        isEn
          ? '📩 Sent to Shop Telegram Bot! Waiting for confirmation...'
          : '📩 បានផ្ញើទៅ Telegram Bot ហាងរួចរាល់! កំពុងរង់ចាំការបញ្ជាក់...'
      );
    } catch {
      setPayError(isEn ? 'Could not reach server' : 'មានបញ្ហាភ្ជាប់ទៅ Server');
    } finally {
      setSendingTgVerify(false);
    }
  };

  const handleVerifySlipAuto = useCallback(
    async (overrideSlip?: string) => {
      unlockAudio();
      const targetSlip = overrideSlip || slipImgData;
      if (!paySessionId || verifyingSlip) return;
      if (!targetSlip) {
        setPayError(
          isEn
            ? 'Please upload your bank transfer receipt screenshot first.'
            : 'សូម Upload រូបវិក្កយបត្រវេរលុយពីធនាគារជាមុនសិន!'
        );
        return;
      }
      setPayError('');
      setNeedsOwnerFallback(false);
      setVerifyingSlip(true);
      try {
        const res = await fetchWithTimeout(
          '/api/payments/khqr/verify-slip',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: paySessionId,
              paymentRef: paymentRefInput.trim(),
              slipImg: targetSlip,
            }),
          },
          22000
        );
        const data = await res.json();
        if (!data.ok || !data.proofToken) {
          if (data?.status === 'amount_mismatch') setPayStatus('amount_mismatch');
          else if (data?.status === 'rejected') setPayStatus('rejected');
          if (data?.needsOwnerReview) setNeedsOwnerFallback(true);
          setPayError(
            data.error ||
              (isEn
                ? 'Receipt verification failed. Please check receipt screenshot or request owner check.'
                : 'ការផ្ទៀងផ្ទាត់វិក្កយបត្រមិនជោគជ័យ! សូមពិនិត្យរូបវិក្កយបត្រ ឬផ្ញើជូនម្ចាស់ហាងពិនិត្យ។')
          );
          return;
        }
        setPayStatus('verified');
        setVerifiedPayment({
          sessionId: paySessionId,
          proofToken: data.proofToken,
          verifiedBy: data.verifiedBy || 'auto_slip_ocr',
          paidAmount: Number(data.paidAmount || dynamicKhqr.amount),
          currency: data.currency === 'KHR' ? 'KHR' : 'USD',
          transactionRef: data.transactionRef || paymentRefInput.trim() || billMeta.billNumber,
          bankName: data.bankName,
          slipHash: data.slipHash,
          md5: payMd5,
          slipImg: targetSlip,
        });
        playPaymentVerifiedSound();
        onToast(
          isEn
            ? `✅ Verified ${data.bankName ? `${data.bankName} ` : ''}receipt automatically!`
            : `✅ បានស្កេនផ្ទៀងផ្ទាត់វិក្កយបត្រ${data.bankName ? ` (${data.bankName})` : ''} ស្វ័យប្រវត្តិជោគជ័យ!`
        );
      } catch {
        setNeedsOwnerFallback(true);
        setPayError(isEn ? 'Could not verify receipt right now' : 'មានបញ្ហាស្កេនផ្ទៀងផ្ទាត់វិក្កយបត្រ');
      } finally {
        setVerifyingSlip(false);
      }
    },
    [paySessionId, verifyingSlip, slipImgData, paymentRefInput, dynamicKhqr.amount, billMeta.billNumber, payMd5, onToast, isEn]
  );

  const handleApplyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (shopSettings.promoCode && code === shopSettings.promoCode.toUpperCase() && shopSettings.promoPercent > 0) {
      setAppliedPromoPct(shopSettings.promoPercent);
      onToast(
        isEn
          ? `Promo applied: ${shopSettings.promoPercent}% off!`
          : `បញ្ចុះតម្លៃ ${shopSettings.promoPercent}% ជោគជ័យ!`
      );
    } else {
      setAppliedPromoPct(0);
      onToast(isEn ? 'Invalid promo code!' : 'លេខកូដ Promo មិនត្រឹមត្រូវទេ!');
    }
  };

  const isKhqrLocked = payment === 'KHQR / ABA' && !verifiedPayment;

  const handleSubmit = async (sendTg: boolean) => {
    unlockAudio();
    if (submitting) return;
    if (!cart.length) {
      onToast(isEn ? 'Cart is empty!' : 'កន្ត្រកទំនិញទទេ!');
      return;
    }
    if (shopSettings.isOpen === false) {
      onToast(isEn ? 'Sorry! The shop is temporarily closed.' : 'សូមអភ័យទោស! ហាងកំពុងបិទបណ្តោះអាសន្ន។');
      return;
    }

    if (orderType === 'delivery') {
      if (!custName.trim() || !custPhone.trim()) {
        onToast(isEn ? 'Please enter your name and phone number!' : 'សូមបំពេញឈ្មោះ និងលេខទូរស័ព្ទ!');
        return;
      }
    }

    if (payment === 'KHQR / ABA' && !verifiedPayment) {
      onToast(
        isEn
          ? 'Please complete & verify KHQR payment amount before confirming order!'
          : 'សូមទូទាត់ KHQR និងផ្ទៀងផ្ទាត់ចំនួនទឹកប្រាក់ជាមុនសិន ទើបអាចបញ្ជាក់ការកម្ម៉ង់បាន!'
      );
      return;
    }

    setSubmitting(true);
    try {
      const ok = await onSubmitOrder({
        sendTg,
        payment,
        promoDisc,
        fee: orderType === 'delivery' ? fee : 0,
        subtotal,
        grandTotal,
        paymentVerification: payment === 'KHQR / ABA' ? verifiedPayment || undefined : undefined,
        customer:
          orderType === 'delivery'
            ? {
                name: custName.trim(),
                phone: custPhone.trim(),
                tg: custTg.trim(),
                addressName: pickedAddressName,
                addressNote: addressNote.trim(),
                coords: selectedCoords,
                distanceKm: distanceKm.toFixed(2),
              }
            : {
                name: currentMember ? currentMember.name : `ភ្ញៀវតុលេខ ${tableNum}`,
                phone: dineInPhone.trim(),
                tg: currentMember ? currentMember.telegramUsername || currentMember.tg || '' : '',
                tableNum,
              },
      });
      if (ok !== false) {
        setAppliedPromoPct(0);
        setPromoInput('');
        resetPaymentSession();
        setBillMeta({ billNumber: makeBillNonce(), timestampMs: Date.now() });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const isKhr = (shopSettings.khqrCurrency || 'USD') === 'KHR';

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
              <h3 className="font-bold text-lg text-[#0D4A3E]">
                {isEn ? 'Confirm Order' : 'បញ្ជាក់ការកម្ម៉ង់'}
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close' : 'បិទ'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-100 rounded-full hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-40 overflow-y-auto">
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
                placeholder={isEn ? 'Promo Code' : 'លេខកូដបញ្ចុះតម្លៃ (Promo Code)'}
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-base sm:text-xs uppercase focus:outline-none focus:border-[#0D4A3E]"
              />
              <button
                type="button"
                onClick={handleApplyPromo}
                className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
              >
                {isEn ? 'Apply' : 'ប្រើកូដ'}
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
                <span>{isEn ? 'Delivery' : 'ដឹកជញ្ជូន'}</span>
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
                <span>{isEn ? 'Dine-In' : 'ញ៉ាំក្នុងហាង'}</span>
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
                    {isEn ? 'Open Map' : 'បើកផែនទី'}
                  </button>
                </div>
                <input
                  type="text"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder={isEn ? 'Your Name *' : 'ឈ្មោះ *'}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-xs focus:outline-none focus:border-[#0D4A3E]"
                />
                <div className="space-y-1">
                  <input
                    type="tel"
                    value={custPhone}
                    onChange={(e) => setCustPhone(e.target.value)}
                    placeholder={isEn ? 'Phone Number *' : 'លេខទូរស័ព្ទ *'}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-xs font-mono-num focus:outline-none focus:border-[#0D4A3E]"
                  />
                  {currentMember?.phoneVerified &&
                    custPhone.replace(/\D/g, '').replace(/^855/, '0') ===
                      (currentMember.phone || '').replace(/\D/g, '').replace(/^855/, '0') && (
                      <p className="text-[11px] font-medium text-emerald-700 flex items-center gap-1 px-1">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span>
                          {isEn
                            ? 'Verified member phone protected against spoofing'
                            : 'លេខទូរស័ព្ទបានផ្ទៀងផ្ទាត់ & ការពារការបន្លំ ✓'}
                        </span>
                      </p>
                    )}
                </div>
                <input
                  type="text"
                  value={custTg}
                  onChange={(e) => setCustTg(e.target.value)}
                  placeholder="Telegram (@username)"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-xs focus:outline-none focus:border-[#0D4A3E]"
                />
                <input
                  type="text"
                  value={addressNote}
                  onChange={(e) => setAddressNote(e.target.value)}
                  placeholder={isEn ? 'House #, Street / Delivery Note...' : 'លេខផ្ទះ / ផ្លូវ / ចំណាំបន្ថែម...'}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-xs focus:outline-none focus:border-[#0D4A3E]"
                />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <label className="text-[11px] font-semibold text-slate-600 block">
                  {isEn ? 'Table Number' : 'លេខតុ'}
                </label>
                <input
                  type="number"
                  min={1}
                  value={tableNum}
                  onChange={(e) => setTableNum(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-sm font-bold font-mono-num text-[#0D4A3E]"
                />
                <input
                  type="tel"
                  value={dineInPhone}
                  onChange={(e) => setDineInPhone(e.target.value)}
                  placeholder={isEn ? 'Phone / Telegram (Optional)' : 'លេខទូរស័ព្ទ / Telegram (ស្រេចចិត្ត)'}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-xs"
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
                      <span>{isEn ? 'Cash' : 'សាច់ប្រាក់ (Cash)'}</span>
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
              <div className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
                {/* Security Header & Countdown */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#0D4A3E] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-[#0D4A3E]" />
                    <span>
                      {isEn
                        ? 'Auto Payment & Amount Verification'
                        : 'ប្រព័ន្ធផ្ទៀងផ្ទាត់ការទូទាត់ & ចំនួនលុយ'}
                    </span>
                  </span>
                  {payCountdown > 0 && payStatus !== 'verified' && (
                    <span className="text-[10px] font-mono-num font-bold bg-white border border-slate-200 px-2 py-0.5 rounded-lg text-slate-600 flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3 text-amber-600" />
                      {formatSec(payCountdown)}
                    </span>
                  )}
                </div>

                {/* KHQR Card */}
                {dynamicKhqr.isOfficialEmv ? (
                  <div className="text-center space-y-2">
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden max-w-[230px] mx-auto shadow-sm">
                      <div className="bg-[#E1232E] text-white py-1.5 px-3 flex items-center justify-between">
                        <span className="font-extrabold text-xs tracking-wider">KHQR</span>
                        <span className="text-[10px] font-semibold bg-white/20 px-1.5 py-0.5 rounded font-mono-num">
                          {billMeta.billNumber}
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

                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await downloadBrandedKhqrPng({
                            payload: dynamicKhqr.payload,
                            merchantDisplay: dynamicKhqr.merchantDisplay,
                            formattedAmount: dynamicKhqr.formattedAmount,
                            bankInfo: shopSettings.bankInfo,
                            filename: `KHQR-${billMeta.billNumber}.png`,
                          });
                          if (ok) {
                            onToast(
                              isEn ? 'KHQR image saved to your device!' : 'បានរក្សាទុករូប KHQR ចូលទូរស័ព្ទហើយ!'
                            );
                          }
                        }}
                        className="inline-flex items-center justify-center gap-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-[#E1232E]" />
                        <span>{isEn ? 'Save QR Image' : 'រក្សាទុករូប QR'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRegenerateQr}
                        className="inline-flex items-center justify-center gap-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                        <span>{isEn ? 'New QR' : 'បង្កើត QR ថ្មី'}</span>
                      </button>
                    </div>
                  </div>
                ) : shopSettings.khqrImg ? (
                  <div className="text-center space-y-2">
                    <p className="text-xs font-bold text-slate-900">
                      {isEn ? 'Scan KHQR to pay exact amount:' : 'ស្កេន KHQR ដើម្បីទូទាត់ឱ្យគ្រប់៖'}{' '}
                      <span className="text-[#E1232E] font-mono-num text-sm">
                        {isKhr ? `${Math.round(dynamicKhqr.amount).toLocaleString()} ៛` : `$${grandTotal.toFixed(2)}`}
                      </span>
                    </p>
                    <img
                      src={shopSettings.khqrImg}
                      alt="KHQR Code"
                      referrerPolicy="no-referrer"
                      className="w-36 h-36 mx-auto rounded-xl object-contain bg-white border p-1"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                    {isEn
                      ? 'Bakong ID or KHQR is not configured yet. Please set it in Shop Admin → Settings.'
                      : 'មិនទាន់បានកំណត់ Bakong ID ឬ KHQR ហាងទេ។ សូមម្ចាស់ហាងបញ្ចូលក្នុង គ្រប់គ្រងហាង → ការកំណត់។'}
                  </p>
                )}

                {shopSettings.bankInfo && (
                  <p className="text-[11px] font-bold text-slate-700 text-center">{shopSettings.bankInfo}</p>
                )}

                {/* Verification Status Banner */}
                {verifiedPayment ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-emerald-50 border border-emerald-300 rounded-xl p-3 text-left space-y-1"
                  >
                    <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        {isEn
                          ? 'Payment & Exact Amount Verified!'
                          : 'បានផ្ទៀងផ្ទាត់ការបង់ប្រាក់ & ចំនួនលុយគ្រប់ជោគជ័យ!'}
                      </span>
                    </p>
                    <p className="text-[11px] text-emerald-800 font-mono-num">
                      {isEn ? 'Paid:' : 'ចំនួនលុយ៖'}{' '}
                      <strong>
                        {verifiedPayment.currency === 'KHR'
                          ? `${Math.round(verifiedPayment.paidAmount).toLocaleString()} ៛`
                          : `$${verifiedPayment.paidAmount.toFixed(2)}`}
                      </strong>{' '}
                      · Ref: <strong>{verifiedPayment.transactionRef}</strong>
                    </p>
                    <p className="text-[10px] text-emerald-700">
                      {verifiedPayment.verifiedBy === 'bakong_md5'
                        ? isEn
                          ? '✓ Auto-verified by Bakong NBC API'
                          : '✓ ផ្ទៀងផ្ទាត់ស្វ័យប្រវត្តិតាម Bakong NBC API'
                        : verifiedPayment.verifiedBy === 'auto_slip_ocr'
                          ? isEn
                            ? `✓ Auto Slip AI Verified${verifiedPayment.bankName ? ` · ${verifiedPayment.bankName}` : ''} (Anti-Fraud & Hash Guard)`
                            : `✓ ស្កេនវិក្កយបត្រ Auto${verifiedPayment.bankName ? ` (${verifiedPayment.bankName})` : ''} · ការពារក្លែងបន្លំ 100%`
                          : verifiedPayment.verifiedBy === 'telegram_owner'
                            ? isEn
                              ? '✓ Confirmed by Shop Owner on Telegram'
                              : '✓ បញ្ជាក់ទទួលប្រាក់ដោយម្ចាស់ហាងតាម Telegram'
                            : verifiedPayment.verifiedBy === 'web_admin'
                              ? isEn
                                ? '✓ Confirmed by Shop Owner on Website'
                                : '✓ បញ្ជាក់ទទួលប្រាក់ដោយម្ចាស់ហាងលើគេហទំព័រ'
                              : isEn
                                ? '✓ Exact amount & receipt reference matched'
                                : '✓ ផ្ទៀងផ្ទាត់ចំនួនទឹកប្រាក់ & លេខយោងត្រឹមត្រូវ'}
                    </p>
                  </motion.div>
                ) : (
                  <div className="space-y-2.5 border-t border-slate-200 pt-2.5">
                    {verifyCaps.bakong && (
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-sky-950 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse shrink-0" />
                            <span>
                              {isEn
                                ? 'Auto-checking Bakong transfer...'
                                : 'កំពុងផ្ទៀងផ្ទាត់លុយ Bakong ស្វ័យប្រវត្តិ...'}
                            </span>
                          </p>
                          <p className="text-[10px] text-sky-800 mt-0.5">
                            {isEn
                              ? 'Scan QR & pay — unlocks automatically once funds arrive.'
                              : 'គ្រាន់តែស្កេនបង់តាមធនាគារ រួចរង់ចាំ ២-៥ វិនាទី ប្រព័ន្ធនឹងដោះសោរភ្លាម!'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => checkPaymentStatus(true)}
                          disabled={checkingNow}
                          className="bg-white border border-sky-300 text-sky-800 px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0"
                        >
                          {checkingNow ? '...' : isEn ? 'Check Now' : 'ពិនិត្យឥឡូវ'}
                        </button>
                      </div>
                    )}

                    {payStatus === 'awaiting_owner' && (
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-sky-900 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse shrink-0" />
                            <span>
                              {isEn
                                ? 'Waiting for Shop Telegram confirmation...'
                                : 'បានផ្ញើទៅ Telegram ហាង! កំពុងរង់ចាំការបញ្ជាក់...'}
                            </span>
                          </p>
                          <p className="text-[10px] text-sky-700 mt-0.5">
                            {isEn
                              ? 'Confirm button unlocks automatically as soon as shop clicks Approve.'
                              : 'ប៊ូតុងបញ្ជាក់កម្ម៉ង់នឹងបើកស្វ័យប្រវត្តិភ្លាម ពេលម្ចាស់ហាងចុចទទួលលុយ!'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => checkPaymentStatus(true)}
                          disabled={checkingNow}
                          className="bg-white border border-sky-300 text-sky-800 px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0"
                        >
                          {checkingNow ? '...' : isEn ? 'Refresh' : 'ពិនិត្យ'}
                        </button>
                      </div>
                    )}

                    {(payStatus === 'amount_mismatch' || payStatus === 'rejected' || payError) && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-xs text-red-700 font-medium flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                        <span>{payError}</span>
                      </div>
                    )}

                    {payStatus === 'expired' && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-amber-900">
                          {isEn ? 'KHQR session expired.' : 'កូដ QR ផុតកំណត់ហើយ'}
                        </span>
                        <button
                          type="button"
                          onClick={handleRegenerateQr}
                          className="bg-amber-500 text-slate-950 px-3 py-1 rounded-lg text-[11px] font-bold"
                        >
                          {isEn ? 'Generate New QR' : 'បង្កើត QR ថ្មី'}
                        </button>
                      </div>
                    )}

                    {/* Smart Auto Bank Slip Scanner + Telegram Owner Fallback */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5 text-left shadow-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-6 h-6 rounded-lg bg-[#E8F2EF] text-[#0D4A3E] flex items-center justify-center shrink-0">
                            <Sparkles className="w-3.5 h-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-slate-900 truncate">
                              {isEn
                                ? 'Auto Bank Slip Verification (Anti-Fraud)'
                                : 'ស្កេនផ្ទៀងផ្ទាត់វិក្កយបត្រ Auto (សុវត្ថិភាពខ្ពស់)'}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {isEn
                                ? 'Upload ABA / ACLEDA / Bakong receipt to verify automatically'
                                : 'Upload រូបវិក្កយបត្រ ABA / ACLEDA / Bakong — អាន & ផ្ទៀងផ្ទាត់ភ្លាមៗ'}
                            </p>
                          </div>
                        </div>
                        {verifyCaps.slipAuto && (
                          <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-md shrink-0">
                            AUTO AI
                          </span>
                        )}
                      </div>

                      {/* Upload Dropzone */}
                      <label
                        className={`relative flex items-center justify-between gap-3 rounded-xl border-2 border-dashed p-2.5 cursor-pointer transition-all ${
                          verifyingSlip
                            ? 'border-emerald-500 bg-emerald-50/70'
                            : slipImgData
                              ? 'border-[#0D4A3E]/40 bg-[#E8F2EF]/40 hover:bg-[#E8F2EF]/60'
                              : 'border-slate-300 bg-slate-50 hover:border-[#0D4A3E] hover:bg-[#E8F2EF]/30'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {slipImgData ? (
                            <img
                              src={slipImgData}
                              alt="Payment Slip"
                              className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0 shadow-xs"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 text-[#0D4A3E]">
                              <Upload className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-slate-800 truncate">
                              {verifyingSlip
                                ? isEn
                                  ? 'Scanning receipt · Checking amount & anti-replay...'
                                  : 'កំពុងស្កេនអានវិក្កយបត្រ & ពិនិត្យសុវត្ថិភាព...'
                                : slipImgData
                                  ? isEn
                                    ? '✓ Slip Ready — Tap to replace image'
                                    : '✓ បានភ្ជាប់រូបវិក្កយបត្រ — ចុចប្តូររូបថ្មី'
                                  : isEn
                                    ? 'Tap to Upload Payment Slip Screenshot'
                                    : 'ចុច Upload រូបវិក្កយបត្រវេរលុយ (Auto Scan)'}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {isEn
                                ? 'Checks exact amount, recipient, date/time & duplicate hash'
                                : 'ផ្ទៀងផ្ទាត់៖ ទឹកប្រាក់ · ឈ្មោះគណនី · កាលបរិច្ឆេទ · កូដស្ទួន SHA-256'}
                            </p>
                          </div>
                        </div>
                        {verifyingSlip && (
                          <ScanLine className="w-5 h-5 text-emerald-600 animate-pulse shrink-0" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={verifyingSlip || payStatus === 'expired'}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = '';
                            if (f) {
                              compressImageFile(
                                f,
                                900,
                                (compressedDataUri) => {
                                  setSlipImgData(compressedDataUri);
                                  setPayError('');
                                  if (verifyCaps.slipAuto && paySessionId && payStatus !== 'expired') {
                                    void handleVerifySlipAuto(compressedDataUri);
                                  }
                                },
                                onToast
                              );
                            }
                          }}
                        />
                      </label>

                      {/* Optional Manual Ref for extra trace */}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={paymentRefInput}
                          onChange={(e) => setPaymentRefInput(e.target.value)}
                          placeholder={
                            isEn
                              ? 'Optional TX ID / Ref (auto-read from slip)'
                              : 'លេខប្រតិបត្តិការណ៍បន្ថែម (ស្រេចចិត្ត — ប្រព័ន្ធអានពី Slip Auto)'
                          }
                          className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-base sm:text-[11px] font-mono-num"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-1.5">
                        <button
                          type="button"
                          disabled={verifyingSlip || payStatus === 'expired' || !slipImgData}
                          onClick={() => handleVerifySlipAuto()}
                          className="w-full bg-[#0D4A3E] hover:bg-[#09352C] disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
                        >
                          {verifyingSlip ? (
                            <>
                              <ScanLine className="w-4 h-4 animate-pulse" />
                              <span>
                                {isEn ? 'Auto-Verifying Receipt...' : 'កំពុងស្កេន & ផ្ទៀងផ្ទាត់វិក្កយបត្រ...'}
                              </span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-4 h-4" />
                              <span>
                                {isEn
                                  ? 'Scan & Verify Slip Automatically'
                                  : 'ស្កេន & ផ្ទៀងផ្ទាត់វិក្កយបត្រ Auto'}
                              </span>
                            </>
                          )}
                        </button>

                        {(verifyCaps.telegram || needsOwnerFallback) && verifyCaps.telegram && (
                          <button
                            type="button"
                            disabled={sendingTgVerify || payStatus === 'expired'}
                            onClick={handleRequestTelegramVerify}
                            className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>
                              {sendingTgVerify
                                ? isEn
                                  ? 'Sending to Shop Telegram...'
                                  : 'កំពុងផ្ញើទៅ Telegram Bot ហាង...'
                                : payStatus === 'awaiting_owner'
                                  ? isEn
                                    ? 'Resend to Shop Telegram Bot'
                                    : 'ផ្ញើសំណើផ្ទៀងផ្ទាត់ម្តងទៀតទៅ Telegram'
                                  : isEn
                                    ? 'Or Send to Shop Telegram for Manual Approval'
                                    : 'ឬ ផ្ញើទៅ Telegram ម្ចាស់ហាងចុចបញ្ជាក់'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 bg-slate-50 p-3 rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span>{isEn ? 'Subtotal:' : 'ទំនិញ៖'}</span>
                <span className="font-mono-num">${subtotal.toFixed(2)}</span>
              </div>
              {promoDisc > 0 && (
                <div className="flex justify-between text-red-600 font-bold">
                  <span>{isEn ? 'Promo Discount:' : 'បញ្ចុះតម្លៃ Promo៖'}</span>
                  <span className="font-mono-num">-${promoDisc.toFixed(2)}</span>
                </div>
              )}
              {orderType === 'delivery' && (
                <div className="flex justify-between">
                  <span>{isEn ? 'Delivery Fee:' : 'ថ្លៃដឹកជញ្ជូន៖'}</span>
                  <span className="font-mono-num">
                    {fee === 0 ? (
                      <span className="text-emerald-700 font-bold">
                        {isEn ? 'Free ($0.00)' : 'ហ្វ្រី ($0.00)'}
                      </span>
                    ) : (
                      `$${fee.toFixed(2)}`
                    )}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base text-[#0D4A3E] border-t border-slate-200 pt-1.5">
                <span>{isEn ? 'Total:' : 'សរុប៖'}</span>
                <span className="font-mono-num">${grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {isKhqrLocked && (
              <p className="mt-2.5 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 shrink-0 text-amber-700" />
                <span>
                  {isEn
                    ? 'Confirm button unlocks automatically once KHQR payment is verified.'
                    : 'ប៊ូតុងបញ្ជាក់ការកម្ម៉ង់នឹងដោះសោរបន្ទាប់ពីផ្ទៀងផ្ទាត់ការបង់ប្រាក់គ្រប់ចំនួនរួចរាល់។'}
                </span>
              </p>
            )}

            <div className="mt-3 space-y-2">
              <button
                type="button"
                disabled={submitting || isKhqrLocked}
                onClick={() => handleSubmit(false)}
                className="w-full bg-[#0D4A3E] hover:bg-[#09352C] disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-2xl text-sm transition-colors active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                {isKhqrLocked && <Lock className="w-3.5 h-3.5" />}
                <span>
                  {submitting
                    ? isEn
                      ? 'Submitting...'
                      : 'កំពុងបញ្ជូន...'
                    : isEn
                      ? 'Confirm Order'
                      : 'បញ្ជាក់ការកម្ម៉ង់'}
                </span>
              </button>
              <button
                type="button"
                disabled={submitting || isKhqrLocked}
                onClick={() => handleSubmit(true)}
                className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isEn ? 'Order & Send to Shop Telegram' : 'កម្ម៉ង់ & ផ្ញើចូល Telegram ហាង'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

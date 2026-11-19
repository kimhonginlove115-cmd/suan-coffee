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
  Gift,
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
  getShopScheduleStatus,
  handleImgFallback,
  resolveAssetUrl,
  safeDel,
  safeGet,
  safeSet,
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
  isTableLocked?: boolean;
  maxTableCount?: number;
  isShopOpenEffective?: boolean;
  shopClosedMessage?: string;
  onOpenAuth?: () => void;
  onChangeTableNum?: (n: number) => void;
  onClose: () => void;
  onChangeOrderType: (t: OrderType) => void;
  onChangeQty: (idx: number, delta: number) => void;
  onOpenLocationPicker: () => void;
  onSubmitOrder: (payload: {
    sendTg: boolean;
    payment: PaymentMethod;
    promoDisc: number;
    loyaltyPointsUsed?: number;
    loyaltyDisc?: number;
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

type KhqrPayStatus =
  | 'idle'
  | 'creating'
  | 'pending'
  | 'awaiting_owner'
  | 'verified'
  | 'amount_mismatch'
  | 'rejected'
  | 'expired';

interface PersistedCheckoutState {
  promoInput: string;
  appliedPromoPct: number;
  payment: PaymentMethod;
  custName: string;
  custPhone: string;
  custTg: string;
  addressNote: string;
  tableNum: number;
  dineInPhone: string;
  billMeta: { billNumber: string; timestampMs: number };
  paySessionId: string | null;
  payMd5: string;
  payExpiresAt: number;
  payStatus: KhqrPayStatus;
  verifyCaps: { bakong: boolean; telegram: boolean; slipAuto: boolean };
  verifiedPayment: VerifiedPaymentState | null;
  paymentRefInput: string;
  slipImgData: string;
  sessionKey: string;
}

const CHECKOUT_STORAGE_KEY = 'cafe_checkout_state_v15';

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
  isTableLocked = false,
  maxTableCount = 10,
  isShopOpenEffective,
  shopClosedMessage,
  onOpenAuth,
  onChangeTableNum,
  onClose,
  onChangeOrderType,
  onChangeQty,
  onOpenLocationPicker,
  onSubmitOrder,
  onToast,
}: CartModalProps) {
  const isEn = lang === 'en';
  const savedCheckout = useMemo(() => {
    if (cart.length === 0) return null;
    const raw = safeGet<PersistedCheckoutState | null>(CHECKOUT_STORAGE_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    return raw;
    // Read once on mount so reload / banking app return restores exact session state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [promoInput, setPromoInput] = useState(() => savedCheckout?.promoInput || '');
  const [appliedPromoPct, setAppliedPromoPct] = useState(() => Number(savedCheckout?.appliedPromoPct) || 0);
  const [useLoyaltyReward, setUseLoyaltyReward] = useState(false);
  const [payment, setPayment] = useState<PaymentMethod>(() =>
    savedCheckout?.payment === 'KHQR / ABA' ? 'KHQR / ABA' : 'Cash'
  );
  const [custName, setCustName] = useState(() => savedCheckout?.custName || '');
  const [custPhone, setCustPhone] = useState(() => savedCheckout?.custPhone || '');
  const [custTg, setCustTg] = useState(() => savedCheckout?.custTg || '');
  const [addressNote, setAddressNote] = useState(() => savedCheckout?.addressNote || '');
  const [tableNum, setTableNum] = useState(() =>
    isTableLocked ? initialTableNum || 1 : initialTableNum || savedCheckout?.tableNum || 1
  );
  const [dineInPhone, setDineInPhone] = useState(() => savedCheckout?.dineInPhone || '');
  const [submitting, setSubmitting] = useState(false);
  const khqrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Payment Verification State (KHQR Auto Verification)
  const [billMeta, setBillMeta] = useState<{ billNumber: string; timestampMs: number }>(() => {
    if (savedCheckout?.billMeta?.billNumber && Number.isFinite(savedCheckout.billMeta.timestampMs)) {
      return savedCheckout.billMeta;
    }
    return { billNumber: makeBillNonce(), timestampMs: Date.now() };
  });
  const [paySessionId, setPaySessionId] = useState<string | null>(() => savedCheckout?.paySessionId || null);
  const [payMd5, setPayMd5] = useState(() => savedCheckout?.payMd5 || '');
  const [payExpiresAt, setPayExpiresAt] = useState(() => Number(savedCheckout?.payExpiresAt) || 0);
  const [payCountdown, setPayCountdown] = useState(0);
  const [payStatus, setPayStatus] = useState<KhqrPayStatus>(() => {
    const st = savedCheckout?.payStatus;
    if (
      st === 'pending' ||
      st === 'awaiting_owner' ||
      st === 'verified' ||
      st === 'amount_mismatch' ||
      st === 'rejected' ||
      st === 'expired'
    ) {
      if (
        st !== 'verified' &&
        savedCheckout?.payExpiresAt &&
        Date.now() >= Number(savedCheckout.payExpiresAt)
      ) {
        return 'expired';
      }
      return st;
    }
    return 'idle';
  });
  const [payError, setPayError] = useState('');
  const [verifyCaps, setVerifyCaps] = useState<{ bakong: boolean; telegram: boolean; slipAuto: boolean }>(() => ({
    bakong: Boolean(savedCheckout?.verifyCaps?.bakong),
    telegram: Boolean(savedCheckout?.verifyCaps?.telegram),
    slipAuto: Boolean(savedCheckout?.verifyCaps?.slipAuto),
  }));
  const [verifiedPayment, setVerifiedPayment] = useState<VerifiedPaymentState | null>(
    () => savedCheckout?.verifiedPayment || null
  );
  const [checkingNow, setCheckingNow] = useState(false);
  const [sendingTgVerify, setSendingTgVerify] = useState(false);
  const [verifyingSlip, setVerifyingSlip] = useState(false);
  const [scanElapsedSec, setScanElapsedSec] = useState(0);
  const [needsOwnerFallback, setNeedsOwnerFallback] = useState(false);
  const [paymentRefInput, setPaymentRefInput] = useState(() => savedCheckout?.paymentRefInput || '');
  const [slipImgData, setSlipImgData] = useState('');
  const activeSessionKeyRef = useRef<string>(savedCheckout?.sessionKey || '');

  useEffect(() => {
    if (!verifyingSlip) {
      setScanElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setScanElapsedSec(Math.max(1, Math.floor((Date.now() - started) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [verifyingSlip]);

  useEffect(() => {
    if (currentMember) {
      setCustName((prev) => prev || currentMember.name || '');
      setCustPhone((prev) => prev || currentMember.phone || '');
      setCustTg((prev) => prev || currentMember.telegramUsername || currentMember.tg || '');
      setDineInPhone((prev) => prev || currentMember.phone || currentMember.telegramUsername || '');
    }
  }, [currentMember]);

  useEffect(() => {
    if (initialTableNum >= 1) {
      setTableNum(isTableLocked ? initialTableNum : Math.min(maxTableCount, initialTableNum));
    }
  }, [initialTableNum, isTableLocked, maxTableCount]);

  const updateTableNumber = useCallback(
    (next: number) => {
      if (isTableLocked) return;
      const clamped = Math.min(maxTableCount, Math.max(1, Math.round(next) || 1));
      setTableNum(clamped);
      onChangeTableNum?.(clamped);
    },
    [isTableLocked, maxTableCount, onChangeTableNum]
  );

  const loyaltyEnabled = shopSettings.loyaltyEnabled !== false;
  const loyaltyRewardPts = Math.max(1, Math.round(Number(shopSettings.loyaltyRewardPoints) || 10));
  const loyaltyRewardUsd = Math.max(0.25, Number(shopSettings.loyaltyRewardAmountUsd) || 2.5);
  const canRedeemLoyalty = Boolean(
    loyaltyEnabled && currentMember && (Number(currentMember.points) || 0) >= loyaltyRewardPts
  );

  useEffect(() => {
    if (!canRedeemLoyalty && useLoyaltyReward) {
      setUseLoyaltyReward(false);
    }
  }, [canRedeemLoyalty, useLoyaltyReward]);

  const scheduleStatus = useMemo(() => getShopScheduleStatus(shopSettings), [shopSettings]);
  const effectiveShopOpen =
    typeof isShopOpenEffective === 'boolean' ? isShopOpenEffective : scheduleStatus.isOpen;

  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const promoDisc = subtotal * (appliedPromoPct / 100);
  const loyaltyDisc =
    useLoyaltyReward && canRedeemLoyalty
      ? Number(Math.min(loyaltyRewardUsd, Math.max(0, subtotal - promoDisc)).toFixed(2))
      : 0;
  const loyaltyPointsUsed = loyaltyDisc > 0 ? loyaltyRewardPts : 0;
  const computedFee = computeDeliveryFee(
    shopSettings,
    distanceKm,
    Math.max(0, subtotal - promoDisc - loyaltyDisc)
  );
  const fee = orderType === 'delivery' ? computedFee : 0;
  const grandTotal = Math.max(0, subtotal - promoDisc - loyaltyDisc + fee);

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
      safeDel(CHECKOUT_STORAGE_KEY);
      setUseLoyaltyReward(false);
      resetPaymentSession();
      setBillMeta({ billNumber: makeBillNonce(), timestampMs: Date.now() });
    }
  }, [cart.length, resetPaymentSession]);

  // Persist active checkout & KHQR payment state so switching to ABA/banking apps or reloading Safari never loses progress
  useEffect(() => {
    if (cart.length === 0) return;
    const khqrCurr = shopSettings.khqrCurrency === 'KHR' ? 'KHR' : 'USD';
    const sessionKey = `${grandTotal.toFixed(2)}|${khqrCurr}|${billMeta.billNumber}|${dynamicKhqr.payload}`;
    const stateToSave: PersistedCheckoutState = {
      promoInput,
      appliedPromoPct,
      payment,
      custName,
      custPhone,
      custTg,
      addressNote,
      tableNum,
      dineInPhone,
      billMeta,
      paySessionId,
      payMd5,
      payExpiresAt,
      payStatus,
      verifyCaps,
      verifiedPayment,
      paymentRefInput,
      slipImgData: '',
      sessionKey: activeSessionKeyRef.current || sessionKey,
    };
    safeSet(CHECKOUT_STORAGE_KEY, stateToSave);
  }, [
    cart.length,
    grandTotal,
    shopSettings.khqrCurrency,
    dynamicKhqr.payload,
    promoInput,
    appliedPromoPct,
    payment,
    custName,
    custPhone,
    custTg,
    addressNote,
    tableNum,
    dineInPhone,
    billMeta,
    paySessionId,
    payMd5,
    payExpiresAt,
    payStatus,
    verifyCaps,
    verifiedPayment,
    paymentRefInput,
  ]);

  // Create KHQR payment session only when total/currency/bill/QR changes (keep session across close, reload & app switch)
  useEffect(() => {
    if (!isOpen || payment !== 'KHQR / ABA' || grandTotal <= 0) return;

    const khqrCurr = shopSettings.khqrCurrency === 'KHR' ? 'KHR' : 'USD';
    const sessionKey = `${grandTotal.toFixed(2)}|${khqrCurr}|${billMeta.billNumber}|${dynamicKhqr.payload}`;
    const stillValid =
      activeSessionKeyRef.current === sessionKey &&
      Boolean(paySessionId) &&
      (payStatus === 'verified' ||
        (payStatus !== 'expired' && (payExpiresAt === 0 || Date.now() < payExpiresAt)));

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

  // Automatic polling every 2.5s + instant check when returning from banking app (ABA / Bakong / ACLEDA)
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

    const handleReturnFromBankApp = () => {
      if (document.visibilityState !== 'hidden') {
        checkPaymentStatus(false);
      }
    };
    window.addEventListener('focus', handleReturnFromBankApp);
    document.addEventListener('visibilitychange', handleReturnFromBankApp);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', handleReturnFromBankApp);
      document.removeEventListener('visibilitychange', handleReturnFromBankApp);
    };
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
          24000
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
      } catch (err) {
        setNeedsOwnerFallback(true);
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        setPayError(
          isAbort
            ? isEn
              ? 'Receipt scan timed out. Please retry or send directly to Shop Telegram.'
              : 'ការស្កេនវិក្កយបត្រចំណាយពេលយូរពេក! សូមចុចស្កេនម្តងទៀត ឬផ្ញើទៅ Telegram ហាង។'
            : isEn
              ? 'Could not verify receipt right now'
              : 'មានបញ្ហាស្កេនផ្ទៀងផ្ទាត់វិក្កយបត្រ'
        );
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
    if (!effectiveShopOpen) {
      onToast(
        shopClosedMessage ||
          (isEn ? 'Sorry! The shop is currently closed.' : 'សូមអភ័យទោស! ហាងកំពុងបិទបណ្តោះអាសន្ន។')
      );
      return;
    }

    const effectiveOrderType: OrderType = isTableLocked ? 'dinein' : orderType;
    const effectiveTableNum = isTableLocked ? initialTableNum : tableNum;

    if (effectiveOrderType === 'delivery') {
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
        ...(loyaltyPointsUsed > 0 ? { loyaltyPointsUsed, loyaltyDisc } : {}),
        fee: effectiveOrderType === 'delivery' ? fee : 0,
        subtotal,
        grandTotal,
        paymentVerification:
          payment === 'KHQR / ABA' && verifiedPayment
            ? {
                ...verifiedPayment,
                slipImg: verifiedPayment.slipImg || slipImgData || undefined,
              }
            : undefined,
        customer:
          effectiveOrderType === 'delivery'
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
                name: currentMember ? currentMember.name : `ភ្ញៀវតុលេខ ${effectiveTableNum}`,
                phone: dineInPhone.trim(),
                tg: currentMember ? currentMember.telegramUsername || currentMember.tg || '' : '',
                tableNum: effectiveTableNum,
              },
      });
      if (ok !== false) {
        safeDel(CHECKOUT_STORAGE_KEY);
        setAppliedPromoPct(0);
        setPromoInput('');
        setUseLoyaltyReward(false);
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

            <div className="mt-3 space-y-1.5">
              <div className="flex gap-1.5">
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
              {shopSettings.promoCode && shopSettings.promoPercent > 0 && (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  {appliedPromoPct > 0 ? (
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isEn
                          ? `Code ${shopSettings.promoCode} applied (-${appliedPromoPct}%)`
                          : `បានប្រើកូដ ${shopSettings.promoCode} (-${appliedPromoPct}%)`}
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPromoInput(shopSettings.promoCode);
                        setAppliedPromoPct(shopSettings.promoPercent);
                        onToast(
                          isEn
                            ? `Promo applied: ${shopSettings.promoPercent}% off!`
                            : `បញ្ចុះតម្លៃ ${shopSettings.promoPercent}% ជោគជ័យ!`
                        );
                      }}
                      className="text-[#0D4A3E] hover:text-[#09352C] font-bold underline underline-offset-2 flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span>
                        {isEn
                          ? `Tap to apply ${shopSettings.promoCode} (-${shopSettings.promoPercent}%)`
                          : `ចុចប្រើកូដ ${shopSettings.promoCode} (-${shopSettings.promoPercent}%) ភ្លាមៗ`}
                      </span>
                    </button>
                  )}
                  {appliedPromoPct > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedPromoPct(0);
                        setPromoInput('');
                      }}
                      className="text-slate-400 hover:text-red-600 font-semibold"
                    >
                      {isEn ? 'Remove' : 'ដកចេញ'}
                    </button>
                  )}
                </div>
              )}

              {loyaltyEnabled && (
                <div className="pt-1">
                  {currentMember ? (
                    canRedeemLoyalty ? (
                      <button
                        type="button"
                        onClick={() => setUseLoyaltyReward((v) => !v)}
                        className={`w-full border rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-between gap-2 transition-colors ${
                          useLoyaltyReward
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                            : 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Gift className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="truncate">
                            {useLoyaltyReward
                              ? isEn
                                ? `Redeemed ${loyaltyRewardPts} ★ (-$${loyaltyDisc.toFixed(2)})`
                                : `បានប្រើ ${loyaltyRewardPts} ★ (-$${loyaltyDisc.toFixed(2)})`
                              : isEn
                                ? `Redeem ${loyaltyRewardPts} ★ for $${loyaltyRewardUsd.toFixed(2)} off`
                                : `ប្តូរ ${loyaltyRewardPts} ★ យកបញ្ចុះតម្លៃ $${loyaltyRewardUsd.toFixed(2)}`}
                          </span>
                        </span>
                        <span className="text-[11px] font-mono-num shrink-0">
                          {useLoyaltyReward ? (isEn ? 'Applied ✓' : 'បានប្រើ ✓') : `${currentMember.points || 0} ★`}
                        </span>
                      </button>
                    ) : (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-slate-600">
                        <span className="flex items-center gap-1.5 truncate">
                          <Gift className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="truncate">
                            {isEn
                              ? `Points: ${currentMember.points || 0}/${loyaltyRewardPts} ★ (+${cart.reduce((s, i) => s + i.qty, 0)} ★ this order)`
                              : `ពិន្ទុ៖ ${currentMember.points || 0}/${loyaltyRewardPts} ★ (ទទួលបន្ថែម +${cart.reduce((s, i) => s + i.qty, 0)} ★)`}
                          </span>
                        </span>
                        <span className="font-mono-num font-bold text-[#0D4A3E] shrink-0">
                          {Math.min(100, Math.round(((currentMember.points || 0) / loyaltyRewardPts) * 100))}%
                        </span>
                      </div>
                    )
                  ) : (
                    onOpenAuth && (
                      <button
                        type="button"
                        onClick={onOpenAuth}
                        className="w-full text-left bg-[#F4F8F6] hover:bg-[#E8F2EF] border border-emerald-900/10 rounded-xl px-3 py-2 text-[11px] font-semibold text-[#0D4A3E] flex items-center justify-between gap-2 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Gift className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="truncate">
                            {isEn
                              ? `Sign in to earn & redeem ${loyaltyRewardPts} ★ ($${loyaltyRewardUsd.toFixed(2)} reward)`
                              : `ចូលគណនីដើម្បីសន្សំពិន្ទុ (${loyaltyRewardPts} ★ = បញ្ចុះ $${loyaltyRewardUsd.toFixed(2)})`}
                          </span>
                        </span>
                        <span className="underline shrink-0">{isEn ? 'Sign in' : 'ចូលគណនី'}</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeOrderType('delivery')}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                  isTableLocked
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed opacity-75'
                    : orderType === 'delivery'
                      ? 'border-[#0D4A3E] bg-[#E8F2EF] text-[#0D4A3E]'
                      : 'border-slate-200 text-slate-600'
                }`}
              >
                {isTableLocked ? <Lock className="w-3.5 h-3.5" /> : <Bike className="w-4 h-4" />}
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

            <AnimatePresence mode="wait">
              {orderType === 'delivery' && !isTableLocked ? (
                <motion.div
                  key="cart-delivery-form"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="mt-3 space-y-2"
                >
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
                </motion.div>
              ) : (
                <motion.div
                  key="cart-dinein-form"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="mt-3 space-y-2.5"
                >
                  {isTableLocked ? (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                          <span>
                            {isEn
                              ? `Locked to Table ${initialTableNum}`
                              : `ចាក់សោតុលេខ ${initialTableNum}`}
                          </span>
                        </span>
                        <span className="font-mono-num text-sm font-extrabold text-[#0D4A3E] bg-white px-2.5 py-0.5 rounded-lg border border-amber-200">
                          #{initialTableNum}
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-900">
                        {isEn
                          ? 'Scanned Table QR — table number & delivery cannot be changed.'
                          : 'បានស្កេន QR តុ — មិនអាចប្តូរលេខតុ ឬកម្ម៉ង់ដឹកជញ្ជូនបានទេ។'}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-700">
                          {isEn ? `Select Table (1-${maxTableCount})` : `ជ្រើសរើសលេខតុ (1-${maxTableCount})`}
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateTableNumber(tableNum - 1)}
                            aria-label={isEn ? 'Decrease table' : 'បន្ថយលេខតុ'}
                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={maxTableCount}
                            value={tableNum}
                            onChange={(e) => updateTableNumber(Number(e.target.value) || 1)}
                            className="w-14 text-center border border-slate-200 bg-white rounded-lg py-1 text-sm font-bold font-mono-num text-[#0D4A3E]"
                          />
                          <button
                            type="button"
                            onClick={() => updateTableNumber(tableNum + 1)}
                            aria-label={isEn ? 'Increase table' : 'បន្ថែមលេខតុ'}
                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-0.5">
                        {Array.from({ length: maxTableCount }, (_, idx) => idx + 1).map((tNo) => (
                          <button
                            key={`modal-t-${tNo}`}
                            type="button"
                            onClick={() => updateTableNumber(tNo)}
                            className={`min-w-[34px] h-7 px-2 rounded-lg text-xs font-bold font-mono-num transition-colors ${
                              tableNum === tNo
                                ? 'bg-[#0D4A3E] text-white shadow-xs'
                                : 'bg-white border border-slate-200 text-slate-700 hover:border-[#0D4A3E]/50'
                            }`}
                          >
                            {tNo}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <input
                    type="tel"
                    value={dineInPhone}
                    onChange={(e) => setDineInPhone(e.target.value)}
                    placeholder={isEn ? 'Phone / Telegram (Optional)' : 'លេខទូរស័ព្ទ / Telegram (ស្រេចចិត្ត)'}
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-base sm:text-xs"
                  />
                </motion.div>
              )}
            </AnimatePresence>

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

            <AnimatePresence>
              {payment === 'KHQR / ABA' && (
                <motion.div
                  key="cart-khqr-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                  className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3"
                >
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
                                  ? `Scanning receipt... ${scanElapsedSec > 0 ? `(${scanElapsedSec}s)` : ''}`
                                  : `កំពុងស្កេនអានវិក្កយបត្រ... ${scanElapsedSec > 0 ? `(${scanElapsedSec}s)` : ''}`
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
                                840,
                                (compressedDataUri) => {
                                  setSlipImgData(compressedDataUri);
                                  setPayError('');
                                  if (verifyCaps.slipAuto && paySessionId && payStatus !== 'expired') {
                                    void handleVerifySlipAuto(compressedDataUri);
                                  } else if (!verifyCaps.slipAuto && verifyCaps.telegram) {
                                    onToast(
                                      isEn
                                        ? 'Slip attached! Tap "Send to Shop Telegram" below to confirm.'
                                        : 'បានភ្ជាប់រូបវិក្កយបត្រ! ចុច «ផ្ញើទៅ Telegram ម្ចាស់ហាង» ខាងក្រោមដើម្បីបញ្ជាក់។'
                                    );
                                  }
                                },
                                onToast,
                                0.74
                              );
                            }
                          }}
                        />
                      </label>
                      {verifyingSlip && (
                        <div className="h-1.5 w-full rounded-full bg-emerald-100 overflow-hidden">
                          <motion.div
                            className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#0D4A3E] via-emerald-500 to-amber-400"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
                          />
                        </div>
                      )}

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
                        {verifyCaps.slipAuto && (
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
                                  {isEn
                                    ? `Auto-Verifying Receipt... ${scanElapsedSec > 0 ? `(${scanElapsedSec}s)` : ''}`
                                    : `កំពុងស្កេន & ផ្ទៀងផ្ទាត់វិក្កយបត្រ... ${scanElapsedSec > 0 ? `(${scanElapsedSec}s)` : ''}`}
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
                        )}

                        {!verifyCaps.slipAuto && !verifyCaps.bakong && (
                          <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-2 leading-relaxed">
                            {verifyCaps.telegram
                              ? isEn
                                ? 'Upload your bank slip & tap below to send directly to Shop Telegram Bot for instant approval (or ask owner to add Bakong Token / GEMINI_API_KEY for 100% hands-free verification).'
                                : 'Upload រូបវិក្កយបត្រ រួចចុចប៊ូតុងខាងក្រោមដើម្បីផ្ញើទៅ Telegram Bot ហាងចុចបញ្ជាក់ភ្លាមៗ (ម្ចាស់ហាងក៏អាចដាក់ Bakong Token ឬ GEMINI_API_KEY ដើម្បីផ្ទៀងផ្ទាត់ Auto 100%)។'
                              : isEn
                                ? 'Upload your bank slip or tap Check Now after shop approves in Owner Dashboard.'
                                : 'Upload រូបវិក្កយបត្រ រួចរង់ចាំម្ចាស់ហាងចុចបញ្ជាក់ ឬកំណត់ Telegram Bot / Bakong Token ក្នុងផ្ទាំងគ្រប់គ្រងហាង។'}
                          </p>
                        )}

                        {verifyCaps.telegram && (
                          <button
                            type="button"
                            disabled={sendingTgVerify || payStatus === 'expired'}
                            onClick={handleRequestTelegramVerify}
                            className={`w-full ${
                              !verifyCaps.slipAuto || needsOwnerFallback
                                ? 'bg-[#0088cc] hover:bg-[#0073ad]'
                                : 'bg-sky-600 hover:bg-sky-700'
                            } disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors`}
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>
                              {sendingTgVerify
                                ? isEn
                                  ? 'Sending to Shop Telegram...'
                                  : 'កំពុងផ្ញើទៅ Telegram Bot ហាង...'
                                : payStatus === 'awaiting_owner'
                                  ? isEn
                                    ? 'Resend Receipt to Shop Telegram Bot'
                                    : 'ផ្ញើសំណើម្តងទៀតទៅ Telegram ហាង'
                                  : isEn
                                    ? verifyCaps.slipAuto
                                      ? 'Or Send Receipt to Shop Telegram'
                                      : 'Send Receipt to Shop Telegram (Instant Approve)'
                                    : verifyCaps.slipAuto
                                      ? 'ឬ ផ្ញើទៅ Telegram ម្ចាស់ហាងចុចបញ្ជាក់'
                                      : 'ផ្ញើវិក្កយបត្រទៅ Telegram Bot ហាងចុចបញ្ជាក់'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
            </AnimatePresence>

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
              {loyaltyDisc > 0 && (
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>
                    {isEn
                      ? `Loyalty Reward (${loyaltyPointsUsed} ★):`
                      : `ប្តូរពិន្ទុសមាជិក (${loyaltyPointsUsed} ★)៖`}
                  </span>
                  <span className="font-mono-num">-${loyaltyDisc.toFixed(2)}</span>
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

            {!effectiveShopOpen && (
              <p className="mt-2.5 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                <span>
                  {shopClosedMessage ||
                    (isEn
                      ? 'The shop is currently closed — checkout will reopen once the shop opens.'
                      : 'ហាងកំពុងបិទបណ្តោះអាសន្ន — មិនទាន់អាចបញ្ជាក់ការកម្ម៉ង់បានទេ។')}
                </span>
              </p>
            )}

            {isKhqrLocked && effectiveShopOpen && (
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
                disabled={submitting || isKhqrLocked || !effectiveShopOpen}
                onClick={() => handleSubmit(false)}
                className="w-full bg-[#0D4A3E] hover:bg-[#09352C] disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-2xl text-sm transition-colors active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                {isKhqrLocked && <Lock className="w-3.5 h-3.5" />}
                <span>
                  {!effectiveShopOpen
                    ? isEn
                      ? 'Shop Closed'
                      : 'ហាងកំពុងបិទ'
                    : submitting
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
                disabled={submitting || isKhqrLocked || !effectiveShopOpen}
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

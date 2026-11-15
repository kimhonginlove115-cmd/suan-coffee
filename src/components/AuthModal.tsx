import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Award,
  CheckCircle2,
  Clock,
  History,
  KeyRound,
  LogOut,
  MessageSquare,
  Phone,
  RotateCcw,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Star,
  X,
} from 'lucide-react';
import type { AppLang, AuthCapabilities, Member, Order, ShopSettings } from '../types';
import { CAFE_ASSETS, fetchWithTimeout, handleImgFallback, resolveAssetUrl } from '../utils/cafeUtils';
import { getOrderStatusText } from '../utils/i18n';
import { SecurityShieldIllustration } from './AnimatedIllustrations';

interface AuthModalProps {
  lang?: AppLang;
  isOpen: boolean;
  onClose: () => void;
  currentMember: Member | null;
  authToken: string | null;
  shopSettings: ShopSettings;
  orders: Order[];
  onAuthenticated: (member: Member, token: string | null) => void;
  onLogout: () => void;
  onReorder: (order: Order) => void;
  onSubmitFeedback: (orderId: string, rating: number, comment: string) => Promise<boolean>;
  onRefreshOrders?: () => void;
  onToast: (msg: string) => void;
}

function normalizePhoneMatch(raw?: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('855')) return `0${digits.slice(3)}`;
  return digits.startsWith('0') ? digits : `0${digits}`;
}

const ORDER_STATUS_CLS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Brewing: 'bg-sky-100 text-sky-800',
  Ready: 'bg-emerald-100 text-[#0D4A3E]',
  Completed: 'bg-slate-100 text-slate-600',
};

type AuthTab = 'telegram' | 'phone';

declare global {
  interface Window {
    onEmeraldTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export function AuthModal({
  lang = 'km',
  isOpen,
  onClose,
  currentMember,
  shopSettings,
  orders,
  onAuthenticated,
  onLogout,
  onReorder,
  onSubmitFeedback,
  onRefreshOrders,
  onToast,
}: AuthModalProps) {
  const isEn = lang === 'en';
  const [activeTab, setActiveTab] = useState<AuthTab>('telegram');
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  // Shared fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Phone OTP verification state (100% real provider delivery — no demo codes)
  const [otpStep, setOtpStep] = useState<'input' | 'verify'>('input');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [deliveredChannel, setDeliveredChannel] = useState('');
  const otpInputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Telegram Bot 1-click link & Share Contact state
  const [tgLinkNonce, setTgLinkNonce] = useState<string | null>(null);
  const [tgLinkMode, setTgLinkMode] = useState<'login' | 'contact'>('login');
  const [tgDeepLink, setTgDeepLink] = useState<string>('');
  const [tgPollStep, setTgPollStep] = useState<'awaiting_start' | 'awaiting_contact'>('awaiting_start');
  const [isPollingTg, setIsPollingTg] = useState(false);

  // Order feedback form state
  const [activeFeedbackOrderId, setActiveFeedbackOrderId] = useState<string | null>(null);
  const [fbRating, setFbRating] = useState(5);
  const [fbComment, setFbComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // Official Telegram Login Widget container
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setErrorMsg('');
      setLoading(false);
      setActiveFeedbackOrderId(null);
      setFbComment('');
      setFbRating(5);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      return;
    }
    if (currentMember) {
      onRefreshOrders?.();
    }
    const ctrl = new AbortController();
    fetchWithTimeout('/api/auth/capabilities', { signal: ctrl.signal }, 8000)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok) setCapabilities(data);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [isOpen, currentMember, onRefreshOrders]);

  const memberOrders = useMemo(() => {
    if (!currentMember) return [];
    const mId = String(currentMember.id);
    const mPhone = normalizePhoneMatch(currentMember.phone);
    const mTg = (currentMember.telegramUsername || currentMember.tg || '').replace(/^@+/, '').trim().toLowerCase();
    const mName = (currentMember.name || '').trim().toLowerCase();

    return [...orders]
      .filter((o) => {
        const c = o.customer;
        if (!c) return false;
        if (c.memberId !== undefined && c.memberId !== null && String(c.memberId) === mId) return true;
        const oPhone = normalizePhoneMatch(c.phone);
        if (mPhone && oPhone && mPhone === oPhone) return true;
        const oTg = (c.tg || '').replace(/^@+/, '').trim().toLowerCase();
        if (mTg && oTg && mTg === oTg) return true;
        if (mName && (c.name || '').trim().toLowerCase() === mName) return true;
        return false;
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [currentMember, orders]);

  const totalPointsEarned = useMemo(() => {
    if (!currentMember) return 0;
    const fromOrders = memberOrders.reduce(
      (sum, o) => sum + o.items.reduce((isum, it) => isum + Math.max(1, Number(it.qty) || 1), 0),
      0
    );
    return Math.max(Number(currentMember.points || 0), fromOrders);
  }, [currentMember, memberOrders]);

  const totalSpent = useMemo(
    () => memberOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0),
    [memberOrders]
  );

  // Mount Official Telegram Login Widget when botUsername + botToken are configured on server
  useEffect(() => {
    if (!isOpen || activeTab !== 'telegram' || currentMember) return;
    if (!capabilities?.telegramWidgetReady || !capabilities.botUsername) return;
    const container = widgetContainerRef.current;
    if (!container) return;

    window.onEmeraldTelegramAuth = async (tgUser: Record<string, unknown>) => {
      setErrorMsg('');
      setLoading(true);
      try {
        const res = await fetchWithTimeout(
          '/api/auth/telegram/verify-widget',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tgUser),
          },
          10000
        );
        const data = await res.json();
        if (!data.ok || !data.member) {
          setErrorMsg(data.error || 'ការផ្ទៀងផ្ទាត់ Telegram មិនជោគជ័យទេ');
          return;
        }
        onAuthenticated(data.member, data.token || null);
        onToast('ចូលគណនី Telegram ផ្លូវការបានជោគជ័យ!');
        onClose();
      } catch {
        setErrorMsg('មានបញ្ហាភ្ជាប់ទៅ Server');
      } finally {
        setLoading(false);
      }
    };

    container.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', capabilities.botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onEmeraldTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      delete window.onEmeraldTelegramAuth;
    };
  }, [isOpen, activeTab, currentMember, capabilities, onAuthenticated, onToast, onClose]);

  // OTP Countdown Timer
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Real-time poll for Telegram Bot /start <nonce> & Share Contact confirmation
  useEffect(() => {
    if (!isOpen || !tgLinkNonce || currentMember) return;
    setIsPollingTg(true);
    let inFlight = false;
    let consecutiveErrors = 0;
    const ctrl = new AbortController();

    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetchWithTimeout(
          '/api/auth/telegram/poll-link',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce: tgLinkNonce }),
            signal: ctrl.signal,
          },
          8000
        );
        if (res.status === 404) {
          clearInterval(interval);
          setIsPollingTg(false);
          setTgLinkNonce(null);
          setErrorMsg('តំណភ្ជាប់ Telegram ផុតកំណត់ហើយ សូមចុចបង្កើតថ្មី');
          return;
        }
        const data = await res.json();
        consecutiveErrors = 0;
        if (data.step === 'awaiting_contact' || data.step === 'awaiting_start') {
          setTgPollStep(data.step);
        }
        if (data.ok && data.linked && data.member) {
          clearInterval(interval);
          setIsPollingTg(false);
          setTgLinkNonce(null);
          onAuthenticated(data.member, data.token || null);
          onToast(
            tgLinkMode === 'contact'
              ? 'ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទពិត Free តាម Telegram ជោគជ័យ!'
              : 'ភ្ជាប់គណនី Telegram ផ្លូវការបានជោគជ័យ!'
          );
          onClose();
        }
      } catch {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 10) {
          clearInterval(interval);
          setIsPollingTg(false);
          setErrorMsg('ការតភ្ជាប់ Telegram យឺតពេក សូមសាកល្បងម្តងទៀត');
        }
      } finally {
        inFlight = false;
      }
    }, 2200);

    return () => {
      ctrl.abort();
      clearInterval(interval);
      setIsPollingTg(false);
    };
  }, [isOpen, tgLinkNonce, tgLinkMode, currentMember, onAuthenticated, onToast, onClose]);

  const handleInitBotDeepLink = async (mode: 'login' | 'contact' = 'login') => {
    if (loading) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/telegram/init-link',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            name: name.trim(),
            phone: mode === 'login' ? phone.trim() : '',
          }),
        },
        10000
      );
      const data = await res.json();
      if (!data.ok) {
        setErrorMsg(data.error || 'មិនអាចបង្កើតតំណភ្ជាប់ Bot បានទេ');
        return;
      }
      setTgLinkMode(mode);
      setTgPollStep('awaiting_start');
      setTgLinkNonce(data.nonce);
      setTgDeepLink(data.deepLink);
    } catch {
      setErrorMsg('មានបញ្ហាភ្ជាប់ទៅ Server (Timeout)');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg('');
    if (!phone.trim()) {
      setErrorMsg('សូមបញ្ចូលលេខទូរស័ព្ទរបស់អ្នក');
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/phone/send-otp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
          }),
        },
        12000
      );
      const data = await res.json();
      if (!data.ok) {
        setErrorMsg(data.error || 'មិនអាចផ្ញើលេខកូដ OTP បានទេ');
        return;
      }
      setNormalizedPhone(data.phone || phone.trim());
      setDeliveredChannel(data.channel || '');
      setOtpStep('verify');
      setOtpCountdown(data.expiresInSeconds || 300);
      setOtpDigits(['', '', '', '', '', '']);
      onToast('បានផ្ញើលេខកូដ OTP ៦ ខ្ទង់រួចរាល់!');
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => otpInputsRef.current[0]?.focus(), 120);
    } catch {
      setErrorMsg('មានបញ្ហាភ្ជាប់ទៅ Server សូមព្យាយាមម្តងទៀត');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpDigitChange = (idx: number, val: string) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[idx] = clean;
    setOtpDigits(next);
    if (clean && idx < 5) {
      otpInputsRef.current[idx + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpInputsRef.current[idx - 1]?.focus();
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg('');
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setErrorMsg('សូមបញ្ចូលលេខកូដ OTP ៦ ខ្ទង់ឱ្យបានគ្រប់');
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/phone/verify-otp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: normalizedPhone || phone.trim(),
            code,
            name: name.trim(),
          }),
        },
        10000
      );
      const data = await res.json();
      if (!data.ok) {
        setErrorMsg(data.error || 'លេខកូដ OTP មិនត្រឹមត្រូវទេ');
        return;
      }
      onAuthenticated(data.member, data.token || null);
      setOtpStep('input');
      onToast('ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ & ចូលគណនីផ្លូវការជោគជ័យ!');
      onClose();
    } catch {
      setErrorMsg('មានបញ្ហាផ្ទៀងផ្ទាត់ OTP');
    } finally {
      setLoading(false);
    }
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-[#F7FAF9]">
              <div className="flex items-center gap-3 min-w-0">
                <SecurityShieldIllustration verified={Boolean(currentMember)} />
                <div className="min-w-0">
                  <h3 className="font-bold text-base text-slate-900 truncate">
                    {currentMember
                      ? isEn
                        ? 'Your Account'
                        : 'គណនីសុវត្ថិភាពរបស់អ្នក'
                      : isEn
                        ? 'Sign In or Create Account'
                        : 'ចូលប្រើ ឬ បង្កើតគណនីផ្លូវការ'}
                  </h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0D4A3E] shrink-0" />
                    <span>
                      {isEn
                        ? 'HMAC-SHA256 & Real Verification'
                        : 'HMAC-SHA256 & ការផ្ទៀងផ្ទាត់ពិតប្រាកដ'}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close' : 'បិទ'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto space-y-4">
              {currentMember ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="bg-[#0D4A3E] text-white p-5 rounded-2xl space-y-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {currentMember.telegramPhotoUrl && (
                          <img
                            src={currentMember.telegramPhotoUrl}
                            alt={currentMember.name}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-full object-cover border-2 border-amber-300 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-emerald-200 truncate">
                            {isEn ? 'Verified Member' : 'សមាជិកផ្លូវការ'} · {shopSettings.brandTitle}
                          </p>
                          <h4 className="font-bold text-lg mt-0.5 truncate">{currentMember.name}</h4>
                        </div>
                      </div>
                      <div className="text-right shrink-0 bg-white/10 px-3 py-1.5 rounded-xl border border-white/15">
                        <p className="text-[10px] text-emerald-200 flex items-center justify-end gap-1">
                          <Award className="w-3 h-3 text-amber-300" />
                          <span>{isEn ? 'Total Points' : 'ពិន្ទុសន្សំសរុប'}</span>
                        </p>
                        <p className="font-mono-num text-xl font-bold text-amber-300">
                          ★ {totalPointsEarned}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-white/15 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-200">{isEn ? 'Phone Number' : 'លេខទូរស័ព្ទ'}</span>
                        <span className="font-mono-num font-semibold flex items-center gap-1">
                          {currentMember.phone || (isEn ? 'Not linked' : 'មិនទាន់ភ្ជាប់')}
                          {currentMember.phoneVerified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-amber-300" />
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-200">{isEn ? 'Telegram Account' : 'គណនី Telegram'}</span>
                        <span className="font-semibold flex items-center gap-1 text-sky-200">
                          {currentMember.telegramUsername ||
                            currentMember.tg ||
                            (currentMember.telegramId
                              ? `ID ${currentMember.telegramId}`
                              : isEn
                                ? 'Not linked'
                                : 'មិនទាន់ភ្ជាប់')}
                          {currentMember.telegramVerified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-sky-300" />
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Points & Spend Summary */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-[#F6F8F7] border border-slate-200/80 rounded-2xl p-2.5 text-center">
                      <p className="text-[10px] text-slate-500 font-semibold">
                        {isEn ? 'Total Orders' : 'ការកម្ម៉ង់សរុប'}
                      </p>
                      <p className="font-mono-num font-bold text-base text-slate-900 mt-0.5">
                        {memberOrders.length}
                      </p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-2.5 text-center">
                      <p className="text-[10px] text-amber-800 font-semibold">
                        {isEn ? 'Total Points' : 'ពិន្ទុសរុប (Points)'}
                      </p>
                      <p className="font-mono-num font-bold text-base text-amber-700 mt-0.5">
                        ★ {totalPointsEarned}
                      </p>
                    </div>
                    <div className="bg-[#E8F2EF] border border-[#0D4A3E]/15 rounded-2xl p-2.5 text-center">
                      <p className="text-[10px] text-[#0D4A3E] font-semibold">
                        {isEn ? 'Total Spent' : 'ចំណាយសរុប'}
                      </p>
                      <p className="font-mono-num font-bold text-base text-[#0D4A3E] mt-0.5">
                        ${totalSpent.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Order History Section */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <History className="w-4 h-4 text-[#0D4A3E]" />
                        <span>{isEn ? 'Order History' : 'ប្រវត្តិការកម្ម៉ង់ (Order History)'}</span>
                      </h4>
                      <span className="text-[11px] font-mono-num font-bold text-slate-500">
                        {memberOrders.length} {isEn ? 'orders' : 'វិក្កយបត្រ'}
                      </span>
                    </div>

                    {!memberOrders.length ? (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 text-center space-y-1.5">
                        <ShoppingBag className="w-7 h-7 text-slate-300 mx-auto" />
                        <p className="text-xs font-semibold text-slate-600">
                          {isEn ? 'No orders yet' : 'មិនទាន់មានប្រវត្តិការកម្ម៉ង់ទេ'}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {isEn
                            ? 'Order drinks or food to start earning points (+1 ★ per item)!'
                            : 'កម្ម៉ង់ភេសជ្ជៈ ឬអាហារដើម្បីប្រមូលពិន្ទុសន្សំ (+1 ★ ក្នុង ១ មុខ)!'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-64 overflow-y-auto pr-0.5">
                        {memberOrders.map((order) => {
                          const badgeCls = ORDER_STATUS_CLS[order.status] || ORDER_STATUS_CLS.Pending;
                          const badgeLabel = getOrderStatusText(order.status, lang);
                          const pts = order.items.reduce(
                            (sum, it) => sum + Math.max(1, Number(it.qty) || 1),
                            0
                          );
                          const dateStr = order.createdAt
                            ? new Date(order.createdAt).toLocaleDateString(isEn ? 'en-US' : 'km-KH', {
                                month: 'short',
                                day: 'numeric',
                              })
                            : '';
                          return (
                            <div
                              key={order.id}
                              className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 shadow-sm"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono-num font-bold text-xs text-[#0D4A3E]">
                                    {order.id}
                                  </span>
                                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5 truncate">
                                    <Clock className="w-3 h-3 shrink-0" />
                                    {dateStr ? `${dateStr} · ` : ''}
                                    {order.timestamp}
                                  </span>
                                </div>
                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold shrink-0 ${badgeCls}`}>
                                  {badgeLabel}
                                </span>
                              </div>

                              <div className="space-y-1.5">
                                {order.items.map((item, idx) => (
                                  <div
                                    key={`${order.id}-${idx}`}
                                    className="flex items-center justify-between gap-2 text-xs"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <img
                                        src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                                        alt={item.name}
                                        referrerPolicy="no-referrer"
                                        onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                                        className="w-8 h-8 rounded-lg object-cover bg-slate-100 shrink-0"
                                      />
                                      <div className="min-w-0">
                                        <p className="font-semibold text-slate-800 truncate">
                                          {item.qty}x {item.name}
                                        </p>
                                        <p className="text-[10px] text-slate-500 truncate">{item.options}</p>
                                      </div>
                                    </div>
                                    <span className="font-mono-num font-semibold text-slate-700 shrink-0">
                                      ${(Number(item.unitPrice || 0) * Number(item.qty || 1)).toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-mono-num font-bold text-slate-900">
                                    ${Number(order.grandTotal || 0).toFixed(2)}
                                  </span>
                                  <span className="text-[10px] font-mono-num font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md">
                                    +{pts} ★
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {order.status === 'Completed' && !order.feedback && (
                                    <motion.button
                                      type="button"
                                      whileTap={{ scale: 0.94 }}
                                      onClick={() => {
                                        if (activeFeedbackOrderId === order.id) {
                                          setActiveFeedbackOrderId(null);
                                        } else {
                                          setActiveFeedbackOrderId(order.id);
                                          setFbRating(5);
                                          setFbComment('');
                                        }
                                      }}
                                      className="bg-amber-100 hover:bg-amber-200 text-amber-900 text-[11px] font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1"
                                    >
                                      <Star className="w-3 h-3 fill-amber-500 text-amber-600" />
                                      <span>{isEn ? 'Rate Order' : 'វាយតម្លៃ'}</span>
                                    </motion.button>
                                  )}
                                  <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.94 }}
                                    onClick={() => onReorder(order)}
                                    className="bg-[#0D4A3E] hover:bg-[#09352C] text-white text-[11px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>{isEn ? 'Re-order' : 'កម្ម៉ង់ម្តងទៀត'}</span>
                                  </motion.button>
                                </div>
                              </div>

                              {order.feedback && (
                                <div className="bg-[#F4F8F6] border border-[#0D4A3E]/15 rounded-xl p-2.5 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold text-[#0D4A3E] flex items-center gap-1">
                                      <MessageSquare className="w-3 h-3" />
                                      <span>{isEn ? 'Your Review' : 'ការវាយតម្លៃរបស់អ្នក'}</span>
                                    </span>
                                    <div className="flex items-center gap-0.5">
                                      {[1, 2, 3, 4, 5].map((s) => (
                                        <Star
                                          key={s}
                                          className={`w-3 h-3 ${
                                            s <= order.feedback!.rating
                                              ? 'fill-amber-400 text-amber-500'
                                              : 'text-slate-300'
                                          }`}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                  {order.feedback.comment && (
                                    <p className="text-[11px] text-slate-700 leading-relaxed">
                                      “{order.feedback.comment}”
                                    </p>
                                  )}
                                </div>
                              )}

                              {order.status === 'Completed' &&
                                !order.feedback &&
                                activeFeedbackOrderId === order.id && (
                                  <form
                                    onSubmit={async (e) => {
                                      e.preventDefault();
                                      if (submittingFeedback) return;
                                      setSubmittingFeedback(true);
                                      try {
                                        const ok = await onSubmitFeedback(order.id, fbRating, fbComment);
                                        if (ok) {
                                          setActiveFeedbackOrderId(null);
                                          setFbComment('');
                                          setFbRating(5);
                                        }
                                      } finally {
                                        setSubmittingFeedback(false);
                                      }
                                    }}
                                    className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] font-bold text-slate-800">
                                        {isEn ? 'Rate & Leave Feedback' : 'ផ្តល់ពិន្ទុ & មតិយោបល់'}
                                      </span>
                                      <div className="flex items-center gap-1">
                                        {[1, 2, 3, 4, 5].map((starVal) => (
                                          <button
                                            key={starVal}
                                            type="button"
                                            onClick={() => setFbRating(starVal)}
                                            aria-label={`${starVal} stars`}
                                            className="p-0.5 transition-transform active:scale-90"
                                          >
                                            <Star
                                              className={`w-5 h-5 ${
                                                starVal <= fbRating
                                                  ? 'fill-amber-400 text-amber-500'
                                                  : 'text-slate-300'
                                              }`}
                                            />
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <textarea
                                      rows={2}
                                      maxLength={500}
                                      value={fbComment}
                                      onChange={(e) => setFbComment(e.target.value)}
                                      placeholder={
                                        isEn
                                          ? 'Share your thoughts on taste or service...'
                                          : 'សរសេរមតិយោបល់របស់អ្នក (រសជាតិ ឬសេវាកម្ម)...'
                                      }
                                      className="w-full px-3 py-2 border border-amber-200 rounded-xl text-xs bg-white focus:outline-none focus:border-[#0D4A3E]"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setActiveFeedbackOrderId(null)}
                                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600"
                                      >
                                        {isEn ? 'Cancel' : 'បោះបង់'}
                                      </button>
                                      <button
                                        type="submit"
                                        disabled={submittingFeedback}
                                        className="flex-1 bg-[#0D4A3E] hover:bg-[#09352C] disabled:opacity-60 text-white py-1.5 rounded-lg text-[11px] font-bold"
                                      >
                                        {submittingFeedback
                                          ? isEn
                                            ? 'Submitting...'
                                            : 'កំពុងផ្ញើ...'
                                          : isEn
                                            ? 'Submit Review'
                                            : 'ផ្ញើការវាយតម្លៃ'}
                                      </button>
                                    </div>
                                  </form>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 py-2.5 rounded-xl text-xs font-bold transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{isEn ? 'Sign Out Safely' : 'ចាកចេញពីគណនីដោយសុវត្ថិភាព'}</span>
                  </button>
                </motion.div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('telegram');
                        setErrorMsg('');
                      }}
                      className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                        activeTab === 'telegram'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5 text-sky-600" />
                      <span>{isEn ? 'Telegram Login' : 'Telegram ផ្លូវការ'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('phone');
                        setErrorMsg('');
                      }}
                      className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                        activeTab === 'phone'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5 text-[#0D4A3E]" />
                      <span>{isEn ? 'Phone (Free)' : 'លេខទូរស័ព្ទ (Free)'}</span>
                    </button>
                  </div>

                  {errorMsg && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-3.5 py-2.5 rounded-xl leading-relaxed"
                    >
                      {errorMsg}
                    </motion.div>
                  )}

                  {activeTab === 'telegram' ? (
                    <motion.div
                      key="tab-tg"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.18 }}
                      className="space-y-4"
                    >
                      {capabilities?.telegramWidgetReady ? (
                        <>
                          {/* Official Telegram Login Widget */}
                          <div className="bg-[#F5F9FC] border border-sky-200 rounded-2xl p-4 text-center space-y-2.5">
                            <p className="text-xs font-bold text-slate-900">
                              ចូលដោយផ្ទាល់តាម Official Telegram Login (Free ១០០%)
                            </p>
                            <p className="text-[11px] text-slate-600">
                              ផ្ទៀងផ្ទាត់គណនី Telegram របស់អ្នកដោយផ្ទាល់តាមហត្ថលេខាផ្លូវការរបស់ Telegram
                            </p>
                            <div ref={widgetContainerRef} className="flex justify-center min-h-[42px]" />
                          </div>

                          {/* Official Telegram Bot 1-Click Verification */}
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                            <p className="text-xs font-bold text-slate-900">
                              ឬ ភ្ជាប់តាម Telegram Bot (@{capabilities.botUsername})
                            </p>
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="លេខទូរស័ព្ទភ្ជាប់ជាមួយគណនី (ស្រេចចិត្ត)"
                              className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-mono-num bg-white focus:outline-none focus:border-[#0D4A3E]"
                            />
                            <button
                              type="button"
                              onClick={() => handleInitBotDeepLink('login')}
                              disabled={loading}
                              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>
                                {isPollingTg && tgLinkMode === 'login'
                                  ? 'កំពុងរង់ចាំការចុច Start លើ Telegram...'
                                  : 'បើក Telegram Bot ដើម្បីផ្ទៀងផ្ទាត់'}
                              </span>
                            </button>

                            {tgLinkNonce && tgLinkMode === 'login' && tgDeepLink && (
                              <div className="bg-white border border-sky-200 rounded-xl p-3 text-[11px] text-slate-700 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span>
                                    កូដ៖ <strong className="font-mono-num text-sky-700">{tgLinkNonce}</strong>
                                  </span>
                                  <span className="text-slate-400">សុពលភាព ១០ នាទី</span>
                                </div>
                                <a
                                  href={tgDeepLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block w-full text-center bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold py-2 rounded-lg border border-sky-200"
                                >
                                  ចុចទីនេះដើម្បីបើក Telegram Bot ↗
                                </a>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2 text-xs text-amber-950 leading-relaxed">
                          <p className="font-bold">តម្រូវការភ្ជាប់ Telegram Bot ផ្លូវការ (Free ១០០%)</p>
                          <p>
                            ដើម្បីបើកការចូលគណនី Telegram ផ្លូវការដោយឥតគិតថ្លៃ សូមម្ចាស់ហាងចូលទៅ{' '}
                            <strong>គ្រប់គ្រងហាង → ការកំណត់ហាង</strong> រួចបញ្ចូល{' '}
                            <strong>Bot Username</strong> និង <strong>Bot Token</strong> (បង្កើត Free ពី @BotFather) ។
                          </p>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="tab-phone"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.18 }}
                      className="space-y-3"
                    >
                      {/* FREE Option: Telegram Share Contact Verification */}
                      {capabilities?.telegramContactReady && (
                        <div className="bg-[#E8F2EF] border border-[#0D4A3E]/25 rounded-2xl p-4 space-y-3">
                          <div>
                            <p className="text-xs font-bold text-[#0D4A3E]">
                              ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទពិត Free ១០០% តាម Telegram
                            </p>
                            <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                              មិនអស់ថ្លៃសេវា SMS ទេ! បើក Bot រួចចុចប៊ូតុង «ចែករំលែកលេខទូរស័ព្ទ» ដើម្បីផ្ទៀងផ្ទាត់លេខ SIM របស់អ្នកដោយផ្ទាល់។
                            </p>
                          </div>

                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="ឈ្មោះរបស់អ្នក (ស្រេចចិត្ត)"
                            className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:border-[#0D4A3E]"
                          />

                          <button
                            type="button"
                            onClick={() => handleInitBotDeepLink('contact')}
                            disabled={loading}
                            className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                          >
                            <Smartphone className="w-4 h-4" />
                            <span>
                              {isPollingTg && tgLinkMode === 'contact'
                                ? tgPollStep === 'awaiting_contact'
                                  ? 'សូមចុចប៊ូតុងផ្ញើលេខទូរស័ព្ទក្នុង Telegram...'
                                  : 'កំពុងរង់ចាំអ្នកចុច Start ក្នុង Telegram...'
                                : 'ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ Free តាម Telegram'}
                            </span>
                          </button>

                          {tgLinkNonce && tgLinkMode === 'contact' && tgDeepLink && (
                            <div className="bg-white border border-emerald-200 rounded-xl p-3 space-y-2 text-[11px] text-slate-700">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-[#0D4A3E]">
                                  {tgPollStep === 'awaiting_contact'
                                    ? 'ជំហាន ២/២៖ ចុច «📱 ចុចផ្ញើលេខទូរស័ព្ទផ្ទៀងផ្ទាត់» ក្នុង Bot'
                                    : 'ជំហាន ១/២៖ ចុច Start ក្នុង Telegram Bot'}
                                </span>
                              </div>
                              <a
                                href={tgDeepLink}
                                target="_blank"
                                rel="noreferrer"
                                className="block w-full text-center bg-emerald-50 hover:bg-emerald-100 text-[#0D4A3E] font-bold py-2 rounded-lg border border-emerald-200"
                              >
                                ចុចទីនេះដើម្បីបើក Telegram Bot ↗
                              </a>
                              <p className="text-slate-500">
                                Bot: <span className="font-semibold">@{capabilities.botUsername}</span> · កូដ{' '}
                                <span className="font-mono-num">{tgLinkNonce}</span>
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Optional SMS OTP Section (if paid SMS provider is configured) */}
                      {capabilities?.phoneOtpReady ? (
                        otpStep === 'input' ? (
                          <form onSubmit={handleSendPhoneOtp} className="space-y-3 pt-1">
                            {capabilities.telegramContactReady && (
                              <p className="text-[11px] font-bold text-slate-500 text-center">
                                — ឬ ផ្ទៀងផ្ទាត់ដោយកូដ SMS OTP —
                              </p>
                            )}
                            <div>
                              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                                ឈ្មោះពេញ *
                              </label>
                              <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="ឧ. ចាន់ ដារ៉ា"
                                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#0D4A3E]"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                                លេខទូរស័ព្ទសម្រាប់ទទួល OTP *
                              </label>
                              <div className="relative">
                                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                  type="tel"
                                  required
                                  value={phone}
                                  onChange={(e) => setPhone(e.target.value)}
                                  placeholder="012 345 678"
                                  className="w-full pl-10 pr-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num focus:outline-none focus:border-[#0D4A3E]"
                                />
                              </div>
                            </div>
                            <button
                              type="submit"
                              disabled={loading}
                              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                            >
                              <KeyRound className="w-4 h-4" />
                              <span>{loading ? 'កំពុងផ្ញើលេខកូដ...' : 'ផ្ញើលេខកូដ OTP តាម SMS'}</span>
                            </button>
                          </form>
                        ) : (
                          <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
                            <div className="text-center space-y-1">
                              <p className="text-xs text-slate-600">
                                សូមបញ្ចូលលេខកូដ ៦ ខ្ទង់ដែលបានផ្ញើទៅ{' '}
                                <span className="font-mono-num font-bold text-slate-900">
                                  {normalizedPhone}
                                </span>
                              </p>
                              <p className="text-[11px] text-slate-500">
                                តាមរយៈ៖{' '}
                                {deliveredChannel === 'telegram_gateway'
                                  ? 'Telegram Verification'
                                  : 'SMS Gateway'}
                              </p>
                              {otpCountdown > 0 && (
                                <p className="text-[11px] text-[#0D4A3E] font-mono-num font-semibold">
                                  ផុតកំណត់ក្នុង៖ {formatCountdown(otpCountdown)}
                                </p>
                              )}
                            </div>

                            <div className="grid grid-cols-6 gap-2">
                              {otpDigits.map((digit, idx) => (
                                <input
                                  key={idx}
                                  ref={(el) => {
                                    otpInputsRef.current[idx] = el;
                                  }}
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={1}
                                  value={digit}
                                  onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                                  className="h-12 text-center font-mono-num text-lg font-bold border-2 border-slate-200 rounded-xl focus:border-[#0D4A3E] focus:outline-none transition-colors"
                                />
                              ))}
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setOtpStep('input');
                                  setErrorMsg('');
                                }}
                                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
                              >
                                ប្តូរលេខ
                              </button>
                              <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-2.5 rounded-xl text-sm transition-colors active:scale-[0.98]"
                              >
                                {loading ? 'កំពុងផ្ទៀងផ្ទាត់...' : 'បញ្ជាក់លេខកូដ OTP'}
                              </button>
                            </div>
                          </form>
                        )
                      ) : !capabilities?.telegramContactReady ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2 text-xs text-amber-950 leading-relaxed">
                          <p className="font-bold">របៀបបើកផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ Free ១០០%</p>
                          <p>
                            ម្ចាស់ហាងគ្រាន់តែបង្កើត Bot <strong>Free</strong> ពី <strong>@BotFather</strong> ក្នុង Telegram
                            រួចបញ្ចូល <strong>Bot Username</strong> និង <strong>Bot Token</strong> នៅក្នុង{' '}
                            <strong>គ្រប់គ្រងហាង → ការកំណត់ហាង</strong> ដើម្បីផ្ទៀងផ្ទាត់លេខទូរស័ព្ទដោយអត់អស់លុយ SMS!
                          </p>
                        </div>
                      ) : null}
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

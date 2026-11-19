import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import {
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  Gift,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  Phone,
  QrCode,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Star,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { AppLang, Member, Order, ShopSettings } from '../types';
import { fetchWithTimeout } from '../utils/cafeUtils';

interface AuthCapabilities {
  telegramWidgetReady: boolean;
  telegramBotReady: boolean;
  telegramContactReady: boolean;
  phoneOtpReady: boolean;
  phoneOtpChannel: string;
  botUsername: string;
}

interface AuthModalProps {
  lang: AppLang;
  isOpen: boolean;
  onClose: () => void;
  currentMember: Member | null;
  authToken: string | null;
  shopSettings: ShopSettings;
  orders: Order[];
  myOrderIds?: string[];
  prefillPhone?: string;
  onAuthenticated: (member: Member, token: string | null) => void;
  onLogout: () => void;
  onReorder: (order: Order) => void;
  onSubmitFeedback: (orderId: string, rating: number, comment: string) => Promise<boolean> | Promise<void> | void;
  onRefreshOrders: () => Promise<void> | void;
  onOpenLiveTrack: (orderId: string) => void;
  onToast: (msg: string) => void;
}

function normalizePhoneMatch(p: string | undefined | null): string {
  const digits = String(p || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('855')) return '0' + digits.slice(3);
  return digits;
}

function getOrderTypeLabel(type: Order['type'], isEn: boolean): string {
  if (type === 'delivery') return isEn ? 'Delivery' : 'ដឹកជញ្ជូន';
  return isEn ? 'Dine-In' : 'ញ៉ាំនៅហាង';
}

function getOrderStatusText(status: Order['status'], isEn: boolean): { label: string; tone: string } {
  if (status === 'Completed') {
    return {
      label: isEn ? 'Completed' : 'បានបញ្ចប់',
      tone: 'text-emerald-700',
    };
  }
  if (status === 'Ready') {
    return {
      label: isEn ? 'Ready / On the way' : 'រួចរាល់ / កំពុងដឹក',
      tone: 'text-sky-700',
    };
  }
  if (status === 'Brewing') {
    return {
      label: isEn ? 'Brewing' : 'កំពុងឆុង',
      tone: 'text-amber-700',
    };
  }
  return {
    label: isEn ? 'Pending' : 'កំពុងរង់ចាំ',
    tone: 'text-stone-600',
  };
}

export const AuthModal: React.FC<AuthModalProps> = ({
  lang,
  isOpen,
  onClose,
  currentMember,
  authToken,
  shopSettings,
  orders,
  myOrderIds = [],
  prefillPhone,
  onAuthenticated,
  onLogout,
  onReorder,
  onSubmitFeedback,
  onRefreshOrders,
  onOpenLiveTrack,
  onToast,
}) => {
  const isEn = lang === 'en';

  // Primary auth method tabs: Quick Phone (always works) vs Telegram / SMS OTP (optional)
  const [authTab, setAuthTab] = useState<'quick' | 'telegram'>('quick');
  const [caps, setCaps] = useState<AuthCapabilities | null>(null);
  const [capsLoading, setCapsLoading] = useState(false);

  // Quick phone + PIN sign-in state
  const [quickPhone, setQuickPhone] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickTg, setQuickTg] = useState('');
  const [quickPin, setQuickPin] = useState('');
  const [showOptionalExtras, setShowOptionalExtras] = useState(false);
  const [pinRequiredName, setPinRequiredName] = useState<string | null>(null);
  const [channelVerifyPrompt, setChannelVerifyPrompt] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const quickPinInputRef = useRef<HTMLInputElement | null>(null);
  const quickNameInputRef = useRef<HTMLInputElement | null>(null);

  // Telegram Bot 2FA & Contact Verification State
  const [tgMode, setTgMode] = useState<'login' | 'contact'>('login');
  const [tgExpectedPhone, setTgExpectedPhone] = useState('');
  const [tgLinkBusy, setTgLinkBusy] = useState(false);
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgNonce, setTgNonce] = useState<string | null>(null);
  const [tgPollSecret, setTgPollSecret] = useState<string | null>(null);
  const [tgVerifyCode, setTgVerifyCode] = useState('');
  const [tgDeviceLabel, setTgDeviceLabel] = useState('');
  const [tgQrDataUrl, setTgQrDataUrl] = useState('');
  const [tgStep, setTgStep] = useState<'awaiting_start' | 'awaiting_approval' | 'awaiting_contact'>('awaiting_start');
  const [tgRemainingSec, setTgRemainingSec] = useState(0);
  const [tgBotUsername, setTgBotUsername] = useState('');
  const [tgWaiting, setTgWaiting] = useState(false);
  const [showFallbackWidget, setShowFallbackWidget] = useState(false);
  const tgWidgetContainerRef = useRef<HTMLDivElement | null>(null);
  const tgAutoTriedRef = useRef(false);

  // Official Telegram Gateway / SMS OTP Verification State
  const [showSmsOtp, setShowSmsOtp] = useState(true);
  const [otpPhone, setOtpPhone] = useState('');
  const [otpName, setOtpName] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpChannelLabel, setOtpChannelLabel] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Signed-in Profile Edit & Orders State
  const [copiedId, setCopiedId] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editTg, setEditTg] = useState('');
  const [editCurrentPin, setEditCurrentPin] = useState('');
  const [editNewPin, setEditNewPin] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [refreshingOrders, setRefreshingOrders] = useState(false);
  const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [authError, setAuthError] = useState('');

  // Load server auth capabilities when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCapsLoading(true);
    fetchWithTimeout('/api/auth/capabilities', { cache: 'no-store' }, 7000)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.ok) {
          setCaps(d);
          if (d.botUsername) setTgBotUsername(d.botUsername);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCapsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Sync profile edit fields & prefill OTP phone for unverified signed-in users
  useEffect(() => {
    if (!currentMember) {
      setIsEditingProfile(false);
      return;
    }
    setEditName(currentMember.name || '');
    setEditPhone(currentMember.phone || '');
    setEditTg(currentMember.telegramUsername || currentMember.tg || '');
    setEditCurrentPin('');
    setEditNewPin('');
    if (!currentMember.phoneVerified && currentMember.phone) {
      setOtpPhone((prev) => prev || currentMember.phone || '');
      setTgExpectedPhone((prev) => prev || currentMember.phone || '');
    }
  }, [currentMember, isEditingProfile]);

  // Cooldown timer for OTP resend
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);

  // Reset transient error & auto-init guard when modal closes or tab/mode changes
  useEffect(() => {
    setAuthError('');
    setChannelVerifyPrompt(null);
  }, [authTab, tgMode]);

  useEffect(() => {
    if (!isOpen) {
      tgAutoTriedRef.current = false;
      setTgWaiting(false);
      setTgDeepLink(null);
      setTgNonce(null);
      setTgPollSecret(null);
      setTgVerifyCode('');
      setTgDeviceLabel('');
      setTgQrDataUrl('');
      setTgStep('awaiting_start');
      setTgRemainingSec(0);
    }
  }, [isOpen]);

  // Countdown timer for active Telegram verification link
  useEffect(() => {
    if (!isOpen || !tgWaiting || tgRemainingSec <= 0) return;
    const t = setTimeout(() => {
      setTgRemainingSec((prev) => {
        if (prev <= 1) {
          setTgWaiting(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [isOpen, tgWaiting, tgRemainingSec]);

  // Focus PIN input automatically when server requests PIN
  useEffect(() => {
    if (pinRequiredName && quickPinInputRef.current) {
      quickPinInputRef.current.focus();
    }
  }, [pinRequiredName]);

  // Prefill phone from checkout phone-protection challenge
  useEffect(() => {
    if (isOpen && prefillPhone && !currentMember) {
      setAuthTab('quick');
      setQuickPhone(prefillPhone);
      setTgExpectedPhone(prefillPhone);
      setOtpPhone(prefillPhone);
      setTimeout(() => quickPinInputRef.current?.focus(), 60);
    }
  }, [isOpen, prefillPhone, currentMember]);

  // Poll function for active Telegram bot link (requires cryptographic pollSecret)
  const pollTelegramNonce = useCallback(
    async (nonce: string, secretOverride?: string | null) => {
      const secret = secretOverride ?? tgPollSecret;
      if (!secret) return false;
      try {
        const res = await fetchWithTimeout(
          '/api/auth/telegram/poll-link',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce, pollSecret: secret }),
          },
          7000
        );
        const data = await res.json();
        if (data?.ok && data.linked && data.member) {
          setTgWaiting(false);
          setTgDeepLink(null);
          setTgNonce(null);
          setTgPollSecret(null);
          setTgVerifyCode('');
          setTgDeviceLabel('');
          setTgQrDataUrl('');
          setTgRemainingSec(0);
          onAuthenticated(data.member, data.token || null);
          onToast(
            isEn
              ? `Verified & signed in via Telegram: ${data.member.name}`
              : `ផ្ទៀងផ្ទាត់ Telegram ជោគជ័យ៖ ${data.member.name}`
          );
          return true;
        }
        if (data?.ok && !data.linked) {
          if (data.step) setTgStep(data.step);
          if (data.verifyCode) setTgVerifyCode(data.verifyCode);
        }
        if (data?.ok === false && data?.error) {
          setTgWaiting(false);
          setTgDeepLink(null);
          setTgNonce(null);
          setTgPollSecret(null);
          setTgVerifyCode('');
          setTgDeviceLabel('');
          setTgQrDataUrl('');
          setTgRemainingSec(0);
          setAuthError(data.error);
          return true;
        }
      } catch {
        // transient error, keep polling
      }
      return false;
    },
    [isEn, onAuthenticated, onToast, tgPollSecret]
  );

  // Poll Telegram deep link + re-poll immediately when customer returns from Telegram app
  useEffect(() => {
    if (!isOpen || !tgWaiting || !tgNonce || !tgPollSecret) return;
    let stopped = false;

    const timer = setInterval(() => {
      if (!stopped && document.visibilityState !== 'hidden') {
        pollTelegramNonce(tgNonce, tgPollSecret);
      }
    }, 2000);

    const handleReturnFromTelegram = () => {
      if (!stopped && document.visibilityState !== 'hidden') {
        pollTelegramNonce(tgNonce, tgPollSecret);
      }
    };
    window.addEventListener('focus', handleReturnFromTelegram);
    document.addEventListener('visibilitychange', handleReturnFromTelegram);

    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', handleReturnFromTelegram);
      document.removeEventListener('visibilitychange', handleReturnFromTelegram);
    };
  }, [isOpen, tgWaiting, tgNonce, tgPollSecret, pollTelegramNonce]);

  // Official Telegram Login Widget (Optional Fallback inside Telegram tab)
  useEffect(() => {
    if (!isOpen || currentMember || authTab !== 'telegram' || !showFallbackWidget || !caps?.telegramWidgetReady) {
      return;
    }
    const container = tgWidgetContainerRef.current;
    if (!container) return;

    const botName = (tgBotUsername || caps?.botUsername || '').replace(/^@+/, '').trim();
    if (!botName) return;

    const w = window as unknown as Record<string, unknown>;
    w.onEmeraldTelegramAuth = async (user: Record<string, unknown>) => {
      setAuthError('');
      try {
        const res = await fetch('/api/auth/telegram/verify-widget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user),
        });
        const data = await res.json();
        if (data?.ok && data.member) {
          onAuthenticated(data.member, data.token || null);
          onToast(
            isEn
              ? `Signed in via Telegram as ${data.member.name}`
              : `ចូលគណនី Telegram ជោគជ័យ៖ ${data.member.name}`
          );
        } else {
          setAuthError(
            data?.error || (isEn ? 'Telegram signature verification failed.' : 'ការផ្ទៀងផ្ទាត់ Telegram បរាជ័យ')
          );
        }
      } catch {
        setAuthError(isEn ? 'Cannot reach authentication server.' : 'មិនអាចភ្ជាប់ទៅកាន់ Server បានទេ');
      }
    };

    container.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onEmeraldTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      delete w.onEmeraldTelegramAuth;
    };
  }, [isOpen, currentMember, authTab, showFallbackWidget, caps, tgBotUsername, isEn, onAuthenticated, onToast]);

  const myOrders = useMemo(() => {
    if (!currentMember) return [];
    const memberPhone = normalizePhoneMatch(currentMember.phone);
    return orders
      .filter((o) => {
        if (o.customer?.memberId && String(o.customer.memberId) === String(currentMember.id)) {
          return true;
        }
        const otherMemberId =
          o.customer?.memberId && String(o.customer.memberId) !== String(currentMember.id);
        if (otherMemberId) return false;
        if (myOrderIds.includes(o.id)) {
          return true;
        }
        // Anti-phone-spoofing: only match unattached guest orders by phone if this member actually verified their phone number
        if (currentMember.phoneVerified && memberPhone) {
          const orderPhone = normalizePhoneMatch(o.customer?.phone);
          if (orderPhone && memberPhone === orderPhone) {
            return true;
          }
        }
        return false;
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [orders, currentMember, myOrderIds]);

  const activeOrdersCount = useMemo(
    () => myOrders.filter((o) => o.status !== 'Completed').length,
    [myOrders]
  );
  const completedOrdersCount = useMemo(
    () => myOrders.filter((o) => o.status === 'Completed').length,
    [myOrders]
  );

  const filteredOrders = useMemo(() => {
    if (orderFilter === 'active') return myOrders.filter((o) => o.status !== 'Completed');
    if (orderFilter === 'completed') return myOrders.filter((o) => o.status === 'Completed');
    return myOrders;
  }, [myOrders, orderFilter]);

  const totalSpent = useMemo(
    () => myOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0),
    [myOrders]
  );

  // Secure Phone + PIN Sign-In / Registration
  const handleQuickLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthError('');
    setChannelVerifyPrompt(null);
    const phoneDigits = quickPhone.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      setAuthError(
        isEn
          ? 'Please enter a valid phone number (e.g. 012 345 678).'
          : 'សូមបញ្ចូលលេខទូរស័ព្ទឲ្យបានត្រឹមត្រូវ (យ៉ាងតិច ៨ ខ្ទង់)'
      );
      return;
    }

    const cleanPin = quickPin.trim();
    if (!cleanPin || !/^\d{4,8}$/.test(cleanPin)) {
      setAuthError(
        isEn
          ? 'Please enter a 4–8 digit Security PIN to protect your account.'
          : 'សូមបញ្ចូលកូដ PIN ការពារ (លេខ ៤–៨ ខ្ទង់) ដើម្បីការពារការបន្លំគណនី'
      );
      quickPinInputRef.current?.focus();
      return;
    }

    setQuickBusy(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/quick-login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: quickPhone.trim(),
            name: quickName.trim(),
            telegramUsername: quickTg.trim(),
            pin: cleanPin,
          }),
        },
        9000
      );
      const data = await res.json();
      if (data?.ok && data.member) {
        setPinRequiredName(null);
        setChannelVerifyPrompt(null);
        setQuickPin('');
        onAuthenticated(data.member, data.token || null);
        onToast(
          isEn
            ? data.isNew
              ? `Account created! Welcome ${data.member.name}`
              : `Welcome back, ${data.member.name}`
            : data.isNew
            ? `បង្កើតគណនីការពារដោយ PIN ជោគជ័យ! សូមស្វាគមន៍ ${data.member.name}`
            : `សូមស្វាគមន៍ការត្រឡប់មកវិញ, ${data.member.name}`
        );
      } else {
        if (data?.requiresChannelVerification) {
          setChannelVerifyPrompt(data.memberName || (isEn ? 'Member' : 'អតិថិជន'));
        }
        if (data?.requiresPin) {
          setPinRequiredName(data.memberName || (isEn ? 'Member' : 'អតិថិជន'));
        }
        if (data?.isNewAccountAttempt && !quickName.trim()) {
          quickNameInputRef.current?.focus();
        }
        setAuthError(
          data?.error || (isEn ? 'Could not sign in right now.' : 'មិនអាចចូលគណនីបានទេ សូមព្យាយាមម្តងទៀត')
        );
      }
    } catch {
      setAuthError(isEn ? 'Network error while signing in.' : 'មានបញ្ហាអ៊ីនធឺណិត សូមព្យាយាមម្តងទៀត');
    } finally {
      setQuickBusy(false);
    }
  };

  // Start Telegram Bot 2FA Login or Free Contact Verify (+ generate scannable QR code)
  const handleStartTelegramLink = useCallback(
    async (mode: 'login' | 'contact', expectedPhoneOverride?: string) => {
      setAuthError('');
      setTgMode(mode);
      setTgWaiting(false);
      setTgStep('awaiting_start');
      setTgDeepLink(null);
      setTgNonce(null);
      setTgPollSecret(null);
      setTgVerifyCode('');
      setTgDeviceLabel('');
      setTgQrDataUrl('');
      setTgRemainingSec(0);

      const expectedPhone =
        mode === 'contact' ? (expectedPhoneOverride ?? tgExpectedPhone).trim() : '';
      setTgLinkBusy(true);
      try {
        const res = await fetchWithTimeout(
          '/api/auth/telegram/init-link',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({
              mode,
              name: quickName.trim() || otpName.trim() || currentMember?.name || '',
              ...(expectedPhone ? { expectedPhone } : {}),
            }),
          },
          9000
        );
        const data = await res.json();
        if (!res.ok || !data?.ok || !data.deepLink) {
          setAuthError(
            data?.error ||
              (isEn
                ? 'Telegram verification is not enabled yet. Please use Quick Phone Login.'
                : 'Telegram មិនទាន់បានបើកដំណើរការទេ! សូមប្រើលេខទូរស័ព្ទចូលរហ័សវិញ។')
          );
          return;
        }
        setTgNonce(data.nonce);
        setTgPollSecret(data.pollSecret || null);
        setTgVerifyCode(data.verifyCode || '');
        setTgDeviceLabel(data.deviceLabel || '');
        setTgDeepLink(data.deepLink);
        setTgStep('awaiting_start');
        setTgRemainingSec(Number(data.expiresInSeconds) || 600);
        if (data.botUsername) setTgBotUsername(data.botUsername);

        try {
          const qrUrl = await QRCode.toDataURL(data.deepLink, {
            width: 176,
            margin: 1,
            color: { dark: '#0D4A3E', light: '#FFFFFF' },
          });
          setTgQrDataUrl(qrUrl);
        } catch {
          setTgQrDataUrl('');
        }

        setTgWaiting(true);
      } catch {
        setAuthError(isEn ? 'Could not reach server.' : 'មិនអាចភ្ជាប់ទៅកាន់ Server បានទេ');
      } finally {
        setTgLinkBusy(false);
      }
    },
    [authToken, currentMember?.name, isEn, otpName, quickName, tgExpectedPhone]
  );

  // Auto-generate secure QR & Telegram link smoothly when user opens the Telegram tab
  useEffect(() => {
    if (
      isOpen &&
      !currentMember &&
      authTab === 'telegram' &&
      caps?.telegramBotReady &&
      !tgDeepLink &&
      !tgLinkBusy &&
      !authError &&
      !tgAutoTriedRef.current
    ) {
      tgAutoTriedRef.current = true;
      handleStartTelegramLink(tgMode);
    }
  }, [
    isOpen,
    currentMember,
    authTab,
    caps?.telegramBotReady,
    tgDeepLink,
    tgLinkBusy,
    authError,
    tgMode,
    handleStartTelegramLink,
  ]);

  // Optional SMS / Gateway OTP Send
  const handleSendOtp = async () => {
    setAuthError('');
    if (!otpPhone.trim() || otpPhone.replace(/\D/g, '').length < 8) {
      setAuthError(
        isEn ? 'Please enter a valid phone number.' : 'សូមបញ្ចូលលេខទូរស័ព្ទឲ្យបានត្រឹមត្រូវ'
      );
      return;
    }
    setOtpBusy(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/phone/send-otp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ name: otpName.trim() || currentMember?.name || '', phone: otpPhone.trim() }),
        },
        10000
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setAuthError(data?.error || (isEn ? 'Unable to send OTP.' : 'មិនអាចផ្ញើលេខកូដ OTP បានទេ'));
        return;
      }
      setOtpSent(true);
      setOtpChannelLabel(
        data.channel === 'telegram_gateway'
          ? isEn
            ? 'Telegram Official OTP'
            : 'ប្រអប់សារ Telegram ផ្លូវការ'
          : isEn
          ? 'SMS Verification'
          : 'សារ SMS ទូរស័ព្ទ'
      );
      setOtpCooldown(45);
      onToast(isEn ? 'Verification code sent!' : 'បានផ្ញើលេខកូដ ៦ ខ្ទង់រួចរាល់!');
    } catch {
      setAuthError(isEn ? 'Network error sending OTP.' : 'មានបញ្ហាក្នុងការផ្ញើលេខកូដ');
    } finally {
      setOtpBusy(false);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthError('');
    if (otpCode.trim().length < 4) {
      setAuthError(isEn ? 'Enter the 6-digit code.' : 'សូមបញ្ចូលលេខកូដ OTP ៦ ខ្ទង់');
      return;
    }
    setOtpBusy(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/phone/verify-otp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            phone: otpPhone.trim(),
            code: otpCode.trim(),
            name: otpName.trim() || currentMember?.name || '',
          }),
        },
        9000
      );
      const data = await res.json();
      if (!res.ok || !data?.ok || !data.member) {
        setAuthError(data?.error || (isEn ? 'Invalid OTP code.' : 'លេខកូដ OTP មិនត្រឹមត្រូវទេ'));
        return;
      }
      onAuthenticated(data.member, data.token || null);
      setOtpSent(false);
      setOtpCode('');
      onToast(
        isEn
          ? `Phone verified! Welcome ${data.member.name}`
          : `ផ្ទៀងផ្ទាត់លេខជោគជ័យ! សូមស្វាគមន៍ ${data.member.name}`
      );
    } catch {
      setAuthError(isEn ? 'Network error verifying OTP.' : 'មានបញ្ហាក្នុងការផ្ទៀងផ្ទាត់លេខកូដ');
    } finally {
      setOtpBusy(false);
    }
  };

  // Profile Editor Save / Clear PIN
  const handleSaveProfile = async (clearPinFlag = false) => {
    if (!authToken) {
      setAuthError(
        isEn
          ? 'Please sign out and sign in once to edit your profile.'
          : 'សូមចាកចេញ ហើយចូលម្តងទៀតដើម្បីធ្វើបច្ចុប្បន្នភាពគណនី'
      );
      return;
    }
    setAuthError('');
    if (!editName.trim()) {
      setAuthError(isEn ? 'Name cannot be empty.' : 'សូមបញ្ចូលឈ្មោះរបស់អ្នក');
      return;
    }
    const cleanNewPin = editNewPin.trim();
    if (!clearPinFlag && cleanNewPin && !/^\d{4,8}$/.test(cleanNewPin)) {
      setAuthError(
        isEn ? 'New PIN must be 4 to 8 digits.' : 'កូដ PIN ថ្មីត្រូវតែមានលេខ ៤ ដល់ ៨ ខ្ទង់'
      );
      return;
    }
    const isPhoneChanged =
      normalizePhoneMatch(editPhone) !== normalizePhoneMatch(currentMember?.phone);
    if ((clearPinFlag || cleanNewPin || isPhoneChanged) && currentMember?.hasPin && !editCurrentPin.trim()) {
      setAuthError(
        isEn
          ? 'Please enter your current PIN to change your phone number or PIN.'
          : 'សូមបញ្ចូលកូដ PIN ចាស់ជាមុនសិន ដើម្បីប្តូរលេខទូរស័ព្ទ ឬកូដ PIN'
      );
      return;
    }

    setEditBusy(true);
    try {
      const res = await fetchWithTimeout(
        '/api/auth/me',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            name: editName.trim(),
            phone: editPhone.trim(),
            telegramUsername: editTg.trim(),
            pin: clearPinFlag ? undefined : cleanNewPin || undefined,
            currentPin: editCurrentPin.trim() || undefined,
            clearPin: clearPinFlag || undefined,
          }),
        },
        9000
      );
      const data = await res.json();
      if (data?.sessionRevoked) {
        onToast(data.error || (isEn ? 'Session revoked for security.' : 'សម័យចូលត្រូវបានផ្តាច់ដើម្បីសុវត្ថិភាព'));
        onLogout();
        return;
      }
      if (!res.ok || !data?.ok || !data.member) {
        setAuthError(data?.error || (isEn ? 'Failed to update profile.' : 'មិនអាចរក្សាទុកការកែប្រែបានទេ'));
        return;
      }
      onAuthenticated(data.member, data.token || null);
      setIsEditingProfile(false);
      setEditCurrentPin('');
      setEditNewPin('');
      onToast(
        data.token
          ? isEn
            ? 'Profile & PIN updated! Other devices signed out.'
            : 'រក្សាទុកជោគជ័យ! ឧបករណ៍ផ្សេងៗត្រូវបានចាកចេញដើម្បីសុវត្ថិភាព'
          : isEn
          ? 'Profile updated!'
          : 'បានរក្សាទុកព័ត៌មានគណនីជោគជ័យ!'
      );
    } catch {
      setAuthError(isEn ? 'Network error saving profile.' : 'មានបញ្ហាអ៊ីនធឺណិតពេលរក្សាទុក');
    } finally {
      setEditBusy(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    if (!authToken) {
      onLogout();
      return;
    }
    setEditBusy(true);
    try {
      await fetchWithTimeout(
        '/api/auth/logout-all',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        },
        8000
      );
      onToast(isEn ? 'Signed out from all devices!' : 'បានផ្តាច់ការចូលពីគ្រប់ឧបករណ៍ទាំងអស់ដោយសុវត្ថិភាព!');
      onLogout();
    } catch {
      setAuthError(isEn ? 'Failed to revoke sessions.' : 'មិនអាចផ្តាច់ឧបករណ៍ផ្សេងបានទេ');
    } finally {
      setEditBusy(false);
    }
  };

  const handleCopyMemberId = async () => {
    if (!currentMember) return;
    try {
      await navigator.clipboard.writeText(String(currentMember.id));
      setCopiedId(true);
      onToast(isEn ? 'Member ID copied' : 'បានចម្លងលេខសម្គាល់សមាជិក');
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleManualRefreshOrders = async () => {
    setRefreshingOrders(true);
    try {
      await onRefreshOrders();
    } finally {
      setTimeout(() => setRefreshingOrders(false), 400);
    }
  };

  const handleSaveReview = async (orderId: string) => {
    setSubmittingReview(true);
    try {
      await onSubmitFeedback(orderId, reviewRating, reviewComment.trim());
      setReviewOrderId(null);
      setReviewComment('');
      setReviewRating(5);
    } finally {
      setSubmittingReview(false);
    }
  };

  const hasTelegram = Boolean(caps?.telegramBotReady || caps?.telegramWidgetReady);
  const hasAnyExternalAuth = hasTelegram || Boolean(caps?.phoneOtpReady);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="auth-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="bg-[#FAF9F6] w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl my-auto flex flex-col max-h-[92vh] border border-stone-200/80"
      >
        {/* Header */}
        <div className="bg-[#0D4A3E] px-5 py-4 flex items-center justify-between text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <UserIcon className="w-5 h-5 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">
                {currentMember
                  ? isEn
                    ? 'My Member Account'
                    : 'គណនីសមាជិករបស់ខ្ញុំ'
                  : isEn
                  ? 'Sign In / Join Member'
                  : 'ចូលគណនី / ចុះឈ្មោះសមាជិក'}
              </h3>
              <p className="text-[11px] text-emerald-100/85 truncate">
                {currentMember
                  ? isEn
                    ? 'Auto-fill checkout · Track orders · Earn points'
                    : 'បំពេញឈ្មោះអូតូ · តាមដានការកម្ម៉ង់ · សន្សំពិន្ទុ'
                  : isEn
                  ? 'Fast sign-in in 5 seconds — earn loyalty points every order'
                  : 'ចូលប្រើភ្លាមៗក្នុង ៥ វិនាទី — រក្សាទុកប្រវត្តិ និងសន្សំពិន្ទុ'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? 'Close account modal' : 'បិទផ្ទាំងគណនី'}
            className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {!currentMember ? (
            /* ==================== SIGNED OUT VIEW ==================== */
            <div className="space-y-4">
              {/* Primary Method Switcher */}
              <div className="grid grid-cols-2 gap-1.5 bg-stone-200/75 p-1 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setAuthTab('quick')}
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                    authTab === 'quick'
                      ? 'bg-white text-[#0D4A3E] shadow-sm'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Quick Phone' : 'ចូលរហ័ស (ទូរស័ព្ទ)'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthTab('telegram')}
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                    authTab === 'telegram'
                      ? 'bg-white text-sky-700 shadow-sm'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Telegram / OTP' : 'Telegram / កូដ OTP'}</span>
                </button>
              </div>

              {authTab === 'quick' && (
                <form
                  onSubmit={handleQuickLogin}
                  className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200/90 shadow-xs space-y-3.5"
                >
                  <div className="space-y-1">
                    <h4 className="text-sm font-extrabold text-[#1E2420] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#0D4A3E]" />
                      {isEn ? 'Protected Phone + PIN Sign-In' : 'ចូលគណនី ឬចុះឈ្មោះ (ការពារដោយ PIN)'}
                    </h4>
                    <p className="text-xs text-stone-500">
                      {isEn
                        ? 'Your 4–8 digit Security PIN prevents anyone else from using your phone number.'
                        : 'កូដ PIN ផ្ទាល់ខ្លួនជួយការពារកុំឲ្យអ្នកដទៃបន្លំប្រើលេខទូរស័ព្ទ ឬចូលមើលប្រវត្តិកម្ម៉ង់របស់អ្នក។'}
                    </p>
                  </div>

                  {channelVerifyPrompt && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-2">
                      <p className="font-bold">
                        {isEn
                          ? `Account "${channelVerifyPrompt}" is already protected via Telegram / OTP.`
                          : `គណនី "${channelVerifyPrompt}" ត្រូវបានផ្ទៀងផ្ទាត់តាម Telegram / OTP រួចហើយ!`}
                      </p>
                      <button
                        type="button"
                        onClick={() => setAuthTab('telegram')}
                        className="min-h-[38px] px-3 py-1.5 bg-[#0088cc] text-white font-bold rounded-lg text-xs inline-flex items-center gap-1.5 hover:bg-[#0073ad] transition"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Sign In with Telegram / OTP' : 'ទៅចូលតាម Telegram / OTP'}</span>
                      </button>
                    </div>
                  )}

                  {pinRequiredName && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-[#0D4A3E] space-y-1">
                      <p className="font-bold">
                        {isEn
                          ? `Welcome back, ${pinRequiredName}!`
                          : `សូមស្វាគមន៍ ${pinRequiredName}!`}
                      </p>
                      <p className="text-emerald-800">
                        {isEn
                          ? 'Please enter your Security PIN to unlock this account.'
                          : 'សូមបញ្ចូលកូដ PIN របស់អ្នកដើម្បីបញ្ជាក់ភាពជាម្ចាស់គណនី។'}
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-bold text-stone-700 block mb-1">
                        {isEn ? 'Phone Number *' : 'លេខទូរស័ព្ទ *'}
                      </label>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={quickPhone}
                        onChange={(e) => {
                          setQuickPhone(e.target.value);
                          if (pinRequiredName) setPinRequiredName(null);
                          if (channelVerifyPrompt) setChannelVerifyPrompt(null);
                        }}
                        placeholder="012 345 678"
                        className="w-full min-h-[46px] px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num focus:outline-none focus:border-[#0D4A3E] focus:bg-white transition"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-stone-700 block mb-1">
                        {isEn ? 'Security PIN (4–8 digits) *' : 'កូដ PIN ការពារគណនី (លេខ ៤–៨ ខ្ទង់) *'}
                      </label>
                      <input
                        ref={quickPinInputRef}
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={quickPin}
                        onChange={(e) => setQuickPin(e.target.value.replace(/\D/g, ''))}
                        placeholder={isEn ? 'e.g. 4829' : 'ឧ. 4829 (ជៀសវាង 1234 ឬលេខដូចគ្នា)'}
                        className="w-full min-h-[46px] px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num tracking-widest focus:outline-none focus:border-[#0D4A3E] focus:bg-white transition"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-stone-700 block mb-1">
                        {isEn ? 'Your Name' : 'ឈ្មោះរបស់អ្នក'}{' '}
                        <span className="font-normal text-stone-400">
                          {isEn ? '(required for new accounts)' : '(បំពេញសម្រាប់បង្កើតគណនីថ្មី)'}
                        </span>
                      </label>
                      <input
                        ref={quickNameInputRef}
                        type="text"
                        autoComplete="name"
                        value={quickName}
                        onChange={(e) => setQuickName(e.target.value)}
                        placeholder={isEn ? 'e.g. Sok Dara' : 'ឧ. សុខ តារា'}
                        className="w-full min-h-[46px] px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-[#0D4A3E] focus:bg-white transition"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowOptionalExtras((v) => !v)}
                      className="text-xs font-bold text-[#0D4A3E] hover:underline flex items-center gap-1.5 py-0.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>
                        {showOptionalExtras
                          ? isEn
                            ? 'Hide Telegram @username'
                            : 'លាក់ Telegram @username'
                          : isEn
                          ? 'Add optional Telegram @username'
                          : 'បន្ថែម Telegram @username (ជម្រើស)'}
                      </span>
                    </button>

                    {showOptionalExtras && (
                      <div className="pt-1 border-t border-stone-100">
                        <label className="text-xs font-bold text-stone-700 block mb-1">
                          Telegram @username{' '}
                          <span className="font-normal text-stone-400">
                            {isEn ? '(optional for delivery contact)' : '(សម្រាប់ទាក់ទងពេលដឹក)'}
                          </span>
                        </label>
                        <input
                          type="text"
                          value={quickTg}
                          onChange={(e) => setQuickTg(e.target.value)}
                          placeholder="@username"
                          className="w-full min-h-[46px] px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-[#0D4A3E] focus:bg-white transition"
                        />
                      </div>
                    )}
                  </div>

                  {authError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-3.5 py-2.5 rounded-xl">
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={quickBusy}
                    className="w-full min-h-[48px] py-3 bg-[#0D4A3E] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-[#09362D] active:scale-[0.99] transition disabled:opacity-60"
                  >
                    {quickBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    <span>
                      {isEn ? 'Sign In / Create Protected Account' : 'ចូលគណនី / បង្កើតគណនីសុវត្ថិភាព'}
                    </span>
                  </button>
                </form>
              )}

              {authTab === 'telegram' && (
                <div className="space-y-3">
                  {capsLoading ? (
                    <div className="bg-white rounded-2xl p-6 border border-stone-200 flex items-center justify-center gap-2 text-xs text-stone-500">
                      <Loader2 className="w-4 h-4 animate-spin text-[#0D4A3E]" />
                      <span>{isEn ? 'Checking verification options...' : 'កំពុងពិនិត្យសេវាផ្ទៀងផ្ទាត់...'}</span>
                    </div>
                  ) : !hasAnyExternalAuth ? (
                    <div className="bg-white rounded-2xl p-5 border border-stone-200 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-sky-50 text-[#0088cc] flex items-center justify-center mx-auto">
                        <Send className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-sm text-[#1E2420] text-center">
                        {isEn
                          ? 'Telegram Phone Verification Not Configured Yet'
                          : 'សេវាផ្ទៀងផ្ទាត់លេខតាម Telegram មិនទាន់បានភ្ជាប់នៅឡើយទេ'}
                      </h4>
                      <p className="text-xs text-stone-500 leading-relaxed text-center">
                        {isEn
                          ? 'Shop owner: Open Owner Dashboard → Settings → Section 4 and add your free @BotFather Bot Token (Share Contact) or Telegram Gateway Token (6-digit OTP).'
                          : 'ម្ចាស់ហាងត្រូវចូល «គ្រប់គ្រងហាង → ការកំណត់ → ផ្នែកទី ៤» រួចបញ្ចូល Bot Token ពី @BotFather (Free ១០០% Share លេខ) ឬ Telegram Gateway Token (ផ្ញើកូដ ៦ ខ្ទង់)។'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setAuthTab('quick')}
                        className="w-full min-h-[46px] py-2.5 bg-[#0D4A3E] text-white font-bold rounded-xl text-xs hover:bg-[#09362D] transition"
                      >
                        {isEn ? 'Sign In with Phone + PIN Instead' : 'ទៅចូលគណនីតាមលេខទូរស័ព្ទ + PIN'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Modern Telegram Bot 2FA & Share-Phone Verification */}
                      {hasTelegram && (
                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 space-y-3.5">
                          <div className="space-y-1">
                            <h4 className="text-sm font-extrabold text-[#1E2420] flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 text-[#0088cc]" />
                              {isEn
                                ? 'Telegram Bot Security Verification'
                                : 'ផ្ទៀងផ្ទាត់សុវត្ថិភាពតាម Telegram Bot'}
                            </h4>
                            <p className="text-xs text-stone-500 leading-relaxed">
                              {tgMode === 'login'
                                ? isEn
                                  ? 'Open our bot or scan the QR code, match the 4-digit security code, and tap Approve.'
                                  : 'ចុចបើក Bot ឬស្កេន QR Code រួចផ្ទៀងផ្ទាត់លេខកូដ ៤ ខ្ទង់ ហើយចុច «អនុញ្ញាតចូល» ក្នុង Telegram។'
                                : isEn
                                ? 'Share your real SIM phone number inside Telegram Bot — 100% free & spoofing-proof.'
                                : 'ចុចបើក Bot ហើយចុច «Share លេខទូរស័ព្ទពិត» ដើម្បីបញ្ជាក់លេខ SIM ដោយឥតគិតថ្លៃ។'}
                            </p>
                          </div>

                          {/* Option toggles: Telegram 2FA Login vs Share Phone Contact */}
                          <div className="grid grid-cols-2 gap-1.5 bg-stone-100 p-1 rounded-xl">
                            <button
                              type="button"
                              onClick={() => {
                                if (tgMode === 'login') return;
                                tgAutoTriedRef.current = false;
                                setTgMode('login');
                                setTgWaiting(false);
                                setTgDeepLink(null);
                                setTgNonce(null);
                                setTgPollSecret(null);
                                setTgQrDataUrl('');
                                setTgVerifyCode('');
                              }}
                              className={`min-h-[44px] px-2.5 rounded-lg text-xs font-bold transition ${
                                tgMode === 'login'
                                  ? 'bg-white text-sky-700 shadow-xs'
                                  : 'text-stone-600 hover:text-stone-900'
                              }`}
                            >
                              {isEn ? 'Telegram 2FA Login' : 'ផ្ទៀង Telegram 2FA'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (tgMode === 'contact') return;
                                tgAutoTriedRef.current = false;
                                setTgMode('contact');
                                setTgWaiting(false);
                                setTgDeepLink(null);
                                setTgNonce(null);
                                setTgPollSecret(null);
                                setTgQrDataUrl('');
                                setTgVerifyCode('');
                              }}
                              className={`min-h-[44px] px-2.5 rounded-lg text-xs font-bold transition ${
                                tgMode === 'contact'
                                  ? 'bg-white text-[#0D4A3E] shadow-xs'
                                  : 'text-stone-600 hover:text-stone-900'
                              }`}
                            >
                              {isEn ? 'Verify Phone (Free)' : 'Share លេខទូរស័ព្ទ (Free)'}
                            </button>
                          </div>

                          {tgMode === 'contact' && (
                            <div className="space-y-1.5">
                              <label className="text-[11px] font-bold text-stone-600 block">
                                {isEn ? 'Lock Expected Phone' : 'កំណត់លេខទូរស័ព្ទត្រូវផ្ទៀងផ្ទាត់'}{' '}
                                <span className="font-normal text-stone-400">
                                  {isEn
                                    ? '(optional · leave empty to use Telegram SIM)'
                                    : '(ស្រេចចិត្ត · ទុកទំនេរដើម្បីទាញលេខពី Telegram)'}
                                </span>
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="tel"
                                  inputMode="tel"
                                  value={tgExpectedPhone}
                                  onChange={(e) => setTgExpectedPhone(e.target.value)}
                                  placeholder="012 345 678"
                                  className="flex-1 min-h-[44px] px-3.5 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num focus:outline-none focus:border-[#0D4A3E] focus:bg-white transition"
                                />
                                {tgDeepLink && (
                                  <button
                                    type="button"
                                    disabled={tgLinkBusy}
                                    onClick={() => handleStartTelegramLink('contact')}
                                    className="shrink-0 min-h-[44px] px-3 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold rounded-xl text-xs transition"
                                  >
                                    {isEn ? 'Apply' : 'ប្តូរលេខ'}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {tgLinkBusy && !tgDeepLink ? (
                            <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-6 flex items-center justify-center gap-2 text-xs font-semibold text-sky-900">
                              <Loader2 className="w-4 h-4 animate-spin text-[#0088cc]" />
                              <span>
                                {isEn
                                  ? 'Generating encrypted Telegram security link...'
                                  : 'កំពុងបង្កើតតំណភ្ជាប់សុវត្ថិភាព Telegram...'}
                              </span>
                            </div>
                          ) : !tgDeepLink ? (
                            <button
                              type="button"
                              disabled={tgLinkBusy}
                              onClick={() => handleStartTelegramLink(tgMode)}
                              className="w-full min-h-[48px] py-3 bg-[#0088cc] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-[#0073ad] transition disabled:opacity-60"
                            >
                              <Send className="w-4 h-4" />
                              <span>
                                {tgMode === 'contact'
                                  ? isEn
                                    ? 'Generate Phone Share Link & QR'
                                    : 'បង្កើតតំណ Share លេខ & QR Code'
                                  : isEn
                                  ? 'Generate 2FA Login Link & QR'
                                  : 'បង្កើតតំណ 2FA & QR Code'}
                              </span>
                            </button>
                          ) : (
                            <div className="bg-sky-50/75 border border-sky-200 rounded-2xl p-3.5 sm:p-4 space-y-3.5">
                              {/* Anti-Phishing Visual Security Code + Device + Timer Header */}
                              <div className="bg-white rounded-xl p-3 border border-sky-100 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
                                    {isEn ? 'Security Match Code' : 'លេខកូដផ្ទៀងផ្ទាត់សុវត្ថិភាព'}
                                  </p>
                                  <p className="font-mono-num text-2xl font-extrabold text-[#0D4A3E] tracking-[0.28em] leading-tight mt-0.5">
                                    {tgVerifyCode || '••••'}
                                  </p>
                                  {tgDeviceLabel && (
                                    <p className="text-[11px] text-stone-500 mt-0.5 flex items-center gap-1 truncate">
                                      <Smartphone className="w-3 h-3 shrink-0 text-stone-400" />
                                      <span className="truncate">{tgDeviceLabel}</span>
                                    </p>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-[11px] font-semibold text-stone-400">
                                    {isEn ? 'Expires' : 'សុពលភាព'}
                                  </p>
                                  <p
                                    className={`font-mono-num text-sm font-extrabold mt-0.5 ${
                                      tgRemainingSec > 60 ? 'text-[#0088cc]' : 'text-amber-600'
                                    }`}
                                  >
                                    {tgRemainingSec > 0
                                      ? `${String(Math.floor(tgRemainingSec / 60)).padStart(2, '0')}:${String(
                                          tgRemainingSec % 60
                                        ).padStart(2, '0')}`
                                      : isEn
                                      ? 'Expired'
                                      : 'ផុតកំណត់'}
                                  </p>
                                </div>
                              </div>

                              {/* QR Code + Primary 1-Tap Deep Link Button */}
                              <div className="flex flex-col sm:flex-row items-center gap-3.5">
                                {tgQrDataUrl && (
                                  <div className="bg-white p-2 rounded-xl border border-stone-200 shrink-0 flex flex-col items-center">
                                    <img
                                      src={tgQrDataUrl}
                                      alt={isEn ? 'Telegram Verification QR Code' : 'QR Code ផ្ទៀងផ្ទាត់ Telegram'}
                                      className="w-28 h-28 object-contain"
                                    />
                                    <span className="text-[10px] font-bold text-stone-500 mt-1 flex items-center gap-1">
                                      <QrCode className="w-3 h-3 text-[#0D4A3E]" />
                                      {isEn ? 'Scan with phone' : 'ស្កេនលើទូរស័ព្ទ'}
                                    </span>
                                  </div>
                                )}

                                <div className="w-full flex-1 space-y-2">
                                  <a
                                    href={tgDeepLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full min-h-[48px] py-3 px-4 bg-[#0088cc] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-[#0073ad] active:scale-[0.99] transition shadow-xs"
                                  >
                                    <ExternalLink className="w-4 h-4 shrink-0" />
                                    <span className="truncate">
                                      {isEn
                                        ? `Open Telegram (${tgBotUsername ? '@' + tgBotUsername.replace(/^@/, '') : 'Bot'})`
                                        : `បើក Telegram (${tgBotUsername ? '@' + tgBotUsername.replace(/^@/, '') : 'Bot'})`}
                                    </span>
                                  </a>

                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      disabled={tgLinkBusy}
                                      onClick={() => handleStartTelegramLink(tgMode)}
                                      className="min-h-[40px] px-2.5 bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1 transition"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      <span>{isEn ? 'New Code' : 'កូដថ្មី'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => tgNonce && pollTelegramNonce(tgNonce, tgPollSecret)}
                                      className="min-h-[40px] px-2.5 bg-white hover:bg-sky-100/70 border border-sky-200 text-[#0073ad] font-bold rounded-xl text-xs flex items-center justify-center gap-1 transition"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>{isEn ? 'Check Now' : 'ពិនិត្យភ្លាម'}</span>
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Clean 3-Step Numeric Status Tracker (no pulsing dots, no static pills) */}
                              <div className="bg-white/90 rounded-xl p-3 border border-sky-100 space-y-1.5 text-xs">
                                <div className="flex items-center gap-2">
                                  {tgStep !== 'awaiting_start' ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                  ) : tgWaiting ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-[#0088cc] shrink-0" />
                                  ) : (
                                    <span className="w-4 h-4 text-center font-mono-num font-bold text-stone-400 shrink-0">
                                      1
                                    </span>
                                  )}
                                  <span
                                    className={
                                      tgStep !== 'awaiting_start'
                                        ? 'text-emerald-800 font-semibold'
                                        : 'text-stone-800 font-bold'
                                    }
                                  >
                                    {isEn
                                      ? '1. Open bot & tap Start in Telegram'
                                      : '១. ចុចបើក Bot រួចចុច Start ក្នុង Telegram'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  {tgStep === 'awaiting_approval' || tgStep === 'awaiting_contact' ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-[#0088cc] shrink-0" />
                                  ) : (
                                    <span className="w-4 h-4 text-center font-mono-num font-bold text-stone-400 shrink-0">
                                      2
                                    </span>
                                  )}
                                  <span
                                    className={
                                      tgStep === 'awaiting_approval' || tgStep === 'awaiting_contact'
                                        ? 'text-[#0073ad] font-bold'
                                        : 'text-stone-500'
                                    }
                                  >
                                    {tgMode === 'login'
                                      ? isEn
                                        ? `2. Confirm code ${tgVerifyCode} → tap "Approve Login"`
                                        : `២. ផ្ទៀងលេខកូដ ${tgVerifyCode} រួចចុច «អនុញ្ញាតចូល»`
                                      : isEn
                                      ? '2. Tap "Share Phone Number" button in Telegram'
                                      : '២. ចុចប៊ូតុង «ចែករំលែកលេខទូរស័ព្ទ (Free)»'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="w-4 h-4 text-center font-mono-num font-bold text-stone-400 shrink-0">
                                    3
                                  </span>
                                  <span className="text-stone-500">
                                    {isEn
                                      ? '3. Automatically signs in right here'
                                      : '៣. ប្រព័ន្ធនឹងភ្ជាប់ចូលគណនីស្វ័យប្រវត្តិ'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {caps?.telegramWidgetReady && (
                            <div className="pt-2 border-t border-stone-100">
                              <button
                                type="button"
                                onClick={() => setShowFallbackWidget((v) => !v)}
                                className="text-xs font-bold text-stone-500 hover:text-stone-800"
                              >
                                {showFallbackWidget
                                  ? isEn
                                    ? 'Hide Telegram Web Widget'
                                    : 'លាក់ប៊ូតុង Telegram ផ្ទាល់លើវេបសាយ'
                                  : isEn
                                  ? 'Use Telegram Web Widget instead'
                                  : 'ប្រើប៊ូតុង Telegram ផ្ទាល់លើវេបសាយ'}
                              </button>
                              {showFallbackWidget && (
                                <div ref={tgWidgetContainerRef} className="min-h-[48px] flex items-center justify-center pt-3" />
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Official Telegram Gateway / SMS 6-Digit OTP Section */}
                      {caps?.phoneOtpReady && (
                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 space-y-3">
                          <button
                            type="button"
                            onClick={() => setShowSmsOtp((v) => !v)}
                            className="w-full flex items-center justify-between text-left"
                          >
                            <span className="text-sm font-bold text-[#1E2420] flex items-center gap-1.5">
                              <ShieldCheck className="w-4 h-4 text-[#0D4A3E]" />
                              {caps.phoneOtpChannel === 'telegram_gateway'
                                ? isEn
                                  ? 'Send 6-Digit Code to Telegram (Gateway)'
                                  : 'ផ្ញើលេខកូដ ៦ ខ្ទង់ចូល Telegram (OTP)'
                                : isEn
                                ? 'Verify Phone with 6-Digit OTP'
                                : 'ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទដោយកូដ OTP'}
                            </span>
                            <span className="text-xs font-bold text-[#0D4A3E]">
                              {showSmsOtp ? (isEn ? 'Hide' : 'បិទ') : isEn ? 'Open' : 'បើក'}
                            </span>
                          </button>

                          {showSmsOtp && (
                            <div className="space-y-3 pt-2 border-t border-stone-100">
                              {!otpSent ? (
                                <>
                                  <input
                                    type="text"
                                    value={otpName}
                                    onChange={(e) => setOtpName(e.target.value)}
                                    placeholder={isEn ? 'Your Name (optional)' : 'ឈ្មោះរបស់អ្នក (ដាក់ក៏បាន)'}
                                    className="w-full min-h-[44px] px-3.5 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                                  />
                                  <input
                                    type="tel"
                                    value={otpPhone}
                                    onChange={(e) => setOtpPhone(e.target.value)}
                                    placeholder="012 345 678"
                                    className="w-full min-h-[44px] px-3.5 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num"
                                  />
                                  <button
                                    type="button"
                                    disabled={otpBusy}
                                    onClick={handleSendOtp}
                                    className="w-full min-h-[46px] py-2.5 bg-[#0D4A3E] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-[#09362D] transition disabled:opacity-60"
                                  >
                                    {otpBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                                    <span>
                                      {caps.phoneOtpChannel === 'telegram_gateway'
                                        ? isEn
                                          ? 'Send 6-Digit Code to Telegram'
                                          : 'ផ្ញើលេខកូដ ៦ ខ្ទង់ទៅ Telegram'
                                        : isEn
                                        ? 'Send 6-Digit Code'
                                        : 'ផ្ញើលេខកូដ OTP'}
                                    </span>
                                  </button>
                                </>
                              ) : (
                                <form onSubmit={handleVerifyOtp} className="space-y-3">
                                  <p className="text-xs text-emerald-700 font-medium">
                                    {isEn
                                      ? `Code sent via ${otpChannelLabel} to ${otpPhone}`
                                      : `បានផ្ញើលេខកូដតាម ${otpChannelLabel} ទៅ ${otpPhone}`}
                                  </p>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                                    placeholder="••••••"
                                    className="w-full min-h-[48px] px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-center font-mono-num text-xl font-extrabold tracking-[0.4em]"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      disabled={otpBusy || otpCooldown > 0}
                                      onClick={handleSendOtp}
                                      className="flex-1 min-h-[44px] border border-stone-200 rounded-xl text-xs font-bold text-stone-600 disabled:opacity-50"
                                    >
                                      {otpCooldown > 0 ? `${otpCooldown}s` : isEn ? 'Resend' : 'ផ្ញើម្តងទៀត'}
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={otpBusy}
                                      className="flex-[2] min-h-[44px] bg-[#0D4A3E] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-1.5"
                                    >
                                      {otpBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                                      <span>{isEn ? 'Confirm Code' : 'បញ្ជាក់លេខកូដ'}</span>
                                    </button>
                                  </div>
                                </form>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {authError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-3.5 py-2.5 rounded-xl">
                          {authError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ==================== SIGNED IN VIEW ==================== */
            <div className="space-y-4">
              {/* Member Identity Card */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200/90 shadow-xs space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {currentMember.telegramPhotoUrl ? (
                      <img
                        src={currentMember.telegramPhotoUrl}
                        alt={currentMember.name}
                        className="w-12 h-12 rounded-2xl object-cover border border-stone-200 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-[#0D4A3E] text-white flex items-center justify-center font-extrabold text-lg shrink-0">
                        {(currentMember.name || 'M').trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-extrabold text-base text-[#1E2420] truncate">
                          {currentMember.name}
                        </h4>
                        {(currentMember.telegramVerified || currentMember.phoneVerified) && (
                          <CheckCircle2
                            className="w-4 h-4 text-[#0D4A3E] shrink-0"
                            aria-label={isEn ? 'Verified Member' : 'គណនីបានផ្ទៀងផ្ទាត់'}
                          />
                        )}
                        {currentMember.hasPin && (
                          <ShieldCheck
                            className="w-4 h-4 text-emerald-700 shrink-0"
                            aria-label={isEn ? 'PIN Protected' : 'ការពារដោយកូដ PIN'}
                          />
                        )}
                      </div>

                      {/* Zero-pill clean inline metadata */}
                      <p className="text-xs text-stone-500 mt-0.5 truncate">
                        {[
                          currentMember.phone || (isEn ? 'No phone set' : 'មិនទាន់មានលេខទូរស័ព្ទ'),
                          currentMember.telegramUsername || currentMember.tg || null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>

                      <button
                        type="button"
                        onClick={handleCopyMemberId}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-mono-num text-stone-400 hover:text-[#0D4A3E] transition"
                      >
                        <span>ID: {currentMember.id}</span>
                        {copiedId ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>

                      {/* Clean security status text */}
                      <p className="text-[11px] mt-1 font-medium text-emerald-700">
                        {[
                          currentMember.phoneVerified
                            ? isEn
                              ? 'Phone Verified ✓'
                              : 'លេខទូរស័ព្ទបានផ្ទៀងផ្ទាត់ ✓'
                            : isEn
                            ? 'Phone unverified'
                            : 'លេខទូរស័ព្ទមិនទាន់ផ្ទៀងផ្ទាត់',
                          currentMember.hasPin
                            ? isEn
                              ? 'PIN Protected ✓'
                              : 'ការពារដោយកូដ PIN ✓'
                            : isEn
                            ? 'Set a PIN in Edit'
                            : 'គួរកំណត់កូដ PIN',
                          currentMember.telegramVerified
                            ? isEn
                              ? 'Telegram Verified ✓'
                              : 'Telegram ✓'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>

                  {/* Quick Edit & Logout actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthError('');
                        setIsEditingProfile((v) => !v);
                      }}
                      title={isEn ? 'Edit Profile' : 'កែប្រែព័ត៌មាន'}
                      className={`min-h-[40px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition ${
                        isEditingProfile
                          ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                          : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">
                        {isEditingProfile ? (isEn ? 'Cancel' : 'បិទ') : isEn ? 'Edit' : 'កែប្រែ'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={onLogout}
                      title={isEn ? 'Sign Out' : 'ចាកចេញ'}
                      className="min-h-[40px] px-3 rounded-xl bg-red-50 text-red-700 border border-red-200/80 text-xs font-bold flex items-center gap-1 hover:bg-red-100 transition"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{isEn ? 'Sign Out' : 'ចាកចេញ'}</span>
                    </button>
                  </div>
                </div>

                {/* 1-Tap Phone Ownership Verification Banner for Signed-In Unverified Phones */}
                {!currentMember.phoneVerified && hasAnyExternalAuth && (
                  <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="space-y-0.5">
                        <p className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                          <span>
                            {isEn
                              ? 'Verify Phone Number via Telegram'
                              : 'ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទតាម Telegram (ការពារការបន្លំ)'}
                          </span>
                        </p>
                        <p className="text-[11px] text-amber-800 leading-relaxed">
                          {hasTelegram
                            ? isEn
                              ? 'Confirm your real SIM number via Telegram Share Contact (Free) to lock out spoofing.'
                              : 'បញ្ជាក់លេខទូរស័ព្ទពិតតាម Telegram Share Contact (Free) ដើម្បីកុំឲ្យអ្នកដទៃយកលេខអ្នកទៅប្រើបាន។'
                            : isEn
                            ? 'Send a 6-digit verification code to your Telegram or phone.'
                            : 'ផ្ញើលេខកូដ ៦ ខ្ទង់ទៅកាន់ Telegram របស់អ្នកដើម្បីបញ្ជាក់ភាពជាម្ចាស់លេខ។'}
                        </p>
                      </div>
                      {hasTelegram && !tgDeepLink && (
                        <button
                          type="button"
                          disabled={tgLinkBusy}
                          onClick={() => handleStartTelegramLink('contact', currentMember.phone || '')}
                          className="shrink-0 min-h-[36px] px-3 py-1.5 bg-[#0088cc] text-white font-bold rounded-lg text-[11px] hover:bg-[#0073ad] transition disabled:opacity-60"
                        >
                          {tgLinkBusy ? '...' : isEn ? 'Share Free' : 'Share តាម TG'}
                        </button>
                      )}
                    </div>

                    {tgDeepLink && tgMode === 'contact' && (
                      <div className="bg-white border border-sky-200 rounded-lg p-3 space-y-2">
                        {tgVerifyCode && (
                          <div className="flex items-center justify-between text-[11px] bg-sky-50 px-2.5 py-1.5 rounded-md border border-sky-100">
                            <span className="text-stone-600 font-semibold">
                              {isEn ? 'Security Code:' : 'កូដផ្ទៀងផ្ទាត់៖'}
                            </span>
                            <span className="font-mono-num font-extrabold text-[#0D4A3E] tracking-[0.2em]">
                              {tgVerifyCode}
                            </span>
                          </div>
                        )}
                        <a
                          href={tgDeepLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full min-h-[44px] py-2 px-3 bg-[#0088cc] text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 hover:bg-[#0073ad] transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>
                            {isEn
                              ? 'Open Telegram & Share Phone Number'
                              : 'បើក Telegram ហើយចុច Share លេខទូរស័ព្ទ'}
                          </span>
                        </a>
                        <div className="flex items-center justify-between text-[11px] text-sky-800">
                          <span className="flex items-center gap-1 font-medium">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {isEn ? 'Waiting for Share Contact...' : 'កំពុងរង់ចាំការ Share Contact...'}
                          </span>
                          <button
                            type="button"
                            onClick={() => tgNonce && pollTelegramNonce(tgNonce, tgPollSecret)}
                            className="font-bold underline"
                          >
                            {isEn ? 'Check now' : 'ពិនិត្យម្តងទៀត'}
                          </button>
                        </div>
                      </div>
                    )}

                    {caps?.phoneOtpReady && (
                      <div className="bg-white border border-amber-200/80 rounded-lg p-2.5 space-y-2">
                        {!otpSent ? (
                          <div className="flex gap-2">
                            <input
                              type="tel"
                              value={otpPhone}
                              onChange={(e) => setOtpPhone(e.target.value)}
                              placeholder="012 345 678"
                              className="flex-1 min-h-[38px] px-2.5 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs font-mono-num"
                            />
                            <button
                              type="button"
                              disabled={otpBusy}
                              onClick={handleSendOtp}
                              className="shrink-0 min-h-[38px] px-3 py-1.5 bg-[#0D4A3E] text-white font-bold rounded-lg text-[11px] hover:bg-[#09362D] transition disabled:opacity-60"
                            >
                              {otpBusy ? '...' : isEn ? 'Send OTP' : 'ផ្ញើកូដ ៦ ខ្ទង់'}
                            </button>
                          </div>
                        ) : (
                          <form onSubmit={handleVerifyOtp} className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={otpCode}
                              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                              placeholder="••••••"
                              className="flex-1 min-h-[38px] px-2.5 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-center font-mono-num font-bold tracking-[0.3em] text-sm"
                            />
                            <button
                              type="submit"
                              disabled={otpBusy}
                              className="shrink-0 min-h-[38px] px-3 py-1.5 bg-[#0D4A3E] text-white font-bold rounded-lg text-[11px]"
                            >
                              {otpBusy ? '...' : isEn ? 'Confirm' : 'បញ្ជាក់'}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Profile & PIN Editor Drawer */}
                {isEditingProfile && (
                  <div className="pt-3.5 border-t border-stone-100 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-bold text-stone-600 block mb-1">
                          {isEn ? 'Display Name' : 'ឈ្មោះ'}
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-[#0D4A3E] focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-stone-600 block mb-1">
                          {isEn ? 'Phone Number' : 'លេខទូរស័ព្ទ'}
                        </label>
                        <input
                          type="tel"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          placeholder="012 345 678"
                          className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono-num focus:outline-none focus:border-[#0D4A3E] focus:bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-stone-600 block mb-1">
                        Telegram @username
                      </label>
                      <input
                        type="text"
                        value={editTg}
                        onChange={(e) => setEditTg(e.target.value)}
                        placeholder="@username"
                        className="w-full min-h-[44px] px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-[#0D4A3E] focus:bg-white"
                      />
                    </div>

                    {/* PIN Security Configuration */}
                    <div className="bg-stone-50 rounded-xl p-3 border border-stone-200/80 space-y-2.5">
                      <p className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-[#0D4A3E]" />
                        {currentMember.hasPin
                          ? isEn
                            ? 'Account Security PIN (Active)'
                            : 'កូដ PIN ការពារគណនី (កំពុងបើក)'
                          : isEn
                          ? 'Set a Security PIN'
                          : 'កំណត់កូដ PIN ការពារគណនី'}
                      </p>

                      {currentMember.hasPin && (
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={8}
                          value={editCurrentPin}
                          onChange={(e) => setEditCurrentPin(e.target.value.replace(/\D/g, ''))}
                          placeholder={
                            isEn
                              ? 'Current PIN (needed to change Phone or PIN)'
                              : 'កូដ PIN ចាស់ (ចាំបាច់ពេលប្តូរលេខទូរស័ព្ទ ឬ PIN)'
                          }
                          className="w-full min-h-[42px] px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-mono-num tracking-widest focus:outline-none focus:border-[#0D4A3E]"
                        />
                      )}

                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={editNewPin}
                        onChange={(e) => setEditNewPin(e.target.value.replace(/\D/g, ''))}
                        placeholder={
                          currentMember.hasPin
                            ? isEn
                              ? 'New 4–8 digit PIN (leave blank to keep)'
                              : 'កូដ PIN ថ្មី ៤–៨ ខ្ទង់ (ទុកទំនេរបើមិនប្តូរ)'
                            : isEn
                            ? 'Set 4–8 digit PIN (e.g. 4829)'
                            : 'ដាក់កូដ PIN ៤–៨ ខ្ទង់ (ឧ. 4829)'
                        }
                        className="w-full min-h-[42px] px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-mono-num tracking-widest focus:outline-none focus:border-[#0D4A3E]"
                      />
                    </div>

                    {authError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-3 py-2 rounded-xl">
                        {authError}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={editBusy}
                        onClick={() => handleSaveProfile(false)}
                        className="flex-1 min-h-[44px] px-4 py-2 bg-[#0D4A3E] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-[#09362D] transition disabled:opacity-60"
                      >
                        {editBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        <span>{isEn ? 'Save Changes' : 'រក្សាទុកការកែប្រែ'}</span>
                      </button>

                      {currentMember.hasPin && (currentMember.telegramVerified || currentMember.phoneVerified) && (
                        <button
                          type="button"
                          disabled={editBusy}
                          onClick={() => handleSaveProfile(true)}
                          className="min-h-[44px] px-3 py-2 bg-white border border-red-200 text-red-700 font-bold rounded-xl text-xs hover:bg-red-50 transition disabled:opacity-60"
                        >
                          {isEn ? 'Remove PIN' : 'លុប PIN'}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={editBusy}
                      onClick={handleLogoutAllDevices}
                      className="w-full min-h-[40px] px-3 py-2 bg-stone-100 hover:bg-red-50 text-stone-700 hover:text-red-700 border border-stone-200 hover:border-red-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>
                        {isEn
                          ? 'Sign Out From All Devices (Security Reset)'
                          : 'ផ្តាច់ការចូលពីគ្រប់ឧបករណ៍ទាំងអស់ (ការពារការលួចប្រើ)'}
                      </span>
                    </button>
                  </div>
                )}

                {/* 3-Metric Summary Row (1 datum per cell) */}
                <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-stone-100 text-center">
                  <div className="bg-stone-50 rounded-xl p-2.5">
                    <p className="text-[11px] text-stone-500 font-medium">
                      {isEn ? 'Orders' : 'ការកម្ម៉ង់'}
                    </p>
                    <p className="font-extrabold font-mono-num text-base text-[#1E2420] mt-0.5">
                      {myOrders.length}
                    </p>
                  </div>
                  <div className="bg-emerald-50/70 rounded-xl p-2.5">
                    <p className="text-[11px] text-[#0D4A3E] font-medium">
                      {isEn ? 'Points' : 'ពិន្ទុសន្សំ'}
                    </p>
                    <p className="font-extrabold font-mono-num text-base text-[#0D4A3E] mt-0.5">
                      {currentMember.points || 0} ★
                    </p>
                  </div>
                  <div className="bg-stone-50 rounded-xl p-2.5">
                    <p className="text-[11px] text-stone-500 font-medium">
                      {isEn ? 'Total Spent' : 'ចំណាយសរុប'}
                    </p>
                    <p className="font-extrabold font-mono-num text-base text-[#1E2420] mt-0.5">
                      ${totalSpent.toFixed(2)}
                    </p>
                  </div>
                </div>

                {shopSettings.loyaltyEnabled !== false && (() => {
                  const reqPts = Math.max(1, Number(shopSettings.loyaltyRewardPoints) || 10);
                  const rewardUsd = Math.max(0.25, Number(shopSettings.loyaltyRewardAmountUsd) || 2.5);
                  const pts = Math.max(0, Number(currentMember.points) || 0);
                  const readyCount = Math.floor(pts / reqPts);
                  const progressInCycle = pts >= reqPts ? reqPts : pts % reqPts;
                  const pct = Math.min(100, Math.round((progressInCycle / reqPts) * 100));
                  const remaining = Math.max(0, reqPts - pts);
                  return (
                    <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#0D4A3E] flex items-center gap-1.5">
                          <Gift className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span>
                            {isEn ? 'Loyalty Stamp Card' : 'កាតសន្សំពិន្ទុប្តូររង្វាន់'}
                          </span>
                        </span>
                        <span className="font-mono-num font-bold text-[#0D4A3E]">
                          {pts} / {reqPts} ★
                        </span>
                      </div>
                      <div className="h-2 w-full bg-white rounded-full overflow-hidden border border-emerald-100">
                        <div
                          className="h-full bg-[#0D4A3E] rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-emerald-900 leading-relaxed">
                        {readyCount > 0
                          ? isEn
                            ? `You have ${readyCount} reward${readyCount > 1 ? 's' : ''} ready! Redeem ${reqPts} ★ for $${rewardUsd.toFixed(2)} off at checkout.`
                            : `អបអរសាទរ! អ្នកមានពិន្ទុគ្រប់អាចប្តូររង្វាន់ ${readyCount} ដង — ប្រើ ${reqPts} ★ ដើម្បីបញ្ចុះតម្លៃ $${rewardUsd.toFixed(2)} ពេលកម្ម៉ង់!`
                          : isEn
                            ? `${remaining} more ★ (1 ★ per item) to unlock a $${rewardUsd.toFixed(2)} free drink reward.`
                            : `សល់ ${remaining} ★ ទៀត (១ កែវ = ១ ★) ដើម្បីទទួលបានកាហ្វេហ្វ្រី / បញ្ចុះ $${rewardUsd.toFixed(2)}!`}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Orders Header + Refresh + Status Filter Tabs */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <h5 className="font-extrabold text-sm text-[#1E2420]">
                    {isEn ? 'Order History' : 'ប្រវត្តិការកម្ម៉ង់របស់ខ្ញុំ'}
                  </h5>
                  <button
                    type="button"
                    onClick={handleManualRefreshOrders}
                    className="min-h-[36px] px-2.5 rounded-lg text-xs font-bold text-[#0D4A3E] hover:bg-emerald-50 flex items-center gap-1 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshingOrders ? 'animate-spin' : ''}`} />
                    <span>{isEn ? 'Refresh' : 'ធ្វើបច្ចុប្បន្នភាព'}</span>
                  </button>
                </div>

                {/* Filter Tabs */}
                <div className="grid grid-cols-3 gap-1.5 bg-stone-200/70 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setOrderFilter('all')}
                    className={`min-h-[38px] rounded-lg text-xs font-bold transition ${
                      orderFilter === 'all'
                        ? 'bg-white text-[#1E2420] shadow-xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {isEn ? `All (${myOrders.length})` : `ទាំងអស់ (${myOrders.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderFilter('active')}
                    className={`min-h-[38px] rounded-lg text-xs font-bold transition ${
                      orderFilter === 'active'
                        ? 'bg-white text-[#0D4A3E] shadow-xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {isEn ? `Active (${activeOrdersCount})` : `កំពុងដំណើរការ (${activeOrdersCount})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderFilter('completed')}
                    className={`min-h-[38px] rounded-lg text-xs font-bold transition ${
                      orderFilter === 'completed'
                        ? 'bg-white text-emerald-700 shadow-xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {isEn ? `Done (${completedOrdersCount})` : `បានបញ្ចប់ (${completedOrdersCount})`}
                  </button>
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="bg-white rounded-2xl p-6 text-center border border-stone-200 text-xs text-stone-500">
                    {myOrders.length === 0
                      ? isEn
                        ? 'No orders yet — place your first order from the menu!'
                        : 'មិនទាន់មានការកម្ម៉ង់នៅឡើយទេ — ចាប់ផ្តើមកម្ម៉ង់ភេសជ្ជៈឆ្ងាញ់ៗឥឡូវនេះ!'
                      : isEn
                      ? 'No orders in this filter.'
                      : 'មិនមានការកម្ម៉ង់ក្នុងប្រភេទនេះទេ។'}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredOrders.map((o) => {
                      const st = getOrderStatusText(o.status, isEn);
                      const isLiveDelivery = o.type === 'delivery' && o.status !== 'Completed';
                      return (
                        <div
                          key={o.id}
                          className="bg-white rounded-2xl p-3.5 sm:p-4 border border-stone-200/90 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-mono-num font-bold text-xs text-[#1E2420]">
                                #{o.id}
                              </p>
                              <p className="text-[11px] text-stone-500 mt-0.5">
                                {[o.timestamp, getOrderTypeLabel(o.type, isEn)].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono-num font-extrabold text-sm text-[#0D4A3E]">
                                ${Number(o.grandTotal || 0).toFixed(2)}
                              </p>
                              <p className={`text-[11px] font-bold mt-0.5 ${st.tone}`}>{st.label}</p>
                            </div>
                          </div>

                          <p className="text-xs text-stone-600 line-clamp-2">
                            {(o.items || []).map((i) => `${i.qty}× ${i.name}`).join(', ')}
                          </p>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {isLiveDelivery && (
                              <button
                                type="button"
                                onClick={() => onOpenLiveTrack(o.id)}
                                className="flex-1 min-h-[40px] px-3 bg-[#0D4A3E] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-[#09362D] transition"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                <span>{isEn ? 'Live Map' : 'តាមដាន Live'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => onReorder(o)}
                              className="flex-1 min-h-[40px] px-3 bg-stone-100 hover:bg-stone-200 text-[#1E2420] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>{isEn ? 'Order Again' : 'កម្ម៉ង់ម្តងទៀត'}</span>
                            </button>

                            {(o.status === 'Completed' || o.paymentVerified) && !o.feedback && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewOrderId(reviewOrderId === o.id ? null : o.id);
                                  setReviewRating(5);
                                  setReviewComment('');
                                }}
                                className="flex-1 min-h-[40px] px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>{isEn ? 'Rate Order' : 'វាយតម្លៃ'}</span>
                              </button>
                            )}
                          </div>

                          {o.feedback && (
                            <div className="bg-stone-50 rounded-xl px-3 py-2 text-xs text-stone-600 flex items-center gap-1.5">
                              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                              <span className="font-bold text-stone-800">{o.feedback.rating}/5</span>
                              {o.feedback.comment && (
                                <span className="truncate">— &ldquo;{o.feedback.comment}&rdquo;</span>
                              )}
                            </div>
                          )}

                          {reviewOrderId === o.id && (
                            <div className="pt-2 border-t border-stone-100 space-y-2.5">
                              <div className="flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((starVal) => (
                                  <button
                                    key={starVal}
                                    type="button"
                                    onClick={() => setReviewRating(starVal)}
                                    className="p-1"
                                    aria-label={`Rate ${starVal} stars`}
                                  >
                                    <Star
                                      className={`w-6 h-6 transition ${
                                        starVal <= reviewRating
                                          ? 'text-amber-500 fill-amber-500'
                                          : 'text-stone-300'
                                      }`}
                                    />
                                  </button>
                                ))}
                              </div>
                              <input
                                type="text"
                                value={reviewComment}
                                onChange={(e) => setReviewComment(e.target.value)}
                                placeholder={
                                  isEn ? 'Share your feedback...' : 'សរសេរមតិរបស់អ្នក (ឧ. កាហ្វេឆ្ងាញ់)...'
                                }
                                className="w-full min-h-[42px] px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:border-[#0D4A3E]"
                              />
                              <button
                                type="button"
                                disabled={submittingReview}
                                onClick={() => handleSaveReview(o.id)}
                                className="w-full min-h-[42px] bg-[#0D4A3E] text-white font-bold rounded-xl text-xs hover:bg-[#09362D] transition disabled:opacity-60"
                              >
                                {isEn ? 'Submit Review' : 'ផ្ញើការវាយតម្លៃ'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Shop Contact Footer Info if needed */}
          {(shopSettings.tgUsername || shopSettings.phoneHotline) && !currentMember && (
            <p className="text-[11px] text-center text-stone-400">
              {isEn ? 'Need help?' : 'ត្រូវការជំនួយ?'}{' '}
              {[
                shopSettings.tgUsername ? `Telegram: ${shopSettings.tgUsername}` : null,
                shopSettings.phoneHotline ? `Tel: ${shopSettings.phoneHotline}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
};

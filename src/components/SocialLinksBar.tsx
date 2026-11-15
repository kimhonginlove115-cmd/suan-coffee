import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { MapPin, Phone } from 'lucide-react';
import type { ShopSettings } from '../types';

function normalizeExternalUrl(raw?: string, type?: 'telegram' | 'facebook' | 'tiktok' | 'instagram' | 'youtube'): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (/^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const cleanHandle = trimmed.replace(/^@+/, '');
  if (type === 'telegram') {
    return `https://t.me/${encodeURIComponent(cleanHandle)}`;
  }
  if (type === 'tiktok' && trimmed.startsWith('@')) {
    return `https://www.tiktok.com/${trimmed}`;
  }
  if (type === 'instagram' && !trimmed.includes('.')) {
    return `https://www.instagram.com/${encodeURIComponent(cleanHandle)}`;
  }
  if (type === 'facebook' && !trimmed.includes('.')) {
    return `https://www.facebook.com/${encodeURIComponent(cleanHandle)}`;
  }
  if (type === 'youtube' && trimmed.startsWith('@')) {
    return `https://www.youtube.com/${trimmed}`;
  }
  return `https://${trimmed}`;
}

interface SocialItem {
  id: string;
  label: string;
  href: string;
  bgClass: string;
  icon: ReactNode;
  external?: boolean;
}

export function SocialLinksBar({
  shopSettings,
  variant = 'footer',
}: {
  shopSettings: ShopSettings;
  variant?: 'hero' | 'footer';
}) {
  const fbHref = normalizeExternalUrl(shopSettings.facebookUrl, 'facebook');
  const ttHref = normalizeExternalUrl(shopSettings.tiktokUrl, 'tiktok');
  const igHref = normalizeExternalUrl(shopSettings.instagramUrl, 'instagram');
  const tgHref = normalizeExternalUrl(shopSettings.tgUsername, 'telegram');
  const ytHref = normalizeExternalUrl(shopSettings.youtubeUrl, 'youtube');
  const phoneClean = (shopSettings.phoneHotline || '').replace(/[^0-9+]/g, '');

  const items: SocialItem[] = [];

  if (fbHref) {
    items.push({
      id: 'facebook',
      label: 'Facebook',
      href: fbHref,
      bgClass: 'bg-[#1877F2] text-white hover:bg-[#1465D1]',
      external: true,
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
          <path d="M13.5 21v-7.8h2.6l.4-3h-3V8.3c0-.9.2-1.5 1.5-1.5h1.6V4.1c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.1H7.6v3h2.6V21h3.3z" />
        </svg>
      ),
    });
  }

  if (tgHref) {
    items.push({
      id: 'telegram',
      label: 'Telegram',
      href: tgHref,
      bgClass: 'bg-[#0088CC] text-white hover:bg-[#0074AD]',
      external: true,
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
          <path d="M21.5 4.4 2.9 11.6c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.1.8.8.8.5 0 .8-.2 1.1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.8c.3-1.3-.5-1.9-1.6-1.9zm-3.1 3.7-8.8 7.9-.3 3.4-1.5-4.7 10.6-6.6z" />
        </svg>
      ),
    });
  }

  if (ttHref) {
    items.push({
      id: 'tiktok',
      label: 'TikTok',
      href: ttHref,
      bgClass: 'bg-slate-900 text-white hover:bg-black',
      external: true,
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
          <path d="M19.6 8.3a5.4 5.4 0 0 1-3.4-1.2v6.6a5.4 5.4 0 1 1-4.7-5.3v2.8a2.6 2.6 0 1 0 1.9 2.5V3h2.8a5.4 5.4 0 0 0 3.4 2.5v2.8z" />
        </svg>
      ),
    });
  }

  if (igHref) {
    items.push({
      id: 'instagram',
      label: 'Instagram',
      href: igHref,
      bgClass: 'bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white',
      external: true,
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-[2]" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="1" className="fill-current stroke-none" />
        </svg>
      ),
    });
  }

  if (ytHref) {
    items.push({
      id: 'youtube',
      label: 'YouTube',
      href: ytHref,
      bgClass: 'bg-[#FF0000] text-white hover:bg-[#D90000]',
      external: true,
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
          <path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15.1V8.9L15.4 12 10 15.1z" />
        </svg>
      ),
    });
  }

  if (phoneClean) {
    items.push({
      id: 'phone',
      label: shopSettings.phoneHotline || phoneClean,
      href: `tel:${phoneClean}`,
      bgClass: 'bg-[#0D4A3E] text-white hover:bg-[#09352C]',
      external: false,
      icon: <Phone className="w-3.5 h-3.5" />,
    });
  }

  // Always include direct Google Maps shop location button when other links exist or in footer
  const mapHref = `https://www.google.com/maps?q=${shopSettings.lat},${shopSettings.lng}`;
  items.push({
    id: 'map',
    label: 'ទីតាំងហាង',
    href: mapHref,
    bgClass: variant === 'hero' ? 'bg-white/15 text-white border border-white/20 hover:bg-white/25' : 'bg-[#E8F2EF] text-[#0D4A3E] hover:bg-[#D5E9E3]',
    external: true,
    icon: <MapPin className="w-3.5 h-3.5" />,
  });

  if (variant === 'hero' && items.length <= 1) {
    return null;
  }

  if (variant === 'hero') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {items.map((item) => (
          <motion.a
            key={item.id}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noreferrer' : undefined}
            whileHover={{ y: -2, scale: 1.04 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 450, damping: 24 }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold shadow-sm ${item.bgClass}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </motion.a>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <motion.a
          key={item.id}
          href={item.href}
          target={item.external ? '_blank' : undefined}
          rel={item.external ? 'noreferrer' : undefined}
          whileHover={{ y: -2, scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 450, damping: 24 }}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold shadow-sm ${item.bgClass}`}
        >
          {item.icon}
          <span>{item.label}</span>
        </motion.a>
      ))}
    </div>
  );
}

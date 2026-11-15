import { motion, useReducedMotion } from 'motion/react';

export function CoffeeCupSteamIllustration({ className = '' }: { className?: string }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={`relative select-none pointer-events-none ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 220 180"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible"
      >
        <defs>
          <linearGradient id="cupGrad" x1="45" y1="75" x2="155" y2="155" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#146B5A" />
            <stop offset="100%" stopColor="#082E26" />
          </linearGradient>
          <linearGradient id="goldRim" x1="50" y1="74" x2="150" y2="74" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="50%" stopColor="#D99B26" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <radialGradient id="cremaGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#0D4A3E" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft ambient aura behind cup */}
        <motion.circle
          cx="105"
          cy="112"
          r="62"
          fill="url(#cremaGrad)"
          animate={shouldReduceMotion ? undefined : { scale: [1, 1.08, 1], opacity: [0.55, 0.85, 0.55] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Rising Steam Ribbons */}
        <motion.path
          d="M78 64 C70 50, 86 38, 77 22"
          stroke="#FDE68A"
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
          initial={{ opacity: 0.2, pathLength: 0.4, y: 6 }}
          animate={
            shouldReduceMotion
              ? { opacity: 0.5 }
              : {
                  opacity: [0, 0.75, 0],
                  y: [8, -12, -22],
                  pathLength: [0.3, 1, 0.4],
                }
          }
          transition={{ duration: 3.1, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d="M104 60 C95 44, 114 32, 102 14"
          stroke="#F59E0B"
          strokeWidth="3.2"
          strokeLinecap="round"
          fill="none"
          initial={{ opacity: 0.25, pathLength: 0.5, y: 6 }}
          animate={
            shouldReduceMotion
              ? { opacity: 0.65 }
              : {
                  opacity: [0, 0.9, 0],
                  y: [10, -14, -26],
                  pathLength: [0.3, 1, 0.5],
                }
          }
          transition={{ duration: 3.6, delay: 0.7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d="M128 65 C136 50, 120 38, 130 22"
          stroke="#A7F3D0"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
          initial={{ opacity: 0.2, pathLength: 0.4, y: 6 }}
          animate={
            shouldReduceMotion
              ? { opacity: 0.5 }
              : {
                  opacity: [0, 0.7, 0],
                  y: [8, -10, -20],
                  pathLength: [0.3, 1, 0.4],
                }
          }
          transition={{ duration: 2.9, delay: 1.3, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Floating Roasted Coffee Bean Left */}
        <motion.g
          animate={shouldReduceMotion ? undefined : { y: [-3, 4, -3], rotate: [-8, 6, -8] }}
          transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '32px 92px' }}
        >
          <ellipse cx="32" cy="92" rx="10" ry="7" fill="#5C3A21" stroke="#D99B26" strokeWidth="1.2" />
          <path d="M24 91 C29 94, 35 90, 40 93" stroke="#FDE68A" strokeWidth="1.2" strokeLinecap="round" />
        </motion.g>

        {/* Floating Roasted Coffee Bean Right */}
        <motion.g
          animate={shouldReduceMotion ? undefined : { y: [4, -4, 4], rotate: [10, -6, 10] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '182px 66px' }}
        >
          <ellipse cx="182" cy="66" rx="9" ry="6.5" fill="#5C3A21" stroke="#D99B26" strokeWidth="1.2" />
          <path d="M175 65 C180 68, 185 64, 189 67" stroke="#FDE68A" strokeWidth="1.1" strokeLinecap="round" />
        </motion.g>

        {/* Saucer Shadow & Plate */}
        <ellipse cx="105" cy="154" rx="58" ry="11" fill="#06231D" opacity="0.45" />
        <ellipse cx="105" cy="148" rx="54" ry="10" fill="#E8F2EF" stroke="#D99B26" strokeWidth="1.5" />

        {/* Cup Handle */}
        <path
          d="M148 86 C172 86, 174 122, 146 124"
          stroke="url(#goldRim)"
          strokeWidth="6.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Cup Body */}
        <path
          d="M54 76 L154 76 L144 134 C142 145, 130 150, 104 150 C78 150, 66 145, 64 134 Z"
          fill="url(#cupGrad)"
          stroke="url(#goldRim)"
          strokeWidth="2"
        />

        {/* Latte Art Surface */}
        <ellipse cx="104" cy="76" rx="50" ry="10" fill="#78350F" stroke="url(#goldRim)" strokeWidth="2" />
        <ellipse cx="104" cy="76" rx="34" ry="6" fill="#D97706" opacity="0.55" />
        <path d="M96 76 C99 73, 109 73, 112 76 C108 79, 100 79, 96 76 Z" fill="#FEF3C7" opacity="0.85" />

        {/* Subtle botanical leaf motif on cup */}
        <path d="M97 115 C101 103, 110 100, 114 109 C110 116, 101 118, 97 115 Z" fill="#FDE68A" opacity="0.35" />
      </svg>
    </div>
  );
}

export function SecurityShieldIllustration({ verified = false }: { verified?: boolean }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="relative w-14 h-14 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" className="w-full h-full">
        <motion.circle
          cx="32"
          cy="32"
          r="28"
          stroke="#0D4A3E"
          strokeOpacity="0.22"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          animate={shouldReduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '32px 32px' }}
        />
        <path
          d="M32 10 L50 17 V31 C50 42.5 42.2 51.5 32 55 C21.8 51.5 14 42.5 14 31 V17 L32 10 Z"
          fill={verified ? '#0D4A3E' : '#E8F2EF'}
          stroke="#0D4A3E"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        {verified ? (
          <motion.path
            d="M24 32.5 L29.5 38 L41 26"
            stroke="#FDE68A"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        ) : (
          <g>
            <rect x="25" y="29" width="14" height="11" rx="2.5" fill="#0D4A3E" />
            <path d="M27.5 29 V25.5 C27.5 23 29.5 21 32 21 C34.5 21 36.5 23 36.5 25.5 V29" stroke="#0D4A3E" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="32" cy="34.5" r="1.5" fill="#FDE68A" />
          </g>
        )}
      </svg>
    </div>
  );
}

export function DeliveryRiderIllustration() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className="w-8 h-8 flex items-center justify-center shrink-0"
      animate={shouldReduceMotion ? undefined : { x: [-2, 3, -2] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" fill="none" className="w-8 h-8">
        <circle cx="11" cy="29" r="5" stroke="#0D4A3E" strokeWidth="2.4" fill="#fff" />
        <circle cx="30" cy="29" r="5" stroke="#0D4A3E" strokeWidth="2.4" fill="#fff" />
        <path d="M11 29 L18 19 H26 L30 29" stroke="#0D4A3E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="7" y="14" width="10" height="8" rx="2" fill="#0D4A3E" />
        <path d="M23 14 H28 L31 20" stroke="#D99B26" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </motion.div>
  );
}

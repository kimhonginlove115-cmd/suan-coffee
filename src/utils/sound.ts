// Reliable Web Audio notification tones with iOS Safari gesture unlock support

let sharedAudioCtx: AudioContext | null = null;
let audioUnlocked = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!audioUnlocked) {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      audioUnlocked = true;
    }
  } catch {
    // ignore Web Audio restrictions
  }
}

export function initAudioUnlocker(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => unlockAudio();
  window.addEventListener('pointerdown', handler, { passive: true });
  window.addEventListener('touchstart', handler, { passive: true });
  window.addEventListener('keydown', handler, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('touchstart', handler);
    window.removeEventListener('keydown', handler);
  };
}

function playToneSequence(
  notes: Array<{ freq: number; delay: number; duration: number; volume?: number; type?: OscillatorType }>
): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const baseTime = ctx.currentTime + 0.02;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type || 'triangle';
      osc.frequency.setValueAtTime(note.freq, baseTime + note.delay);
      const start = baseTime + note.delay;
      const end = start + note.duration;
      const vol = note.volume ?? 0.24;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // ignore playback errors
  }
}

export function playOrderConfirmedSound(): void {
  // Bright celebratory cafe chime (F5 -> A5 -> C6 -> F6)
  playToneSequence([
    { freq: 698.46, delay: 0, duration: 0.22, volume: 0.26, type: 'triangle' },
    { freq: 880.0, delay: 0.12, duration: 0.22, volume: 0.28, type: 'triangle' },
    { freq: 1046.5, delay: 0.24, duration: 0.28, volume: 0.3, type: 'triangle' },
    { freq: 1396.91, delay: 0.38, duration: 0.45, volume: 0.28, type: 'sine' },
  ]);
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([110, 55, 160]);
    } catch {
      // ignore vibration restriction
    }
  }
}

export function playPaymentVerifiedSound(): void {
  // Crisp 3-note chime (C6 -> E6 -> G6)
  playToneSequence([
    { freq: 1046.5, delay: 0, duration: 0.16, volume: 0.24, type: 'sine' },
    { freq: 1318.51, delay: 0.1, duration: 0.18, volume: 0.26, type: 'sine' },
    { freq: 1567.98, delay: 0.2, duration: 0.36, volume: 0.28, type: 'sine' },
  ]);
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([80, 40, 110]);
    } catch {
      // ignore
    }
  }
}

export function playAdminAlertSound(): void {
  playToneSequence([
    { freq: 880, delay: 0, duration: 0.18, volume: 0.24, type: 'sine' },
    { freq: 1320, delay: 0.14, duration: 0.3, volume: 0.26, type: 'sine' },
  ]);
}

let activeVoiceAudio: HTMLAudioElement | null = null;

export function playUnpaidChime(): void {
  // Urgent loud two-phrase attention chime for forgotten payment
  playToneSequence([
    { freq: 1046.5, delay: 0, duration: 0.14, volume: 0.34, type: 'triangle' },
    { freq: 1318.51, delay: 0.14, duration: 0.14, volume: 0.34, type: 'triangle' },
    { freq: 1567.98, delay: 0.28, duration: 0.22, volume: 0.36, type: 'triangle' },
    { freq: 1046.5, delay: 0.56, duration: 0.14, volume: 0.34, type: 'triangle' },
    { freq: 1318.51, delay: 0.7, duration: 0.14, volume: 0.34, type: 'triangle' },
    { freq: 1567.98, delay: 0.84, duration: 0.3, volume: 0.38, type: 'sine' },
  ]);
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([150, 70, 150, 70, 240]);
    } catch {
      // ignore vibration restriction
    }
  }
}

export function stopUnpaidVoiceAlert(): void {
  if (activeVoiceAudio) {
    try {
      activeVoiceAudio.pause();
      activeVoiceAudio.currentTime = 0;
    } catch {
      // ignore
    }
    activeVoiceAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export function buildUnpaidAlertMessage(opts: {
  text?: string;
  lang?: 'km' | 'en';
  tableNum?: string | number;
  amountUsd?: number;
  customerName?: string;
}): string {
  const tableLabel = opts.tableNum !== undefined && String(opts.tableNum).trim() !== ''
    ? String(opts.tableNum).trim()
    : '';
  const amtStr = Number.isFinite(Number(opts.amountUsd))
    ? Number(opts.amountUsd).toFixed(2)
    : '0.00';
  const custName = (opts.customerName || '').trim();
  const custom = (opts.text || '').trim();
  if (custom) {
    return custom
      .replace(/\{table\}/gi, tableLabel || '1')
      .replace(/\{amount\}/gi, amtStr)
      .replace(/\{name\}/gi, custName || (opts.lang === 'en' ? 'Customer' : 'ភ្ញៀវ'));
  }
  if (opts.lang === 'en') {
    return tableLabel
      ? `Excuse me, customer at Table ${tableLabel}, please remember to complete your payment of ${amtStr} dollars before leaving. Thank you.`
      : `Excuse me${custName ? ` ${custName}` : ''}, please remember to complete your payment of ${amtStr} dollars. Thank you.`;
  }
  return tableLabel
    ? `សូមអភ័យទោស ភ្ញៀវតុលេខ ${tableLabel} ភ្លេចទូទាត់ប្រាក់ ${amtStr} ដុល្លារហើយ សូមមេត្តាអញ្ជើញគិតលុយផង។ សូមអរគុណ!`
    : `សូមអភ័យទោស ភ្ញៀវ${custName ? ` ${custName}` : ''} ភ្លេចទូទាត់ប្រាក់ ${amtStr} ដុល្លារហើយ សូមមេត្តាអញ្ជើញគិតលុយផង។ សូមអរគុណ!`;
}

export async function playUnpaidVoiceAlert(opts: {
  audioDataUri?: string;
  text?: string;
  lang?: 'km' | 'en';
  tableNum?: string | number;
  amountUsd?: number;
  customerName?: string;
  speakFallback?: boolean;
}): Promise<{ playedAudio: boolean; spokeTts: boolean }> {
  unlockAudio();
  stopUnpaidVoiceAlert();
  playUnpaidChime();

  let playedAudio = false;
  let spokeTts = false;

  const clip = (opts.audioDataUri || '').trim();
  if (clip && clip.startsWith('data:audio/') && typeof Audio !== 'undefined') {
    try {
      const audio = new Audio(clip);
      audio.volume = 1;
      activeVoiceAudio = audio;
      await new Promise<void>((resolve) => {
        window.setTimeout(() => {
          audio
            .play()
            .then(() => {
              playedAudio = true;
              audio.onended = () => {
                if (activeVoiceAudio === audio) activeVoiceAudio = null;
                resolve();
              };
              audio.onerror = () => {
                if (activeVoiceAudio === audio) activeVoiceAudio = null;
                resolve();
              };
            })
            .catch(() => {
              if (activeVoiceAudio === audio) activeVoiceAudio = null;
              resolve();
            });
        }, 420);
      });
    } catch {
      playedAudio = false;
    }
  }

  const shouldSpeak = !playedAudio && (opts.speakFallback ?? true);
  if (shouldSpeak && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      const message = buildUnpaidAlertMessage(opts);
      const utter = new SpeechSynthesisUtterance(message);
      const targetLang = opts.lang === 'en' ? 'en-US' : 'km-KH';
      utter.lang = targetLang;
      utter.rate = 0.96;
      utter.pitch = 1.02;
      utter.volume = 1;

      const voices = window.speechSynthesis.getVoices?.() || [];
      if (voices.length > 0) {
        const preferred =
          voices.find((v) => v.lang.toLowerCase().startsWith(opts.lang === 'en' ? 'en' : 'km')) ||
          voices.find((v) => v.lang.toLowerCase().includes(opts.lang === 'en' ? 'en' : 'km'));
        if (preferred) utter.voice = preferred;
      }

      window.setTimeout(() => {
        try {
          window.speechSynthesis.speak(utter);
        } catch {
          // ignore
        }
      }, 450);
      spokeTts = true;
    } catch {
      spokeTts = false;
    }
  }

  return { playedAudio, spokeTts };
}


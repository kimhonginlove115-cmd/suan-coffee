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

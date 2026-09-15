import type { NotifyDriver, NotifyKind } from '../types';

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctor =
      window.AudioContext ??
      (window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

/** Short sine tones, synthesised so there is no asset to ship or license. */
function chime(tones: Array<{ hz: number; at: number; ms: number }>, peak = 0.12) {
  const ctx = context();
  if (!ctx) return;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.hz;

    const start = ctx.currentTime + tone.at / 1000;
    const end = start + tone.ms / 1000;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

const SOUNDS: Record<NotifyKind, () => void> = {
  // Rising major third: finished, no action needed.
  done: () => chime([{ hz: 660, at: 0, ms: 140 }, { hz: 880, at: 110, ms: 200 }]),
  // Repeated, higher: come back, you are the blocker.
  waiting: () =>
    chime(
      [
        { hz: 880, at: 0, ms: 110 },
        { hz: 880, at: 170, ms: 110 },
        { hz: 1174, at: 340, ms: 220 },
      ],
      0.14,
    ),
  // Falling minor: something broke.
  error: () => chime([{ hz: 440, at: 0, ms: 150 }, { hz: 330, at: 120, ms: 260 }]),
};

export class WebNotify implements NotifyDriver {
  permission(): NotificationPermission {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission;
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.requestPermission();
  }

  async post(notice: { kind: NotifyKind; title: string; body: string; tag: string }) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      silent: true, // we play our own sound
    });
  }

  sound(kind: NotifyKind) {
    SOUNDS[kind]?.();
  }
}

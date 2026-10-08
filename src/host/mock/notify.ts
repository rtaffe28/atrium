import type { NotifyDriver, Unsubscribe } from '../types';

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

/** A short sine tone, synthesised so there is no asset to ship or license. */
export function bellTone() {
  const ctx = context();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;

  const start = ctx.currentTime;
  const end = start + 0.18;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.12, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

export class WebNotify implements NotifyDriver {
  private handlers = new Set<(tag: string) => void>();

  permission(): NotificationPermission {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission;
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.requestPermission();
  }

  async post(notice: { title: string; body: string; tag: string }) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const shown = new Notification(notice.title, { body: notice.body, tag: notice.tag });
    shown.onclick = () => {
      window.focus();
      for (const handler of this.handlers) handler(notice.tag);
      shown.close();
    };
  }

  bell() {
    bellTone();
  }

  attention() {
    // A browser tab has no dock icon to bounce. The notification is the ask.
  }

  onClick(handler: (tag: string) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

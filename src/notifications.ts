import { useEffect, useRef } from 'react';
import type { AgentState, Session } from './session/types';

/**
 * Notifications exist for one reason: an agent that needs you is worthless if
 * you are in another window and do not know. "Waiting" is therefore louder
 * than "done" — it is the only state where a human is the bottleneck.
 *
 * In the browser this is the Web Notifications API. Under Electron it becomes
 * a native notification with the same shape, so nothing above here changes.
 */

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

/** Two short sine tones. Synthesised so there is no asset to ship or license. */
function chime(tones: Array<{ hz: number; at: number; ms: number }>, gainPeak = 0.12) {
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
    gain.gain.linearRampToValueAtTime(gainPeak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

const SOUNDS: Partial<Record<AgentState, () => void>> = {
  // Rising major third: finished, no action needed.
  done: () => chime([{ hz: 660, at: 0, ms: 140 }, { hz: 880, at: 110, ms: 200 }]),
  // Repeated note at a higher pitch: come back, you are the blocker.
  waiting: () =>
    chime([
      { hz: 880, at: 0, ms: 110 },
      { hz: 880, at: 170, ms: 110 },
      { hz: 1174, at: 340, ms: 220 },
    ], 0.14),
  // Falling minor: something broke.
  error: () => chime([{ hz: 440, at: 0, ms: 150 }, { hz: 330, at: 120, ms: 260 }]),
};

const COPY: Partial<Record<AgentState, (session: string, tab: string) => string>> = {
  done: (session) => `${session} finished`,
  waiting: (session) => `${session} needs your input`,
  error: (session) => `${session} failed`,
};

export function notificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  const result = await Notification.requestPermission();
  // Confirm the grant audibly so the user knows sound works too.
  if (result === 'granted') SOUNDS.done?.();
  return result;
}

function post(state: AgentState, sessionTitle: string, tabTitle: string, branch: string) {
  SOUNDS[state]?.();
  const headline = COPY[state];
  if (!headline || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  new Notification(headline(sessionTitle, tabTitle), {
    body: `${tabTitle} · ${branch}`,
    tag: `atrium-${sessionTitle}-${tabTitle}`,
    silent: true, // we play our own sound
  });
}

/**
 * Fires when any agent tab crosses into a state worth interrupting for.
 *
 * Diffing sessions here rather than emitting from the driver keeps the driver
 * ignorant of presentation — the real PTY driver gets notifications for free.
 */
export function useAgentNotifications(sessions: Session[], enabled: boolean) {
  const previous = useRef<Map<string, AgentState | undefined>>(new Map());
  const primed = useRef(false);

  useEffect(() => {
    const current = new Map<string, AgentState | undefined>();
    for (const session of sessions) {
      for (const tab of Object.values(session.tabs)) {
        current.set(tab.id, tab.agentState);
      }
    }

    // Skip the first pass so seeded sessions do not all fire at once on load.
    if (!primed.current) {
      previous.current = current;
      primed.current = true;
      return;
    }

    if (enabled) {
      for (const session of sessions) {
        for (const tab of Object.values(session.tabs)) {
          const before = previous.current.get(tab.id);
          const after = tab.agentState;
          if (after && after !== before && after !== 'working') {
            post(after, session.title, tab.title, session.branch);
          }
        }
      }
    }
    previous.current = current;
  }, [sessions, enabled]);
}

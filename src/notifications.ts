import { useEffect, useRef } from 'react';
import { useHost } from './host/context';
import { useSettings } from './settings/context';
import type { AgentState, Session } from './session/types';
import type { NotifyKind } from './host/types';

/**
 * Notifications exist for one reason: an agent that needs you is worthless if
 * you are in another window and do not know.
 *
 * The *policy* — which transitions are worth interrupting for, and what they
 * say — lives here. The *delivery* lives in host.notify, so a native Electron
 * notification and a browser one are the same call. Diffing sessions here
 * rather than emitting from the driver keeps the session driver ignorant of
 * presentation, so the real PTY driver gets notifications for free.
 */

const COPY: Partial<Record<AgentState, (session: string) => string>> = {
  done: (session) => `${session} finished`,
  waiting: (session) => `${session} needs your input`,
  error: (session) => `${session} failed`,
};

export function useAgentNotifications(sessions: Session[]) {
  const host = useHost();
  const { settings } = useSettings();
  const previous = useRef<Map<string, AgentState | undefined>>(new Map());
  const primed = useRef(false);

  useEffect(() => {
    const current = new Map<string, AgentState | undefined>();
    for (const session of sessions) {
      for (const tab of Object.values(session.tabs)) current.set(tab.id, tab.agentState);
    }

    // Skip the first pass, or every seeded session fires at once on load.
    if (!primed.current) {
      previous.current = current;
      primed.current = true;
      return;
    }

    for (const session of sessions) {
      for (const tab of Object.values(session.tabs)) {
        const before = previous.current.get(tab.id);
        const after = tab.agentState;
        if (!after || after === before || after === 'working') continue;
        if (!settings.notifyOn[after]) continue;

        const headline = COPY[after];
        if (!headline) continue;

        // Sound and notification are independent switches, so each is asked
        // for separately rather than one implying the other.
        if (settings.sounds) host.notify.sound(after as NotifyKind);
        if (settings.notifications) {
          void host.notify.post({
            kind: after as NotifyKind,
            title: headline(session.title),
            body: `${tab.title} · ${session.branch}`,
            tag: `atrium-${session.id}-${tab.id}`,
          });
        }
      }
    }
    previous.current = current;
  }, [host, sessions, settings]);
}

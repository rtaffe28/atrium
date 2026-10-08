import { useEffect, useRef } from 'react';
import { useHost } from './host/context';
import { useSettings } from './settings/context';
import type { Session } from './session/types';

/**
 * Pass a tab's request for attention on to the desktop.
 *
 * There is no policy about *when* here, because the program already made that
 * call: Claude asks when it finishes or needs permission, Codex when a turn
 * ends or wants approval, anything else when it rings. The driver has already
 * dropped requests from the tab you are looking at. What is left is how loud
 * to be, which is the user's call.
 *
 * Clicking a notification takes you to the tab that posted it.
 */
export function useTerminalAlerts(
  sessions: Session[],
  windowFocused: boolean,
  reveal: (tabId: string) => void,
) {
  const host = useHost();
  const { settings } = useSettings();
  const driver = host.sessions;

  // Read at the moment of the alert, not captured when it was subscribed.
  const latest = useRef({ sessions, windowFocused, settings, reveal });
  useEffect(() => {
    latest.current = { sessions, windowFocused, settings, reveal };
  });

  useEffect(
    () =>
      driver.onAlert((tabId, alert) => {
        const { sessions, windowFocused, settings } = latest.current;
        const session = sessions.find((s) => s.tabs[tabId]);
        const tab = session?.tabs[tabId];
        if (!session || !tab) return;

        if (!windowFocused) host.notify.attention();

        if (alert.type === 'bell') {
          if (settings.bellSound) host.notify.bell();
          return;
        }

        if (!settings.desktopNotifications) return;
        void host.notify.post({
          // OSC 9 carries a body and nothing else.
          title: alert.title || session.title,
          body: alert.body || tab.programTitle || tab.title,
          tag: tabId,
        });
      }),
    [driver, host],
  );

  useEffect(() => host.notify.onClick((tabId) => latest.current.reveal(tabId)), [host]);

  // Notifications are on by default, but a browser will only ask for
  // permission in response to a gesture — so ask on the first one, or the
  // switch reads on while nothing ever reaches the desktop. Native hosts
  // never answer 'default', so this does nothing there.
  const wanted = settings.desktopNotifications;
  useEffect(() => {
    if (!wanted || host.notify.permission() !== 'default') return;
    const ask = () => void host.notify.requestPermission();
    window.addEventListener('pointerdown', ask, { once: true });
    return () => window.removeEventListener('pointerdown', ask);
  }, [host, wanted]);
}

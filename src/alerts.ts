import { useEffect, useRef } from 'react';
import { useHost } from './host/context';
import { useSettings } from './settings/context';

/** A program's title without the status glyph it leads with: `✳ Fix the bug`. */
const plain = (title: string | undefined) => title?.replace(/^[^\p{L}\p{N}]+/u, '');

/**
 * Pass a tab's request for attention on to the desktop.
 *
 * Requests the program made — Claude when it needs permission or has sat
 * idle, Codex when a turn ends or wants approval, anything when it rings —
 * are passed on as they come; the program already decided when. `finished`
 * is the one Atrium raises itself, when a tab's Working tag goes out, and is
 * sent only if the user asked for it. The driver has already dropped all of
 * them for the tab you are looking at. What is left is how loud to be.
 *
 * Clicking a notification takes you to the tab that posted it.
 */
export function useTerminalAlerts(
  windowFocused: boolean,
  reveal: (tabId: string) => void,
) {
  const host = useHost();
  const { settings } = useSettings();
  const driver = host.sessions;

  // Read at the moment of the alert, not captured when it was subscribed.
  const latest = useRef({ windowFocused, settings, reveal });
  useEffect(() => {
    latest.current = { windowFocused, settings, reveal };
  });

  useEffect(
    () =>
      driver.onAlert((tabId, alert) => {
        const { windowFocused, settings } = latest.current;
        // From the store, not the last render: an alert can arrive before
        // React has drawn the change that caused it.
        const session = driver.list().find((s) => s.tabs[tabId]);
        const tab = session?.tabs[tabId];
        if (!session || !tab) return;

        if (alert.type === 'finished') {
          // Atrium's own observation, unlike the others, so it is only
          // anything at all if asked for.
          if (!settings.notifyWhenFinished) return;
          driver.patchTab(session.id, tabId, { attention: true });
          if (!windowFocused) host.notify.attention();
          void host.notify.post({
            title: session.title,
            body: `${plain(tab.programTitle) || tab.title} finished`,
            tag: tabId,
          });
          return;
        }

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
  const wanted = settings.desktopNotifications || settings.notifyWhenFinished;
  useEffect(() => {
    if (!wanted || host.notify.permission() !== 'default') return;
    const ask = () => void host.notify.requestPermission();
    window.addEventListener('pointerdown', ask, { once: true });
    return () => window.removeEventListener('pointerdown', ask);
  }, [host, wanted]);
}

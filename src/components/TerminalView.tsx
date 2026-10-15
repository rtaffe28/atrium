import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { claimFocus, type FocusRequest } from '../focusRequest';
import { useHost } from '../host/context';
import { encodeKey } from '../keyboard/terminal';
import { isResizing, onSettled } from '../layout/settle';
import { isOpenLinkClick } from '../links';
import { useSettings } from '../settings/context';
import type { SessionDriver } from '../session/types';

const THEME = {
  background: '#0d0f12',
  foreground: '#d7dce4',
  cursor: '#7aa2f7',
  cursorAccent: '#0d0f12',
  selectionBackground: '#28304a',
  black: '#1a1d23',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#d7dce4',
};

interface Props {
  tabId: string;
  driver: SessionDriver;
  /**
   * A one-shot request to take keyboard focus.
   *
   * Claiming it marks it spent, so a later remount — a split, a tab move —
   * cannot honour it again and jump the cursor.
   */
  focusRequest?: FocusRequest | null;
  /** A link was Cmd- or Ctrl-clicked. */
  onOpenLink?: (url: string) => void;
}

/**
 * One xterm instance per mounted tab.
 *
 * Attach replays scrollback before streaming live, so re-mounting after a
 * split, a tab move, or a session switch exercises exactly the path a real
 * driver uses to recover from a dropped connection.
 */
export function TerminalView({ tabId, driver, focusRequest, onOpenLink }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { settings } = useSettings();
  const fontSize = settings.terminalFontSize;
  const platform = useHost().window.platform();
  // Read through a ref so a new callback each render does not tear down the
  // terminal it is wired into.
  const openLinkRef = useRef(onOpenLink);
  useEffect(() => {
    openLinkRef.current = onOpenLink;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, monospace',
      fontSize,
      lineHeight: 1.45,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10_000,
      theme: THEME,
      // OSC 8 hyperlinks — what agents print when a link's text is not its
      // URL. Same rule as a bare URL below.
      linkHandler: {
        activate: (event, url) => follow(event, url),
        allowNonHttpProtocols: false,
      },
    });

    // A plain click belongs to the terminal: selecting, and positioning the
    // cursor in apps that take the mouse. Only the modifier makes it a link.
    function follow(event: MouseEvent, url: string) {
      if (isOpenLinkClick(event, platform)) openLinkRef.current?.(url);
    }

    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(follow));
    term.open(host);

    // WebGL is the fast path but fails on some Linux GPU drivers and in VMs.
    // A dropped frame rate beats a blank terminal.
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // DOM renderer stays active.
    }

    fit.fit();

    // Every keystroke reaches the pty, Escape included: ESC is load-bearing
    // for vim, readline and agents' own cancel handling, and swallowing it to
    // synthesise an interrupt breaks all three. Ctrl-C already does the right
    // thing without our help — xterm sends 0x03 and the line discipline turns
    // it into SIGINT for the foreground group. The one key re-encoded on the
    // way is Shift+Enter, which xterm would send as a bare CR, identical to
    // Enter; see keyboard/terminal.ts. It still reaches the pty, as bytes an
    // agent can tell apart.
    term.attachCustomKeyEventHandler((event) => {
      const sequence = encodeKey(event);
      if (sequence === null) return true;
      if (event.type === 'keydown') {
        // Cancelling the keydown stops the keypress that would follow, which
        // xterm would encode as the plain Enter being replaced.
        event.preventDefault();
        term.input(sequence);
      }
      return false;
    });

    const detach = driver.attach(tabId, (chunk) => term.write(chunk));
    const typed = term.onData((data) => driver.write(tabId, data));

    // Fitting resizes the DOM, which re-triggers the observer. Deferring the
    // work to the next frame breaks that feedback loop — otherwise every
    // split and splitter drag throws "ResizeObserver loop completed with
    // undelivered notifications".
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          fit.fit();
          driver.resize(tabId, term.cols, term.rows);
        } catch {
          // Fires when the pane is hidden and has zero size.
        }
      });
    };
    // Mid-drag, wait for the release; see layout/settle.ts.
    const observer = new ResizeObserver(() => {
      if (!isResizing()) refit();
    });
    observer.observe(host);
    const settled = onSettled(refit);

    return () => {
      cancelAnimationFrame(frame);
      settled();
      observer.disconnect();
      typed.dispose();
      detach();
      term.dispose();
      termRef.current = null;
    };
  }, [tabId, driver, fontSize, platform]);

  useEffect(() => {
    if (claimFocus(focusRequest ?? null, tabId)) termRef.current?.focus();
  }, [focusRequest, tabId]);

  return <div className="terminal-host" ref={hostRef} />;
}

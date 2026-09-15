import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
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
}

/**
 * One xterm instance per mounted tab.
 *
 * Attach replays scrollback before streaming live, so re-mounting after a
 * split, a tab move, or a session switch exercises exactly the path a real
 * driver uses to recover from a dropped connection.
 */
export function TerminalView({ tabId, driver }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const fontSize = settings.terminalFontSize;

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
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // WebGL is the fast path but fails on some Linux GPU drivers and in VMs.
    // A dropped frame rate beats a blank terminal.
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // DOM renderer stays active.
    }

    fit.fit();

    // No custom key handling. Every keystroke reaches the pty, Escape
    // included: ESC is load-bearing for vim, readline and agents' own cancel
    // handling, and swallowing it to synthesise an interrupt breaks all three.
    // Ctrl-C already does the right thing without our help — xterm sends 0x03
    // and the line discipline turns it into SIGINT for the foreground group.

    const detach = driver.attach(tabId, (chunk) => term.write(chunk));
    const typed = term.onData((data) => driver.write(tabId, data));

    // Fitting resizes the DOM, which re-triggers the observer. Deferring the
    // work to the next frame breaks that feedback loop — otherwise every
    // split and splitter drag throws "ResizeObserver loop completed with
    // undelivered notifications".
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          fit.fit();
          driver.resize(tabId, term.cols, term.rows);
        } catch {
          // Fires when the pane is hidden and has zero size.
        }
      });
    });
    observer.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      typed.dispose();
      detach();
      term.dispose();
    };
  }, [tabId, driver, fontSize]);

  return <div className="terminal-host" ref={hostRef} />;
}

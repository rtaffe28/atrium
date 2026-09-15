import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
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
  sessionId: string;
  driver: SessionDriver;
}

/**
 * One xterm instance, torn down and rebuilt when the active session changes.
 *
 * That is deliberate: it forces every session switch through the same
 * attach-and-replay path a real driver uses after a reconnect, so the
 * reattach model gets exercised constantly instead of only on a crash.
 */
export function TerminalView({ sessionId, driver }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10_000,
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // WebGL is the fast path, but it fails on some Linux GPU drivers and
    // inside VMs. Falling back to the DOM renderer is the whole reason this
    // is wrapped: a dropped frame rate beats a blank terminal.
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // DOM renderer stays active.
    }

    fit.fit();

    const detach = driver.attach(sessionId, (chunk) => term.write(chunk));
    const typed = term.onData((data) => driver.write(sessionId, data));

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        driver.resize(sessionId, term.cols, term.rows);
      } catch {
        // Fires when the pane is hidden and has zero size.
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      typed.dispose();
      detach();
      term.dispose();
    };
  }, [sessionId, driver]);

  return <div className="terminal-host" ref={hostRef} />;
}

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { claimFocus, type FocusRequest } from '../focusRequest';
import { useHost } from '../host/context';
import { encodeDrop, encodeKey, encodePaste } from '../keyboard/terminal';
import { isResizing, onSettled } from '../layout/settle';
import { isOpenLinkClick } from '../links';
import { useSettings } from '../settings/context';
import type { FileTarget, SessionDriver } from '../session/types';
import { fileUrlPath, pathLinkProvider } from '../terminal/pathLinks';

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
  /** A path was Cmd- or Ctrl-clicked, or a file: link. */
  onOpenFile?: (target: FileTarget) => void;
  /** Where the shell is, which a path it printed is relative to. */
  cwd?: string;
}

/**
 * One xterm instance per mounted tab.
 *
 * Attach replays scrollback before streaming live, so re-mounting after a
 * split, a tab move, or a session switch exercises exactly the path a real
 * driver uses to recover from a dropped connection.
 */
export function TerminalView({ tabId, driver, focusRequest, onOpenLink, onOpenFile, cwd }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { settings } = useSettings();
  const fontSize = settings.terminalFontSize;
  const { window: hostWindow, files, capabilities } = useHost();
  const platform = hostWindow.platform();
  const canReadFiles = capabilities.files;
  // Read through refs so a new callback each render, or a cd, does not tear
  // down the terminal it is wired into.
  const openLinkRef = useRef(onOpenLink);
  const openFileRef = useRef(onOpenFile);
  const cwdRef = useRef(cwd);
  useEffect(() => {
    openLinkRef.current = onOpenLink;
    openFileRef.current = onOpenFile;
    cwdRef.current = cwd;
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
      // URL. Same rule as a bare URL below; a file: link opens the file.
      linkHandler: {
        activate: (event, url) => follow(event, url),
        allowNonHttpProtocols: true,
      },
    });

    // A plain click belongs to the terminal: selecting, and positioning the
    // cursor in apps that take the mouse. Only the modifier makes it a link.
    function follow(event: MouseEvent, url: string) {
      if (!isOpenLinkClick(event, platform)) return;
      if (/^file:/i.test(url)) {
        const path = fileUrlPath(url);
        if (path) openFileRef.current?.({ kind: 'file', path });
      } else if (/^https?:/i.test(url)) {
        openLinkRef.current?.(url);
      }
    }

    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(follow));
    // Paths, with the same click and the same split as links; see
    // terminal/pathLinks.ts. Only where the host can say whether a path
    // exists, since every word with a dot in it is a candidate.
    const pathLinks = canReadFiles
      ? term.registerLinkProvider(
          pathLinkProvider(term, {
            cwd: () => cwdRef.current ?? '~',
            stat: (path) => files.stat(path),
            activate: (event, path, line, directory) => {
              if (!isOpenLinkClick(event, platform)) return;
              openFileRef.current?.(
                directory ? { kind: 'folder', root: path } : { kind: 'file', path, line },
              );
            },
          }),
        )
      : null;
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
    // it into SIGINT for the foreground group. The keys re-encoded on the way
    // are Shift+Enter, which xterm would send as a bare CR, identical to
    // Enter, and on macOS the Option and Cmd line-editing keys, which xterm
    // sends as bytes a shell does not read, or not at all; see
    // keyboard/terminal.ts. They still reach the pty, as bytes the program
    // can act on.
    term.attachCustomKeyEventHandler((event) => {
      const sequence = encodeKey(event, platform);
      if (sequence === null) return true;
      if (event.type === 'keydown') {
        // Cancelling the keydown stops the keypress that would follow, which
        // xterm would encode as the plain key being replaced.
        event.preventDefault();
        term.input(sequence);
      }
      return false;
    });

    // A paste xterm cannot carry — an image with no text, which is what a
    // screenshot is — went nowhere. It is sent on as Ctrl+V instead, the key
    // Claude Code reads the clipboard's image on; see keyboard/terminal.ts.
    // Capturing, so it is decided before xterm's own paste handling runs.
    const pasted = (event: ClipboardEvent) => {
      const sequence = encodePaste(event.clipboardData);
      if (sequence === null) return;
      event.preventDefault();
      event.stopPropagation();
      term.input(sequence);
    };
    host.addEventListener('paste', pasted, true);

    // Files dropped from the desktop are typed as their paths, as Terminal.app
    // and iTerm2 do and as Claude Code expects of a terminal; see
    // keyboard/terminal.ts. The drag has to be claimed first or the drop never
    // comes, and a drop nobody claims navigates the window to the file.
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const draggedOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer!.dropEffect = 'copy';
    };
    const dropped = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const paths = Array.from(event.dataTransfer!.files, (file) => files.pathOf(file));
      const text = encodeDrop(paths.filter((path): path is string => path !== null));
      if (text === null) return;
      term.paste(text);
      term.focus();
    };
    host.addEventListener('dragover', draggedOver);
    host.addEventListener('drop', dropped);

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
      host.removeEventListener('paste', pasted, true);
      host.removeEventListener('dragover', draggedOver);
      host.removeEventListener('drop', dropped);
      typed.dispose();
      detach();
      pathLinks?.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [tabId, driver, fontSize, platform, files, canReadFiles]);

  useEffect(() => {
    if (claimFocus(focusRequest ?? null, tabId)) termRef.current?.focus();
  }, [focusRequest, tabId]);

  return <div className="terminal-host" ref={hostRef} />;
}

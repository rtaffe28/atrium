import { cleanup, createEvent, render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';

type Handler = (event: KeyboardEvent) => boolean;

const g = globalThis as Record<string, unknown>;
const handlers = () => (g.__xtermKeyHandlers as Handler[]) ?? [];
/** What the terminal was asked to send to the pty on the app's behalf. */
const sent = () => (g.__xtermInput as string[]) ?? [];

const press = (init: KeyboardEventInit, type = 'keydown') =>
  new KeyboardEvent(type, { cancelable: true, ...init });

/** Open a session and return the key handler of the terminal it mounted. */
function openTerminal(): Handler {
  render(<App />);
  act(() => {
    fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
  });
  const installed = handlers();
  expect(installed.length, 'a handler per mounted terminal').toBeGreaterThan(0);
  return installed[installed.length - 1];
}

describe('terminal key handling', () => {
  beforeEach(() => {
    g.__xtermKeyHandlers = [];
    g.__xtermInput = [];
  });
  afterEach(cleanup);

  /**
   * Escape must reach the pty. It is load-bearing for vim, readline and
   * agents' own cancel handling — and Ctrl-C already becomes SIGINT via the
   * line discipline without help — so the handler passes everything through
   * except the one key xterm cannot encode distinguishably.
   */
  it('lets Escape, Enter and Ctrl-C through to xterm untouched', () => {
    const handler = openTerminal();
    for (const init of [{ key: 'Escape' }, { key: 'Enter' }, { key: 'c', ctrlKey: true }]) {
      const event = press(init);
      expect(handler(event), `${JSON.stringify(init)} should reach xterm`).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(sent()).toEqual([]);
  });

  it('sends ESC CR for Shift+Enter, where xterm would send the same CR as Enter', () => {
    const handler = openTerminal();
    const event = press({ key: 'Enter', shiftKey: true });
    expect(handler(event)).toBe(false);
    expect(event.defaultPrevented, 'the keypress that would send CR must not follow').toBe(true);
    expect(sent()).toEqual(['\x1b\r']);
  });

  it('sends it once per press, and keeps every phase of the key from xterm', () => {
    const handler = openTerminal();
    handler(press({ key: 'Enter', shiftKey: true }));
    expect(handler(press({ key: 'Enter', shiftKey: true }, 'keypress'))).toBe(false);
    expect(handler(press({ key: 'Enter', shiftKey: true }, 'keyup'))).toBe(false);
    expect(sent()).toEqual(['\x1b\r']);
  });
});


describe('terminal paste handling', () => {
  beforeEach(() => {
    g.__xtermKeyHandlers = [];
    g.__xtermInput = [];
  });
  afterEach(cleanup);

  /** What the browser hands a paste handler, reduced to what is read. */
  const clipboard = (text: string, types: string[]) => ({
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items: types.map((type) => ({ type })),
  });

  /** Open a session and return the element the terminal it mounted lives in. */
  function openTerminalHost(): HTMLElement {
    render(<App />);
    act(() => {
      fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
    });
    const hosts = document.querySelectorAll('.terminal-host');
    expect(hosts.length, 'a host per mounted terminal').toBeGreaterThan(0);
    return hosts[hosts.length - 1] as HTMLElement;
  }

  it('sends Ctrl+V for a screenshot, which xterm would otherwise drop', () => {
    const host = openTerminalHost();
    const event = createEvent.paste(host, { clipboardData: clipboard('', ['image/png']) });
    fireEvent(host, event);
    expect(event.defaultPrevented, "xterm's own paste handling must not run").toBe(true);
    expect(sent()).toEqual(['\x16']);
  });

  it('leaves a paste with text to xterm', () => {
    const host = openTerminalHost();
    const event = createEvent.paste(host, {
      clipboardData: clipboard('npm test', ['text/plain', 'image/png']),
    });
    fireEvent(host, event);
    expect(event.defaultPrevented).toBe(false);
    expect(sent()).toEqual([]);
  });
});

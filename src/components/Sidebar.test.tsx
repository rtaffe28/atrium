import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const sessionCount = () => document.querySelectorAll('.session-row').length;
const plusButton = () => screen.getByTitle(/^New session \(/);

/** Press and hold the +, long enough for the menu to open. */
function hold() {
  act(() => {
    fireEvent.pointerDown(plusButton());
  });
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

describe('the new-session button', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('opens a session on a plain click', () => {
    render(<App />);
    const before = sessionCount();

    act(() => fireEvent.click(plusButton()));

    expect(sessionCount()).toBe(before + 1);
  });

  it('opens the menu when held, and does not also open a session', () => {
    vi.useFakeTimers();
    render(<App />);
    const before = sessionCount();

    hold();

    expect(screen.getByRole('menu')).toBeTruthy();
    // The click the browser sends after the press must not land as well.
    act(() => {
      fireEvent.pointerUp(plusButton());
      fireEvent.click(plusButton());
    });
    expect(sessionCount()).toBe(before);
  });

  it('opens a fresh session with no agent from the menu', () => {
    vi.useFakeTimers();
    render(<App />);
    const before = sessionCount();

    hold();
    act(() => fireEvent.click(screen.getByText('Fresh session')));

    expect(sessionCount()).toBe(before + 1);
    // A session with no command to name it is just the shell.
    expect(screen.getAllByText('Shell').length).toBeGreaterThan(0);
  });

  it('runs the configured command for the ordinary entry', () => {
    vi.useFakeTimers();
    render(<App />);
    const before = sessionCount();

    hold();
    act(() => fireEvent.click(screen.getByText('Open with default command')));

    expect(sessionCount()).toBe(before + 1);
  });

  it('closes the menu on Escape without opening anything', () => {
    vi.useFakeTimers();
    render(<App />);
    const before = sessionCount();

    hold();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(sessionCount()).toBe(before);
  });
});

const terminalFocused = () => Boolean((globalThis as Record<string, unknown>).__xtermFocused);
const clearTerminalFocus = () => {
  (globalThis as Record<string, unknown>).__xtermFocused = false;
};

describe('renaming a session', () => {
  afterEach(cleanup);

  const row = (title: string) => screen.getByText(title).closest('.session-row')!;
  const field = () => screen.getByLabelText('Session name') as HTMLInputElement;

  /** A real double-click is two clicks first, and the first one enters the session. */
  function startRenaming(title: string) {
    act(() => fireEvent.click(row(title)));
    act(() => fireEvent.doubleClick(row(title)));
  }

  it('turns the title into a field on a double-click, ready to type over', () => {
    render(<App />);
    startRenaming('Auth flow migration');

    expect(field().value).toBe('Auth flow migration');
    expect(document.activeElement).toBe(field());
  });

  it('keeps the name on Enter and puts the cursor back in the terminal', () => {
    render(<App />);
    startRenaming('Auth flow migration');
    clearTerminalFocus();

    act(() => {
      fireEvent.change(field(), { target: { value: 'Login rewrite' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
    });

    expect(screen.queryByLabelText('Session name')).toBeNull();
    expect(screen.getByText('Login rewrite')).toBeTruthy();
    expect(screen.queryByText('Auth flow migration')).toBeNull();
    expect(terminalFocused(), 'Enter should leave you typing in the session').toBe(true);
  });

  it('keeps the name when the field loses focus', () => {
    render(<App />);
    startRenaming('Auth flow migration');

    act(() => {
      fireEvent.change(field(), { target: { value: 'Login rewrite' } });
      fireEvent.blur(field());
    });

    expect(screen.queryByLabelText('Session name')).toBeNull();
    expect(screen.getByText('Login rewrite')).toBeTruthy();
  });

  it('throws the name away on Escape', () => {
    render(<App />);
    startRenaming('Auth flow migration');

    act(() => {
      fireEvent.change(field(), { target: { value: 'Login rewrite' } });
      fireEvent.keyDown(field(), { key: 'Escape' });
    });

    expect(screen.queryByLabelText('Session name')).toBeNull();
    expect(screen.getByText('Auth flow migration')).toBeTruthy();
    expect(screen.queryByText('Login rewrite')).toBeNull();
  });

  it('leaves the title alone when the name is blank', () => {
    render(<App />);
    startRenaming('Auth flow migration');

    act(() => {
      fireEvent.change(field(), { target: { value: '   ' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
    });

    expect(screen.queryByLabelText('Session name')).toBeNull();
    expect(screen.getByText('Auth flow migration')).toBeTruthy();
  });

  it('renames the session you are in from the keyboard', () => {
    render(<App />);
    act(() => fireEvent.click(row('Auth flow migration')));

    // Shift held, so the browser reports the key as a capital.
    act(() => fireEvent.keyDown(window, { key: 'R', metaKey: true, shiftKey: true }));

    expect(field().value).toBe('Auth flow migration');
    expect(document.activeElement).toBe(field());
  });

  /**
   * The field sits on the row, and clicking the row enters the session —
   * which would yank the cursor into the terminal mid-word.
   */
  it('does not enter the session when the field itself is clicked', () => {
    render(<App />);
    startRenaming('Auth flow migration');
    clearTerminalFocus();

    act(() => fireEvent.click(field()));

    expect(terminalFocused()).toBe(false);
    expect(screen.getByLabelText('Session name')).toBeTruthy();
  });
});

describe("a session's name on the rail", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  const railTitles = () =>
    [...document.querySelectorAll('.session-title')].map((el) => el.textContent);
  const field = () => screen.getByLabelText('Session name') as HTMLInputElement;

  /** The + button's session runs a scripted Claude turn, which names itself a second in. */
  it('follows the agent in it', () => {
    vi.useFakeTimers();
    render(<App />);
    act(() => fireEvent.click(plusButton()));
    expect(railTitles()).toContain('claude');

    act(() => vi.advanceTimersByTime(1100));

    expect(railTitles()).toContain('wire up the pty driver');
    expect(railTitles()).not.toContain('claude');
  });

  it('keeps the name you gave it instead', () => {
    vi.useFakeTimers();
    render(<App />);
    act(() => fireEvent.click(plusButton()));
    // The new session is the one in front, so the shortcut renames it.
    act(() => fireEvent.keyDown(window, { key: 'R', metaKey: true, shiftKey: true }));
    act(() => {
      fireEvent.change(field(), { target: { value: 'PTY driver' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
    });

    act(() => vi.advanceTimersByTime(1100));

    expect(railTitles()).toContain('PTY driver');
    expect(railTitles()).not.toContain('wire up the pty driver');
  });
});

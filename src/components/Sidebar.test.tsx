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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';

const focused = () => Boolean((globalThis as Record<string, unknown>).__xtermFocused);
const clearFocus = () => {
  (globalThis as Record<string, unknown>).__xtermFocused = false;
};

describe('keyboard focus follows the session you enter', () => {
  beforeEach(clearFocus);
  afterEach(cleanup);

  /**
   * The guard that makes the rest safe. Focusing whenever a terminal mounts
   * would yank the cursor on every launch, every restore and every split —
   * worse than the problem it solves.
   */
  it('does not grab focus just from rendering', () => {
    render(<App />);
    expect(focused(), 'mounting must not steal the cursor').toBe(false);
  });

  it('focuses the terminal of a session you create', () => {
    render(<App />);
    clearFocus();

    act(() => fireEvent.click(screen.getByTitle(/New session/)));

    expect(focused()).toBe(true);
  });

  it('focuses the terminal when you enter an existing session', () => {
    render(<App />);
    clearFocus();

    act(() => {
      fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
    });

    expect(focused()).toBe(true);
  });

  it('focuses a terminal tab you add', () => {
    render(<App />);
    act(() => {
      fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
    });
    clearFocus();

    act(() => fireEvent.click(screen.getByTitle('New terminal tab')));

    expect(focused()).toBe(true);
  });

  it('selects the address bar of a browser tab you add', () => {
    render(<App />);
    act(() => {
      fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
    });

    act(() => fireEvent.click(screen.getByTitle('New browser tab')));

    const url = document.querySelector('.browser-url');
    expect(url).not.toBeNull();
    expect(document.activeElement, 'the address bar should be ready to type in').toBe(url);
  });
});

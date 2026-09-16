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

  it('focuses the terminal when the app opens', () => {
    render(<App />);
    expect(focused(), 'the app should open ready to type').toBe(true);
  });

  /**
   * The guard that keeps the rest safe. Opening takes focus once; after that,
   * a terminal mounting must not. Splitting a pane remounts terminals, and
   * having the cursor jump on every split would be worse than the problem
   * focusing solves.
   */
  it('does not grab focus again when a split remounts terminals', () => {
    render(<App />);
    act(() => {
      fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
    });
    clearFocus();

    const tabs = [...document.querySelectorAll('[data-tab-id]')];
    act(() => {
      fireEvent.pointerDown(tabs[1], { clientX: 700, clientY: 50, button: 0 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700, clientY: 400 }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1400, clientY: 500 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 1400, clientY: 500 }));
    });

    expect(document.querySelectorAll('.pane')).toHaveLength(2);
    expect(focused(), 'splitting must not move the cursor').toBe(false);
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

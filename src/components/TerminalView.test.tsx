import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';

const handlers = () =>
  ((globalThis as Record<string, unknown>).__xtermKeyHandlers as unknown[]) ?? [];

describe('terminal key handling', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__xtermKeyHandlers = [];
  });
  afterEach(cleanup);

  /**
   * Escape must reach the pty. It is load-bearing for vim, readline and
   * agents' own cancel handling, so the app installs no custom key handler at
   * all — Ctrl-C already becomes SIGINT via the line discipline without help.
   */
  it('installs no custom key handler, so every key reaches the pty', () => {
    render(<App />);
    act(() => {
      fireEvent.click(screen.getByText('Auth flow migration').closest('.session-row')!);
    });

    expect(handlers(), 'no key should be intercepted before the terminal').toHaveLength(0);
  });
});

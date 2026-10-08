import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { MockHost } from './host/mock';

/**
 * The mock's scripts send what Claude sends: a title and progress while a
 * turn runs, an OSC 777 notification when it stops. "Auth flow migration"
 * stops to ask a question, in a session that is not the one in front.
 */
describe('a tab asking for you', () => {
  let host: MockHost;
  let clicked: (tag: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    host = new MockHost();
    vi.spyOn(host.notify, 'post').mockResolvedValue();
    vi.spyOn(host.notify, 'onClick').mockImplementation((handler) => {
      clicked = handler;
      return () => {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const authTab = () => {
    const session = host.sessions.list().find((s) => s.title === 'Auth flow migration')!;
    const tab = Object.values(session.tabs).find((t) => t.kind === 'terminal')!;
    return { session, tab: () => host.sessions.list().find((s) => s.id === session.id)!.tabs[tab.id] };
  };

  it('posts what the program said, and marks the tab and its session', () => {
    render(<App host={host} />);
    act(() => vi.advanceTimersByTime(6000));

    const { tab } = authTab();
    expect(host.notify.post).toHaveBeenCalledWith({
      title: 'Claude Code',
      body: 'Claude needs your permission',
      tag: tab().id,
    });
    expect(tab().attention).toBe(true);
    const row = screen.getByText('Auth flow migration').closest('.session-row')!;
    expect(row.querySelector('.attention-mark')).not.toBeNull();
  });

  it('takes you to the tab when the notification is clicked, which clears its mark', () => {
    render(<App host={host} />);
    act(() => vi.advanceTimersByTime(6000));

    const { tab } = authTab();
    act(() => clicked(tab().id));

    const row = screen.getByText('Auth flow migration').closest('.session-row')!;
    expect(row.classList.contains('is-active')).toBe(true);
    expect(tab().attention).toBeUndefined();
  });

  it('says nothing to the desktop when notifications are off', () => {
    localStorage.setItem(
      'atrium.settings.v1',
      JSON.stringify({ desktopNotifications: false }),
    );
    render(<App host={host} />);
    act(() => vi.advanceTimersByTime(6000));

    expect(host.notify.post).not.toHaveBeenCalled();
    // The tab is still marked: that is the terminal's job, not the desktop's.
    expect(authTab().tab().attention).toBe(true);
    localStorage.removeItem('atrium.settings.v1');
  });
});

describe('the working tag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const tagOn = (title: string) =>
    screen.getByText(title).closest('.session-row')!.querySelector('.working-tag');

  /** "WebGL renderer spike" runs a scripted Claude turn: spinner, then ✳. */
  it('shows while the agent’s title spins, and is gone when it stops', () => {
    render(<App host={new MockHost()} />);

    act(() => vi.advanceTimersByTime(1500));
    expect(tagOn('WebGL renderer spike')).not.toBeNull();

    act(() => vi.advanceTimersByTime(15000));
    expect(tagOn('WebGL renderer spike')).toBeNull();
  });

  /** A build prints steadily and never sets a spinner title. Output is not working. */
  it('never shows for a command that does not say so', () => {
    render(<App host={new MockHost()} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(tagOn('Production build')).toBeNull();
  });
});

describe('the finished notification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem('atrium.settings.v1');
  });

  /** "WebGL renderer spike" runs a Claude turn in a session that is not in front. */
  it('is posted when a tab you are not looking at stops working', () => {
    const host = new MockHost();
    vi.spyOn(host.notify, 'post').mockResolvedValue();
    render(<App host={host} />);
    act(() => vi.advanceTimersByTime(20000));

    expect(host.notify.post).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'WebGL renderer spike',
        body: 'try the WebGL addon finished',
      }),
    );
    const row = screen.getByText('WebGL renderer spike').closest('.session-row')!;
    expect(row.querySelector('.attention-mark')).not.toBeNull();
  });

  it('is not posted, nor the tab marked, when it is turned off', () => {
    localStorage.setItem('atrium.settings.v1', JSON.stringify({ notifyWhenFinished: false }));
    const host = new MockHost();
    vi.spyOn(host.notify, 'post').mockResolvedValue();
    render(<App host={host} />);
    act(() => vi.advanceTimersByTime(20000));

    expect(host.notify.post).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('finished') }),
    );
    const row = screen.getByText('WebGL renderer spike').closest('.session-row')!;
    expect(row.querySelector('.attention-mark')).toBeNull();
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { MockHost } from './mock';
import type { Build, Capabilities, Host, Platform } from './types';

/**
 * The point of the Host interface is that the app works against any
 * implementation. These tests swap one in and assert the app reacts to what it
 * is told, rather than to what it can guess about the platform.
 */
function hostWith(overrides: {
  capabilities?: Partial<Capabilities>;
  platform?: Platform;
  build?: Build;
  insets?: { lead: number; trail: number };
}): Host {
  const base = new MockHost();
  return {
    ...base,
    name: 'test',
    capabilities: { ...base.capabilities, ...overrides.capabilities },
    window: {
      ...base.window,
      platform: () => overrides.platform ?? 'linux',
      build: () => overrides.build ?? 'release',
      chromeInsets: () => overrides.insets ?? { lead: 0, trail: 0 },
      subscribe: base.window.subscribe.bind(base.window),
    },
  };
}

function openBrowserTab() {
  const row = screen.getByText('Auth flow migration').closest('.session-row')!;
  act(() => fireEvent.click(row));
  const previewTab = [...document.querySelectorAll('[data-tab-id]')].find((el) =>
    el.textContent?.includes('Preview'),
  )!;
  act(() => fireEvent.pointerDown(previewTab, { clientX: 400, clientY: 50, button: 0 }));
}

describe('host injection', () => {
  afterEach(cleanup);

  it('renders an embedded surface when the host supports one', () => {
    render(<App host={hostWith({ capabilities: { browserSurface: 'iframe' } })} />);
    openBrowserTab();

    expect(document.querySelector('.surface-host')).not.toBeNull();
    expect(screen.queryByText(/cannot embed/i)).toBeNull();
  });

  it('degrades instead of breaking when the host cannot embed pages', () => {
    render(<App host={hostWith({ capabilities: { browserSurface: 'none' } })} />);
    openBrowserTab();

    expect(screen.getByText(/cannot embed/i)).toBeTruthy();
    expect(document.querySelector('.surface-host')).toBeNull();
  });

  it('takes window-control insets from the host rather than the user agent', () => {
    render(<App host={hostWith({ platform: 'mac', insets: { lead: 72, trail: 0 } })} />);

    const titlebar = document.querySelector('.titlebar') as HTMLElement;
    expect(titlebar.className).toContain('platform-mac');
    expect(titlebar.style.getPropertyValue('--chrome-lead')).toBe('72px');
  });

  it('puts the inset on the trailing side for Windows', () => {
    render(<App host={hostWith({ platform: 'win', insets: { lead: 0, trail: 138 } })} />);

    const titlebar = document.querySelector('.titlebar') as HTMLElement;
    expect(titlebar.className).toContain('platform-win');
    expect(titlebar.style.getPropertyValue('--chrome-trail')).toBe('138px');
  });

  it('marks a development window so it cannot be mistaken for the installed app', () => {
    render(<App host={hostWith({ build: 'dev' })} />);

    expect(screen.getByText('dev')).toBeTruthy();
  });

  it('leaves the installed app unmarked', () => {
    render(<App host={hostWith({ build: 'release' })} />);

    expect(document.querySelector('.build-badge')).toBeNull();
  });

  it('offers to open a file where the host can read one', () => {
    render(<App host={hostWith({ capabilities: { files: true } })} />);
    expect(screen.getByLabelText('Open file…')).toBeTruthy();
  });

  it('degrades instead of breaking when the host cannot read files', () => {
    render(<App host={hostWith({ capabilities: { files: false } })} />);
    expect(screen.queryByLabelText('Open file…')).toBeNull();

    const row = screen.getByText('Session rail + status dots').closest('.session-row')!;
    act(() => fireEvent.click(row));
    expect(screen.getByText(/cannot read files/i)).toBeTruthy();
  });

  it('reports its own capabilities honestly', () => {
    const host = new MockHost();
    expect(host.capabilities.pty).toBe(false); // scripted output, not processes
    expect(host.capabilities.browserSurface).toBe('iframe');
  });

});

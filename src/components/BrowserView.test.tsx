import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostProvider } from '../host/HostProvider';
import { MockHost } from '../host/mock';
import type { Host, SurfaceDriver, SurfaceEvent } from '../host/types';
import { toUrl } from '../links';
import type { Tab } from '../session/types';
import { BrowserView } from './BrowserView';

/**
 * A surface that remembers what it was asked and lets a test speak as the
 * page. What matters here is the direction of traffic: a URL the page
 * reports must never come back to it as a navigation.
 */
class FakeSurfaces implements SurfaceDriver {
  mounted: (string | undefined)[] = [];
  navigated: string[] = [];
  back = vi.fn(async () => {});
  forward = vi.fn(async () => {});
  reload = vi.fn(async () => {});
  toggleDevTools = vi.fn(async () => {});
  private listeners = new Map<string, Set<(event: SurfaceEvent) => void>>();

  mount(_id: string, _container: HTMLElement, options: { url?: string }) {
    this.mounted.push(options.url);
    return () => {};
  }

  async navigate(_id: string, url: string) {
    this.navigated.push(url);
  }

  subscribe(id: string, handler: (event: SurfaceEvent) => void) {
    const set = this.listeners.get(id) ?? new Set();
    set.add(handler);
    this.listeners.set(id, set);
    return () => void set.delete(handler);
  }

  /** The page reporting in. */
  emit(id: string, event: SurfaceEvent) {
    for (const listener of this.listeners.get(id) ?? []) listener(event);
  }
}

function hostWith(surfaces: SurfaceDriver, kind: 'webview' | 'iframe' = 'webview'): Host {
  const base = new MockHost();
  return { ...base, surfaces, capabilities: { ...base.capabilities, browserSurface: kind } };
}

const ID = 't-browser';
const tab = (url?: string): Tab => ({ id: ID, kind: 'browser', title: 'New tab', url });

function renderView(host: Host, first: Tab) {
  const onNavigate = vi.fn();
  const onTitle = vi.fn();
  const view = (t: Tab) => (
    <HostProvider host={host}>
      <BrowserView tab={t} onNavigate={onNavigate} onTitle={onTitle} />
    </HostProvider>
  );
  const utils = render(view(first));
  return { onNavigate, onTitle, show: (t: Tab) => utils.rerender(view(t)) };
}

const address = () => screen.getByLabelText<HTMLInputElement>('Address');
const enter = (text: string) => {
  fireEvent.change(address(), { target: { value: text } });
  fireEvent.submit(address().closest('form')!);
};

describe('toUrl', () => {
  it('gives a bare host http://', () => {
    expect(toUrl('localhost:5173')).toBe('http://localhost:5173');
    expect(toUrl('  example.com/docs ')).toBe('http://example.com/docs');
  });

  it('leaves a scheme alone', () => {
    expect(toUrl('https://a.test/x')).toBe('https://a.test/x');
    expect(toUrl('file:///tmp/a.html')).toBe('file:///tmp/a.html');
    expect(toUrl('about:blank')).toBe('about:blank');
  });

  it('is nothing for nothing', () => {
    expect(toUrl('   ')).toBeNull();
  });
});

describe('BrowserView', () => {
  afterEach(cleanup);

  it('records where the page went and never sends it back', () => {
    const surfaces = new FakeSurfaces();
    const { onNavigate, show } = renderView(hostWith(surfaces), tab('http://localhost:5173'));
    expect(surfaces.mounted).toEqual(['http://localhost:5173']);

    // The page lands with a trailing slash: where it is, not where it was sent.
    act(() =>
      surfaces.emit(ID, {
        type: 'url',
        url: 'http://localhost:5173/',
        canGoBack: false,
        canGoForward: false,
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith('http://localhost:5173/');

    // The record comes back down as a prop, the way it does from the store.
    show(tab('http://localhost:5173/'));
    expect(address().value).toBe('http://localhost:5173/');
    expect(surfaces.navigated, 'a reported URL pushed back is a reload, or a loop').toEqual([]);
    expect(surfaces.mounted, 'nor is the surface remounted').toHaveLength(1);
  });

  it('navigates the surface once when you enter a URL', () => {
    const surfaces = new FakeSurfaces();
    const { onNavigate } = renderView(hostWith(surfaces), tab('http://a.test/'));

    enter('b.test');

    expect(surfaces.navigated).toEqual(['http://b.test']);
    expect(onNavigate).toHaveBeenCalledWith('http://b.test');
  });

  it('mounts a blank tab at the URL you enter', () => {
    const surfaces = new FakeSurfaces();
    const { onNavigate, show } = renderView(hostWith(surfaces), tab());
    expect(document.querySelector('.surface-host')).toBeNull();

    enter('localhost:3000');
    expect(onNavigate).toHaveBeenCalledWith('http://localhost:3000');

    show(tab('http://localhost:3000'));
    expect(document.querySelector('.surface-host')).not.toBeNull();
    expect(surfaces.mounted).toEqual(['http://localhost:3000']);
  });

  it('enables back and forward as the page reports its history', () => {
    const surfaces = new FakeSurfaces();
    renderView(hostWith(surfaces), tab('http://a.test/'));
    const back = screen.getByLabelText<HTMLButtonElement>('Back');
    const forward = screen.getByLabelText<HTMLButtonElement>('Forward');
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);

    act(() =>
      surfaces.emit(ID, { type: 'url', url: 'http://a.test/2', canGoBack: true, canGoForward: false }),
    );
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);

    fireEvent.click(back);
    expect(surfaces.back).toHaveBeenCalledWith(ID);
  });

  it('puts the page URL back on Escape, and leaves the bar on a second', () => {
    const surfaces = new FakeSurfaces();
    renderView(hostWith(surfaces), tab('http://a.test/'));
    const input = address();
    input.focus();
    fireEvent.change(input, { target: { value: 'half-typ' } });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('http://a.test/');
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });

  it('names the tab after the page, and keeps the host when the page has no name', () => {
    const surfaces = new FakeSurfaces();
    const { onTitle } = renderView(hostWith(surfaces), tab('http://a.test/'));

    act(() => surfaces.emit(ID, { type: 'title', title: 'Dashboard' }));
    expect(onTitle).toHaveBeenCalledWith('Dashboard');

    act(() => surfaces.emit(ID, { type: 'title', title: '  ' }));
    expect(onTitle).toHaveBeenCalledTimes(1);
  });

  it('offers developer tools on a webview and not on an iframe', () => {
    const surfaces = new FakeSurfaces();
    renderView(hostWith(surfaces, 'iframe'), tab('http://a.test/'));
    expect(screen.queryByLabelText('Developer tools')).toBeNull();
    cleanup();

    renderView(hostWith(surfaces, 'webview'), tab('http://a.test/'));
    fireEvent.click(screen.getByLabelText('Developer tools'));
    expect(surfaces.toggleDevTools).toHaveBeenCalledWith(ID);
  });
});

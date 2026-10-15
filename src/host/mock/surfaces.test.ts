import { describe, expect, it } from 'vitest';
import type { SurfaceEvent } from '../types';
import { IframeSurfaces } from './surfaces';

describe('IframeSurfaces', () => {
  it('reports where the page is and where it can still go', async () => {
    const surfaces = new IframeSurfaces();
    const events: SurfaceEvent[] = [];
    surfaces.subscribe('t', (event) => events.push(event));
    surfaces.mount('t', document.createElement('div'), { url: 'http://a.test/' });
    const last = () => {
      const urls = events.filter((event) => event.type === 'url');
      return urls[urls.length - 1];
    };

    await surfaces.navigate('t', 'http://b.test/');
    expect(last()).toEqual({ type: 'url', url: 'http://b.test/', canGoBack: true, canGoForward: false });

    await surfaces.back('t');
    expect(last()).toEqual({ type: 'url', url: 'http://a.test/', canGoBack: false, canGoForward: true });

    await surfaces.forward('t');
    expect(last()).toEqual({ type: 'url', url: 'http://b.test/', canGoBack: true, canGoForward: false });

    // Navigating from the middle of history drops what was ahead.
    await surfaces.back('t');
    await surfaces.navigate('t', 'http://c.test/');
    expect(last()).toEqual({ type: 'url', url: 'http://c.test/', canGoBack: true, canGoForward: false });
    await surfaces.forward('t');
    expect(last()?.url).toBe('http://c.test/');
  });
});

describe('IframeSurfaces listeners', () => {
  it('keep hearing a surface that is remounted under them', () => {
    const surfaces = new IframeSurfaces();
    const events: SurfaceEvent[] = [];
    const container = document.createElement('div');
    // Subscribed first, as the component is; then the surface is mounted
    // twice, which is what moving a tab between panes does, and what React's
    // development mode does to every new surface.
    surfaces.subscribe('t', (event) => events.push(event));
    surfaces.mount('t', container, { url: 'http://a.test/' })();
    surfaces.mount('t', container, { url: 'http://a.test/' });

    void surfaces.navigate('t', 'http://b.test/');
    expect(events.some((e) => e.type === 'url' && e.url === 'http://b.test/')).toBe(true);
  });
});

describe('IframeSurfaces history', () => {
  it('treats Enter on the address already shown as a reload', async () => {
    const surfaces = new IframeSurfaces();
    const events: SurfaceEvent[] = [];
    surfaces.subscribe('t', (event) => events.push(event));
    surfaces.mount('t', document.createElement('div'), { url: 'http://a.test/' });

    await surfaces.navigate('t', 'http://a.test/');
    const urls = events.filter((e) => e.type === 'url');
    expect(urls[urls.length - 1]).toEqual({ type: 'url', url: 'http://a.test/', canGoBack: false, canGoForward: false });
  });
});

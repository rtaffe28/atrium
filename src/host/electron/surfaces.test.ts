import { describe, expect, it } from 'vitest';
import type { AtriumBridge } from './bridge';
import { WebviewSurfaces } from './surfaces';

const bridge = { surfaces: { onOpen: () => () => {} } } as unknown as AtriumBridge;
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('WebviewSurfaces', () => {
  it('attaches the webview once the mount has settled', async () => {
    const surfaces = new WebviewSurfaces(bridge);
    const container = document.createElement('div');
    surfaces.mount('t', container, { url: 'http://a.test/' });
    expect(container.children).toHaveLength(0);

    await settle();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe('webview');
  });

  it('never attaches a surface unmounted in the same tick', async () => {
    // What React's development mode does to every new surface: mount,
    // unmount, mount again. Only the survivor should become a guest page.
    const surfaces = new WebviewSurfaces(bridge);
    const container = document.createElement('div');
    surfaces.mount('t', container, { url: 'http://a.test/' })();
    surfaces.mount('t', container, { url: 'http://a.test/' });

    await settle();
    expect(container.children).toHaveLength(1);
  });
});

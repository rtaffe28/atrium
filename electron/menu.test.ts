import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { menuTemplate } from './menu';

/** Every role asked for, including those nested in submenus. */
function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ]);
}

/**
 * Mod+Shift+R, meant for a rename, used to force-reload the renderer and take
 * every open terminal with it. Electron fills in the role menus itself, so the
 * check is on what is asked for: neither reload role, and not the stock View
 * menu that carries both.
 */
describe('the application menu', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'never reloads the renderer on %s',
    (platform) => {
      const used = roles(menuTemplate(platform));
      expect(used).not.toContain('reload');
      expect(used).not.toContain('forceReload');
      expect(used).not.toContain('viewMenu');
    },
  );

  it('still offers editing, zoom and the developer tools', () => {
    const used = roles(menuTemplate('darwin'));
    expect(used).toEqual(expect.arrayContaining(['editMenu', 'zoomIn', 'toggleDevTools']));
  });
});

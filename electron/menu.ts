import type { MenuItemConstructorOptions } from 'electron';

/**
 * The application menu: Electron's default, less the two entries that reload
 * the renderer.
 *
 * The default menu binds Reload to Mod+R and Force Reload to Mod+Shift+R, and
 * nothing in the renderer took those keys, so they fell through to the menu
 * and reloaded the page. In a browser that is harmless. Here the page is where
 * every open terminal lives: the agents in them are cut off mid-run, and what
 * comes back is the workspace restored from disk as fresh processes. Sitting
 * beside Mod+T and Mod+W, that is a trap rather than a feature.
 *
 * Everything else is kept by role, so copy and paste, zoom, full screen and
 * the developer tools behave exactly as they did.
 */
export function menuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions[] = platform === 'darwin' ? [{ role: 'appMenu' }] : [];
  return [
    ...appMenu,
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}

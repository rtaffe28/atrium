import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLoginEnv } from './env';
import { PtyManager } from './pty';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let ptys: PtyManager;

/**
 * Space to leave clear of the OS window controls.
 *
 * macOS puts traffic lights top-left; Windows and Linux put their controls
 * top-right, and Windows 11 needs the maximize button's hit region intact for
 * snap layouts. The renderer reads these rather than guessing from a user
 * agent — which is exactly the bug this replaces.
 */
function chromeInsets() {
  if (process.platform === 'darwin') return { lead: 72, trail: 0 };
  return { lead: 0, trail: 138 };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0d0f12',
    show: false,
    titleBarStyle: 'hidden',
    // Windows and Linux draw their own controls over our chrome; macOS does
    // not take this option and uses the inset above instead.
    ...(process.platform === 'darwin'
      ? {}
      : {
          titleBarOverlay: {
            color: '#101318',
            symbolColor: '#808999',
            height: 38,
          },
        }),
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload needs Node to reach the pty bridge
      webviewTag: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // A packaged app whose renderer fails to load shows a blank window and says
  // nothing at all. These two turned a silent failure into a one-line answer.
  window.webContents.on('did-fail-load', (_event, code, description, url) =>
    console.error('[atrium] renderer failed to load', code, description, url),
  );
  window.webContents.on('preload-error', (_event, preloadPath, error) =>
    console.error('[atrium] preload error', preloadPath, error),
  );
  window.webContents.on('preload-error', (_e, p, error) =>
    console.error('[atrium] PRELOAD ERROR', p, error),
  );
  // Renderer console in the terminal. Worth keeping: a silent renderer is how
  // a stale dev server presented itself as a blank window for half an hour.
  window.webContents.on('console-message', (event) =>
    console.log('[renderer]', event.message),
  );
  ptys.bind(window.webContents);

  const emitState = () =>
    window.webContents.send('window:state', {
      focused: window.isFocused(),
      fullscreen: window.isFullScreen(),
    });
  window.on('focus', emitState);
  window.on('blur', emitState);
  window.on('enter-full-screen', emitState);
  window.on('leave-full-screen', emitState);

  // Links that would replace the app navigate the real browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    void window.loadURL(DEV_URL);
  } else {
    void window.loadFile(path.join(dirname, '../dist/index.html'));
  }

  return window;
}

app.whenReady().then(async () => {
  const env = await resolveLoginEnv();
  ptys = new PtyManager(env, () => {});

  const insets = chromeInsets();
  ipcMain.handle('host:info', () => ({
    platform:
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux',
    insets,
    home: env.HOME ?? env.USERPROFILE ?? '',
    shell: env.SHELL ?? process.env.COMSPEC ?? '',
  }));

  ipcMain.handle('pty:spawn', (_e, options) => ptys.spawn(options));
  ipcMain.handle('pty:replay', (_e, id: string) => ptys.replay(id));
  ipcMain.handle('pty:foreground', () => ptys.foreground());
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data));
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    ptys.resize(id, cols, rows),
  );
  ipcMain.on('pty:interrupt', (_e, id: string) => ptys.interrupt(id));
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id));

  const workspaceFile = path.join(app.getPath('userData'), 'workspace.json');

  ipcMain.handle('workspace:load', async () => {
    try {
      return JSON.parse(await readFile(workspaceFile, 'utf8'));
    } catch {
      // Missing on first run, and unreadable if a previous write was cut off.
      // Either way, starting fresh beats refusing to start.
      return null;
    }
  });

  ipcMain.handle('workspace:save', async (_e, state) => {
    // Write-then-rename: a crash mid-write leaves the previous good file
    // intact rather than a truncated one that loses every session.
    const temporary = `${workspaceFile}.tmp`;
    await writeFile(temporary, JSON.stringify(state), 'utf8');
    await rename(temporary, workspaceFile);
  });

  ipcMain.handle('notify:post', (_e, notice: { title: string; body: string; tag: string }) => {
    if (!Notification.isSupported()) return;
    new Notification({ title: notice.title, body: notice.body, silent: true }).show();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Every pty is a child of this process; leaving them behind is the orphan
// problem the roadmap's stage 8 is about. Kill them explicitly.
app.on('before-quit', () => ptys?.killAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

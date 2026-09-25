import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { readFile, writeFile, rename, readdir, stat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLoginEnv } from './env';
import { PtyManager } from './pty';
import { useBaseDirectory } from './shims';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let ptys: PtyManager;
let loginShellName = 'zsh';

// A development run and the installed app are the same app by name, and macOS
// volumes are case-insensitive, so they share one workspace.json, one
// scrollback store and one shim directory. That only matters once you develop
// Atrium inside Atrium — at which point testing a build silently overwrites
// the workspace you were working in. Must run before `ready`.
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`);

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

  // The close button quits, after the same confirmation as Cmd-Q.
  window.on('close', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void requestQuit(window);
  });

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
  // Shims and shell integration belong with the app's data, not scattered
  // through the temp directory one copy per launch.
  useBaseDirectory(app.getPath('userData'));

  const env = await resolveLoginEnv();
  loginShellName = (env.SHELL ?? '/bin/zsh').split('/').pop() ?? 'zsh';
  ptys = new PtyManager(env, () => {});

  const insets = chromeInsets();

  /** Where the shims report what each tab is running; the renderer is told. */
  const sessionRoot = path.join(app.getPath('userData'), 'sessions');

  ipcMain.handle('host:info', () => ({
    platform:
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux',
    // The same bit that moved `userData` aside above. The renderer cannot see
    // `app.isPackaged`, and it is what tells the two windows apart on screen.
    build: app.isPackaged ? 'release' : 'dev',
    insets,
    home: env.HOME ?? env.USERPROFILE ?? '',
    shell: env.SHELL ?? process.env.COMSPEC ?? '',
    sessionState: sessionRoot,
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

  const sessionState = (tabId: string) => path.join(sessionRoot, tabId.replace(/[^\w-]/g, ''));

  /**
   * Where Claude keeps the transcripts for a directory: the path with every
   * separator flattened to a hyphen, so /Users/ryan/git → -Users-ryan-git.
   */
  const claudeProjects = (cwd: string) =>
    path.join(env.HOME ?? '', '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

  /**
   * Arm a tab to resume, once.
   *
   * Only Atrium restoring a tab means "reopen what was there". Running an agent
   * again by hand should start a new conversation, so the marker is consumed by
   * the shim on the next invocation and not replaced.
   */
  ipcMain.handle(
    'agent:prepare-session',
    async (_e, tabId: string, resume: { claude?: string; codex?: string }, cwd?: string) => {
      const dir = sessionState(tabId);
      await mkdir(dir, { recursive: true }).catch(() => {});
      await rm(path.join(dir, 'resume'), { force: true }).catch(() => {});
      await rm(path.join(dir, 'resume-codex'), { force: true }).catch(() => {});
      // Arming a conversation that does not exist is worse than not arming one:
      // `claude --resume` fails outright, where an unarmed tab merely starts
      // fresh. A tab can hold an id nothing was ever written under — one
      // handed out for a session where nothing was said, or left behind by an
      // agent that never started.
      const transcript = resume.claude
        ? await stat(path.join(claudeProjects(cwd ?? ''), `${resume.claude}.jsonl`)).catch(
            () => null,
          )
        : null;
      if (resume.claude && (!cwd || transcript)) {
        await writeFile(path.join(dir, 'resume'), resume.claude, 'utf8');
      }
      if (resume.codex) await writeFile(path.join(dir, 'resume-codex'), resume.codex, 'utf8');
      return dir;
    },
  );

  /**
   * Which conversation the tab's agent is on.
   *
   * `current` is written by the shim when it hands out an id, and by Claude's
   * SessionStart hook for every other way a conversation can begin.
   */
  ipcMain.handle('agent:report', async (_e, tabId: string) => {
    const current = await readFile(path.join(sessionState(tabId), 'current'), 'utf8').catch(
      () => '',
    );
    return { sessionId: current.trim() || null };
  });

  ipcMain.handle('agent:newest-codex-session', async (_e, since: number) => {
    const root = path.join(env.HOME ?? '', '.codex', 'sessions');
    const uuid = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
    let best: { id: string; at: number } | null = null;

    const walk = async (dir: string, depth: number): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth > 0) await walk(full, depth - 1);
          continue;
        }
        const match = uuid.exec(entry.name);
        if (!match) continue;
        const info = await stat(full).catch(() => null);
        if (!info || info.mtimeMs < since) continue;
        if (!best || info.mtimeMs > best.at) best = { id: match[1], at: info.mtimeMs };
      }
    };

    await walk(root, 3);
    return best?.id ?? null;
  });

  ipcMain.handle('files:choose', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose a folder to browse',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
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

/**
 * Quitting, asked for once and then carried out properly.
 *
 * Closing the window quits the app rather than leaving it running with nothing
 * on screen — there is no document-less state worth keeping. Quitting stops
 * live agents, so it asks first; and it is deferred until they have exited,
 * because an agent killed mid-write never finishes saving its session, and an
 * unsaved session cannot be resumed.
 */
let shuttingDown = false;
let asking = false;

async function requestQuit(window?: BrowserWindow) {
  if (shuttingDown || asking) return;
  asking = true;
  try {
    const busy = ptys?.busyCount(loginShellName) ?? 0;
    const choice = await dialog.showMessageBox(window ?? BrowserWindow.getAllWindows()[0], {
      type: 'question',
      buttons: ['Cancel', 'Quit Atrium'],
      defaultId: 1,
      cancelId: 0,
      message: 'Quit Atrium?',
      detail:
        busy > 0
          ? `${busy} session${busy === 1 ? ' is' : 's are'} running something. ` +
            'They will be stopped, and reopened where they left off next time.'
          : 'Your sessions will be reopened where they left off next time.',
    });
    if (choice.response !== 1) return;
  } catch {
    // No window to attach a dialog to; quit rather than becoming unquittable.
  } finally {
    asking = false;
  }

  shuttingDown = true;
  await ptys?.shutdown();
  app.quit();
}

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  void requestQuit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

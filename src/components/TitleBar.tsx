import type { SessionMeta } from '../session/types';

/**
 * The custom title bar.
 *
 * In the browser this is just a header. Under Electron it becomes the drag
 * region for a frameless window, and the left inset is what stops the macOS
 * traffic lights from landing on top of the session rail. Windows and Linux
 * get the inset on the right instead, where their window controls live.
 *
 * Getting this wrong is the single most reliable way to make a cross-platform
 * app feel wrong, so it is a real component from day one rather than a
 * retrofit.
 */

type Platform = 'mac' | 'win' | 'linux';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'mac';
  if (ua.includes('Win')) return 'win';
  return 'linux';
}

interface Props {
  session: SessionMeta | null;
}

export function TitleBar({ session }: Props) {
  const platform = detectPlatform();

  return (
    <header className={`titlebar platform-${platform}`}>
      <div className="titlebar-lead">
        <span className="wordmark">atrium</span>
      </div>

      <div className="titlebar-center">
        {session ? (
          <>
            <span className="crumb">{session.cwd}</span>
            <span className="crumb-sep">/</span>
            <span className="crumb strong">{session.branch}</span>
          </>
        ) : (
          <span className="crumb dim">no session</span>
        )}
      </div>

      <div className="titlebar-trail">
        <kbd>{platform === 'mac' ? '⌘' : 'Ctrl'}K</kbd>
      </div>
    </header>
  );
}

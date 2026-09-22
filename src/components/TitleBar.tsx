import { useHost } from '../host/context';
import type { Session, TabKind } from '../session/types';

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
 *
 * Both the platform and the inset sizes come from the host. A browser tab has
 * no window controls to avoid and reports zero; a frameless Electron window
 * reports the real numbers. The component never sniffs a user agent.
 *
 * The `dev` marker beside the wordmark comes from the host too. Developing
 * Atrium inside Atrium leaves two identical windows open: mistaking the dev
 * build for the installed one wastes a moment, and mistaking the installed one
 * for the dev build means typing into the window holding your real agents. The
 * marker sits by the wordmark rather than the session crumbs because it is a
 * property of the window, and because a dev run that has restored nothing yet
 * has no session for it to sit beside.
 */

interface Props {
  session: Session | null;
  onOpenSettings: () => void;
  onNewTab: (kind: TabKind) => void;
  canAddTab: boolean;
}

export function TitleBar({ session, onOpenSettings, onNewTab, canAddTab }: Props) {
  const host = useHost();
  const platform = host.window.platform();
  const build = host.window.build();
  const insets = host.window.chromeInsets();

  return (
    <header
      className={`titlebar platform-${platform}`}
      style={
        {
          '--chrome-lead': `${insets.lead}px`,
          '--chrome-trail': `${insets.trail}px`,
        } as React.CSSProperties
      }
    >
      <div className="titlebar-lead">
        <span className="wordmark">atrium</span>
        {build === 'dev' && (
          <span className="build-badge" title="Development build — its own workspace in atrium-dev">
            dev
          </span>
        )}
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
        <button
          className="icon-button subtle"
          onClick={() => onNewTab('terminal')}
          disabled={!canAddTab}
          title="New terminal tab"
          aria-label="New terminal tab"
        >
          {/* A terminal window with a prompt — the convention users already
              read as "terminal" in VS Code, iTerm and macOS Terminal. */}
          <svg viewBox="0 0 16 16" aria-hidden width="14" height="14" fill="none">
            <rect
              x="1.6"
              y="2.6"
              width="12.8"
              height="10.8"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M4.4 6.4 6.6 8.3 4.4 10.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.4 10.4h3.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="icon-button subtle"
          onClick={() => onNewTab('browser')}
          disabled={!canAddTab}
          title="New browser tab"
          aria-label="New browser tab"
        >
          {/* A globe — the standard "the web" mark, and visually distinct from
              the terminal window so the pair reads at a glance. */}
          <svg viewBox="0 0 16 16" aria-hidden width="14" height="14" fill="none">
            <g stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="6" />
              <ellipse cx="8" cy="8" rx="2.7" ry="6" />
              <path d="M2.3 6h11.4M2.3 10h11.4" strokeLinecap="round" />
            </g>
          </svg>
        </button>
        <span className="titlebar-divider" />
        <button
          className="icon-button subtle"
          onClick={onOpenSettings}
          title={`Settings (${platform === 'mac' ? '⌘' : 'Ctrl'},)`}
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}

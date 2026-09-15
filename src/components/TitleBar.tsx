import { useHost } from '../host/context';
import type { Session } from '../session/types';

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
 */

interface Props {
  session: Session | null;
  onOpenSettings: () => void;
}

export function TitleBar({ session, onOpenSettings }: Props) {
  const host = useHost();
  const platform = host.window.platform();
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

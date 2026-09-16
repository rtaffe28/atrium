import { useEffect, useId, useRef } from 'react';
import { useDrag } from '../dnd/context';
import { deriveSessionState, type Session, type SessionState } from '../session/types';

const STATUS_LABEL: Record<SessionState, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Needs you',
  done: 'Done',
  error: 'Failed',
};

function relativeTime(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

interface Props {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onKill: (id: string) => void;
}

export function Sidebar({ sessions, activeId, onSelect, onCreate, onKill }: Props) {
  const { register, action } = useDrag();
  const railRef = useRef<HTMLElement>(null);
  const zoneId = useId();

  // Dropping a tab on the rail promotes it into a session of its own.
  useEffect(
    () =>
      register({
        id: `rail:${zoneId}`,
        priority: 3,
        getRect: () => railRef.current?.getBoundingClientRect() ?? null,
        resolve: () => ({ kind: 'rail' }),
      }),
    [register, zoneId],
  );

  const railActive = action?.kind === 'rail';

  // Double-clicking blank rail space opens a session — the same gesture as the
  // empty workspace. Guarded so a double-click on a row is still just a
  // double-click on that row.
  const onBackgroundDoubleClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('.session-row, button')) return;
    onCreate();
  };

  return (
    <nav
      className={`sidebar${railActive ? ' is-drop-target' : ''}`}
      ref={railRef}
      onDoubleClick={onBackgroundDoubleClick}
    >
      <header className="sidebar-head">
        <div className="sidebar-title">Sessions</div>
        <button className="icon-button" onClick={onCreate} title="New session (⌘N)">
          +
        </button>
      </header>

      <ul className="session-list">

        {sessions.map((session) => {
          const state = deriveSessionState(session);
          const tabCount = Object.keys(session.tabs).length;
          return (
            <li key={session.id}>
              <div
                className={`session-row${session.id === activeId ? ' is-active' : ''}`}
                onClick={() => onSelect(session.id)}
              >
                <span className={`dot dot-${state}`} aria-hidden />
                <span className="session-body">
                  <span className="session-title">{session.title}</span>
                  <span className="session-meta">
                    <span className="branch">{session.branch}</span>
                    <span className="sep">·</span>
                    <span>
                      {tabCount} tab{tabCount === 1 ? '' : 's'}
                    </span>
                    <span className="sep">·</span>
                    <span>{relativeTime(session.createdAt)}</span>
                  </span>
                  {session.diff.files > 0 && (
                    <span className="session-diff">
                      <span className="added">+{session.diff.added}</span>
                      <span className="removed">−{session.diff.removed}</span>
                      <span className="files">
                        {session.diff.files} file{session.diff.files === 1 ? '' : 's'}
                      </span>
                    </span>
                  )}
                </span>
                <span className={`status-tag status-${state}`}>{STATUS_LABEL[state]}</span>
                <button
                  className="session-kill"
                  title="Kill session"
                  onClick={(event) => {
                    event.stopPropagation();
                    onKill(session.id);
                  }}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {railActive && <div className="rail-drop-hint">Drop to start a new session</div>}

      <footer className="sidebar-foot">
        <span className="dim">mock driver</span>
        <span className="dim">⌘N new · ⌘, settings</span>
      </footer>
    </nav>
  );
}

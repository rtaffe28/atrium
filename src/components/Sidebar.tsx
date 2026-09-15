import type { SessionMeta, SessionStatus } from '../session/types';

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Idle',
  running: 'Working',
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
  sessions: SessionMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function Sidebar({ sessions, activeId, onSelect, onCreate }: Props) {
  const needsAttention = sessions.filter((s) => s.status === 'waiting').length;

  return (
    <nav className="sidebar">
      <header className="sidebar-head">
        <div className="sidebar-title">
          Sessions
          {needsAttention > 0 && (
            <span className="badge" title={`${needsAttention} waiting on you`}>
              {needsAttention}
            </span>
          )}
        </div>
        <button className="icon-button" onClick={onCreate} title="New session (⌘N)">
          +
        </button>
      </header>

      <ul className="session-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              className={`session-row${session.id === activeId ? ' is-active' : ''}`}
              onClick={() => onSelect(session.id)}
            >
              <span className={`dot dot-${session.status}`} aria-hidden />
              <span className="session-body">
                <span className="session-title">{session.title}</span>
                <span className="session-meta">
                  <span className="branch">{session.branch}</span>
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
              <span className={`status-tag status-${session.status}`}>
                {STATUS_LABEL[session.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <footer className="sidebar-foot">
        <span className="dim">mock driver</span>
        <span className="dim">no processes running</span>
      </footer>
    </nav>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { useDrag } from '../dnd/context';
import type { Session } from '../session/types';
import { isWorking } from '../session/signals';

function relativeTime(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

/**
 * How long + has to be held before it opens the menu instead of a session.
 *
 * Long enough that an ordinary click never reaches it, short enough that you
 * do not wonder whether the press registered.
 */
const HOLD_MS = 450;

interface Props {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  /** A session with no agent in it — just the shell, in the same directory. */
  onCreateShell: () => void;
  onKill: (id: string) => void;
  /** The session whose title is being edited, if any. */
  renamingId: string | null;
  onBeginRename: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCancelRename: () => void;
}

/**
 * A session's title, as a field.
 *
 * Enter keeps what was typed and so does clicking away, since what was typed
 * is the thing worth not losing; Escape throws it away, and so does a blank.
 * Whichever of those comes first decides and the rest are ignored, because
 * committing unmounts the field and a browser may blur it on the way out.
 *
 * Pointer events stop here. A click on the row enters the session, which puts
 * the cursor in its terminal — in the middle of typing a name — and a
 * double-click would start the rename over.
 */
function RenameField({
  title,
  onCommit,
  onCancel,
}: {
  title: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  // The whole name selected, since a rename usually replaces it.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const next = ref.current?.value.trim();
    if (next) onCommit(next);
    else onCancel();
  };
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      className="session-title-input"
      defaultValue={title}
      spellCheck={false}
      aria-label="Session name"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape') cancel();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onBlur={commit}
    />
  );
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onCreateShell,
  onKill,
  renamingId,
  onBeginRename,
  onRename,
  onCancelRename,
}: Props) {
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

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number | null>(null);
  // A hold has already done its work by the time the pointer comes up. The
  // click that follows it must not open a session on top of the menu.
  const held = useRef(false);

  const cancelHold = () => {
    if (holdTimer.current === null) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const beginHold = () => {
    held.current = false;
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setMenuOpen(true);
    }, HOLD_MS);
  };

  useEffect(() => cancelHold, []);

  // Dismissed the way every other menu is: click away, or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const choose = (create: () => void) => {
    setMenuOpen(false);
    held.current = false;
    create();
  };

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
        <div className="new-session">
          <button
            className="icon-button"
            onPointerDown={beginHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onClick={() => {
              if (held.current) {
                held.current = false;
                return;
              }
              onCreate();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuOpen(true);
            }}
            title="New session (⌘N) — hold for more"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            +
          </button>
          {menuOpen && (
            <div className="new-session-menu" role="menu" ref={menuRef}>
              <button role="menuitem" onClick={() => choose(onCreate)}>
                Open with default command
              </button>
              <button role="menuitem" onClick={() => choose(onCreateShell)}>
                Fresh session
              </button>
            </div>
          )}
        </div>
      </header>

      <ul className="session-list">

        {sessions.map((session) => {
          const tabs = Object.values(session.tabs);
          const tabCount = tabs.length;
          // Not a state of the session: just whatever its tabs are showing,
          // so a request made in a session you are not in is not missed.
          const attention = tabs.some((tab) => tab.attention);
          const working = tabs.some(isWorking);
          return (
            <li key={session.id}>
              <div
                className={`session-row${session.id === activeId ? ' is-active' : ''}`}
                onClick={() => onSelect(session.id)}
                onDoubleClick={() => onBeginRename(session.id)}
              >
                <span className="session-body">
                  <span className="session-headline">
                    {session.id === renamingId ? (
                      <RenameField
                        title={session.title}
                        onCommit={(title) => onRename(session.id, title)}
                        onCancel={onCancelRename}
                      />
                    ) : (
                      <span className="session-title">{session.title}</span>
                    )}
                    {attention && (
                      <span
                        className="attention-mark"
                        title="A tab in this session asked for your attention"
                      />
                    )}
                  </span>
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
                {working && <span className="working-tag">Working</span>}
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

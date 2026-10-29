import { useEffect, useMemo, useRef, useState } from 'react';
import { claimFocus, type FocusRequest } from '../focusRequest';
import { useCapability, useHost } from '../host/context';
import type { FileContents, GitChange, GitStatus } from '../host/types';
import { basename, relativeTo } from '../paths';
import type { FileTarget, Session, SessionDriver, Tab } from '../session/types';
import { diffLines, foldRows, type DiffRow } from '../viewers/diff';
import { canHighlight, highlight, styleOf, type TokenSpan } from '../viewers/highlight';
import { languageFor } from '../viewers/kind';
import { Icon } from './Icon';
import { useGitStatus } from './useGitStatus';

interface Props {
  tab: Tab;
  session: Session;
  driver: SessionDriver;
  focusRequest?: FocusRequest | null;
  /** Open a file beside this pane, at a line if given. */
  onOpenBeside: (target: FileTarget) => void;
}

/** Unchanged lines kept either side of a change, as `git diff` keeps them. */
const CONTEXT = 3;

const ICON = {
  list: 'M2 3h12v10H2zM6 3v10',
  whole: 'M3 2h10v12H3zM5.5 5h5M5.5 8h5M5.5 11h5',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  file: 'M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13',
};

/** One letter per kind, as `git status --short` writes them. */
const LETTER: Record<GitChange['kind'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
};

const KIND_LABEL: Record<GitChange['kind'], string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New, untracked',
};

/**
 * A changes tab: what the working tree changed against HEAD, one file at a
 * time. The list is the repository's changed files; the diff is the chosen
 * one, unified, coloured as the file is coloured, with unchanged stretches
 * folded away until asked for.
 *
 * Read-only on purpose, like the file viewer: staging, committing and
 * reverting are a sentence to the agent beside it, or a command in the
 * terminal. See docs/plan/active/15-file-viewer.md, stage 9.
 */
export function DiffView({ tab, session, driver, focusRequest, onOpenBeside }: Props) {
  const canAsk = useCapability('git');
  const root = tab.root ?? session.cwd;
  const { status, refresh } = useGitStatus(canAsk ? root : undefined);
  const [listShown, setListShown] = useState(true);
  const [whole, setWhole] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!claimFocus(focusRequest ?? null, tab.id)) return;
    frame.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusRequest, tab.id]);

  if (!canAsk) return <div className="empty">This host cannot ask git what changed.</div>;
  if (status === undefined) return <div className="diffview" ref={frame} />;
  if (status === null) {
    return (
      <div className="empty">
        <p>Not in a git repository.</p>
        <span className="empty-hint">{root}</span>
      </div>
    );
  }

  // The chosen file, or the first change until one is chosen.
  const chosen = tab.path ? status.changes.find((c) => c.path === tab.path) : status.changes[0];
  const shownPath = tab.path ?? chosen?.path;
  const choose = (path: string) => driver.patchTab(session.id, tab.id, { path });

  const button = (label: string, icon: string, onClick: () => void, on = false, disabled = false) => (
    <button
      type="button"
      className={`icon-button subtle${on ? ' is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={on || undefined}
    >
      <Icon d={icon} />
    </button>
  );

  const where = shownPath ? relativeTo(status.root, shownPath) : '';
  const name = shownPath ? basename(shownPath) : '';
  const folder = where.endsWith(name) ? where.slice(0, where.length - name.length) : '';

  const body = () => {
    if (status.changes.length === 0) {
      return (
        <div className="empty">
          <p>No changes against HEAD.</p>
          <span className="empty-hint">{status.branch ?? 'detached HEAD'}</span>
        </div>
      );
    }
    if (!chosen) {
      return (
        <div className="empty">
          <p>No longer changed.</p>
          <span className="empty-hint">{where}</span>
        </div>
      );
    }
    return (
      <FileDiff
        // A file's folds and scroll are its own.
        key={chosen.path}
        root={status.root}
        change={chosen}
        whole={whole}
        onOpenLine={(line) => onOpenBeside({ kind: 'file', path: chosen.path, line })}
      />
    );
  };

  return (
    <div className="diffview fileview" ref={frame}>
      {listShown && <ChangeList status={status} selected={chosen?.path} onChoose={choose} onRefresh={refresh} />}
      <div className="fileview-main">
        <div className="file-bar">
          {button('Changed files', ICON.list, () => setListShown((shown) => !shown), listShown)}
          <span className="file-path" title={shownPath}>
            {chosen?.oldPath && (
              <span className="file-folder diff-renamed-from">{relativeTo(status.root, chosen.oldPath)} → </span>
            )}
            <span className="file-folder">{folder}</span>
            <strong>{name}</strong>
            {chosen && <span className={`change-kind kind-${chosen.kind}`}>{KIND_LABEL[chosen.kind]}</span>}
          </span>
          {button('Whole file', ICON.whole, () => setWhole((w) => !w), whole, !chosen)}
          {button(
            'Open file',
            ICON.file,
            () => chosen && onOpenBeside({ kind: 'file', path: chosen.path }),
            false,
            !chosen || chosen.kind === 'deleted',
          )}
        </div>
        {status.truncated && (
          <div className="file-notice" role="status">
            The first {status.changes.length} changed files.
          </div>
        )}
        {body()}
      </div>
    </div>
  );
}

// ── the list ───────────────────────────────────────────────────────────────

function ChangeList({
  status,
  selected,
  onChoose,
  onRefresh,
}: {
  status: GitStatus;
  selected: string | undefined;
  onChoose: (path: string) => void;
  onRefresh: () => void;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const totals = useMemo(
    () =>
      status.changes.reduce(
        (sum, change) => ({ added: sum.added + change.added, removed: sum.removed + change.removed }),
        { added: 0, removed: 0 },
      ),
    [status],
  );

  const at = status.changes.findIndex((c) => c.path === selected);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const last = status.changes.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        next = Math.min(last, at + 1);
        break;
      case 'ArrowUp':
      case 'k':
        next = Math.max(0, at - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next >= 0 && status.changes[next]) onChoose(status.changes[next].path);
  };

  useEffect(() => {
    if (!selected || !rowsRef.current) return;
    for (const el of rowsRef.current.querySelectorAll<HTMLElement>('[data-path]')) {
      if (el.dataset.path === selected) el.scrollIntoView?.({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <div className="file-tree change-list">
      <div className="tree-head">
        <span className="change-summary">
          <span className="branch" title={status.root}>
            {status.branch ?? 'detached HEAD'}
          </span>
          <span className="session-diff">
            <span className="added">+{totals.added}</span>
            <span className="removed">−{totals.removed}</span>
            <span className="files">
              {status.changes.length} file{status.changes.length === 1 ? '' : 's'}
            </span>
          </span>
        </span>
        <button type="button" className="icon-button subtle" title="Refresh" aria-label="Refresh" onClick={onRefresh}>
          <Icon d={ICON.refresh} />
        </button>
      </div>
      <div className="tree-rows" ref={rowsRef} role="listbox" tabIndex={0} onKeyDown={onKeyDown} aria-label="Changed files">
        {status.changes.map((change) => {
          const where = relativeTo(status.root, change.path);
          const name = basename(change.path);
          const folder = where.slice(0, where.length - name.length);
          return (
            <div
              key={change.path}
              role="option"
              aria-selected={change.path === selected}
              data-path={change.path}
              className={`tree-row change-row${change.path === selected ? ' is-selected' : ''}`}
              title={`${KIND_LABEL[change.kind]}: ${where}`}
              onClick={() => onChoose(change.path)}
            >
              <span className={`change-letter kind-${change.kind}`}>{LETTER[change.kind]}</span>
              <span className="tree-name">
                {name}
                {folder && <span className="change-folder"> {folder.replace(/\/$/, '')}</span>}
              </span>
              <span className="change-counts">
                {change.binary ? (
                  <span className="files">bin</span>
                ) : (
                  <>
                    {change.added > 0 && <span className="added">+{change.added}</span>}
                    {change.removed > 0 && <span className="removed">−{change.removed}</span>}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── one file's diff ────────────────────────────────────────────────────────

interface Sides {
  old: FileContents | null;
  now: FileContents | null;
}

/**
 * Both sides of a changed file, read again whenever its counts move or the
 * file is written: two edits that leave the counts alone are still two edits.
 */
function useSides(root: string, change: GitChange): Sides | undefined {
  const host = useHost();
  const [sides, setSides] = useState<Sides | undefined>(undefined);
  const [written, setWritten] = useState(0);
  const signature = `${change.kind}:${change.added}:${change.removed}`;

  useEffect(
    () => host.files.watch(change.path, () => setWritten((n) => n + 1)),
    [host, change.path],
  );

  useEffect(() => {
    let cancelled = false;
    const neverCommitted = change.kind === 'untracked' || change.kind === 'added';
    Promise.all([
      neverCommitted ? null : host.git.original(root, change.oldPath ?? change.path).catch(() => null),
      change.kind === 'deleted' ? null : host.files.read(change.path).catch(() => null),
    ]).then(([old, now]) => {
      if (!cancelled) setSides({ old, now });
    });
    return () => {
      cancelled = true;
    };
    // `signature` and `written` are the reasons to read again.
  }, [host, root, change.path, change.oldPath, change.kind, signature, written]);

  return sides;
}

/** Tokens for a whole side, or null while they come or when they cannot. */
function useTokens(text: string | null, language: string | null): TokenSpan[][] | null {
  const [result, setResult] = useState<{ text: string; lines: TokenSpan[][] } | null>(null);
  useEffect(() => {
    if (text === null || !language || !canHighlight(text)) return;
    let cancelled = false;
    highlight(text, language).then(
      (lines) => {
        if (!cancelled) setResult({ text, lines });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [text, language]);
  return result && result.text === text ? result.lines : null;
}

function textOf(contents: FileContents | null): string | null {
  return contents?.kind === 'text' ? contents.text : null;
}

function FileDiff({
  root,
  change,
  whole,
  onOpenLine,
}: {
  root: string;
  change: GitChange;
  whole: boolean;
  onOpenLine: (line: number) => void;
}) {
  const sides = useSides(root, change);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const oldText = textOf(sides?.old ?? null);
  const newText = textOf(sides?.now ?? null);
  const language = languageFor(change.path, (newText ?? oldText ?? '').slice(0, 200));
  const oldTokens = useTokens(oldText, language);
  const newTokens = useTokens(newText, language);

  const rows = useMemo(() => (sides ? diffLines(oldText ?? '', newText ?? '') : []), [sides, oldText, newText]);
  const blocks = useMemo(() => foldRows(rows, whole ? Infinity : CONTEXT, expanded), [rows, whole, expanded]);

  if (!sides) return <div className="code-view" />;
  if (change.binary || sides.old?.kind === 'binary' || sides.now?.kind === 'binary') {
    return (
      <div className="empty">
        <p>A binary file. {KIND_LABEL[change.kind]}.</p>
      </div>
    );
  }
  const truncated =
    (sides.old?.kind === 'text' && sides.old.truncated) || (sides.now?.kind === 'text' && sides.now.truncated);
  if (truncated) {
    return (
      <div className="empty">
        <p>Too large to compare here.</p>
        <span className="empty-hint">git diff in the terminal will show it.</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p>{change.kind === 'renamed' ? 'Renamed, and otherwise unchanged.' : 'An empty file.'}</p>
      </div>
    );
  }

  const tokensFor = (row: DiffRow) =>
    row.kind === 'removed'
      ? oldTokens?.[row.oldLine! - 1]
      : newTokens?.[row.newLine! - 1] ?? (row.oldLine ? oldTokens?.[row.oldLine - 1] : undefined);

  return (
    <div className="code-view diff-view" tabIndex={0}>
      {blocks.map((block) =>
        block.kind === 'gap' ? (
          <button
            key={`gap-${block.start}`}
            type="button"
            className="diff-gap"
            onClick={() => setExpanded((was) => new Set(was).add(block.start))}
          >
            ⋯ {block.count} unchanged line{block.count === 1 ? '' : 's'}
          </button>
        ) : (
          block.rows.map((row, i) => {
            const tokens = tokensFor(row);
            return (
              <div key={block.start + i} className={`code-line diff-line is-${row.kind}`}>
                <span className="code-gutter diff-num" aria-hidden>
                  {row.oldLine ?? ''}
                </span>
                {row.newLine ? (
                  <button
                    type="button"
                    className="code-gutter diff-num diff-goto"
                    title={`Open at line ${row.newLine}`}
                    tabIndex={-1}
                    onClick={() => onOpenLine(row.newLine!)}
                  >
                    {row.newLine}
                  </button>
                ) : (
                  <span className="code-gutter diff-num" aria-hidden />
                )}
                <span className="diff-sign" aria-hidden>
                  {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
                </span>
                <span className="code-text">
                  {tokens
                    ? tokens.map((token, j) => (
                        <span key={j} style={styleOf(token)}>
                          {token.text}
                        </span>
                      ))
                    : row.text}
                </span>
              </div>
            );
          })
        ),
      )}
    </div>
  );
}

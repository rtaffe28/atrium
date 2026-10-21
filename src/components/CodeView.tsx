import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BOLD, canHighlight, highlight, ITALIC, UNDERLINE, type TokenSpan } from '../viewers/highlight';

interface Props {
  text: string;
  /** The grammar to colour with, or null for plain text. */
  language: string | null;
  /** A line to land on and mark. */
  line?: number;
}

/** A trailing newline ends the last line; it is not an empty line after it. */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function styleOf(token: TokenSpan): React.CSSProperties | undefined {
  if (!token.color && !token.style) return undefined;
  const style: React.CSSProperties = {};
  if (token.color) style.color = token.color;
  if (token.style) {
    if (token.style & ITALIC) style.fontStyle = 'italic';
    if (token.style & BOLD) style.fontWeight = 600;
    if (token.style & UNDERLINE) style.textDecoration = 'underline';
  }
  return style;
}

/**
 * Code, coloured as VS Code colours it, with a gutter.
 *
 * Shown plain first and coloured when the highlighter answers, so a file
 * is readable the moment it is read. Plain is also what stays for a file
 * too big to tokenise, a language nobody has a grammar for, and a host with
 * no worker to run one in. The reader's place survives a rewrite.
 */
export function CodeView({ text, language, line }: Props) {
  const lines = useMemo(() => splitLines(text), [text]);
  const [coloured, setColoured] = useState<{ text: string; language: string; lines: TokenSpan[][] } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    if (!language || !canHighlight(text)) return;
    let cancelled = false;
    highlight(text, language).then(
      (result) => {
        if (!cancelled) setColoured({ text, language, lines: result });
      },
      () => {
        // Plain it stays.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [text, language]);

  const tokens = coloured && coloured.text === text && coloured.language === language ? coloured.lines : null;

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scrollTop.current;
  }, [text]);

  useEffect(() => {
    if (line === undefined) return;
    scroller.current?.querySelector<HTMLElement>(`[data-line="${line}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [line, text]);

  return (
    <div
      className="code-view"
      ref={scroller}
      tabIndex={0}
      onScroll={(event) => {
        scrollTop.current = event.currentTarget.scrollTop;
      }}
    >
      {lines.map((plain, i) => (
        <div key={i} className={`code-line${i + 1 === line ? ' is-marked' : ''}`} data-line={i + 1}>
          <span className="code-gutter" aria-hidden>
            {i + 1}
          </span>
          <span className="code-text">
            {tokens?.[i]
              ? tokens[i].map((token, j) => (
                  <span key={j} style={styleOf(token)}>
                    {token.text}
                  </span>
                ))
              : plain}
          </span>
        </div>
      ))}
    </div>
  );
}

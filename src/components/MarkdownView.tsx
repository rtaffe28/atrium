import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHost } from '../host/context';
import { isOpenLinkClick } from '../links';
import { dirname, resolveAgainst } from '../paths';
import type { FileTarget } from '../session/types';
import { highlight, type TokenSpan } from '../viewers/highlight';
import { fenceLanguage } from '../viewers/kind';

interface Props {
  path: string;
  text: string;
  /** A plain click on a link to a file: show it in this tab. */
  onShow: (path: string) => void;
  /** A Cmd- or Ctrl-click: open it beside, as a link. */
  onOpenBeside: (target: FileTarget) => void;
  /** A link to the web: a browser tab beside. */
  onOpenLink: (url: string) => void;
}

/** GitHub's heading ids, near enough: lower-case, punctuation out, spaces to hyphens. */
function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

const escape = MarkdownIt().utils.escapeHtml;

function toHtml(lines: TokenSpan[][]): string {
  return lines
    .map((line) =>
      line
        .map((token) => {
          const styles: string[] = [];
          if (token.color) styles.push(`color:${token.color}`);
          if (token.style && token.style & 1) styles.push('font-style:italic');
          if (token.style && token.style & 2) styles.push('font-weight:600');
          return styles.length > 0
            ? `<span style="${styles.join(';')}">${escape(token.text)}</span>`
            : escape(token.text);
        })
        .join(''),
    )
    .join('\n');
}

/**
 * markdown-it, set up the way a README expects: GitHub-flavoured tables,
 * strikethrough and autolinks, task lists, heading ids, and no raw HTML.
 * Raw HTML is off because this renders in the app's own tree, and a README
 * is something an agent wrote; markdown-it escapes it instead.
 */
function renderer(highlights: Map<string, string>): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    highlight: (code, lang) => {
      const html = highlights.get(`${lang}\u0000${code}`);
      return html ? `<pre class="code-block"><code>${html}</code></pre>` : '';
    },
  });

  md.core.ruler.push('heading_ids', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const text =
        tokens[i + 1]?.children
          ?.filter((t) => t.type === 'text' || t.type === 'code_inline')
          .map((t) => t.content)
          .join('') ?? '';
      tokens[i].attrSet('id', slug(text));
    }
  });

  // `- [ ] task` and `- [x] done`, as GitHub draws them.
  md.core.ruler.push('task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'list_item_open') continue;
      const inline = tokens[i + 2];
      const first = inline?.type === 'inline' ? inline.children?.[0] : undefined;
      if (!first || first.type !== 'text') continue;
      const match = /^\[([ xX])\]\s+/.exec(first.content);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}> `;
      inline.children!.unshift(box);
      tokens[i].attrJoin('class', 'task');
    }
  });

  return md;
}

/** The fences in a document, with the grammar each asks for. */
function fencesOf(text: string): Array<{ info: string; lang: string; code: string }> {
  return MarkdownIt()
    .parse(text, {})
    .filter((token) => token.type === 'fence')
    .map((token) => ({ info: token.info.trim().split(/\s+/)[0] ?? '', lang: fenceLanguage(token.info) ?? '', code: token.content }))
    .filter((fence) => fence.lang);
}

const isRemote = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

/**
 * A markdown file, rendered. Links to files open the way links do
 * everywhere here: a plain click shows the file in this tab, a Cmd-click
 * opens it beside. Images beside the file are read through the host.
 */
export function MarkdownView({ path, text, onShow, onOpenBeside, onOpenLink }: Props) {
  const host = useHost();
  const platform = host.window.platform();
  const container = useRef<HTMLDivElement>(null);
  const [highlights, setHighlights] = useState<{ text: string; map: Map<string, string> } | null>(null);

  // Rendered plain first, then again with the fences coloured once the
  // highlighter answers; the document is readable before that.
  useEffect(() => {
    const fences = fencesOf(text);
    if (fences.length === 0) return;
    let cancelled = false;
    void Promise.all(
      fences.map((fence): Promise<[string, string] | null> => {
        const key = `${fence.info}\u0000${fence.code}`;
        return highlight(fence.code, fence.lang).then(
          (lines) => [key, toHtml(lines)],
          () => null,
        );
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map = new Map(entries.filter((entry): entry is [string, string] => entry !== null));
      if (map.size > 0) setHighlights({ text, map });
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const html = useMemo(
    () => renderer(highlights?.text === text ? highlights.map : new Map()).render(text),
    [text, highlights],
  );

  // Images beside the file come through the host as data URLs; the page has
  // no file: access, and should not.
  const dir = dirname(path) ?? path;
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let cancelled = false;
    for (const img of root.querySelectorAll<HTMLImageElement>('img[src]')) {
      const src = img.getAttribute('src') ?? '';
      if (isRemote(src)) continue;
      void host.files.read(resolveAgainst(dir, src), 'dataUrl').then(
        (contents) => {
          if (!cancelled && contents.kind === 'dataUrl') img.src = contents.dataUrl;
        },
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [host, html, dir]);

  const onClick = (event: React.MouseEvent) => {
    const anchor = (event.target as Element).closest('a[href]');
    if (!anchor || !container.current?.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      container.current.querySelector<HTMLElement>(`[id="${id.replace(/"/g, '\\"')}"]`)?.scrollIntoView?.();
      return;
    }
    if (isRemote(href)) {
      if (/^https?:/i.test(href)) onOpenLink(href);
      return;
    }
    const target = resolveAgainst(dir, href.replace(/[#?].*$/, ''));
    if (isOpenLinkClick(event, platform)) onOpenBeside({ kind: 'file', path: target });
    else onShow(target);
  };

  return (
    <div className="markdown-view" tabIndex={0}>
      <div
        className="markdown"
        ref={container}
        onClick={onClick}
        // Rendered by markdown-it with raw HTML off: everything here is its own markup.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

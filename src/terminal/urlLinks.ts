import type { ILink, ILinkProvider } from '@xterm/xterm';
import { logicalLineAt, rangeOf, touchesRow, type RowSource } from './logicalLine';

/**
 * http(s) URLs in terminal output, as links.
 *
 * In place of xterm's web-links addon, which reads a line the terminal
 * wrapped but not one a program wrapped itself, so a URL Claude Code laid
 * out across two rows opened as its first row only. The pattern is the
 * addon's, so what counts as a URL is unchanged.
 */
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;

export function findUrls(text: string): { url: string; start: number; end: number }[] {
  return [...text.matchAll(URL_RE)].map((m) => ({ url: m[0], start: m.index, end: m.index + m[0].length }));
}

export function urlLinkProvider(
  rows: () => RowSource,
  activate: (event: MouseEvent, url: string) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = logicalLineAt(rows(), y - 1);
      const links: ILink[] = findUrls(line.text)
        .filter((hit) => touchesRow(line, hit.start, hit.end, y))
        .map((hit) => ({
          range: rangeOf(line, hit.start, hit.end),
          text: hit.url,
          activate: (event) => activate(event, hit.url),
        }));
      callback(links.length > 0 ? links : undefined);
    },
  };
}

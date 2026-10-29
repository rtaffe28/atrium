import type { CSSProperties } from 'react';
import type { HighlightReply, HighlightRequest, TokenSpan } from './worker';

export type { TokenSpan };

/** Shiki's FontStyle bits. */
export const ITALIC = 1;
export const BOLD = 2;
export const UNDERLINE = 4;

/** A token's colour and font style, as an element's style. */
export function styleOf(token: TokenSpan): CSSProperties | undefined {
  if (!token.color && !token.style) return undefined;
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  if (token.style) {
    if (token.style & ITALIC) style.fontStyle = 'italic';
    if (token.style & BOLD) style.fontWeight = 600;
    if (token.style & UNDERLINE) style.textDecoration = 'underline';
  }
  return style;
}

/** Past this, a file is shown plain: tokenising it would take seconds. */
export const MAX_HIGHLIGHT_CHARS = 512 * 1024;
/** A line this long is a minified bundle, not something to tokenise. */
export const MAX_LINE_CHARS = 10_000;

/** Whether the text is worth sending to the highlighter at all. */
export function canHighlight(text: string): boolean {
  if (text.length > MAX_HIGHLIGHT_CHARS) return false;
  let start = 0;
  for (;;) {
    const end = text.indexOf('\n', start);
    if ((end < 0 ? text.length : end) - start > MAX_LINE_CHARS) return false;
    if (end < 0) return true;
    start = end + 1;
  }
}

/**
 * The highlighter as a service: one worker, started on first use, and a
 * promise per request. Where there is no Worker — a test, a host without
 * one — every request rejects at once, and the caller shows plain text.
 */
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (lines: TokenSpan[][]) => void; reject: (error: Error) => void }
>();

function start(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (event: MessageEvent<HighlightReply>) => {
    const reply = event.data;
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if ('lines' in reply) request.resolve(reply.lines);
    else request.reject(new Error(reply.error));
  };
  worker.onerror = (event) => {
    for (const request of pending.values()) request.reject(new Error(event.message));
    pending.clear();
  };
  return worker;
}

/** The last few results, so a tab switched back to is coloured at once. */
const CACHE_SIZE = 16;
const cache = new Map<string, TokenSpan[][]>();

function remember(key: string, lines: TokenSpan[][]): void {
  cache.delete(key);
  cache.set(key, lines);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

export function highlight(text: string, lang: string): Promise<TokenSpan[][]> {
  const key = `${lang}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const target = start();
  if (!target) return Promise.reject(new Error('No highlighter here'));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, {
      resolve: (lines) => {
        remember(key, lines);
        resolve(lines);
      },
      reject,
    });
    const request: HighlightRequest = { id, text, lang };
    target.postMessage(request);
  });
}

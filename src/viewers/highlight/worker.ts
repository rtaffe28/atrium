import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

/**
 * The highlighter, off the UI thread.
 *
 * Shiki tokenises with VS Code's own TextMate grammars and colours with VS
 * Code's own themes, so a file here is coloured token for token as it is
 * there. Tokyo Night is the palette index.css already uses. One instance,
 * one grammar cache, loaded on first use; a grammar on a bad file can take a
 * second, and terminals must not stall for it.
 */

export interface HighlightRequest {
  id: number;
  text: string;
  lang: string;
}

export interface TokenSpan {
  text: string;
  color?: string;
  /** Shiki's FontStyle bits: 1 italic, 2 bold, 4 underline. */
  style?: number;
}

export type HighlightReply = { id: number; lines: TokenSpan[][] } | { id: number; error: string };

const THEME = 'tokyo-night';

let ready: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

function highlighter(): Promise<HighlighterCore> {
  ready ??= createHighlighterCore({
    themes: [bundledThemes[THEME]],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  return ready;
}

// A worker's global, typed as one: this file is compiled with the DOM lib.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HighlightRequest>) => void) | null;
  postMessage(message: HighlightReply): void;
};

scope.onmessage = async (event) => {
  const { id, text, lang } = event.data;
  try {
    const core = await highlighter();
    const grammar = (bundledLanguages as Record<string, LanguageInput | undefined>)[lang];
    if (!grammar) throw new Error(`No grammar for ${lang}`);
    if (!loaded.has(lang)) {
      await core.loadLanguage(grammar);
      loaded.add(lang);
    }
    const lines = core
      .codeToTokensBase(text, { lang, theme: THEME })
      .map((line) =>
        line.map((token) => ({ text: token.content, color: token.color, style: token.fontStyle })),
      );
    scope.postMessage({ id, lines });
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};

import { bundledLanguagesInfo } from 'shiki/langs';
import { describe, expect, it } from 'vitest';
import { KNOWN_LANGUAGES, isImage, languageFor, viewerFor } from './kind';

describe('what a file is', () => {
  it('tells markdown and images from code', () => {
    expect(viewerFor('/repo/README.md')).toBe('markdown');
    expect(viewerFor('/repo/docs/plan.markdown')).toBe('markdown');
    expect(viewerFor('/repo/build/icon.png')).toBe('image');
    expect(viewerFor('/repo/public/favicon.svg')).toBe('image');
    expect(viewerFor('/repo/src/App.tsx')).toBe('code');
    expect(viewerFor('/repo/LICENSE')).toBe('code');
    expect(isImage('a.JPG')).toBe(true);
    expect(isImage('a.jpg.txt')).toBe(false);
  });

  it('names the grammar by extension', () => {
    expect(languageFor('/repo/src/App.tsx')).toBe('tsx');
    expect(languageFor('/repo/src/store.ts')).toBe('typescript');
    expect(languageFor('/repo/scripts/build.mjs')).toBe('javascript');
    expect(languageFor('/repo/electron/shell/hook.sh')).toBe('shellscript');
    expect(languageFor('/repo/electron/shell/zshenv.zsh')).toBe('shellscript');
    expect(languageFor('/repo/src/index.css')).toBe('css');
    expect(languageFor('/repo/a.yml')).toBe('yaml');
    expect(languageFor('/repo/a.UNKNOWN')).toBeNull();
    expect(languageFor('/repo/LICENSE')).toBeNull();
  });

  it('names the grammar by the whole name where there is no extension', () => {
    expect(languageFor('/repo/Dockerfile')).toBe('docker');
    expect(languageFor('/repo/Makefile')).toBe('make');
    expect(languageFor('/repo/package.json')).toBe('json');
    expect(languageFor('/repo/tsconfig.json')).toBe('jsonc');
    expect(languageFor('/home/me/.zshrc')).toBe('shellscript');
  });

  it('reads a shebang when the name says nothing', () => {
    expect(languageFor('/repo/bin/atrium', '#!/bin/sh\necho hi')).toBe('shellscript');
    expect(languageFor('/repo/bin/tool', '#!/usr/bin/env python3\n')).toBe('python');
    expect(languageFor('/repo/bin/tool', '#!/usr/bin/env -S node --enable-source-maps\n')).toBe('javascript');
    expect(languageFor('/repo/bin/tool', 'no shebang')).toBeNull();
    // The name wins over the shebang.
    expect(languageFor('/repo/tool.rb', '#!/usr/bin/env python3\n')).toBe('ruby');
  });

  it('only names grammars Shiki ships', () => {
    const ids = new Set<string>();
    for (const info of bundledLanguagesInfo) {
      ids.add(info.id);
      for (const alias of info.aliases ?? []) ids.add(alias);
    }
    const missing = [...KNOWN_LANGUAGES].filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });
});

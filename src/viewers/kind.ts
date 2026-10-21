/**
 * What a file is, from its name and its first line.
 *
 * Which viewer shows a file, and which grammar colours it. Extension first,
 * then the whole name for the files that have none, then a shebang. Unknown
 * is plain text, coloured as nothing, which is the honest answer.
 */

export type ViewerKind = 'markdown' | 'image' | 'code';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif']);
const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx']);

/** Shiki's language ids, by extension. */
const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'jsonc', json5: 'json5', jsonl: 'json',
  md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown', mdx: 'mdx',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less', styl: 'stylus',
  html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte', astro: 'astro',
  py: 'python', pyi: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', kts: 'kotlin', swift: 'swift', scala: 'scala', groovy: 'groovy', gradle: 'groovy',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  m: 'objective-c', mm: 'objective-cpp', cs: 'csharp', fs: 'fsharp', fsx: 'fsharp',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', fish: 'fish', ps1: 'powershell',
  bat: 'bat', cmd: 'bat',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  xml: 'xml', plist: 'xml', xsl: 'xml', svg: 'xml',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'proto', prisma: 'prisma',
  lua: 'lua', php: 'php', pl: 'perl', pm: 'perl', r: 'r', dart: 'dart',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', ml: 'ocaml', mli: 'ocaml',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure', el: 'emacs-lisp', lisp: 'lisp', scm: 'scheme',
  vim: 'viml', tex: 'latex', sty: 'latex', bib: 'bibtex',
  diff: 'diff', patch: 'diff', dockerfile: 'docker', mk: 'make', cmake: 'cmake',
  nix: 'nix', zig: 'zig', tf: 'terraform', hcl: 'hcl', jl: 'julia', nim: 'nim', v: 'v',
  csv: 'csv', tsv: 'tsv', log: 'log', env: 'dotenv', http: 'http', rst: 'rst', adoc: 'asciidoc',
  wgsl: 'wgsl', glsl: 'glsl', hlsl: 'hlsl', s: 'asm', asm: 'asm', sol: 'solidity', move: 'move',
  cue: 'cue', jsonnet: 'jsonnet', nginx: 'nginx', vb: 'vb',
};

/** By the whole name, lower-cased, for files whose name is the type. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'make',
  gnumakefile: 'make',
  'cmakelists.txt': 'cmake',
  '.env': 'dotenv',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  '.zshrc': 'shellscript',
  '.zshenv': 'shellscript',
  '.bashrc': 'shellscript',
  '.bash_profile': 'shellscript',
  '.profile': 'shellscript',
  'go.mod': 'go',
  'cargo.lock': 'toml',
  'pipfile': 'toml',
  'gemfile': 'ruby',
  rakefile: 'ruby',
  'package.json': 'json',
  'tsconfig.json': 'jsonc',
  '.oxlintrc.json': 'jsonc',
};

/** By the interpreter a shebang names. */
const BY_INTERPRETER: Record<string, string> = {
  node: 'javascript', deno: 'typescript', bun: 'typescript',
  python: 'python', python3: 'python',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', fish: 'fish',
  ruby: 'ruby', perl: 'perl', php: 'php', lua: 'lua', osascript: 'applescript',
};

function nameOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

export function isImage(path: string): boolean {
  return IMAGE.has(extensionOf(nameOf(path)));
}

export function viewerFor(path: string): ViewerKind {
  const extension = extensionOf(nameOf(path));
  if (IMAGE.has(extension)) return 'image';
  if (MARKDOWN.has(extension)) return 'markdown';
  return 'code';
}

/**
 * The grammar to colour a file with, or null for plain text.
 *
 * `head` is the start of the file, for the shebang of a script with no
 * extension — `bin/atrium` says what it is on its first line.
 */
export function languageFor(path: string, head = ''): string | null {
  const name = nameOf(path);
  if (name in BY_NAME) return BY_NAME[name];
  const extension = extensionOf(name);
  if (extension in BY_EXTENSION) return BY_EXTENSION[extension];
  const shebang = /^#!\s*(?:\/\S*\/)?(?:env\s+(?:-S\s+)?)?([\w.-]+)/.exec(head.split('\n', 1)[0] ?? '');
  if (shebang) {
    const interpreter = shebang[1].replace(/[\d.]+$/, '') || shebang[1];
    if (interpreter in BY_INTERPRETER) return BY_INTERPRETER[interpreter];
  }
  return null;
}

/** What a markdown fence's info string names, as a grammar. */
export function fenceLanguage(info: string): string | null {
  const word = info.trim().split(/\s+/)[0];
  if (!word) return null;
  return languageFor(`x.${word}`) ?? word;
}

/** Every grammar this module can name, for the test that checks Shiki has them. */
export const KNOWN_LANGUAGES = new Set([
  ...Object.values(BY_EXTENSION),
  ...Object.values(BY_NAME),
  ...Object.values(BY_INTERPRETER),
]);

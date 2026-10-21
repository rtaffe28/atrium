# A file viewer: widgets in the pane slot, and the channel an agent opens them through

**Status: the tab, the tree, the viewers and the channel are built; the
sandbox is ahead.** Stages 15.1 and 15.2 landed as planned. The viewers of
15.3 were built in-tree first, ahead of `14`'s runner, because a markdown file
shown as its source was not a viewer; see *Where this stands* below. A tab
can be a terminal or a browser. This plan adds a third kind: a file, or a folder with its tree beside whichever of
its files you are reading. What renders the file is a widget in the sense
`14-composable-rail.md` defines: code that renders in the rail's sandbox, reads
only what the frame hands it, and can be replaced per file type by one an agent
wrote. The tree is ours, like the tab bar. The colouring is VS Code's, because
the grammars and the theme are VS Code's. A path in a terminal opens with the
same Cmd-click that opens a link, into the same split. And the agent asks for a
file to be shown the same way it reports anything else to Atrium: through the
`atrium` command on its PATH, into its own state directory, and no further.

`11-file-explorer.md`, on the `files-explorer` branch, is the previous attempt:
a tree beside a plain text pane, built and then taken off `main` (`cd967d5`)
because it did nothing `ls` and `cat` could not. Its list of what was missing —
highlighting, watching for changes, seeing what an agent changed — is this
plan's starting point. What it did not have was a reason for the viewer to be
anything other than one more hardcoded component. The rail plan supplies that
reason.

## Why

Three things, in the order they matter.

**Agents write things you read.** A plan, a README, a migration, a review, a
folder of them. Today you read them in the terminal through `cat`, or alt-tab
to an editor, and either way the file you are reading is one the agent is
still editing. A pane that shows the file beside the agent writing it, coloured
as an editor would colour it and refreshing as it changes, is the reading half
of a workflow whose writing half this app already hosts.

**The viewer is the first thing people will ask an agent to change.** "Show
CSVs as a table." "Collapse the headings." "Render the mermaid block." Every one
of those is a viewer for one file type, which is exactly the size of thing an
agent writes well and exactly the thing `14` built a sandbox for. A viewer that
is a widget gets that for free; a viewer that is a component in
`src/components/` gets a feature request.

**The agent should be able to open it.** An agent that has just written
`docs/plan/active/15-file-viewer.md` should be able to put it in front of you
without you finding it in a tree. That needs a channel from the agent to
Atrium, and there already is one: the state directory the shims write into.
This plan gives it a verb.

## The three parts

| | What | Owned by |
|---|---|---|
| The **file tab** | A third `TabKind`. It holds a path, or a folder and a path, persists them, and is placed, dragged and closed like any other tab. The folder's tree is part of it | the app, in-tree |
| The **viewer** | What renders inside it, chosen by file pattern. Built-ins for code, markdown and images, shipped as widgets; replaceable by one from `widgets/` | the widget, in the sandbox |
| The **channel** | How an agent asks for a file to be shown or says which files it is working on, and the rail widget that shows them | the `atrium` command, the state directory, and `14`'s SDK |

The split follows `14` exactly. The tab and its tree are frame; the viewer is
body; the data — the file's text, the highlighter, git — reaches the body only
through the SDK.

## The file tab

```ts
type TabKind = 'terminal' | 'browser' | 'file';

interface Tab {
  // …
  /** File tabs only. Absolute. Absent in a folder tab until a file is chosen. */
  path?: string;
  /** A folder whose tree is shown beside the file. Absent means no tree. */
  root?: string;
  /** A line to land on, from `path:12` or a link. Not persisted. */
  line?: number;
  /** A viewer the user pinned for this tab with "Open with…". Absent means the pattern decides. */
  viewer?: string;
}
```

The title is the file's name, or the folder's while no file is chosen; the
path, relative to the session's directory, is the tooltip. `path` and `root`
are saved with the workspace and the file is read again on restore — unlike
`11`, which judged the open file not worth restoring, because here the file
*is* the tab. A path that no longer exists restores as a tab
saying so, with the path, rather than being dropped: the agent may be about to
write it back.

**Where it lands.** `openFileBeside(sessionId, groupId, path)` is
`openLinkBeside` for files: the pane to the right if there is exactly one,
otherwise a split. One difference: a file already open in the session is
raised rather than opened twice. Reading the same plan in two tabs is never
what anyone meant.

**Ways in**, cheapest first:

1. `atrium open <path>` from an agent or a shell in any tab, on a file or a
   folder. The tab lands beside the pane that asked. See *The channel*.
2. **Cmd- or Ctrl-click on a path in a terminal, exactly as a link.** The
   modifier is `isOpenLinkClick`, the placement is `openFileBeside`, and the
   plumbing is `PaneView`'s `onOpenLink` with a second branch: a URL goes to a
   browser tab, a path to a file tab, in the pane to the right or a new split.
   xterm's link provider is taught path-shaped tokens — `src/foo.ts`,
   `./README.md:12`, `~/x`, `/abs` — resolved against the tab's `cwd`, which
   the shell already reports on every prompt. Existence is checked on hover
   and cached, so a word that merely looks like a path is not underlined.
   Agents print paths constantly; this is the gesture that makes them links.
3. A link in a viewer, with a browser tab's rules: a plain click on
   `[plan](./15-file-viewer.md)` shows that file in this tab, Cmd- or
   Ctrl-click opens it beside, and `https://` opens a browser tab. All go
   through the frame.
4. A row in the folder tree, with the same two clicks. Below.
5. `Mod+O`, a native file picker, into the focused pane; `Mod+Shift+O`, a
   folder picker; and a third glyph in the title bar beside the terminal and
   the globe, which opens the file picker.
6. A row in the rail's files widget. Stage 5.
7. Fuzzy open, `Mod+P`. Later, with the palette in `10-keyboard.md`, because
   it needs an index of the directory and the palette is where that index
   would also be used.

`11` argued fuzzy open should come first because it makes the tree optional.
In this app the agent is the one who knows which file matters, so the
agent-driven ways in come first — the command, and the paths it prints. The
tree is for when you are the one looking: a folder of plans, a directory the
agent just filled.

**Live.** Agents rewrite files constantly, and `11` was right that a stale
view is worse than none. The host watches the file's *directory* and filters
by name, because editors and agents write-then-rename and a watch on the inode
goes quietly stale on the first save. Changes are debounced, re-read, and
dropped if the content hash did not move. The viewer keeps its scroll position
anchored to the top visible line; the tab shows a brief mark, the same one a
terminal gets for a bell, so a file changing behind you is visible without
being loud. A deleted file says "deleted" and stays open. The watch lives as
long as the tab does, not only while it is in front, so a background tab can
show the mark; the viewer itself is mounted only while active, like a
terminal's xterm, and the frame keeps the last text so switching back is
instant.

**Limits.** Text is read up to 2 MB, then truncated with a notice and an
*Open externally*. Highlighting stops at 512 KB or at a line over 10,000
characters — a minified bundle is not something to tokenise. A NUL in the
first 8 KB means binary: size, type, open externally. Images by extension get
the image viewer.

## The folder tree

A tab opened on a folder — `atrium open docs/plan/`, `Mod+Shift+O`, or *Open
folder…* in the frame menu — shows the folder's tree beside its body. A click
on a file shows it in this tab, with the tree still there; Cmd- or Ctrl-click
opens it beside as a plain file tab, so a browsing tab stays a browsing tab.
*Show tree* on any file tab adds one, rooted at the session's directory, or
at the file's own if it lives outside that. The tree collapses to a strip and
remembers its width.

**The tree is frame, not body.** It is `src/components/FolderTree.tsx`,
revived from `FilesView.tsx` at `07b058e`, in the app's own React tree and
not in a widget — the call `14` makes for `atrium:sessions`, for the same
reasons: it is navigation rather than content, it reads the host directly,
and it is a thing that still works when the runner does not. Nothing a widget
sees changes: `useFile()` is still one file.

What it does, most of which `34feebb` already did:

- **Lazy.** A directory is listed when expanded, so opening a repo does not
  walk it. Directories first, then files, both alphabetical. `.git`,
  `node_modules` and `.DS_Store` are never shown; other dotfiles are, because
  `.claude/`, `.github/` and `.env` are things agents write and people look
  for. A directory over 2,000 entries shows the first 2,000 and says how many
  more.
- **Live.** Every expanded directory is watched through the same `watch` the
  viewer uses, and released when collapsed. An agent writing ten files into
  `docs/` is ten rows appearing, which is `11`'s point from the other side: a
  tree that does not update is worse than none.
- **Out of the root.** The header is a breadcrumb of the root; a segment
  re-roots the tree there, and a parent affordance goes up one. `11` listed
  this as missing; it is a header.
- **Reveals the open file.** The tree expands to the current file's ancestors
  and marks it, so a file opened from the terminal or by the agent is found
  in context.
- **Keyboard.** Up and down move, left and right collapse and expand, Enter
  opens — only while the tree has focus, so the terminal's rule in
  `10-keyboard.md` is untouched.
- **Marks what changed.** Modified and untracked files marked, ignored ones
  dimmed, once the `GitDriver` is back in stage 5. That is the tree `11`
  wanted, and the reason to look at one in this app.

`root` is saved with the tab, so a folder tab restores as one. Which
directories were expanded is not, and reveal re-expands the ones that matter.

## The viewer is a widget

This is the plugin experience, and the whole of it is: **a viewer is a widget
whose manifest says `slot: "pane"` and which files it is for.**

```jsonc
// ~/.config/atrium/widgets/csv-table/widget.json
{
  "name": "csv-table",
  "title": "CSV",
  "slot": "pane",
  "matches": ["*.csv", "*.tsv"],
  "entry": "index.tsx",
  "sdk": 1,
  "permissions": { "files": "self" }
}
```

```tsx
import { useFile, Code, Toolbar } from '@atrium/widget';

export default function CsvTable() {
  const file = useFile(); // { path, text, language, line, changed, … }
  const rows = file.text.split('\n').map((row) => row.split(','));
  if (rows.length < 2) return <Code file={file} />; // the floor, when it is not a table
  return (
    <>
      <Toolbar>{rows.length} rows</Toolbar>
      <table>
        {rows.map((cells, i) => (
          <tr key={i}>{cells.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
        ))}
      </table>
    </>
  );
}
```

Everything in `14` applies unchanged: the same runner page, the same sandboxed
iframe with an opaque origin and no bridge, the same protocol, the same
esbuild in main, the same `.atrium/last-error.txt` loop, the same approval
keyed by the permission block. What the pane slot changes:

| Rail slot | Pane slot |
|---|---|
| Sized by the widget, clamped by the manifest; `resize` messages | Fills the pane. No `resize`, no `size` in the manifest |
| Props from `rail.json` | Props are the file: `useFile()` |
| Always mounted while the rail is shown | Mounted while the tab is active |
| Frame: title, icon, collapse, reorder, remove, menu | Frame: the tab itself, plus a menu — *Open with…*, *Show tree*, *Open folder…*, *Open externally*, *Fork this viewer*, *Reload* |

### The SDK, for viewers

Additions to `@atrium/widget`. The rules are `14`'s: handed in, never
imported; async and serialisable; every request checked against the manifest
by the frame.

- `useFile()` — the file this tab is showing: `path`, `text`, `language`
  (from the extension, a shebang or a modeline), `line`, `truncated`,
  `binary`, and `changed`, a counter that moves on every rewrite so a viewer
  can react. Pushed as a `data` topic; the viewer never asks the disk for it.
- `useHighlight(text, language)` — tokens for the text, in the app's theme. A
  request to the frame; see *Where the colouring comes from*. Cached by
  content hash, so a rewrite that changed one line costs one line.
- `useGit(path)` — later: the file at HEAD and its hunks, for a diff viewer.
- `actions.showFile(path)` and `actions.openFile(path)` — this tab, or a tab
  beside it: a plain click and a Cmd-click, as a browser tab's links. Relative
  paths resolve against this file. `actions.openUrl` as in `14`.
- `file.read(relativePath, as: 'text' | 'dataUrl')` — a sibling of the file,
  for a markdown image or an include. Scoped by the manifest's `files` grant:
  `self` (nothing but the open file; the default), `siblings` (the open file's
  directory and below), `session` (the session's directory and below). A file
  opened from outside the session's directory gets `siblings` at most. The
  frame resolves the path and checks it; the runner is never trusted to.

**Components.** The kit is where "ease of use" lives, so that an agent writing
a viewer in thirty lines gets what an editor's view has and never reimplements
it:

- `<Code file={…} />` — highlighted, with line numbers, a soft-wrap toggle,
  go-to-line, find (`Mod+F` while the viewer has focus), copy, and scroll
  kept across rewrites. `line` from the file scrolls to and marks a line. Mono
  font and size follow the terminal's setting, through the theme, so a pane of
  code and a pane of terminal match.
- `<Markdown file={…} />` — GitHub-flavoured: tables, task lists,
  strikethrough, autolinks, heading anchors, a heading outline. Fenced code
  goes through `useHighlight` with the fence's language. Relative links show or
  open files through the two actions; relative images are fetched through
  `file.read` as data URLs, which the runner's CSP allows with `img-src data:`.
  Remote images — badges, mostly — show their alt text until `14`'s `net`
  permission exists. Raw HTML is off by default and DOMPurify-sanitised when a
  viewer asks for it; inside the sandbox a `<script>` in a README could do
  nothing, but it could also do nothing useful.
- `<Toolbar>`, `<Empty>`, and `14`'s `Row`, `Stack`, `Badge`, `Button`.

The built-in code viewer is `<Code file={useFile()} />` with a toolbar. The
built-in markdown viewer is `<Markdown file={useFile()} />` with an outline
and a *Source* toggle. They are short on purpose: they are what an agent will
copy.

### Built-ins are widgets, and forkable

`14` keeps `atrium:sessions` in-tree for drag integration. Viewers have no such
need, so **the built-ins run in the sandbox**, prebuilt by Vite from
`src/rail/viewers/` the way the mock's example widgets are:

| Built-in | Matches | Shows |
|---|---|---|
| `atrium:code` | everything text | the kit's `<Code>` |
| `atrium:markdown` | `*.md`, `*.markdown`, `*.mdx` | rendered, with the outline; `files: "siblings"` for its images |
| `atrium:image` | `*.png *.jpg *.jpeg *.gif *.svg *.webp` | the image, fit or 1:1, and its dimensions |
| `atrium:binary` | what the read says is binary | size, type, open externally |
| `atrium:text` | the floor | a plain `<pre>`, live. **In-tree, not a widget**: it is what shows when the runner cannot build or load a viewer, and the thing that cannot fail must not depend on the thing that can |

**Where this stands (October 2026).** The built-ins exist and are in-tree:
`src/viewers/kind.ts` says what a file is, `CodeView`, `MarkdownView` and
`ImageView` show it, and the highlighter already runs as the service
described below, in a worker the app owns. They were built this way first
because the floor was not enough to use, and the runner did not exist to put
them in. Moving them into the sandbox when it does is a move, not a rewrite:
the registry is the seam, the SDK's `<Code>` and `<Markdown>` are these
components with the host swapped for the protocol, and nothing they need is in
the app tree. Until then *Fork this viewer* and `matches` wait with them.

Running the built-ins in the sandbox is the honesty check `14` wanted for the
sessions projection: if the SDK cannot express the built-in markdown viewer, it
cannot express the one an agent will write either. It is also what makes
**Fork this viewer** work. The frame's menu copies a built-in's source — the
source ships beside the bundle — into `widgets/<name>/`, pins it for this
file's pattern, and opens a session in that directory with the default agent
and `AGENTS.md` in front of it. "Make the headings collapsible" is then a
sentence to the agent, and the open tab hot-reloads when it saves. That is the
plugin experience: not an API to learn, but a working viewer to change.

**Which viewer opens a file.** Most specific wins: a pin in `viewers.json` for
this pattern, then a user widget whose `matches` fits (longest glob first),
then a built-in, then `atrium:text`. *Open with…* in the frame lists every
viewer that matches, and any viewer at all, and writes the pin. `viewers.json`
is loaded, validated and kept-last-good exactly as `rail.json` is.

```jsonc
// ~/.config/atrium/viewers.json
{ "version": 1, "pins": { "*.md": "my-markdown", "*.csv": "csv-table" } }
```

A widget with `slot: "pane"` and no `matches` is a tab with no file: a
dashboard. That is `14`'s R3 answered — widgets expand into a pane by being
allowed to live there — and it costs nothing here beyond letting `useFile()`
be absent.

## Where the colouring comes from

"VS Code style" is literal. Shiki tokenises with VS Code's own TextMate
grammars and colours with VS Code's own themes, so a TypeScript file in a
viewer is coloured token for token as it is in VS Code with the same theme
loaded. And the theme is already chosen: `index.css`'s accents — `#7aa2f7`,
`#9ece6a`, `#e0af68`, `#f7768e`, `#bb9af7` — are Tokyo Night's blue, green,
yellow, red and magenta, and Shiki ships `tokyo-night`. A viewer coloured by
it looks native without a theme being authored.

**It is a service, not a library.** The highlighter runs once, in a Web Worker
the frame owns, with the oniguruma engine's wasm and grammars loaded on first
use. A viewer asks for tokens and gets lines of `{ text, color }` spans back,
which it can decorate — line numbers, folds, a marked line — without parsing
HTML. Three reasons it lives in the frame rather than in each iframe:

- One wasm instance and one grammar cache, instead of one per open tab.
- Widgets stay a few kilobytes, which keeps `14`'s "no npm imports in v1"
  comfortable: the heavy thing a viewer would have imported is handed in.
- The frame decides the theme, so every viewer matches the rail, and a second
  theme later is a second Shiki theme in one place.

The worker keeps it off the UI thread, which matters: a grammar on a bad file
can take a second, and terminals must not stall for it. The engine is the wasm
one. Shiki's JavaScript regex engine avoids the binary but rejects some
grammars, and the grammars were written against oniguruma; packaging a wasm
asset is the easier problem, and it is the problem node-pty's helper already
posed in `04-roadmap.md`. Verify it under `file://` and asar before trusting
it.

Language comes from the extension, then a shebang, then a modeline; markdown
fences name their own. Unknown is plain text, coloured as nothing, which is the
honest answer.

## The channel

This is the part the rail plan started and this one finishes. `14` proposed
`atrium report <key> <value>`: a command on the tab's PATH that says something
about the session, into `$ATRIUM_SESSION_STATE`, the directory the shims
already use to say which conversation a tab is on. This plan ships that
command and gives it a second verb.

```
atrium open <path | url>      show a file or folder in a tab beside this one, or a URL in a browser tab
atrium report <key> <value>   say something about this session, for the rail to show
atrium --help                 written for an agent to read
```

**How it works.** The command resolves a relative path against `$PWD`, writes
one small file into `$ATRIUM_SESSION_STATE/requests/` — first line the verb,
the rest the argument, no JSON and so no escaping to get wrong, which is the
lesson of `hook.sh` — and exits 0. The main process watches `sessions/` and
forwards each request to the renderer tagged with the tab it came from, which
it knows from the directory name, then deletes the file. The renderer hands it
to the `SessionStore`, which opens the tab beside the pane that asked. Without
`$ATRIUM_SESSION_STATE` — a shell outside Atrium — the command says so on
stderr and exits 1.

One amendment to `14`: it had the command write `meta.json` itself. Here every
verb is a request file, and main is the only thing that writes JSON, for the
same reason `hook.sh` only ever reads one flat string: a shell script
producing JSON is a thing to remove, not to be careful about.

Written files rather than an escape sequence, although the terminal is right
there and iTerm2's tools do speak that way, because the file channel is proven
from everywhere a request can come from: a Claude hook with its stdout
captured, a Bash tool call under a sandbox, a script. It also keeps requests
out of the scrollback, where a restore would replay them.

**What is provable about it.** The argument is `14`'s, applied in the other
direction. There, code the agent wrote runs where it cannot reach anything.
Here, the agent cannot run anything at all: the channel carries a closed set
of verbs, each is a request the app validates and may refuse, and nothing
flows back. In full:

| An agent can | An agent cannot |
|---|---|
| Open a file or a folder in a tab beside its own pane | Open anything in another session, or at any particular position |
| Open a URL as a browser tab, which a Cmd-click on a link it printed already does | Run a command, write into a terminal, or close a tab |
| Say something about its session, as free text, for a widget to show | Read anything back: no scrollback, no sessions, no reply. The exit code says the request was written, not what happened to it |
| | Make Atrium read a file into anywhere but a sandboxed viewer, with the size and binary checks applied |

A request for a path that does not exist, is neither a file nor a directory,
or is over the limit opens nothing and leaves a line in the tab's state log. Unknown verbs
are logged and ignored, so an older app and a newer command fail quietly
rather than strangely. Windows has no shims today and so no channel; that is
the existing gap, not a new one.

What this is not: a sandbox around the agent process. The agent already has
the user's shell and could write into another tab's state directory if it
cared to. The property here is narrower and more useful: *nothing the agent
can write is interpreted as code, and nothing it can ask for exceeds what the
user could do with a click*.

### The rail half

The rail shows what the agent is working on, and clicking a file opens the
viewer. That is the part of this plan that sits on the rail, and it is one
widget.

**`atrium:files`**, a built-in rail widget showing, for the active session:
files open in viewer tabs, files the agent reported, and files git says are
modified or untracked under the session's directory. Each row opens or raises
its tab through `actions.openFile`. It reads one new topic,
`useSessionFiles(sessionId)`, which the frame assembles from the tabs, from
what `report` said, and from a restored `GitDriver` — the one `11` said
wanted a caller. Running in the sandbox beside the viewers, it is the proof
that a widget on the rail and a widget in a pane share one SDK.

Two ways a file gets reported. **Any agent:** `atrium report touched <path>`,
which is what `AGENTS.md` will tell it to do when it finishes writing
something. **Claude specifically:** a `PostToolUse` hook for `Edit` and
`Write` in the settings file the shim already passes, reporting the tool's
`file_path` the same way. The second is the kind of Claude-only hook
`12-agent-state.md` took out, and the same caveat holds: it is a convenience
over git status, not the source of truth, and nothing in the rail should look
wrong for an agent without it.

## Fit with the host seam

`FileDriver` grows back to what `34feebb` built and a little past it — reading
was not speculative then and is not now:

```ts
interface FileDriver {
  chooseDirectory(): Promise<string | null>;
  chooseFile(): Promise<string | null>;
  /** Size, kind and mtime, or null for nothing there. */
  stat(path: string): Promise<FileStat | null>;
  /** Text by default; a data URL for images. Carries the truncated and binary flags, as before. */
  read(path: string, as?: 'text' | 'dataUrl'): Promise<FileContents>;
  /** A file: changed or deleted. A directory: its listing changed. Debounced; the directory is watched, not the inode. */
  watch(path: string, handler: (event: FileEvent) => void): Unsubscribe;
  /** For the tree and the rail widget; later, quick open. */
  list(dir: string): Promise<FileEntry[]>;
  /** The OS's choice of editor. */
  openExternally(path: string): Promise<void>;
}
```

with a capability, `files: boolean`. `ElectronHost` is true, backed by
`electron/files.ts` revived from the branch plus `fs.watch` subscriptions
pushed on `files:changed`. `MockHost` is also true, with an in-memory tree a
few directories deep, and its scripted agent rewrites one file and adds
another on a beat, so both live paths are exercised in the design loop and not
only in Electron. The test host sets it false and asserts the picker, the glyph and
the path links are absent, and that a restored file tab says the host cannot
read files. That keeps `06-host-interface.md`'s point: `files: false` proves
degradation.

Requests reach the store through the session driver, not a new member of
`Host`: `ElectronSessionDriver` subscribes to `bridge.agent.onRequest` and
calls `SessionStore.receiveRequest(tabId, request)`; the mock's script calls
the same method on a beat, so "the agent opened the plan" is part of the
browser-tab demo.

## What it should not become

**An editor.** `11`'s argument stands: undo, dirty state, conflicts with an
agent writing the same file, autosave, a save dialog. *Open externally* is the
door to one, and the terminal beside the viewer contains `vim` and an agent
that edits on request.

**A file manager.** The tree shows; it does not create, rename, delete or
move. Each of those is one command in the terminal beside it or a sentence to
the agent, and a tree that can delete is a tree you have to be careful around.

## Stages, and where they sit against the rail's

The first two stages need nothing from `14`, and they are what makes the
channel usable weeks before the sandbox exists. The third gives `14`'s runner
its first real customer; a file viewer tests a widget runtime harder than a
list of pull requests does.

| Order | Plan | Stage |
|---|---|---|
| 1 | 15.1 ✅ | **The file tab, the tree and the seam.** `'file'` in `TabKind`, `path` and `root` on the tab, `FileDriver` and `files`, `electron/files.ts` and the mock tree, `openFileBeside`, paths in terminals that Cmd-click into a split exactly as links do, `Mod+O`, `Mod+Shift+O` and the glyph, the folder tree — lazy, live, breadcrumb, keyboard, reveal — persistence, and `atrium:text` in-tree with live update. Tests: open, restore, degrade |
| 2 | 15.2 ✅ | **The channel.** `electron/shell/atrium.sh` with `open` and `report` and a `--help` written for an agent; the requests directory, the watcher in main, `agent:request`, `receiveRequest`; `open` on a file, a folder or a URL. The dogfood moment: "open the plan you just wrote" |
| 3 | 14.1 | The frame |
| 4 | 14.2 | The runner and the SDK |
| 5 | 15.3 ◐ | **Colour.** *Built in-tree ahead of the runner: the worker, language detection, the size policy, and the code, markdown, image and binary viewers.* Still to do with 14.2: the pane slot in the runner — `useFile`, focus, key forwarding — and `useHighlight`, `<Code>` and `<Markdown>` in the kit, with the built-ins moved into the sandbox |
| 6 | 14.3–14.5 | Widgets from disk, the spec file, permissions |
| 7 | 15.4 | **Viewers from disk.** `slot` and `matches` in the manifest, precedence, `viewers.json`, *Open with…*, the `files` grant and its scope check, *Fork this viewer* |
| 8 | 14.6 + 15.5 | **The agent loop, and the rail half.** `atrium:files`, `useSessionFiles`, the `GitDriver` restored and the tree's git marks, `touched` by command and by hook, the viewer section of `AGENTS.md` |
| 9 | later | `atrium:diff` against HEAD, which replaces the roadmap's "diff review pane"; `Mod+P` with the palette; a tree row dragged to a pane edge to open it there, or onto a terminal to type its path; a file or folder dropped in from the OS; mermaid and maths in `<Markdown>`; remote images once `14` has `net`; find across frames |

## Open questions

- **V1: tokens or HTML across the protocol.** Tokens let a viewer decorate;
  HTML is smaller and Shiki produces it directly. Measure both on a
  20,000-line file before choosing; the SDK can offer both if the cost is a
  flag.
- **V2: keys inside the sandbox.** `Mod+W` pressed in a viewer must close the
  tab, and a sandboxed iframe's `keydown` does not reach the app. The runner
  forwards modifier chords to the frame as a `key` message. This belongs to
  `14`, since every widget has it, and the same gap exists for `<webview>`
  browser tabs today.
- **V3: the floor.** `atrium:text` is in-tree so that a broken runner still
  shows a file. Once the runner has been stable for a while, is that still
  worth a second code path? Lean yes: it is twenty lines.
- **V4: the engine.** Oniguruma wasm, as argued above, unless packaging it
  under asar proves worse than losing the grammars the JavaScript engine
  cannot run.
- **V5: an answer for `atrium open`.** It exits before the app has acted. An
  agent that wants to know would need a reply, and a reply is the first
  information flowing back through the channel. Lean no, until an agent is
  observed needing one.
- **V6: the rail widget's reach.** `useSessionFiles` is the first topic that
  reads git. Whether `GitDriver` is a `Host` member again or a frame-side
  helper over `exec` decides whether every widget can ask git things. Lean
  `Host`: git is a capability of the machine, like files.

## Where it will live

- `src/session/types.ts`, `store.ts` — the `'file'` kind, `path`,
  `openFileBeside`, `receiveRequest`.
- `src/components/FileView.tsx` — the tab's frame and the `atrium:text`
  floor, until `14`'s frame exists; then a pane-slot variant of `WidgetFrame`
  in `src/rail/`.
- `src/components/FolderTree.tsx` — the tree and its breadcrumb, revived from
  `FilesView.tsx` at `07b058e`.
- `src/terminal/pathLinks.ts` — the link provider, beside the web-links one
  in `TerminalView`.
- `src/host/types.ts`, `src/host/mock/files.ts`, `src/host/electron/files.ts`
  — the driver and the capability.
- `electron/files.ts`, `electron/requests.ts` — reading, watching, and the
  requests watcher.
- `electron/shell/atrium.sh`, `electron/shims.ts` — the command, installed
  beside `claude` and `codex`.
- `src/rail/highlight/` — the worker and the theme.
- `src/rail/viewers/{code,markdown,image,binary,files}/` — the built-ins, as
  widgets with their source.
- `src/rail/sdk/` — `useFile`, `useHighlight`, `useSessionFiles`, `Code`,
  `Markdown`.
- `~/.config/atrium/viewers.json` — pins; `widgets/*/widget.json` gains
  `slot` and `matches`.

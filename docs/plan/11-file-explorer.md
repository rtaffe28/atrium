# File explorer — what it would take

This branch has a working tree: it lists a directory lazily, sorts folders
first, opens a native picker, remembers the folder on the tab, and prints the
selected file with large-file truncation and binary detection.

That is not yet a reason to spend a tab on it instead of a terminal. `ls` and
`cat` already do this, in a pane that can also do everything else. The viewer
earns its place only when it does something the terminal beside it cannot.

## What is missing before it is worth using

**Syntax highlighting.** The first thing anyone notices, and the first real
weight added to the bundle — Shiki is accurate but heavy, Prism is light and
approximate, and highlighting in a worker avoids blocking the renderer on a
large file. This is a deliberate dependency decision, not a detail to slip in.

**Navigating out of the root.** There is a picker and nothing else: no parent
directory, no breadcrumb, no way to reach a sibling folder without reopening
the dialog.

**Finding things.** A tree you scroll is a tree you abandon at about thirty
entries. Fuzzy file open — VS Code's `Mod+P` — is more useful than the tree
itself, and probably the feature to build *first*, since it makes the tree
optional.

**Watching for changes.** Agents edit files constantly. A tree that does not
update, and a file view that shows a stale copy while an agent is rewriting it,
is actively misleading — worse than absent. `fs.watch` through the existing
host seam, debounced.

**Seeing what changed.** The reason to look at a file in this app is usually to
see what an agent just did to it. A diff against git HEAD, and marks in the
tree for modified and untracked files, is the feature that would make this a
tab worth opening. It also wants the `GitDriver` that was deleted for having no
callers — which would then have one.

## What it should not become

**An editor.** Editing needs an undo stack, dirty state, conflict handling when
an agent writes the same file, autosave semantics, and a save-file dialog. That
is a different product, and the terminal beside it already contains `vim` and
an agent that edits on request.

## Where it sits in the app

No architecture changes are needed. It is a third `TabKind` beside terminal and
browser, its driver is one more member of `Host`, and both hosts implement it —
`MockHost` with a small in-memory tree so the browser build keeps working. The
tab persists only the folder it was pointed at; which file you were reading is
not worth restoring.

# Plans

Split by whether there is work left, not by age. A document moves to
`completed/` when the thing it describes is built and it has become a
description rather than an intention — it is still worth reading, and still the
reference for how that part works.

Numbers are the original reading order and are kept across the move, so a gap
in one folder is a document sitting in the other.

## active/ — outstanding work

| | |
|---|---|
| [`00-overview.md`](active/00-overview.md) | what Atrium is and what it has to do |
| [`02-decisions.md`](active/02-decisions.md) | Electron vs Tauri, why not fork cmux, open questions O1–O3 |
| [`03-architecture.md`](active/03-architecture.md) | the seam, the cross-platform table, and who owns the PTYs |
| [`04-roadmap.md`](active/04-roadmap.md) | the stages; lifecycle is the one still ahead |
| [`08-packaging.md`](active/08-packaging.md) | macOS and Linux build and install; Windows unbuilt, signing unsolved |
| [`09-borrowed-ideas.md`](active/09-borrowed-ideas.md) | what to take from VS Code and cmux next |
| [`10-keyboard.md`](active/10-keyboard.md) | the binding table, and the palette that would reshape it |
| [`12-agent-state.md`](active/12-agent-state.md) | tabs show what their program sends — title, bell, notification, progress — and nothing inferred |
| [`13-dogfooding.md`](active/13-dogfooding.md) | what developing Atrium in Atrium has turned up, and what to do about it |

## completed/ — built, and now the reference

| | |
|---|---|
| [`01-terminal-primer.md`](completed/01-terminal-primer.md) | how terminals actually work |
| [`05-ui-model.md`](completed/05-ui-model.md) | sessions, panes, tabs, drag, notifications |
| [`06-host-interface.md`](completed/06-host-interface.md) | the cross-platform host seam |
| [`07-persistence.md`](completed/07-persistence.md) | restore, and what it cannot do |

`11-file-explorer.md` is on the `files-explorer` branch and has not landed.

## Reading order

For someone new, unchanged by the split: 00, 01, 02, 03, 04, then 05–10 as
needed.

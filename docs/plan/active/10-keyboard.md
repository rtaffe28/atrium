# Keyboard

## Where it is now

Every binding lives in one table, `src/keyboard/commands.ts`. The handler in
`App` and the list in Settings both read it, so the shortcuts a user is shown
are by construction the shortcuts that run — a binding defined in a component
and described again in a panel is two things that drift.

| Command | Binding | Group |
|---|---|---|
| New session | `Mod+N` | Sessions |
| Rename session | `Mod+Shift+R` | Sessions |
| New terminal tab | `Mod+T` | Tabs |
| Close tab | `Mod+W` | Tabs |
| Settings | `Mod+,` | Application |

`Mod` is the platform's command key, so a binding is written once and rendered
as `⌘N` on macOS and `Ctrl+N` elsewhere. A test asserts no two commands claim
the same keys. Rename is also a double-click on the session's row. A name you
give is kept; until you give one, the session is called what its agent calls
itself — see [`12-agent-state.md`](12-agent-state.md).

Electron's own menu is the other claimant on the keyboard. Its default binds
Reload to `Mod+R` and Force Reload to `Mod+Shift+R`, and a reload here throws
away the renderer every terminal lives in. The menu is built in
`electron/menu.ts` from the same roles without those two, and a test keeps them
out.

## The rule that constrains everything here

**The terminal gets every key we do not take.** This app's whole purpose is
running agents in a terminal, and a shortcut that swallows a key an agent needs
is worse than no shortcut. Escape was bound to "interrupt" early on and had to
be given back: vim, readline and agents' own cancel handling all need it.

That rules out bare keys and most `Ctrl+` combinations outright — `Ctrl+C`,
`Ctrl+D`, `Ctrl+R`, `Ctrl+W` all mean something to a shell. On macOS this is
comfortable, because `⌘` is free. On Windows and Linux it is the central
problem: `Ctrl+N` and `Ctrl+W` collide with things people type. Both platforms'
terminals solve it the same way and we should follow — `Ctrl+Shift+` for app
commands, leaving plain `Ctrl+` to the terminal.

The one key below `Mod` the app touches is Shift+Enter, and it still goes to
the terminal. xterm.js encodes it as a bare carriage return, the same byte as
Enter, so Claude Code could not tell "new line" from "send". The terminal now
sends ESC CR for it — what Claude Code's own `/terminal-setup` binds
Shift+Enter to in VS Code, Zed and Alacritty, and what Alt+Enter already
sends — and lets every other key through untouched. `src/keyboard/terminal.ts`
is the whole of it, and a test holds the pass-through for Escape.

The same module takes the one paste xterm.js drops. It pastes the clipboard's
text and nothing else, so Cmd+V on a screenshot — an image with no text beside
it — did nothing at all. Claude Code reads images from the clipboard itself
when it is sent Ctrl+V, its image-paste key, so a paste with an image and no
text becomes that byte, and a paste with any text in it is still xterm's. In a
shell the byte is quoted-insert, which waits for a key and is harmless. See
[`13-dogfooding.md`](13-dogfooding.md).

## Rebinding

Three pieces, in order of what they unlock:

**1. Store overrides.** A map of command id to binding in settings, merged over
the defaults at read time. Settings already persists per-viewer, so this is a
field and a merge, not new machinery.

**2. Capture a keypress.** A row in Settings becomes a button that listens for
the next chord and writes it. The fiddly parts are showing the pending state,
allowing Escape to cancel without binding Escape, and refusing a chord with no
modifier — a bare letter would be swallowed before the terminal ever sees it.

**3. Report conflicts rather than silently taking the last one.** Two kinds
matter: two commands claiming one chord, which the existing uniqueness test
catches for defaults but not for overrides; and a chord the terminal needs,
which should warn rather than refuse — someone may genuinely want it.

## Worth having before rebinding

A **command palette** (`Mod+K`, already reserved in the title bar and doing
nothing). Most shortcuts exist because a thing is hard to reach; a palette
makes everything reachable and shrinks how many bindings are worth defining. It
also gives rebinding its natural home: each palette entry shows its binding,
and rebinding from there is a smaller surface than a settings table.

Commands worth adding once a palette exists, none of which deserve a key of
their own: switch to session by name, split the pane, move a tab to a new
session, open a file explorer here, change the working directory.

## Not planned

**Chords** (`Mod+K` then `S`, VS Code style). They earn their place at a few
hundred commands; at a dozen they are a lookup table the user has to memorise
for no gain.

**Vim-style modal keys.** The terminal already contains vim if that is what
someone wants, and a modal layer above a modal program is a way to lose track
of which one is listening.

# Architecture

## The seam

One interface, `SessionDriver` (`src/session/types.ts`). Everything above it is
UI, written once. Everything below it is platform-specific.

```ts
interface SessionDriver {
  list(): SessionMeta[]
  subscribe(handler): Unsubscribe
  attach(id, onData): Unsubscribe   // replay scrollback, then stream
  write(id, data)                   // keystrokes -> stdin
  resize(id, cols, rows)            // SIGWINCH | ResizePseudoConsole
  interrupt(id)                     // SIGINT   | 0x03 / CTRL_C_EVENT
  kill(id)                          // killpg   | Job Object close
  create(options): Promise<SessionMeta>
}
```

The mistake this avoids is letting PTY handles, xterm state and UI state
entangle so there is no boundary to move later. Two implementations are
planned: `MockDriver` (today) and `NodePtyDriver` (stage 5).

## What differs across platforms

`node-pty` covers the first two rows. We own the rest.

| What we want | mac / Linux | Windows |
|---|---|---|
| Open a PTY | `openpty()` | `CreatePseudoConsole` (ConPTY, Win10 1809+) |
| Resize | `TIOCSWINSZ` + SIGWINCH | `ResizePseudoConsole()` |
| Interrupt | SIGINT to the process group | write byte `0x03` |
| Kill the whole tree | `killpg(-pgid)` | **Job Object**, kill-on-close |
| Default shell | `$SHELL` | `pwsh` → `powershell` → `cmd` |
| Login environment | login-shell sentinel trick | inherited from registry; nothing to do |

Notes on the awkward rows:

- **Ctrl-C** mostly works for free on Windows: xterm.js already sends `0x03`
  and the console host turns it into `CTRL_C_EVENT`. An *out-of-band* stop
  button needs `GenerateConsoleCtrlEvent`, which is fiddly because it can hit
  our own process too.
- **Job Objects** are genuinely better than Unix process groups for orphan
  cleanup: assign the child to a job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,
  drop the handle, the entire tree dies. No SIGTERM→SIGKILL escalation dance.
- **ConPTY always translates.** It runs a real console underneath and re-emits
  VT sequences, so output is not a pure byte passthrough — expect redundant
  cursor positioning and reflow on resize that Unix does not produce.

## The rule that buys most of the portability

**Never shell out with a string. Always spawn a binary with an argv array.**

The moment you write ``sh -c `cd {dir} && git worktree add …` `` you have
married `&&`, quoting, globbing and `/`, none of which survive PowerShell.
Spawn `git` directly with `["worktree", "add", path]` and the difference
evaporates. Since Atrium launches agent CLIs and `git` rather than authoring
shell scripts, this line holds nearly everywhere.

Corollary: `PathBuf`-equivalent path handling, never string concatenation. On
Windows, deep `node_modules` inside worktrees hits the 260-char `MAX_PATH`
limit — enable long paths and set `core.longpaths`.

## Environment resolution is three different problems

- **macOS** — GUI apps do not inherit the shell environment. Launched from
  Finder, `node`, `pnpm`, `brew` binaries and nvm/asdf shims are all missing.
  Resolve once at startup with the sentinel trick, because BSD `env` has no
  `-0`:
  ```sh
  $SHELL -ilc 'echo -n "__ENV_START__"; env; echo -n "__ENV_END__"'
  ```
  and parse between the sentinels, discarding whatever the rc files print.
  (`-i` can hang on rc files that block on input; time it out and fall back to
  non-interactive.)
- **Linux** — same problem from a `.desktop` launch, milder, but shims still
  vanish.
- **Windows** — PATH comes from the registry and *is* inherited. Nothing to do.

Cache the resolved environment once in the main process; every session inherits
it plus `cwd`, `TERM=xterm-256color`, `COLORTERM=truecolor`. Do **not** wrap
each command in `$SHELL -lc` — it re-sources rc files per session and mangles
argv.

### Strip the launcher's identity before handing over a shell

Atrium inherits whatever environment it was launched from, and the login-shell
probe *preserves* it — the probe inherits our environment before adding to it,
so anything already there survives the round trip.

That leaked badly. Launching Atrium from inside a coding-agent session handed
every terminal it opened that session's identity. Claude Code reads
`CLAUDE_CODE_CHILD_SESSION`, concludes it is a nested invocation, and turns off
transcript saving and trust persistence — so it asked to trust the same folder
on every single launch and never saved a conversation. Nine variables were
being passed through.

`stripAgentSession` in `electron/env.ts` removes them. The rule is narrow on
purpose: markers that identify *our launcher*, never credentials or
preferences. `ANTHROPIC_API_KEY` belongs to the shell and stays.

Generalise the lesson rather than the list: a terminal emulator hands over a
clean shell. Anything in the environment that describes the emulator's own
parentage is not part of that.

## Open question O1: who owns the PTYs

Deferred, but the shape of the answer is known.

**Option A — children of the main process.** Simple. Quitting or crashing the
app kills every running agent and loses all scrollback.

**Option B — a detached daemon the GUI attaches to** (tmux's model). Sessions
survive app restarts. Costs a second process, a socket, and a lifecycle.

If B, the design is:

- Bounded scrollback ring buffer per session in the daemon (5–10 MB), plus an
  append-only raw log on disk for export.
- A monotonic output sequence number. `attach` means *"snapshot as of seq S,
  then stream deltas"*, so socket drop, GUI restart and cold start are all the
  same code path.
- Do not replay raw scrollback into xterm.js — after an agent prints 200 MB you
  will hang the renderer parsing escape codes. Keep a headless terminal in the
  daemon and hand over rendered screen state plus trimmed scrollback.
- Transport: localhost WebSocket (ephemeral port, token in a `0600` file) lets
  xterm.js talk to the daemon directly and keeps IPC out of the hot path.
- Persist `{session_id, pid, pgid, cwd}` so a crashed daemon can reap the
  previous generation's orphans on next start.
- Split the menu into **Close window** and **Quit and stop all agents**. That
  distinction is the whole point of the design and users need it visible.

`MockDriver` already models the important half of this: `attach` replays
buffered scrollback before streaming live, and `TerminalView` tears down and
re-attaches on every session switch, so the reattach path is exercised
constantly rather than only on a crash.

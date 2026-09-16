# PTY experiments

Small programs for understanding pseudo-terminals with nothing else in the
way. They are not part of the app and nothing imports them — but they run
against the same `node-pty` atrium uses, so what you learn here is what the
app is doing.

```sh
npm run pty:clean   # zsh -f — no rc files, minimal noise
npm run pty         # your real shell, rc files and all
```

## What `hello-pty.mjs` shows

Run it and read the output. Every line below is visible in it.

**The shell believes it is on a terminal.** `[ -t 1 ]` passes and prints
`stdout IS a tty`. Nothing about this is simulated — the kernel gave the shell
a real terminal device. That is the entire difference between a PTY and a pipe,
and it is why `claude`, `vim` and `git log` behave normally on one and go into
dumb mode on the other.

**Window size is real, and SIGWINCH works.** `tput cols` prints `80`, then
`120` after `term.resize(120, 40)`. The kernel signalled the shell, and it
updated. Skip this in a real app and `vim` renders into the wrong shape.

**Output arrives in arbitrary chunks, not lines.** Four commands produced 20+
chunks. Look at chunks 13 and 14:

```
chunk 13 (24 bytes)   printf "\033[32mgreen\
chunk 14 (43 bytes)   033[0m and \033[1mbold\033[0m\n"
```

An escape sequence split across two reads. Any terminal that parses output
line-by-line, or that assumes a chunk contains whole sequences, will eventually
corrupt the screen. This is why you hand bytes straight to a real emulator
(xterm.js) rather than trying to interpret them yourself.

**You see your own keystrokes come back.** Chunk 3 reads `eecho hello from` —
the doubled `e` is the shell echoing the character we just wrote. Input and
output are one loop through the PTY, not two separate streams.

**Escape sequences are most of the traffic.** `ESC[?2004h` / `ESC[?2004l`
bracket every command — that is bracketed-paste mode being turned on and off.
`ESC[K` erases to end of line, `ESC[J` to end of screen; together they are zsh
repainting its prompt. The reverse-video `%` at the top is zsh marking output
that did not end in a newline.

## The gotcha that cost an hour

node-pty's prebuilt `spawn-helper` arrives **without its execute bit**, because
npm's tarball extraction drops it. Every spawn then fails with:

```
Error: posix_spawnp failed.
```

which looks like a bug in your code and is not. `/bin/echo` fails identically,
which is the tell — if *nothing* can spawn, it is not the thing you are
spawning.

`scripts/native-permissions.mjs` runs on atrium's `postinstall` so `npm ci`
cannot silently undo it. Expect the same class of problem when packaging:
native helpers have to keep their permissions through asar packing and code
signing.

## Why these live here

They were a separate repo at first, back when atrium was a browser-only Vite
app and adding `node-pty` for a learning exercise would have polluted its
dependencies. atrium depends on `node-pty` now, so that reason is gone — and
keeping notes this relevant in an unversioned directory was the worse of the
two options.

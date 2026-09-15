# How terminals actually work

The one mental model that unlocks everything else. "Terminal" is three separate
things that get conflated:

- **The emulator** (iTerm, xterm.js) — draws a grid of characters, sends your
  keystrokes as bytes. That is all it does.
- **The PTY** — a kernel object; a fake serial cable with two ends. The
  emulator holds the *master*, the program holds the *slave* as its
  stdin/stdout/stderr.
- **The shell** (zsh) — just a program that happens to be on the far end. It is
  *not* the terminal, and it is replaceable by any other program — which is
  exactly why we can put `claude` there instead.

Everything between them is bytes plus escape sequences: the program writes
`\x1b[31m`, the emulator paints red. Ctrl-C becoming SIGINT and backspace
erasing a character are not the shell — that is the kernel's **line
discipline**, sitting in the middle of the PTY.

## Prove it to yourself in ten minutes

```sh
tty                          # in terminal A -> /dev/ttys003
echo hello > /dev/ttys003    # from terminal B; watch it appear in A
printf '\x1b[31mred\x1b[0m\n'
cat -v                       # then press arrow keys -> ^[[A
```

A terminal is a file you write bytes to. That is the whole abstraction.

## Why this matters for Atrium

`MockDriver` emits exactly the byte stream a PTY would, escape codes and all.
When the real driver lands, nothing above the seam changes — the UI has been
parsing real terminal output the entire time, it just came from an array
instead of a kernel.

## Reading

- **"The TTY demystified"** — Linus Åkesson. The canonical explainer.
- node-pty's README, and the xterm.js getting-started demo.
- cmux's source, for how a serious version of this is organised.

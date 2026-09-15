// Watch a pseudo-terminal work.
//
// The goal is not to build anything. It is to see the three pieces from
// ../../docs/plan/01-terminal-primer.md actually moving:
//
//   - we hold the MASTER end of a PTY (the `term` object below)
//   - the shell holds the SLAVE end as its stdin/stdout/stderr
//   - everything between is bytes, including ANSI escape sequences
//
// Run:  npm run pty          (your real shell, rc files and all)
//       npm run pty:clean    (zsh -f: no rc files, minimal output)

import os from 'node:os';
import pty from 'node-pty';

const clean = process.argv.includes('--clean');
const shell = process.env.SHELL ?? '/bin/zsh';

// Open a PTY and start the shell on the far end of it. cols/rows are the
// window size the shell will believe it has — this is what `tput cols` reads
// and what SIGWINCH updates later.
const term = pty.spawn(shell, clean ? ['-f'] : [], {
  name: 'xterm-256color',   // becomes $TERM; programs use it to pick capabilities
  cols: 80,
  rows: 24,
  cwd: os.homedir(),
  env: process.env,
});

console.log(`\n▶ spawned ${shell}${clean ? ' -f' : ''}  pid=${term.pid}  80x24\n`);

/**
 * Render control bytes visibly, the way `cat -v` does.
 *
 * Matching control characters is the whole point of this file — seeing ESC and
 * BEL is what makes the escape-sequence traffic legible — so the usual warning
 * against it does not apply.
 */
/* eslint-disable no-control-regex */
function visible(text) {
  return text
    .replace(/\x1b/g, '\x1b[35mESC\x1b[0m')   // the escape that starts every sequence
    .replace(/\r/g, '\x1b[36m\\r\x1b[0m')
    .replace(/\n/g, '\x1b[36m\\n\x1b[0m\n')
    .replace(/\x07/g, '\x1b[33m\\a\x1b[0m');  // BEL — often ends a title sequence
}
/* eslint-enable no-control-regex */

let chunks = 0;

// Output arrives in whatever chunks the kernel hands over — NOT in lines.
// Any real terminal has to cope with a sequence split across two reads.
term.onData((data) => {
  chunks += 1;
  process.stdout.write(
    `\x1b[2m─── chunk ${chunks} (${Buffer.byteLength(data)} bytes) ───\x1b[0m\n`,
  );
  process.stdout.write(visible(data));
  process.stdout.write('\n');
});

term.onExit(({ exitCode }) => {
  console.log(`\n▶ shell exited (${exitCode}) after ${chunks} chunks\n`);
  process.exit(0);
});

// Typing is just writing bytes to the master. "\r" is Enter — not "\n".
const type = (text, afterMs) =>
  setTimeout(() => term.write(text), afterMs);

type('echo hello from a pty\r', 600);

// Proof the shell believes it is on a terminal, and at what size.
type('[ -t 1 ] && echo "stdout IS a tty" ; tput cols\r', 1200);

// Colour, emitted by the program and interpreted by whatever draws the screen.
type('printf "\\033[32mgreen\\033[0m and \\033[1mbold\\033[0m\\n"\r', 1800);

// Resize the window. The kernel sends SIGWINCH to the shell; programs like vim
// redraw on it. Watch `tput cols` change afterwards.
setTimeout(() => {
  console.log('\n▶ resizing to 120x40 (sends SIGWINCH)\n');
  term.resize(120, 40);
}, 2400);

type('tput cols\r', 2800);
type('exit\r', 3400);

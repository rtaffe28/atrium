/**
 * Whether a string is something you could actually type at a prompt.
 *
 * A process can rename itself to anything — Claude Code reports as its own
 * version number — so a foreground process name is not automatically a
 * command. Restoring a session by typing `2.1.273` into a shell is worse than
 * restoring nothing, so anything that is not plausibly a command is dropped.
 */
export function plausibleCommand(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const first = candidate.trim().split(/\s+/)[0];
  if (!first) return undefined;
  // A leading letter or underscore, then the characters a program name uses.
  // Rules out version strings, status text and anything starting with a digit.
  return /^[A-Za-z_][\w.+-]*$/.test(first) ? candidate : undefined;
}

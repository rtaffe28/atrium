#!/bin/bash
# Atrium shell integration for bash.
#
# bash has no ZDOTDIR, so this is installed with --init-file. That replaces the
# interactive startup files outright, which means this file has to source them
# itself — and doing so is what makes the PATH fix below work, because by the
# time the sourcing returns the user's own rc files have already had their turn
# at PATH.

if [[ -r /etc/bash.bashrc ]]; then builtin source /etc/bash.bashrc; fi
if [[ -r "$HOME/.bashrc" ]]; then builtin source "$HOME/.bashrc"; fi

# Nothing below applies to a shell nobody is typing at.
case $- in *i*) ;; *) return ;; esac

# Put the agent shims back in front.
#
# Atrium prefixes PATH before spawning, but an rc file that prepends its own
# directory silently wins — Ubuntu's stock .bashrc prepends ~/.local/bin, which
# is exactly where an agent is installed. The shim then never runs, the tab is
# never bound to a conversation, and the failure is invisible until a restore
# opens a new conversation instead of the one you left.
#
# Moved to the front rather than added if absent: it is already present and in
# the wrong place, which is the whole problem.
if [[ -n "${ATRIUM_SHIM_DIR:-}" ]]; then
  _atrium_clean=""
  _atrium_ifs="$IFS"
  IFS=:
  for _atrium_entry in $PATH; do
    [[ "$_atrium_entry" == "$ATRIUM_SHIM_DIR" ]] && continue
    _atrium_clean="${_atrium_clean:+$_atrium_clean:}$_atrium_entry"
  done
  IFS="$_atrium_ifs"
  builtin export PATH="$ATRIUM_SHIM_DIR:$_atrium_clean"
  builtin unset _atrium_clean _atrium_ifs _atrium_entry
fi

# Shell integration, in VS Code's OSC 633 / OSC 133 protocol — the same thing
# the zsh side reports, so the app above the seam cannot tell which shell it is
# talking to.
_atrium_osc() { builtin printf '\e]%s\a' "$1"; }

# A command line can contain anything, including the byte that would end the
# sequence carrying it.
_atrium_escape() {
  local s=${1//\\/\\x5c}
  s=${s//$'\n'/\\x0a}
  s=${s//$'\r'/\\x0d}
  s=${s//$'\e'/\\x1b}
  s=${s//$'\a'/\\x07}
  builtin printf '%s' "$s"
}

# bash has no preexec, so the DEBUG trap stands in for one. It fires once per
# simple command where zsh's preexec fires once per line, so the first one
# after a prompt reports and the rest stay quiet until the next prompt clears
# the latch.
#
# It also fires for whatever PROMPT_COMMAND runs, which is not a command the
# user submitted. Those are filtered by name — the alternative is a prompt that
# announces itself as a command on every keystroke.
_atrium_running=""
_atrium_prompt_command=""

_atrium_preexec() {
  [[ -n "$COMP_LINE" ]] && return           # tab completion, not a command
  [[ -n "$_atrium_running" ]] && return
  [[ "$BASH_COMMAND" == _atrium_precmd* ]] && return
  [[ -n "$_atrium_prompt_command" && "$_atrium_prompt_command" == *"$BASH_COMMAND"* ]] && return
  _atrium_running=1
  _atrium_osc "633;E;$(_atrium_escape "$BASH_COMMAND")"
  _atrium_osc "133;C"
}

_atrium_precmd() {
  local code=$?
  _atrium_running=""
  _atrium_osc "133;D;$code"
  _atrium_osc "133;A"
  builtin return $code
}

# Registered first so it still sees the command's exit status: anything the
# user already had in PROMPT_COMMAND would overwrite $? before we read it.
# bash 5.1 made PROMPT_COMMAND an array as well as a string, and both forms
# are in the wild.
if [[ "$(builtin declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  _atrium_prompt_command="${PROMPT_COMMAND[*]}"
  PROMPT_COMMAND=(_atrium_precmd "${PROMPT_COMMAND[@]}")
else
  _atrium_prompt_command="$PROMPT_COMMAND"
  PROMPT_COMMAND="_atrium_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi

# Installed last, so the rest of this file is not reported as though the user
# had typed it.
builtin trap '_atrium_preexec' DEBUG

# Atrium shell integration.
#
# Hand ZDOTDIR back immediately: /etc/zshrc derives HISTFILE from it, and zsh
# needs to find the user's own .zprofile and .zshrc in their real location.
if [[ -n "${ATRIUM_USER_ZDOTDIR+X}" ]]; then
  builtin export ZDOTDIR="$ATRIUM_USER_ZDOTDIR"
  builtin unset ATRIUM_USER_ZDOTDIR
else
  builtin unset ZDOTDIR
fi

_atrium_file="${ZDOTDIR-$HOME}/.zshenv"
[[ -r "$_atrium_file" ]] && builtin source -- "$_atrium_file"
builtin unset _atrium_file

if [[ -o interactive ]]; then
  builtin autoload -Uz add-zsh-hook

  # Shell integration, in VS Code's OSC 633 / OSC 133 protocol.
  #
  # The shell says what it is doing, rather than Atrium inferring it from the
  # foreground process — which lies when a process renames itself — and from
  # keystrokes reassembled by hand, which one control character invalidates.
  _atrium_osc() { builtin printf '\e]%s\a' "$1" }

  # A command line can contain anything, including the byte that would end the
  # sequence carrying it.
  _atrium_escape() {
    builtin local s=${1//\\/\\x5c}
    s=${s//$'\n'/\\x0a}
    s=${s//$'\r'/\\x0d}
    s=${s//$'\e'/\\x1b}
    s=${s//$'\a'/\\x07}
    builtin print -r -- "$s"
  }

  _atrium_preexec() {
    _atrium_osc "633;E;$(_atrium_escape "$1")"
    _atrium_osc "133;C"
  }

  # Registered first so it still sees the command's exit status: another hook
  # running before it would overwrite $?.
  _atrium_precmd() {
    builtin local code=$?
    _atrium_osc "133;D;$code"
    _atrium_osc "633;P;Cwd=$(_atrium_escape "$PWD")"
    _atrium_osc "133;A"
    builtin return $code
  }

  add-zsh-hook precmd _atrium_precmd
  add-zsh-hook preexec _atrium_preexec

  # Put the agent shims back in front once the user's configuration has run.
  # A precmd hook is the first moment that is true.
  if [[ -n "${ATRIUM_SHIM_DIR:-}" ]]; then
    _atrium_restore_path() {
      builtin export PATH="$ATRIUM_SHIM_DIR:$PATH"
      add-zsh-hook -d precmd _atrium_restore_path
      builtin unset -f _atrium_restore_path
    }
    add-zsh-hook precmd _atrium_restore_path
  fi
fi

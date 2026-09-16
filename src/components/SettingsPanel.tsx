import { useEffect } from 'react';
import { useHost } from '../host/context';
import { COMMANDS, display } from '../keyboard/commands';
import { useSettings } from '../settings/context';
import { FONT_SIZES } from '../settings/types';

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`setting-row${disabled ? ' is-disabled' : ''}`}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </label>
  );
}

/** `~`, `$HOME`, or an empty value that falls back to it. */
function isHomeDirectory(path: string): boolean {
  const trimmed = path.trim().replace(/\/+$/, '');
  return trimmed === '' || trimmed === '~' || trimmed === '$HOME';
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, update, reset } = useSettings();
  const host = useHost();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const permission = host.notify.permission();
  const platform = host.window.platform();

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Settings</h2>
          <button className="icon-button subtle" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="settings-section">
          <h3>New sessions</h3>
          <label className="setting-row">
            <span className="setting-text">
              <span className="setting-label">Working directory</span>
              <span className="setting-hint">
                Where the first session opens; after that, new ones inherit the
                directory you are in. Point it at a project rather than your
                home folder — an agent asks permission per directory, and your
                home folder is the one to never grant wholesale.
              </span>
            </span>
            <span className="setting-pair">
              <input
                className="setting-input"
                value={settings.defaultCwd}
                spellCheck={false}
                placeholder="~/git/atrium"
                onChange={(event) => update({ defaultCwd: event.target.value })}
              />
              <button
                type="button"
                className="ghost-button tiny"
                onClick={() => {
                  void host.files.chooseDirectory().then((dir) => {
                    if (dir) update({ defaultCwd: dir });
                  });
                }}
              >
                Choose…
              </button>
            </span>
          </label>
          {isHomeDirectory(settings.defaultCwd) && (
            <p className="setting-warning">
              Agents ask permission per directory, and will not remember being
              trusted with your whole home folder — so they ask again on every
              launch. Point this at a project and the question is asked once.
            </p>
          )}
          <label className="setting-row">
            <span className="setting-text">
              <span className="setting-label">Default command</span>
              <span className="setting-hint">
                Runs when a session opens. Leave blank for a plain shell.
              </span>
            </span>
            <input
              className="setting-input"
              value={settings.defaultCommand}
              spellCheck={false}
              placeholder="claude"
              onChange={(event) => update({ defaultCommand: event.target.value })}
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Alerts</h3>
          <Toggle
            label="Play sounds"
            hint="A tone when an agent changes state."
            checked={settings.sounds}
            onChange={(sounds) => {
              update({ sounds });
              if (sounds) host.notify.sound('done'); // preview it immediately
            }}
          />
          <Toggle
            label="System notifications"
            hint={
              permission === 'granted'
                ? undefined
                : 'Needs permission — granted the first time one fires.'
            }
            checked={settings.notifications}
            onChange={(notifications) => update({ notifications })}
          />

          <div className="setting-group">
            <span className="setting-label">Alert me when an agent…</span>
            <Toggle
              label="Needs input"
              checked={settings.notifyOn.waiting}
              disabled={!settings.notifications && !settings.sounds}
              onChange={(v) => update({ notifyOn: { ...settings.notifyOn, waiting: v } })}
            />
            <Toggle
              label="Finishes"
              checked={settings.notifyOn.done}
              disabled={!settings.notifications && !settings.sounds}
              onChange={(v) => update({ notifyOn: { ...settings.notifyOn, done: v } })}
            />
            <Toggle
              label="Fails"
              checked={settings.notifyOn.error}
              disabled={!settings.notifications && !settings.sounds}
              onChange={(v) => update({ notifyOn: { ...settings.notifyOn, error: v } })}
            />
          </div>
        </section>

        <section className="settings-section">
          <h3>Terminal</h3>
          <label className="setting-row">
            <span className="setting-text">
              <span className="setting-label">Font size</span>
            </span>
            <select
              className="setting-input narrow"
              value={settings.terminalFontSize}
              onChange={(event) => update({ terminalFontSize: Number(event.target.value) })}
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-section">
          <h3>Keyboard</h3>
          {(['Sessions', 'Tabs', 'Application'] as const).map((group) => (
            <div key={group} className="shortcut-group">
              <span className="shortcut-group-name">{group}</span>
              {COMMANDS.filter((c) => c.group === group).map((command) => (
                <div key={command.id} className="shortcut-row">
                  <span>{command.label}</span>
                  <kbd>{display(command.keys, platform)}</kbd>
                </div>
              ))}
            </div>
          ))}
          <p className="setting-hint">
            Fixed for now. Rebinding is designed in docs/plan/10-keyboard.md;
            this list is generated from the same table the app binds, so it
            cannot fall out of step with what the keys actually do.
          </p>
        </section>

        <footer className="modal-foot">
          <span className="dim">{host.name} host</span>
          <button className="ghost-button" onClick={reset}>
            Reset to defaults
          </button>
        </footer>
      </div>
    </div>
  );
}

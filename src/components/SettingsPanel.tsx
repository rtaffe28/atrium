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
          <h3>Alerts</h3>
          <Toggle
            label="Desktop notifications"
            hint="When a tab you are not looking at asks for one — Claude and Codex do when they finish or need you."
            checked={settings.desktopNotifications}
            disabled={!host.capabilities.nativeNotifications}
            onChange={(on) => {
              update({ desktopNotifications: on });
              // A browser only asks in response to a click, so this is the moment.
              if (on && host.notify.permission() === 'default') {
                void host.notify.requestPermission();
              }
            }}
          />
          <Toggle
            label="Notify when work finishes"
            hint="When a tab you are not looking at stops working — unless its agent just notified you itself."
            checked={settings.notifyWhenFinished}
            disabled={!host.capabilities.nativeNotifications}
            onChange={(on) => {
              update({ notifyWhenFinished: on });
              if (on && host.notify.permission() === 'default') {
                void host.notify.requestPermission();
              }
            }}
          />
          <Toggle
            label="Bell sound"
            hint="When a tab you are not looking at rings. It is marked either way."
            checked={settings.bellSound}
            onChange={(on) => update({ bellSound: on })}
          />
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
            Fixed for now. Rebinding is designed in docs/plan/active/10-keyboard.md;
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

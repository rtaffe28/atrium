import { useEffect } from 'react';
import { useHost } from '../host/context';
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

  const permission = host.notify.permission();

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
                Where new sessions open. A project directory rather than your
                home folder: an agent asks permission per directory, and
                resumes the conversation belonging to it.
              </span>
            </span>
            <input
              className="setting-input"
              value={settings.defaultCwd}
              spellCheck={false}
              placeholder="~/git/atrium"
              onChange={(event) => update({ defaultCwd: event.target.value })}
            />
          </label>
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
          <h3>Restoring a session</h3>
          <label className="setting-row stacked">
            <span className="setting-text">
              <span className="setting-label">Command overrides</span>
              <span className="setting-hint">
                One <code>command = replacement</code> per line. Applied when a
                saved session reopens, so an agent resumes instead of starting
                blank.
              </span>
            </span>
            <textarea
              className="setting-input area"
              rows={3}
              spellCheck={false}
              value={settings.restoreOverrides}
              onChange={(event) => update({ restoreOverrides: event.target.value })}
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

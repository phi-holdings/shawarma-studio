import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type AppSettings, getSettings, removeApiKey, saveApiKey, setDailyCap } from '../api';
import { EditorSettings } from './EditorSettings';
import { AudioSettings } from './AudioSettings';
import './settings.css';

export type SettingsSection = 'claude' | 'editor' | 'audio';
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'claude', label: 'Shawarma' },
  { id: 'editor', label: 'Editor' },
  { id: 'audio', label: 'Audio' },
];

type Status = { kind: 'ok' | 'err'; text: string } | null;

/**
 * Settings in three sections: Claude (API key + daily cap), Editor (prefs.ts) and Audio (output device).
 * The key only lives in this input's state until it is submitted; it is cleared
 * after a save and never stored in the browser. The server keeps it in the macOS Keychain.
 */
export function SettingsDialog(props: {
  settings: AppSettings | null; onChange(s: AppSettings): void; onClose(): void; section?: SettingsSection;
  /** Hosted mode: the plan and allowance, shown instead of the API key and daily cap. */
  hostedPanel?: ReactNode;
}) {
  const [section, setSection] = useState<SettingsSection>(props.section ?? 'claude');
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [cap, setCap] = useState(props.settings ? String(props.settings.dailyCapUsd) : '');
  const [capStatus, setCapStatus] = useState<Status>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const s = props.settings;

  useEffect(() => {
    if (section === 'claude' && !props.hostedPanel) keyInput.current?.focus();
    // refresh today's spend when the dialog opens
    getSettings().then((fresh) => { props.onChange(fresh); setCap(String(fresh.dailyCapUsd)); }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const saveKey = () => run(async () => {
    const value = key.trim();
    if (!value) return;
    setStatus({ kind: 'ok', text: 'Checking the key with Anthropic…' });
    try {
      const next = await saveApiKey(value);
      setKey('');
      setShow(false);
      props.onChange(next);
      setStatus({ kind: 'ok', text: `Key saved (${next.keyHint})` });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  });
  const removeKey = () => run(async () => {
    try {
      props.onChange(await removeApiKey());
      setStatus({ kind: 'ok', text: 'Key removed' });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  });
  const saveCap = () => run(async () => {
    const n = Number(cap);
    if (cap.trim() === '' || !Number.isFinite(n) || n < 0) { setCapStatus({ kind: 'err', text: 'Enter a dollar amount of 0 or more' }); return; }
    try {
      const next = await setDailyCap(n);
      props.onChange(next);
      setCapStatus({ kind: 'ok', text: `Daily cap set to $${next.dailyCapUsd.toFixed(2)}` });
    } catch (e) {
      setCapStatus({ kind: 'err', text: (e as Error).message });
    }
  });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button className="btn btn-ghost btn-icon" aria-label="Close settings" onClick={props.onClose}>×</button>
        </div>

        <nav className="settings-nav" role="tablist" aria-label="Settings sections">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" role="tab" id={`settings-tab-${x.id}`} aria-selected={section === x.id} aria-controls={`settings-${x.id}`}
              className={`settings-tab${section === x.id ? ' on' : ''}`} onClick={() => setSection(x.id)}>{x.label}</button>
          ))}
        </nav>

        <div className="settings-body">
          <div role="tabpanel" id="settings-claude" aria-labelledby="settings-tab-claude" hidden={section !== 'claude'} className="settings-panel">
            {props.hostedPanel ?? <>
            <section className="modal-section">
              <h3>Anthropic API key</h3>
              <p className="muted">
                {s?.hasKey ? `A key is saved (${s.keyHint}).` : 'No key saved.'} The key is stored in the macOS Keychain on this machine and never sent back to the browser.
                {s?.fakeAi && ' The server runs in fake AI mode, so chat works without a key.'}
              </p>
              <form className="row" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
                <input
                  ref={keyInput}
                  aria-label="Anthropic API key"
                  type={show ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="grow"
                />
                <button className="btn" type="button" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
                <button className="btn btn-primary" type="submit" disabled={busy || !key.trim()}>Save key</button>
              </form>
              {s?.hasKey && <button className="btn" disabled={busy} onClick={() => void removeKey()}>Remove key</button>}
              {status && <div role="status" className={status.kind === 'err' ? 'err-text' : 'ok-text'}>{status.text}</div>}
            </section>

            <section className="modal-section">
              <h3>Daily spend cap</h3>
              <p className="muted">Spent today: ${(s?.spentTodayUsd ?? 0).toFixed(2)}{s ? ` of $${s.dailyCapUsd.toFixed(2)}` : ''}. Chat stops for the day once the cap is reached.</p>
              <form className="row" onSubmit={(e) => { e.preventDefault(); void saveCap(); }}>
                <span>$</span>
                <input aria-label="Daily cap (USD)" type="number" min={0} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} className="cap" />
                <button className="btn" type="submit" disabled={busy}>Save cap</button>
              </form>
              {capStatus && <div role="status" className={capStatus.kind === 'err' ? 'err-text' : 'ok-text'}>{capStatus.text}</div>}
            </section>
            </>}
          </div>
          <div role="tabpanel" id="settings-editor" aria-labelledby="settings-tab-editor" hidden={section !== 'editor'} className="settings-panel">
            {section === 'editor' && <EditorSettings />}
          </div>
          <div role="tabpanel" id="settings-audio" aria-labelledby="settings-tab-audio" hidden={section !== 'audio'} className="settings-panel">
            {section === 'audio' && <AudioSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

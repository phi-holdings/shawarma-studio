import { useState } from 'react';
import { Modal } from './Modal';
import { TEMPLATES } from './templates';
import { ImportError, codeFromStrudelLink, importName } from './share';

export type NewProjectMode = 'template' | 'import';

/** Largest song file accepted by Import (a song is text; anything bigger is not one). */
const MAX_IMPORT_BYTES = 1024 * 1024;

/**
 * New project: a name plus a starting point, either one of the templates or imported code (a
 * strudel.cc link or a .js/.strudel file). `onCreate` throws to show its error in the dialog.
 */
export function NewProjectDialog(props: { initialMode?: NewProjectMode; onCreate(name: string, code: string): Promise<void>; onClose(): void }) {
  const [mode, setMode] = useState<NewProjectMode>(props.initialMode ?? 'template');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [link, setLink] = useState('');
  const [file, setFile] = useState<{ name: string; code: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pickFile = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) { setError(`${f.name} is ${(f.size / 1e6).toFixed(1)} MB; a song file should be a small text file (under 1 MB).`); return; }
    const code = await f.text();
    if (!code.trim()) { setError(`${f.name} is empty. Choose a file with Strudel code in it.`); return; }
    setFile({ name: f.name, code });
    setLink('');
  };

  const submit = async () => {
    setError('');
    let code: string;
    let fallbackName: string;
    if (mode === 'template') {
      const t = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];
      code = t.code;
      fallbackName = t.name;
    } else if (file) {
      code = file.code;
      fallbackName = importName(file.name);
    } else {
      try { code = codeFromStrudelLink(link); } catch (e) { setError(e instanceof ImportError ? e.message : String(e)); return; }
      fallbackName = importName();
    }
    const finalName = name.trim() || fallbackName;
    if (!/[\p{L}\p{N}]/u.test(finalName)) { setError('A project name needs at least one letter or digit.'); return; }
    setBusy(true);
    try {
      await props.onCreate(finalName.slice(0, 100), code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === 'template' || Boolean(file) || Boolean(link.trim());
  return (
    <Modal title="New project" onClose={props.onClose} wide>
      <form className="new-project-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} maxLength={100} autoFocus placeholder={mode === 'template' ? (TEMPLATES.find((t) => t.id === template)?.name ?? '') : file ? importName(file.name) : 'Imported song'}
            onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        </label>

        <div className="segmented" role="tablist" aria-label="Start from">
          <button type="button" role="tab" aria-selected={mode === 'template'} className={mode === 'template' ? 'active' : ''} onClick={() => { setMode('template'); setError(''); }}>Template</button>
          <button type="button" role="tab" aria-selected={mode === 'import'} className={mode === 'import' ? 'active' : ''} onClick={() => { setMode('import'); setError(''); }}>Import</button>
        </div>

        {mode === 'template' ? (
          <div className="template-list" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((t) => (
              <label key={t.id} className={`template${t.id === template ? ' selected' : ''}`}>
                <input type="radio" name="template" value={t.id} checked={t.id === template} onChange={() => setTemplate(t.id)} />
                <span className="template-name">{t.name}</span>
                <span className="template-desc">{t.description}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="import-box">
            <label className="field">
              <span>strudel.cc link</span>
              <input type="text" value={link} placeholder="https://strudel.cc/#…" aria-label="strudel.cc link" disabled={Boolean(file)}
                onChange={(e) => { setLink(e.target.value); setError(''); }} />
            </label>
            <div className="row import-file">
              <span className="muted">or</span>
              <label className="btn">
                Choose a file…
                <input type="file" accept=".js,.strudel,.txt,text/javascript,text/plain" className="visually-hidden" aria-label="Song file"
                  onChange={(e) => void pickFile(e.target.files?.[0])} />
              </label>
              {file && (
                <span className="pill" title={file.name}>
                  {file.name}
                  <button type="button" className="chip-x" aria-label={`Remove ${file.name}`} onClick={() => setFile(null)}>×</button>
                </span>
              )}
            </div>
            <p className="muted">Paste a long strudel.cc link (the one with # in it) or choose a .js or .strudel file.</p>
          </div>
        )}

        {error && <div role="alert" className="err-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !ready} aria-busy={busy}>Create project</button>
        </div>
      </form>
    </Modal>
  );
}

/** Rename: one field, saved on Enter. `onRename` throws to show its error in the dialog. */
export function RenameDialog(props: { current: string; onRename(name: string): Promise<void>; onClose(): void }) {
  const [name, setName] = useState(props.current);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n) { setError('A project name needs 1-100 characters.'); return; }
    if (n === props.current) { props.onClose(); return; }
    setBusy(true);
    try { await props.onRename(n); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Rename project" onClose={props.onClose}>
      <form className="new-project-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} maxLength={100} autoFocus aria-label="Project name"
            onFocus={(e) => e.currentTarget.select()} onChange={(e) => { setName(e.target.value); setError(''); }} />
        </label>
        {error && <div role="alert" className="err-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Rename</button>
        </div>
      </form>
    </Modal>
  );
}

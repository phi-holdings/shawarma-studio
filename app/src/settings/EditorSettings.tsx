import { DEFAULT_PREFS, FONT_SIZES, editorPrefs, useEditorPrefs, type EditorPrefs } from '../editor/prefs';

const THEMES: { id: EditorPrefs['theme']; label: string; hint: string }[] = [
  { id: 'desk', label: 'Mixing desk', hint: 'Dark' },
  { id: 'paper', label: 'Score paper', hint: 'Light' },
  { id: 'night', label: 'Night drive', hint: 'Navy' },
];

/** Editor preferences: saved in this browser and applied as you change them. */
export function EditorSettings() {
  const p = useEditorPrefs();
  const set = (patch: Partial<EditorPrefs>) => editorPrefs.set(patch);
  const toggle = (key: 'lineNumbers' | 'lineWrap' | 'autocomplete' | 'hoverDocs' | 'patternHighlight', label: string, hint?: string) => (
    <label className="check settings-check">
      <input type="checkbox" checked={p[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>{label}{hint && <span className="muted"> {hint}</span>}</span>
    </label>
  );
  const isDefault = (Object.keys(DEFAULT_PREFS) as (keyof EditorPrefs)[]).every((k) => p[k] === DEFAULT_PREFS[k]);

  return (
    <div className="settings-grid">
      <fieldset className="settings-field">
        <legend>Theme</legend>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <label key={t.id} className={`theme-option${p.theme === t.id ? ' on' : ''}`}>
              <input type="radio" name="editor-theme" value={t.id} checked={p.theme === t.id} onChange={() => set({ theme: t.id })} />
              <span className={`swatch swatch-${t.id}`} aria-hidden="true"><i /><i /><i /></span>
              <span className="theme-name">{t.label}</span><span className="muted">{t.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="settings-field">
        <label htmlFor="editor-font-size" className="settings-label">Font size</label>
        <div className="row">
          <button type="button" className="btn btn-icon" aria-label="Smaller text" disabled={p.fontSize <= FONT_SIZES.min} onClick={() => set({ fontSize: Math.round(p.fontSize) - 1 })}>−</button>
          <input id="editor-font-size" type="number" min={FONT_SIZES.min} max={FONT_SIZES.max} step={0.5} value={p.fontSize}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && e.target.value !== '') set({ fontSize: n }); }} className="font-size" />
          <button type="button" className="btn btn-icon" aria-label="Larger text" disabled={p.fontSize >= FONT_SIZES.max} onClick={() => set({ fontSize: Math.round(p.fontSize) + 1 })}>+</button>
          <span className="muted">px</span>
        </div>
      </div>

      <div className="settings-field">
        <label htmlFor="editor-keys" className="settings-label">Keybindings</label>
        <select id="editor-keys" value={p.keybindings} onChange={(e) => set({ keybindings: e.target.value as EditorPrefs['keybindings'] })}>
          <option value="default">Default</option>
          <option value="vim">Vim</option>
          <option value="emacs">Emacs</option>
        </select>
        {p.keybindings === 'vim' && <p className="muted settings-hint"><kbd>:w</kbd> plays, <kbd>:q</kbd> stops.</p>}
      </div>

      <div className="settings-field settings-checks">
        <span className="settings-label">Display</span>
        {toggle('lineNumbers', 'Line numbers')}
        {toggle('lineWrap', 'Wrap long lines')}
        {toggle('patternHighlight', 'Highlight what is playing')}
      </div>

      <div className="settings-field settings-checks">
        <span className="settings-label">Help while typing</span>
        {toggle('autocomplete', 'Autocomplete')}
        {toggle('hoverDocs', 'Function docs on hover', '(hold Ctrl)')}
        <p className="muted settings-hint">Find and replace: <kbd>⌘</kbd><kbd>F</kbd> in the editor.</p>
      </div>

      <button type="button" className="btn btn-outline settings-reset" disabled={isDefault} onClick={() => editorPrefs.reset()}>Reset editor settings</button>
    </div>
  );
}

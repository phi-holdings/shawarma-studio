// Editor preferences: kept in localStorage, applied live (see prefsExtension.ts). This module has no
// CodeMirror imports so it can be used (and tested) anywhere.
import { useSyncExternalStore } from 'react';

/** App themes (app.css): mixing desk (dark graphite), score paper (light), night drive (navy). */
export type EditorTheme = 'desk' | 'paper' | 'night';
export type Keybindings = 'default' | 'vim' | 'emacs';

export interface EditorPrefs {
  theme: EditorTheme;
  fontSize: number;
  lineNumbers: boolean;
  lineWrap: boolean;
  keybindings: Keybindings;
  autocomplete: boolean;
  hoverDocs: boolean;
  patternHighlight: boolean;
}

export const DEFAULT_PREFS: EditorPrefs = {
  theme: 'desk',
  fontSize: 14.5,
  lineNumbers: true,
  lineWrap: true,
  keybindings: 'default',
  autocomplete: true,
  hoverDocs: true,
  patternHighlight: true,
};

export const FONT_SIZES = { min: 11, max: 24 } as const;
export const PREFS_KEY = 'shawarma.editorPrefs';

const THEMES: EditorTheme[] = ['desk', 'paper', 'night'];
/** Themes from before the redesign map to their nearest new one. */
const RENAMED: Record<string, EditorTheme> = { aubergine: 'desk', toum: 'paper' };
const KEYS: Keybindings[] = ['default', 'vim', 'emacs'];

/** Reads stored prefs; unknown or malformed fields fall back to their defaults one by one. */
export function parsePrefs(raw: string | null): EditorPrefs {
  let o: Record<string, unknown> = {};
  try { const v = raw ? JSON.parse(raw) : null; if (v && typeof v === 'object' && !Array.isArray(v)) o = v; } catch { /* defaults */ }
  const bool = (k: keyof EditorPrefs) => (typeof o[k] === 'boolean' ? o[k] as boolean : DEFAULT_PREFS[k] as boolean);
  const size = Number(o.fontSize);
  return {
    theme: THEMES.includes(o.theme as EditorTheme) ? o.theme as EditorTheme : RENAMED[String(o.theme)] ?? DEFAULT_PREFS.theme,
    fontSize: typeof o.fontSize === 'number' && Number.isFinite(size) ? Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, size)) : DEFAULT_PREFS.fontSize,
    lineNumbers: bool('lineNumbers'),
    lineWrap: bool('lineWrap'),
    keybindings: KEYS.includes(o.keybindings as Keybindings) ? o.keybindings as Keybindings : DEFAULT_PREFS.keybindings,
    autocomplete: bool('autocomplete'),
    hoverDocs: bool('hoverDocs'),
    patternHighlight: bool('patternHighlight'),
  };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** A tiny observable store over one storage key. */
export function createPrefsStore(storage: Storage | null) {
  const read = () => { try { return storage?.getItem(PREFS_KEY) ?? null; } catch { return null; } };
  let prefs = parsePrefs(read());
  const subs = new Set<() => void>();
  return {
    get: () => prefs,
    set(patch: Partial<EditorPrefs>) {
      prefs = parsePrefs(JSON.stringify({ ...prefs, ...patch }));
      try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode: in memory only */ }
      subs.forEach((fn) => fn());
    },
    reset() { this.set(DEFAULT_PREFS); },
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

export const editorPrefs = createPrefsStore(typeof localStorage === 'undefined' ? null : localStorage);

export function useEditorPrefs(): EditorPrefs {
  return useSyncExternalStore(editorPrefs.subscribe, editorPrefs.get);
}

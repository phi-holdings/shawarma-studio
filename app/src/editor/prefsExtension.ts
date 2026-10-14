// Applies EditorPrefs to a CodeMirror view. The switches reuse @strudel/codemirror's own compartments
// (initEditor already mounted them, filled from Strudel's settings); this module reconfigures them
// from the app's prefs, swaps Strudel's theme for the app's, and adds search (Strudel ships it off).
import { type Extension, type StateEffect } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { Prec } from '@codemirror/state';
import { compartments, extensions } from '@strudel/codemirror';
import type { EditorPrefs } from './prefs';

/**
 * Syntax colours from the theme (CSS variables, so every theme shares one style; see editor.css): the
 * action colour for calls, green for strings (the mini-notation), the playing colour for numbers, a
 * per-theme colour for keywords, quiet greys for comments and punctuation.
 */
export const shawarmaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName], color: 'var(--syn-call)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--syn-name)' },
  { tag: [t.labelName], color: 'var(--syn-keyword)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: 'var(--syn-punct)' },
  { tag: t.invalid, color: 'var(--err)' },
]);

/** The theme compartment: CodeMirror's dark flag plus the palette highlighter (above Strudel's default style). */
const themeExtension = (theme: EditorPrefs['theme']): Extension => [
  EditorView.theme({}, { dark: theme !== 'paper' }),
  Prec.highest(syntaxHighlighting(shawarmaHighlight)),
];

const KEYMAP_NAMES: Record<EditorPrefs['keybindings'], string> = { default: 'codemirror', vim: 'vim', emacs: 'emacs' };

/** Find / replace: Mod-f opens the panel (find and replace fields) at the bottom of the editor. */
export const searchExtension: Extension = [
  search({ top: false }),
  highlightSelectionMatches(),
  Prec.high(keymap.of(searchKeymap)),
  EditorState.phrases.of({
    Find: 'Find', Replace: 'Replace', next: 'Next', previous: 'Previous', all: 'All', 'match case': 'Match case',
    regexp: 'Regex', 'by word': 'Whole word', replace: 'Replace', 'replace all': 'Replace all', close: 'Close',
  }),
];

type Highlight = { editor: EditorView; miniLocations: [number, number][] };
const set = (key: string, ext: Extension) => compartments[key].reconfigure(ext);
const APPLY: { [K in keyof EditorPrefs]?: (v: EditorPrefs[K], h?: Highlight) => StateEffect<unknown> } = {
  theme: (v) => set('theme', themeExtension(v)),
  lineNumbers: (v) => set('isLineNumbersDisplayed', extensions.isLineNumbersDisplayed(v)),
  lineWrap: (v) => set('isLineWrappingEnabled', extensions.isLineWrappingEnabled(v)),
  keybindings: (v) => set('keybindings', extensions.keybindings(KEYMAP_NAMES[v])),
  autocomplete: (v) => set('isAutoCompletionEnabled', extensions.isAutoCompletionEnabled(v)),
  hoverDocs: (v) => set('isTooltipEnabled', extensions.isTooltipEnabled(v)),
  // switched back on, the marks of the last evaluation are restored (the extension holding them is rebuilt)
  patternHighlight: (v, h) => set('isPatternHighlightingEnabled', extensions.isPatternHighlightingEnabled(v, h)),
};

/** Effects that bring the view in line with `prefs` (only what differs from `prev`, when given). */
export function prefsEffects(prefs: EditorPrefs, prev?: EditorPrefs | null, highlight?: Highlight): StateEffect<unknown>[] {
  return (Object.keys(APPLY) as (keyof EditorPrefs)[])
    .filter((k) => !prev || prev[k] !== prefs[k])
    .map((k) => (APPLY[k] as (v: unknown, h?: Highlight) => StateEffect<unknown>)(prefs[k], highlight));
}

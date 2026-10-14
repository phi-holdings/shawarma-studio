// Section outline for the status bar: each section of the song map with the place in the code that
// names it (its header comment, else its definition, else its arrange() entry).
import { arrangeLayout, type Section, type SongMap } from '@shawarma/shared';

export interface OutlineItem { section: Section; pos: number | null }

export function sectionOutline(code: string, map: SongMap | null): OutlineItem[] {
  if (!map) return [];
  const layout = arrangeLayout(code);
  const aligned = layout && layout.entries.length === map.sections.length;
  return map.sections.map((section, i) => ({
    section,
    pos: aligned ? layout.headers[i] ?? layout.defs[i] ?? layout.entries[i].from : null,
  }));
}

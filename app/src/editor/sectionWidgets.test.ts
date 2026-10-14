import { expect, test } from 'vitest';
import { buildSongMap } from '@shawarma/shared';
import { activeSection, deriveMarks, fmtTime, songCycle } from './sectionWidgets';

const map = buildSongMap([4, 2, 2], ['intro', 'verse', 'end'], 0.5)!;

test('song position for each play mode wraps at the arrangement length', () => {
  expect(songCycle({ kind: 'song' }, 9, 8)).toBe(1);
  expect(songCycle({ kind: 'from', startCycle: 4 }, 1.5, 8)).toBe(5.5);
  expect(songCycle({ kind: 'from', startCycle: 6 }, 3, 8)).toBe(1);
  expect(songCycle({ kind: 'loop', startCycle: 4, cycles: 2 }, 7.25, 8)).toBe(5.25);
  expect(songCycle({ kind: 'other' }, 1, 8)).toBeNull();
  expect(songCycle({ kind: 'song' }, 1, 0)).toBeNull();
});

test('the active section follows the scheduler time', () => {
  expect(activeSection(map, { kind: 'song' }, 0.5)).toBe(0);
  expect(activeSection(map, { kind: 'from', startCycle: 4 }, 0.1)).toBe(1);
  expect(activeSection(map, { kind: 'loop', startCycle: 6, cycles: 2 }, 13)).toBe(2);
  expect(activeSection(null, { kind: 'song' }, 1)).toBeNull();
});

test('marks: the song widget on line 1 and the arrange( line, a widget per entry, matched header and definition', () => {
  const code = 'setcpm(30)\n// == INTRO ==\nconst a = s("bd")\narrange(\n  [4, a], // intro\n  [2, s("hh")], // verse\n  [2, silence] // end\n)';
  const marks = deriveMarks(code, map);
  expect(marks.map((m) => [m.where, m.section?.label ?? null, m.pos])).toEqual([
    ['song', null, 0],
    ['song', null, code.indexOf('arrange(')],
    ['entry', 'intro', code.indexOf('[4, a]')],
    ['header', 'intro', code.indexOf('// == INTRO')],
    ['def', 'intro', code.indexOf('const a')],
    ['entry', 'verse', code.indexOf('[2, s(')],
    ['entry', 'end', code.indexOf('[2, silence]')],
  ]);
  // no arrange(): only the song widget, on line 1; a map that does not fit the code adds nothing
  expect(deriveMarks('s("bd")', null)).toEqual([{ pos: 0, section: null, where: 'song' }]);
  expect(deriveMarks('arrange([1, a], [1, b])', map)).toHaveLength(1);
  expect(fmtTime(16)).toBe('0:16');
  expect(fmtTime(75.9)).toBe('1:15');
});

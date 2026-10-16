import { expect, test } from 'vitest';
import { inspect } from './inspect';
// the app's New project templates (plain data, no browser imports)
import { TEMPLATES } from '../../app/src/projects/templates';

test('there are five templates with distinct ids', () => {
  expect(TEMPLATES).toHaveLength(5);
  expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(5);
});

for (const t of TEMPLATES) {
  test(`template "${t.name}" evaluates clean, with the hosted sound packs too`, async () => {
    const hosted = await inspect(t.code, { packs: 'hosted' });
    expect(hosted.issues).toEqual([]);
    const r = await inspect(t.code);
    expect(r.ok, r.error).toBe(true);
    // unknown_sound is only checked when the sample maps are reachable; any issue at all fails here
    expect(r.issues).toEqual([]);
    expect(r.sectionEventCounts.every((n) => n > 0)).toBe(true);
  }, 60_000);
}

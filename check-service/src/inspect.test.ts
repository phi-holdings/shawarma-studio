import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { inspect, queryEvents } from './inspect';

const fx = (n: string) => fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

describe('inspect', () => {
  test('catdance: 14 sections, 200 s, no blocking issues', async () => {
    const r = await inspect(fx('catdance.strudel.js'));
    expect(r.ok).toBe(true);
    expect(r.map!.sections).toHaveLength(14);
    expect(r.map!.durationSec).toBe(200);
    expect(r.map!.sections[0].label).toBe('I.   choir a cappella');
    expect(r.issues.filter((i) => i.kind !== 'empty_section')).toEqual([]);
  });

  test('double-quoted key → missing_note issue', async () => {
    const r = await inspect(fx('double-quotes.strudel.js'));
    expect(r.issues.map((i) => i.kind)).toContain('missing_note');
  });

  test('helper shadowing a Strudel name → issue mentioning piano', async () => {
    const r = await inspect(fx('piano-shadow.strudel.js'));
    expect(r.issues.some((i) => /piano/.test(i.message))).toBe(true);
  });

  test('leading paren → eval_error', async () => {
    const r = await inspect(fx('leading-paren.strudel.js'));
    expect(r.ok).toBe(false);
    expect(r.issues[0].kind).toBe('eval_error');
  });

  test('no arrange → map null, 8 cycles checked', async () => {
    const r = await inspect(fx('no-arrange.strudel.js'));
    expect(r.map).toBeNull();
    expect(r.checkedCycles).toBe(8);
    expect(r.sectionEventCounts[0]).toBeGreaterThan(0);
  });

  test('unknown sound is reported', async () => {
    const r = await inspect('s("definitely_not_a_sound")');
    expect(r.issues.map((i) => i.kind)).toContain('unknown_sound');
  });

  test('heavy pattern is truncated, not hung', async () => {
    const r = await inspect('setcpm(30)\narrange([100, s("bd*4096")])');
    expect(r.issues.map((i) => i.kind)).toContain('truncated');
  });

  test('very long sparse song stops at the cycle/time limit', async () => {
    const t = Date.now();
    const r = await inspect('setcpm(30)\narrange([1e8, s("bd").slow(1e6)])');
    expect(Date.now() - t).toBeLessThan(6000);
    const issue = r.issues.find((i) => i.kind === 'truncated');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/cycles|ms/);
  });
});

test('queryEvents lists notes in a window', async () => {
  const q = await queryEvents('note("c4 e4").s("sine")', 0, 1);
  expect(q).toMatchObject({ clipped: false });
  expect(q.events.map((r) => r.note)).toEqual(['c4', 'e4']);
});

describe('truncation is never silent', () => {
  test('cycle limit: sections after the checked part are unchecked, not "empty"', async () => {
    const r = await inspect('setcpm(30)\narrange([2000, s("bd")], [10, s("sd")], [4, s("hh")])');
    expect(r.truncated).toBe(true);
    expect(r.checkedCycles).toBe(2000);
    expect(r.uncheckedFromSec).toBe(4000);
    expect(r.issues.map((i) => i.kind)).toContain('truncated');
    expect(r.issues.find((i) => i.kind === 'truncated')!.message).toMatch(/from 4000 s \(cycle 2000\) on is unchecked/);
    expect(r.issues.filter((i) => i.kind === 'empty_section')).toEqual([]);
  });

  test('event limit: a partly checked section is not flagged; fully checked silent ones still are', async () => {
    const r = await inspect('setcpm(30)\narrange([2, silence], [60, s("bd*4096")], [4, s("sd")])');
    expect(r.truncated).toBe(true);
    expect(r.checkedCycles).toBeGreaterThan(2);
    expect(r.checkedCycles).toBeLessThan(62);
    expect(r.issues.find((i) => i.kind === 'truncated')!.message).toMatch(/events limit/);
    expect(r.issues.filter((i) => i.kind === 'empty_section')).toEqual([]);
    // a silent first section without "silence" in its label is fully checked and still reported
    const r2 = await inspect('setcpm(30)\narrange([2, s("~")], [60, s("bd*4096")], [4, s("sd")])');
    expect(r2.issues.filter((i) => i.kind === 'empty_section')).toHaveLength(1);
    expect(r2.issues.find((i) => i.kind === 'empty_section')!.message).toMatch(/"s\("~"\)"/);
  });

  test('an untruncated report has no truncated flag', async () => {
    const r = await inspect('setcpm(30)\narrange([2, s("bd")], [2, s("~")])');
    expect(r.truncated).toBeUndefined();
    expect(r.uncheckedFromSec).toBeUndefined();
    expect(r.checkedCycles).toBe(4);
    expect(r.issues.map((i) => i.kind)).toEqual(['empty_section']);
  });

  test('queryEvents beyond 2000 cycles says it clipped', async () => {
    const q = await queryEvents('s("bd")', 0, 5000);
    expect(q.clipped).toBe(true);
    if (!q.clipped) return;
    expect(q).toMatchObject({ reason: 'cycles', checkedToCycle: 2000 });
    expect(q.events).toHaveLength(200);
    expect(q.note).toMatch(/2000-cycle query limit: only cycles 0-2000 of 0-5000/);
  });

  test('queryEvents with more matching events than the row limit says so', async () => {
    const q = await queryEvents('s("bd*16")', 0, 20);
    expect(q).toMatchObject({ clipped: true, reason: 'rows', totalMatching: 320 });
    expect(q.events).toHaveLength(200);
    if (q.clipped) expect(q.note).toMatch(/320 events matched, only the first 200/);
  });
});

test('several arrange() calls: the last is used and an issue says so', async () => {
  const r = await inspect('setcpm(30)\nconst a = arrange([1, s("bd")])\narrange([2, s("sd")], [2, s("hh")])');
  expect(r.map!.sections.map((s) => s.cycles)).toEqual([2, 2]);
  expect(r.issues).toContainEqual({ kind: 'multiple_arrange', message: 'multiple arrange() calls (2); using the last' });
});

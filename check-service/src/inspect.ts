import { arrangeInfo, buildSongMap, type EventQuery, type InspectReport, type Issue } from '@shawarma/shared';
import { FALLBACK_CYCLES, INSPECT_DEADLINE_MS, MAX_CYCLES, MAX_EVENTS } from './sandbox/limits.mjs';
import { sandboxAnalyse, sandboxQuery } from './sandbox';
import { knownSounds } from './sounds';

export { INSPECT_DEADLINE_MS, MAX_CYCLES, MAX_EVENTS };

// names user code must not redefine (Strudel pattern methods/functions)
const RESERVED = ['piano', 'note', 'sound', 'gain', 'stack', 'arrange', 'silence'];

/** Check a song. The code itself only ever runs in the sandbox process (see sandbox.ts). */
export async function inspect(code: string, opts: { extraSounds?: Iterable<string> } = {}): Promise<InspectReport> {
  const extra = new Set(opts.extraSounds ?? []);   // e.g. the project's own samples folder names
  const issues: Issue[] = [];
  for (const name of RESERVED) {
    if (new RegExp(`\\b(const|let|var|function)\\s+${name}\\b`).test(code)) {
      issues.push({ kind: 'shadowed_name', message: `"${name}" is a Strudel name; rename your helper (e.g. "${name}Part")` });
    }
  }
  let ev;
  try {
    ev = await sandboxAnalyse(code);
  } catch (e) {
    issues.unshift({ kind: 'eval_error', message: String((e as Error).message ?? e) });
    return { ok: false, error: issues[0].message, map: null, checkedCycles: 0, issues, sectionEventCounts: [], sounds: [] };
  }
  const arrangement = arrangeInfo(code);
  if (arrangement.calls > 1) issues.push({ kind: 'multiple_arrange', message: `multiple arrange() calls (${arrangement.calls}); using the last` });
  const map = buildSongMap(ev.arrangeWeights, arrangement.labels, ev.cps);
  // sections ending after this cycle were not (fully) queried: no "silent" verdict for them
  const checkedCycles = ev.truncated ? ev.checkedCycles : map ? map.totalCycles : FALLBACK_CYCLES;
  const uncheckedFromSec = ev.truncated ? Number((checkedCycles / ev.cps).toFixed(3)) : undefined;
  if (ev.truncated) {
    const why = ev.limit === 'events' ? `${MAX_EVENTS} events` : ev.limit === 'cycles' ? `${MAX_CYCLES} cycles` : `${INSPECT_DEADLINE_MS} ms`;
    issues.push({ kind: 'truncated', message: `stopped after ${why} (${ev.limit} limit); checks are partial: everything from ${uncheckedFromSec} s (cycle ${checkedCycles}) on is unchecked` });
  }
  if (ev.eventCount === 0) issues.push({ kind: 'no_events', message: ev.truncated ? `no sound events in the checked part (up to ${uncheckedFromSec} s)` : 'the song produces no sound events' });
  if (ev.missingNote) issues.push({ kind: 'missing_note', message: `${ev.missingNote} synth events have no note (often a "double-quoted" key passed to a helper — use 'single quotes')` });

  const known = await knownSounds(); // null when offline: skip the check rather than guess
  const isKnown = (n: string) => known!.has(n) || extra.has(n);
  const unknown = known ? ev.sounds.filter((s) => !isKnown(s) && !isKnown(s.split(':')[0])) : [];
  if (unknown.length) issues.push({ kind: 'unknown_sound', message: `unknown sounds: ${unknown.join(', ')}` });

  const sectionEventCounts = ev.sectionEventCounts;
  map?.sections.forEach((s, i) => {
    const fullyChecked = s.startCycle + s.cycles <= checkedCycles;
    if (fullyChecked && sectionEventCounts[i] === 0 && !/silence|end/i.test(s.label)) {
      issues.push({ kind: 'empty_section', message: `section "${s.label}" is silent` });
    }
  });
  return {
    ok: !issues.some((i) => i.kind === 'eval_error'),
    map,
    checkedCycles,
    ...(ev.truncated ? { truncated: true, uncheckedFromSec } : {}),
    issues,
    sectionEventCounts,
    sounds: ev.sounds,
  };
}

const CLIP_REASON = { cycles: `the ${MAX_CYCLES}-cycle query limit`, events: `the ${MAX_EVENTS}-event limit`, time: `the ${INSPECT_DEADLINE_MS} ms time limit`, rows: 'the row limit' } as const;

/** Events between two cycles. A clipped listing says so (reason + how far it goes), never silently. */
export async function queryEvents(code: string, fromCycle: number, toCycle: number, sound?: string, limit = 200): Promise<EventQuery> {
  const r = await sandboxQuery(code, fromCycle, toCycle, sound, limit);
  if (!r.clipped) return { events: r.rows, clipped: false };
  const note = r.reason === 'rows'
    ? `clipped: ${r.totalMatching} events matched, only the first ${limit} (up to cycle ${r.checkedToCycle}) are listed; query a narrower window for the rest`
    : `clipped by ${CLIP_REASON[r.reason]}: only cycles ${fromCycle}-${r.checkedToCycle} of ${fromCycle}-${toCycle} were queried; query from cycle ${r.checkedToCycle} for the rest`;
  return { events: r.rows, clipped: true, reason: r.reason, checkedToCycle: r.checkedToCycle, totalMatching: r.totalMatching, note };
}

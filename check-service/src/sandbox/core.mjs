// Headless Strudel evaluation. Plain JS so the sandbox child process (child.mjs) can load it with
// bare `node` under the permission model, without a TypeScript loader. Never import this from the
// server process itself: it runs user code with whatever privileges the importing process has.
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';

import { FALLBACK_CYCLES, INSPECT_DEADLINE_MS, MAX_CYCLES, MAX_EVENTS } from './limits.mjs';

export { FALLBACK_CYCLES, INSPECT_DEADLINE_MS, MAX_CYCLES, MAX_EVENTS };
const SYNTH_NEEDS_PITCH = new Set(['sine', 'square', 'triangle', 'sawtooth', 'saw', 'tri', 'sqr', 'supersaw', 'pulse']);

const DEFAULT_CPS = 0.5;
let ready = null;
let captured = { cps: DEFAULT_CPS, arrange: null };
let queue = Promise.resolve();

function init() {
  ready ??= (async () => {
    await core.evalScope(core, mini, tonal);
    const g = globalThis;
    // capture tempo instead of driving a scheduler
    g.setcps = (v) => { captured.cps = Number(v); };
    g.setcpm = (v) => { captured.cps = Number(v) / 60; };
    // the transpiler rewrites slider(v, min, max) into sliderWithID(id, v, min, max)
    g.sliderWithID = (_id, value) => core.pure(value);
    g.slider = (value) => core.pure(value);
    // browser-only helpers become no-ops
    for (const name of ['samples', 'hush', 'aliasBank', 'soundAlias', 'loadSoundfont']) g[name] = async () => {};
    // visuals (@strudel/draw, the app's inline widgets) are drawn in the browser: here they leave the pattern as is
    for (const name of ['pianoroll', 'punchcard', 'spiral', 'scope', 'tscope', 'fscope', 'spectrum', 'pitchwheel']) {
      for (const n of [name, `_${name}`]) core.Pattern.prototype[n] ??= function () { return this; };
    }
    const original = core.arrange;
    g.arrange = (...sections) => {
      captured.arrange = sections.map((s) => Number(Array.isArray(s) ? s[0] : 1));
      return original(...sections);
    };
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// A small song touching the common surface (mini-notation, chords, stack, arrange, effects, slider,
// signals, superimpose/off) so the transpiler, mini parser and query code are warm before real use.
const WARMUP_SONG = `setcpm(30)
const chords = note(\`<[d3,f3,a3] [bb2,d3,f3] [c3,e3,g3] [a2,c3,e3]>\`).s("gm_choir_aahs").attack(.5).release(1).gain(.4).room(.8)
const mel = note("<[d5@2 e5 f5@2 e5 d5 c#5 d5@2] [a5@3 g5 f5@2 e5 f5 e5 d5]>").s("gm_dulcimer").off(1/8, x => x.add(note(12)).gain(.2))
const lead = n("0 2 4 <5 7>").scale('D:minor').s("sawtooth").lpf(sine.range(400, 2000).slow(4)).superimpose(x => x.add(note(-12)))
const drums = stack(s("bd*2 [~ bd] bd ~").bank("RolandTR909"), s("~ sd").gain(slider(.8, 0, 1)), s("hh*8").gain(.4).struct("x x ~ x x ~ x x"))
const intro = stack(chords, mel)
arrange([4, intro], [4, stack(chords, lead, drums)], [2, drums.mask("<1 0>")], [2, silence])
`;

/**
 * Load Strudel's scope and run a representative song several times, so the first real request in a
 * fresh sandbox child does not pay for module initialisation and cold (unoptimised) parser/query code.
 */
export async function warmup(rounds = 3) {
  await init();
  for (let r = 0; r < rounds; r++) {
    const { pattern } = await core.evaluate(WARMUP_SONG, transpiler);
    for (let c = 0; c < 12; c++) for (const h of pattern.queryArc(c, c + 1)) if (h.hasOnset()) h.whole.begin.valueOf();
  }
  captured = { cps: DEFAULT_CPS, arrange: null };
}

/** Evaluate code with real Strudel semantics but no audio. Serialised: Strudel scope is global. */
export function evaluateHeadless(code) {
  const run = async () => {
    await init();
    captured = { cps: DEFAULT_CPS, arrange: null };
    const { pattern } = await core.evaluate(code, transpiler);
    return { pattern, cps: captured.cps, arrangeWeights: captured.arrange };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Onset haps in [from, to), bounded by events, cycles and a wall-clock deadline.
 * `checkedTo` is the cycle up to which the window was queried completely: haps at or after it may be
 * missing when the result is truncated.
 */
export function onsets(pattern, from, to, deadline = Date.now() + INSPECT_DEADLINE_MS) {
  const out = [];
  const end = Math.min(to, from + MAX_CYCLES);
  let limit = to > end ? 'cycles' : null;
  let checkedTo = end;
  for (let c = from; c < end; c += 1) {
    if (Date.now() > deadline) { limit = 'time'; checkedTo = c; break; }
    for (const h of pattern.queryArc(c, Math.min(c + 1, end))) {
      if (h.hasOnset()) out.push(h);
      if (out.length >= MAX_EVENTS) return { haps: out, truncated: true, limit: 'events', checkedTo: c };
    }
  }
  return { haps: out, truncated: limit !== null, limit, checkedTo };
}

/**
 * Evaluate and summarise a song. Returns only plain data (it crosses a process boundary).
 * The deadline for event collection counts from `startedAt` so the caller's hard kill timeout
 * keeps a margin for evaluation and summarising.
 */
export async function analyse(code, startedAt = Date.now()) {
  const ev = await evaluateHeadless(code);
  const weights = ev.arrangeWeights && ev.arrangeWeights.length ? ev.arrangeWeights : null;
  const totalCycles = weights ? weights.reduce((a, b) => a + b, 0) : FALLBACK_CYCLES;
  const { haps, truncated, limit, checkedTo } = onsets(ev.pattern, 0, totalCycles, startedAt + INSPECT_DEADLINE_MS);

  const sounds = new Set();
  let missingNote = 0;
  for (const h of haps) {
    const v = h.value ?? {};
    const name = v.bank && v.s ? `${v.bank}_${v.s}` : v.s ?? (v.note !== undefined ? 'triangle' : undefined);
    if (name) sounds.add(String(name));
    if (v.s && SYNTH_NEEDS_PITCH.has(v.s) && v.note === undefined && v.n === undefined && v.freq === undefined) missingNote++;
  }

  let sectionEventCounts;
  if (weights) {
    const starts = [];
    let s = 0;
    for (const w of weights) { starts.push(s); s += w; }
    sectionEventCounts = weights.map(() => 0);
    for (const h of haps) {
      const b = h.whole.begin.valueOf();
      for (let i = 0; i < weights.length; i++) {
        if (b >= starts[i] && b < starts[i] + weights[i]) sectionEventCounts[i]++;
      }
    }
  } else {
    sectionEventCounts = [haps.length];
  }
  return { cps: ev.cps, arrangeWeights: weights, eventCount: haps.length, truncated, limit, checkedCycles: checkedTo, sounds: [...sounds], missingNote, sectionEventCounts };
}

const plain = (v) => (v === undefined || typeof v === 'number' || typeof v === 'string' ? v : String(v));

/**
 * Event rows between two cycles (plain data). Never truncates silently: `clipped` is set (with the
 * reason and the cycle up to which the window was fully queried) when the cycle, event or time limit
 * stopped the query, or when more rows matched than `limit`.
 */
export async function queryRows(code, fromCycle, toCycle, sound, limit = 200, startedAt = Date.now()) {
  const ev = await evaluateHeadless(code);
  const q = onsets(ev.pattern, fromCycle, toCycle, startedAt + INSPECT_DEADLINE_MS);
  const matching = q.haps
    .filter((h) => !sound || h.value?.s === sound)
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
  const rows = matching
    .slice(0, limit)
    .map((h) => ({
      cycle: Number(h.whole.begin.valueOf().toFixed(4)),
      sec: Number((h.whole.begin.valueOf() / ev.cps).toFixed(3)),
      sound: h.value?.s ?? 'triangle',
      note: plain(h.value?.note ?? h.value?.n),
      gain: typeof h.value?.gain === 'number' ? h.value.gain : undefined,
    }));
  if (q.truncated) return { rows, clipped: true, reason: q.limit, checkedToCycle: q.checkedTo, totalMatching: null };
  if (matching.length > limit) return { rows, clipped: true, reason: 'rows', checkedToCycle: rows[rows.length - 1]?.cycle ?? fromCycle, totalMatching: matching.length };
  return { rows, clipped: false };
}

/** Cycles queried from the start, and around each arrange() section start, by precheck(). */
export const PRECHECK_START_CYCLES = 8;
export const PRECHECK_SECTION_CYCLES = 2;

/**
 * Pre-flight for the browser: evaluate the song and query its first cycles and the first cycles of each
 * section. A song that hangs here is killed by the parent's hard timeout (the caller refuses it); a
 * song that merely runs long is cut off by the soft deadline and reported as checked up to there.
 */
export async function precheck(code, startedAt = Date.now()) {
  const ev = await evaluateHeadless(code);
  // well inside the 3 s hard timeout: long but finite work is cut short, not refused
  const deadline = startedAt + 2000;
  const windows = [[0, PRECHECK_START_CYCLES]];
  let at = 0;
  for (const w of ev.arrangeWeights ?? []) { if (at > 0) windows.push([at, at + PRECHECK_SECTION_CYCLES]); at += w; }
  let queried = 0;
  for (const [from, to] of windows) {
    const r = onsets(ev.pattern, from, to, deadline);
    queried += r.checkedTo - from;
    if (r.truncated && r.limit === 'time') return { cyclesQueried: queried, windows: windows.length, cutShort: true };
  }
  return { cyclesQueried: queried, windows: windows.length, cutShort: false };
}

import { beforeEach, expect, test, vi } from 'vitest';

const renderChunks = vi.fn();
const pushed: Float32Array[][] = [];
const upload = {
  push: vi.fn(async (chs: Float32Array[]) => { pushed.push(chs); }),
  finish: vi.fn(async (_o: object) => ({ wav: 'a.wav', mp3: 'a.mp3', peakDb: -1 })),
  abort: vi.fn(async () => {}),
};
vi.mock('../audio/render', () => ({ renderChunks: (...a: unknown[]) => renderChunks(...a) }));
vi.mock('../api', () => ({
  inspectCode: vi.fn(async () => ({ map: { totalCycles: 4, sections: [{ label: 'A', startSec: 0, endSec: 1 }] } })),
  startExportUpload: vi.fn(async () => upload),
}));

import { analyseRange, exportSong } from './exportSong';

const editor = () => ({ stop: vi.fn(), getCode: () => 'x', evaluatePattern: vi.fn(async () => ({ pattern: { code: 'x' }, cps: 0.5 })) }) as any;
/** renderChunks stand-in: delivers the given chunks to the callback, like the runtime does. */
const delivering = (chunks: Float32Array[][], missing: string[] = [], kinds = { normal: chunks.length, long: 0, single: 0 }) => async (_p: unknown, _c: number, _b: number, _e: number, onChunk: (chs: Float32Array[]) => Promise<void> | void) => {
  for (const c of chunks) await onChunk(c);
  return { sampleRate: 48000, length: chunks.reduce((n, c) => n + c[0].length, 0), chunks: chunks.length, kinds, missing };
};

beforeEach(() => { renderChunks.mockReset(); pushed.length = 0; Object.values(upload).forEach((f) => f.mockClear()); });

test('exportSong streams every chunk to the server and lets it normalise', async () => {
  const a = [new Float32Array([0, 1.8]), new Float32Array(2)];
  const b = [new Float32Array([0.3]), new Float32Array(1)];
  renderChunks.mockImplementation(delivering([a, b]));
  const r = await exportSong(editor(), 'p', { small: true });
  expect(renderChunks).toHaveBeenCalledTimes(1);
  expect(pushed).toEqual([a, b]);
  expect(upload.finish).toHaveBeenCalledWith({ sampleRate: 48000, channels: 2, small: true });
  expect(r.peakDb).toBe(-1);
});

test('exportSong throws naming missing sounds and drops the partial upload', async () => {
  renderChunks.mockImplementation(delivering([[new Float32Array(4), new Float32Array(4)]], ['foo', 'bar']));
  await expect(exportSong(editor(), 'p')).rejects.toThrow(/foo, bar/);
  expect(upload.abort).toHaveBeenCalled();
  expect(upload.finish).not.toHaveBeenCalled();
});

test('a failed render aborts the upload', async () => {
  renderChunks.mockRejectedValue(new Error('boom'));
  await expect(exportSong(editor(), 'p')).rejects.toThrow('boom');
  expect(upload.abort).toHaveBeenCalled();
});

test('analyseRange stops the live editor first, analyses chunk by chunk and reports missing sounds', async () => {
  const c1 = [new Float32Array(48000).fill(0.5), new Float32Array(48000)];
  renderChunks.mockImplementation(delivering([c1], ['foo']));
  const e = editor();
  const r = await analyseRange(e, 'x', 0, 1);
  expect(e.stop).toHaveBeenCalled();
  expect(r.missing).toEqual(['foo']);
  expect(r.sections[0].peakDb).toBeCloseTo(-6.02, 1);
  expect(r.toSec).toBeCloseTo(1, 6);
});

test('exportSong flags a render that needed long single-piece chunks (a drone)', async () => {
  const c = [new Float32Array(4), new Float32Array(4)];
  renderChunks.mockImplementation(delivering([c], [], { normal: 0, long: 1, single: 0 }));
  expect((await exportSong(editor(), 'p')).longRender).toBe(true);
  renderChunks.mockImplementation(delivering([c]));
  expect((await exportSong(editor(), 'p')).longRender).toBeUndefined();
});

test('exportSong renders only the chosen section or cycle range, under its own file name', async () => {
  const api = await import('../api');
  const map = { cps: 0.5, totalCycles: 12, durationSec: 24, sections: [
    { index: 0, label: 'intro', startCycle: 0, cycles: 4, startSec: 0, endSec: 8 },
    { index: 1, label: 'drop', startCycle: 4, cycles: 8, startSec: 8, endSec: 24 },
  ] };
  vi.mocked(api.inspectCode).mockResolvedValue({ map } as any);
  renderChunks.mockImplementation(delivering([[new Float32Array(2), new Float32Array(2)]]));
  const r = await exportSong(editor(), 'night', { range: { kind: 'section', index: 1 } });
  expect(renderChunks.mock.calls[0].slice(1, 4)).toEqual([0.5, 4, 12]);
  expect(api.startExportUpload).toHaveBeenLastCalledWith('night', 'night-section-2-drop');
  expect(r.range).toEqual({ from: 4, to: 12, label: 'drop' });

  await exportSong(editor(), 'night', { range: { kind: 'cycles', from: 1, to: 3 } });
  expect(renderChunks.mock.calls[1].slice(2, 4)).toEqual([1, 3]);
  expect(api.startExportUpload).toHaveBeenLastCalledWith('night', 'night-cycles-1-3');

  await exportSong(editor(), 'night');
  expect(renderChunks.mock.calls[2].slice(2, 4)).toEqual([0, 12]);
  expect(api.startExportUpload).toHaveBeenLastCalledWith('night', undefined);   // whole song keeps the usual name

  // a bad range fails before anything is uploaded
  vi.mocked(api.startExportUpload).mockClear();
  await expect(exportSong(editor(), 'night', { range: { kind: 'cycles', from: 0, to: 99 } })).rejects.toThrow(/12 cycles long/);
  expect(api.startExportUpload).not.toHaveBeenCalled();
});

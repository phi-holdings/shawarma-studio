import type { SongMap } from './types';

export function buildSongMap(weights: number[] | null, labels: string[] | null, cps: number): SongMap | null {
  if (!weights || weights.length === 0) return null;
  const useLabels = labels && labels.length === weights.length ? labels : null;
  let start = 0;
  const sections = weights.map((cycles, index) => {
    const s = {
      index,
      label: useLabels ? useLabels[index] : `Section ${index + 1}`,
      startCycle: start,
      cycles,
      startSec: start / cps,
      endSec: (start + cycles) / cps,
    };
    start += cycles;
    return s;
  });
  return { cps, totalCycles: start, durationSec: start / cps, sections };
}

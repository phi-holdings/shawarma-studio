import type { AnalysisReport } from '@shawarma/shared';

export const DB_FLOOR = -120;
export const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : DB_FLOOR);

type SectionSpec = { label: string; startSec: number; endSec: number };
interface Acc { peak: number; sum: number; clipped: number; n: number }
const acc = (): Acc => ({ peak: 0, sum: 0, clipped: 0, n: 0 });
const result = (a: Acc) => ({ peakDb: db(a.peak), rmsDb: db(Math.sqrt(a.sum / Math.max(a.n, 1))), clipped: a.clipped });

/**
 * Per-section level statistics computed incrementally, chunk by chunk, so a long render never has
 * to exist as one buffer. `push` takes consecutive chunks (`channels[c]`, all the same length).
 */
export class SectionAnalyser {
  private at = 0;
  private all = acc();
  private secs: { spec: SectionSpec; a: number; b: number; acc: Acc }[];

  constructor(private sampleRate: number, private offsetSec: number, sections: SectionSpec[]) {
    const toIdx = (sec: number) => Math.round((sec - offsetSec) * sampleRate);
    this.secs = sections.map((spec) => ({ spec, a: toIdx(spec.startSec), b: toIdx(spec.endSec), acc: acc() }));
  }

  private static add(a: Acc, chs: Float32Array[], from: number, to: number) {
    for (const c of chs) for (let i = from; i < to; i++) {
      const x = Math.abs(c[i]); if (x > a.peak) a.peak = x; if (x >= 0.9999) a.clipped++; a.sum += x * x; a.n++;
    }
  }

  push(chs: Float32Array[]) {
    const len = chs[0]?.length ?? 0;
    const start = this.at;
    SectionAnalyser.add(this.all, chs, 0, len);
    for (const s of this.secs) {
      const from = Math.max(s.a, start) - start, to = Math.min(s.b, start + len) - start;
      if (to > from) SectionAnalyser.add(s.acc, chs, from, to);
    }
    this.at += len;
  }

  report(): AnalysisReport {
    const len = this.at, off = this.offsetSec, sr = this.sampleRate;
    const sections = this.secs
      .filter((s) => s.spec.endSec > off && s.spec.startSec < off + len / sr)
      .map((s) => ({ label: s.spec.label, ...result(s.acc) }));
    const all = result(this.all);
    return { fromSec: off, toSec: off + len / sr, peakDb: all.peakDb, clipped: all.clipped, sections };
  }
}

export function analyseChannels(chs: Float32Array[], sampleRate: number, offsetSec: number, sections: SectionSpec[]): AnalysisReport {
  const a = new SectionAnalyser(sampleRate, offsetSec, sections);
  a.push(chs);
  return a.report();
}

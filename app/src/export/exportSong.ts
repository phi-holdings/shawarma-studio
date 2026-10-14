import type { AnalysisReport } from '@shawarma/shared';
import { inspectCode, startExportUpload, type ExportResult } from '../api';
import type { EditorHandle } from '../editor/Editor';
import { SectionAnalyser } from '../audio/analysis';
import { missingSoundsMessage } from '../audio/missing';
import { renderChunks } from '../audio/render';
import { type ExportRange, rangeExportName, resolveRange } from './range';

/**
 * Renders the song chunk by chunk in the runtime and streams each chunk as float32 to the server,
 * which normalises to -1 dBFS (offline output is float, so peaks above full scale survive and one
 * gain fixes them: no re-render) and writes WAV + MP3. The browser never holds the whole song.
 */
export async function exportSong(
  editor: EditorHandle, projectId: string, opts: { small?: boolean; name?: string; range?: ExportRange } = {},
): Promise<ExportResult & { range: { from: number; to: number; label: string } }> {
  editor.stop();
  const code = editor.getCode();
  const report = await inspectCode(code);
  // the range is resolved against the code being exported (sections may have moved since the popover opened)
  const range = resolveRange(opts.range ?? { kind: 'all' }, report.map ?? null);
  const { pattern, cps } = await editor.evaluatePattern(code);
  const upload = await startExportUpload(projectId, opts.name ?? rangeExportName(projectId, range));
  let rendered;
  try {
    rendered = await renderChunks(pattern, cps, range.from, range.to, (chs) => upload.push(chs));
  } catch (e) {
    await upload.abort();
    throw e;
  }
  if (rendered.missing.length) { await upload.abort(); throw new Error(missingSoundsMessage(rendered.missing)); }
  const result = await upload.finish({ sampleRate: rendered.sampleRate, channels: 2, small: opts.small });
  // a sound that never stops ringing leaves no quiet seam: those stretches were rendered in one long
  // piece (still exact, but memory grows with their length) — tell the user why the export was heavy
  const k = rendered.kinds;
  const span = { from: range.from, to: range.to, label: range.label };
  return k && (k.long || k.single) ? { ...result, longRender: true, range: span } : { ...result, range: span };
}

export async function analyseRange(editor: EditorHandle, code: string, fromSec: number, toSec: number): Promise<AnalysisReport & { missing?: string[] }> {
  editor.stop();   // live haps must not leak into the offline context
  const report = await inspectCode(code);
  const { pattern, cps } = await editor.evaluatePattern(code);
  const sections = report.map?.sections ?? [{ label: 'all', startSec: fromSec, endSec: toSec }];
  const sampleRate = 48000;
  const analyser = new SectionAnalyser(sampleRate, fromSec, sections);
  const { missing } = await renderChunks(pattern, cps, fromSec * cps, toSec * cps, (chs) => analyser.push(chs), { sampleRate });
  const result = analyser.report();
  return missing.length ? { ...result, missing } : result;
}

import type { ChunkingOptions } from './chunks';
import { getRuntime } from '../runtime/client';
import type { ChunkKinds, PatternRef } from '../runtime/protocol';

export interface RenderSummary { sampleRate: number; length: number; chunks: number; kinds: ChunkKinds; missing: string[] }

/**
 * Offline render of [begin, end) cycles in the song runtime (the pattern never leaves it), in
 * chunks split at quiet seams (about a minute each; see audio/chunks.ts). Each chunk's channels arrive as transferables and
 * are handed to `onChunk` in order; the runtime renders the next chunk only after `onChunk`
 * resolves, so at most one chunk is held here at a time. A throwing `onChunk` aborts the render.
 */
export async function renderChunks(
  pattern: PatternRef, cps: number, begin: number, end: number,
  onChunk: (channels: Float32Array[], startSample: number) => void | Promise<void>,
  opts: { gainScale?: number; sampleRate?: number; chunking?: Partial<ChunkingOptions> } = {},
): Promise<RenderSummary> {
  let next = 0;
  let failure: unknown = null;
  const r = await getRuntime().request(
    {
      type: 'renderRange', code: pattern.code, cps, begin, end, ack: true,
      sampleRate: opts.sampleRate ?? 48000, gainScale: opts.gainScale ?? 1, ...(opts.chunking ? { chunking: opts.chunking } : {}),
    },
    {
      onChunk: async (index, channels, startSample) => {
        try {
          if (index !== next) throw new Error(`render chunk ${index} arrived out of order (expected ${next})`);
          next++;
          await onChunk(channels, startSample);
        } catch (e) { failure ??= e; throw e; }
      },
    },
  ).catch((e) => { throw failure ?? e; });
  if (next !== r.chunks) throw new Error('render incomplete: the song runtime dropped audio chunks');
  return r;
}

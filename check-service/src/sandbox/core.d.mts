export { FALLBACK_CYCLES, INSPECT_DEADLINE_MS, MAX_CYCLES, MAX_EVENTS } from './limits.mjs';
export type Limit = 'events' | 'cycles' | 'time';
export function evaluateHeadless(code: string): Promise<{ pattern: any; cps: number; arrangeWeights: number[] | null }>;
export function onsets(pattern: any, from: number, to: number, deadline?: number): { haps: any[]; truncated: boolean; limit: Limit | null; checkedTo: number };
export function warmup(): Promise<void>;
export interface Analysis {
  cps: number;
  arrangeWeights: number[] | null;
  eventCount: number;
  truncated: boolean;
  limit: Limit | null;
  /** cycles from 0 that were queried completely */
  checkedCycles: number;
  sounds: string[];
  missingNote: number;
  sectionEventCounts: number[];
}
export function analyse(code: string, startedAt?: number): Promise<Analysis>;
export interface Row { cycle: number; sec: number; sound: string; note?: string | number; gain?: number }
export type QueryResult =
  | { rows: Row[]; clipped: false }
  | { rows: Row[]; clipped: true; reason: Limit | 'rows'; checkedToCycle: number; totalMatching: number | null };
export function queryRows(code: string, fromCycle: number, toCycle: number, sound?: string, limit?: number, startedAt?: number): Promise<QueryResult>;
export const PRECHECK_START_CYCLES: number;
export const PRECHECK_SECTION_CYCLES: number;
export interface PrecheckResult { cyclesQueried: number; windows: number; cutShort: boolean }
export function precheck(code: string, startedAt?: number): Promise<PrecheckResult>;

export interface Range { from: number; to: number }

export interface Section {
  index: number; label: string; startCycle: number; cycles: number; startSec: number; endSec: number;
}
export interface SongMap { cps: number; totalCycles: number; durationSec: number; sections: Section[] }

export type IssueKind = 'eval_error' | 'shadowed_name' | 'no_events' | 'empty_section' | 'missing_note' | 'unknown_sound' | 'truncated' | 'multiple_arrange';
export interface Issue { kind: IssueKind; message: string }

export interface InspectReport {
  ok: boolean;
  error?: string;
  map: SongMap | null;           // null when the code has no arrange()
  checkedCycles: number;         // cycles queried completely (from cycle 0)
  /** set when a limit stopped the check early; sections from uncheckedFromSec on were not (fully) checked */
  truncated?: boolean;
  uncheckedFromSec?: number;
  issues: Issue[];
  sectionEventCounts: number[];  // one per section (or one entry when map is null)
  sounds: string[];              // distinct sound names used
}

export interface EventRow { cycle: number; sec: number; sound: string; note?: string | number; gain?: number }

/** Result of an event query. `clipped` is never silent: it says why and how far the listing goes. */
export type EventQuery =
  | { events: EventRow[]; clipped: false }
  | { events: EventRow[]; clipped: true; reason: 'cycles' | 'events' | 'time' | 'rows'; checkedToCycle: number; totalMatching: number | null; note: string };

export interface SectionLevels { label: string; peakDb: number; rmsDb: number; clipped: number }
export interface AnalysisReport { fromSec: number; toSec: number; peakDb: number; clipped: number; sections: SectionLevels[] }

/**
 * Claude's suggested change, as streamed and as kept in chat.jsonl (role 'proposal'). `partial`: the turn
 * was stopped and these are the edits made until then. `selection`: the range of baseCode the request was
 * limited to. `check`: the automatic check after the last edit (kept out of the summary).
 */
export interface Proposal {
  id: string;
  baseCode: string;
  code: string;
  summary: string[];
  partial?: boolean;
  selection?: Range | null;
  check?: string;
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; summary: string }
  | ({ type: 'proposal' } & Proposal)
  | { type: 'analysis_request'; requestId: string; fromSec: number; toSec: number; code: string }
  | { type: 'done'; costUsd: number; spentTodayUsd: number; stopped?: boolean }
  | { type: 'error'; message: string; /** the API key was refused */ code?: 'auth' }
  /** The edits so far, sent after each edit while the turn is still running (superseded by 'proposal'). */
  | { type: 'proposal_partial'; id: string; baseCode: string; code: string; summary: string[]; selection?: Range | null };

/** What the user did with a proposal (chat.jsonl role 'decision'); the newest decision for a proposal wins. */
export interface Decision {
  proposalId: string;
  status: 'accepted' | 'rejected' | 'reverted';
  /** Hunks taken / offered (accepted only). */
  accepted?: number;
  total?: number;
  /** The version the accept (or revert) wrote, and the head before it. */
  versionId?: string;
  previousVersionId?: string | null;
  reason?: string;
}

/** `id` is a filesystem-safe slug of the name; `name` is the display name as the user typed it. */
export interface ProjectSummary { id: string; name: string; updatedAt: string }
export interface VersionMeta { id: string; createdAt: string; source: 'ai' | 'manual'; message: string }

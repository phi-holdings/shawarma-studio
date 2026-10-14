// The chat as a list of items, the state of each proposal card, and the quick-action suggestions.
// Pure functions, so they are unit-tested without React.
import { friendlyApiError, type Decision, type InspectReport, type Proposal, type Range } from '@shawarma/shared';
import type { StoredChat } from '../api';

export type Item =
  | { kind: 'user'; text: string; selection: Range | null; scope?: string }
  | { kind: 'assistant'; text: string; tools: string[]; cost?: number; stopped?: boolean }
  /** `live`: still being written (proposal_partial events), not yet actionable. */
  | { kind: 'proposal'; proposal: Proposal; live?: boolean }
  /** `auth`: the API key was refused, so the item links to Settings. */
  | { kind: 'error'; text: string; auth?: boolean; upgrade?: boolean };

/** An error item with the API's raw text turned into a plain sentence (see shared/apiErrors.ts). */
export function errorItem(raw: string, auth = false): Item {
  const f = friendlyApiError(raw);
  return { kind: 'error', text: f.message, ...(auth || f.auth ? { auth: true } : {}) };
}

/** Id of a proposal stored before proposals had ids: its position in chat.jsonl (as the server derives it). */
export const legacyId = (index: number) => `legacy-${index}`;

/** Items to show and the newest decision per proposal, from chat.jsonl. */
export function fromStoredChat(chat: StoredChat[]): { items: Item[]; decisions: Map<string, Decision> } {
  const items: Item[] = [];
  const decisions = new Map<string, Decision>();
  chat.forEach((m, i) => {
    if (m.role === 'decision') {
      const { role: _, ...d } = m;
      decisions.set(d.proposalId, d);
    } else if (m.role === 'proposal') {
      const { role: _, ...p } = m;
      items.push({ kind: 'proposal', proposal: { ...p, id: p.id ?? legacyId(i), summary: Array.isArray(p.summary) ? p.summary : [] } });
    } else if (m.role === 'user') {
      items.push({ kind: 'user', text: m.text, selection: m.selection ?? null, ...(m.scope ? { scope: m.scope } : {}) });
    } else if (m.text.startsWith('[error] ')) {
      items.push(errorItem(m.text.slice('[error] '.length)));   // a failed turn, as the server stores it
    } else {
      items.push({ kind: 'assistant', text: m.text, tools: [] });
    }
  });
  return { items, decisions };
}

export type CardStatus = 'live' | 'pending' | 'superseded' | 'accepted' | 'rejected' | 'reverted';

/**
 * Only the newest proposal can be pending: an older one without a decision is superseded (its base is
 * out of date and Claude has moved on). Decided ones show their decision.
 */
export function cardStatuses(items: Item[], decisions: Map<string, Decision>): Map<string, CardStatus> {
  const out = new Map<string, CardStatus>();
  const proposals = items.filter((it): it is Extract<Item, { kind: 'proposal' }> => it.kind === 'proposal');
  const newest = proposals.filter((p) => !p.live).at(-1)?.proposal.id;
  for (const p of proposals) {
    const id = p.proposal.id;
    const d = decisions.get(id);
    out.set(id, p.live ? 'live' : d ? d.status : id === newest ? 'pending' : 'superseded');
  }
  return out;
}

/** Adds or updates the live (still streaming) proposal with this id. */
export function upsertLive(items: Item[], p: Proposal): Item[] {
  const i = items.findIndex((it) => it.kind === 'proposal' && it.proposal.id === p.id);
  if (i < 0) return [...items, { kind: 'proposal', proposal: p, live: true }];
  const copy = [...items];
  copy[i] = { kind: 'proposal', proposal: p, live: true };
  return copy;
}

/** The final proposal replaces its live version (or is added at the end). */
export function settleProposal(items: Item[], p: Proposal): Item[] {
  const rest = items.filter((it) => !(it.kind === 'proposal' && it.proposal.id === p.id));
  return [...rest, { kind: 'proposal', proposal: p }];
}

/** Section-aware suggestions for the composer, e.g. "Add a breakdown after Verse 2". */
export function quickActions(report: InspectReport | null): string[] {
  const sections = report?.map?.sections ?? [];
  const raw = sections.at(-1)?.label?.trim();
  // a label taken from code (e.g. "stack(pad, drone)") reads badly in a sentence: use its number
  const last = raw && !/[()[\],."'`=]/.test(raw) && raw.length <= 28 ? raw : sections.length ? `section ${sections.length}` : undefined;
  const failing = Boolean(report && (!report.ok || report.issues.length > 0));
  return [
    ...(failing ? ['Fix the check issues'] : []),
    'Vary the drums',
    last ? `Add a breakdown after ${last}` : 'Add a breakdown',
    'Listen and tell me what\'s muddy',
  ];
}

/** "$0.012": small amounts keep three decimals, larger ones (and nothing at all) two. */
export const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** The message box after a sound is picked in the Sounds tab: "Add `a`", then "… and `b`". */
export function withSound(draft: string, code: string): string {
  const head = draft.trimEnd();
  return head ? `${head} and \`${code}\`` : `Add \`${code}\``;
}

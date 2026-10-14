// Unsaved editor buffers, one per project, kept in localStorage while they differ from the saved code,
// so a closed tab or a crash never loses work. Saving (or discarding) clears the draft.

export interface Draft { code: string; at: string }

const PREFIX = 'shawarma.draft.';
const key = (projectId: string) => PREFIX + projectId;

/** The stored draft for a project, or null (none, unreadable, or identical to the saved code). */
export function loadDraft(projectId: string, savedCode: string, storage: Storage = localStorage): Draft | null {
  try {
    const raw = storage.getItem(key(projectId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d?.code !== 'string' || typeof d.at !== 'string') return null;
    return d.code === savedCode ? null : { code: d.code, at: d.at };
  } catch {
    return null;
  }
}

/**
 * Keeps the draft in step with the editor: stored while `code` differs from `savedCode`, removed
 * when they match (unless `keepWhenClean`, used while an older draft is still being offered).
 * Storage errors (quota, private mode) are ignored: the draft is a safety net, not the save.
 */
export function syncDraft(projectId: string, code: string, savedCode: string, opts: { keepWhenClean?: boolean; now?: Date; storage?: Storage } = {}): void {
  const storage = opts.storage ?? localStorage;
  try {
    if (code === savedCode) {
      if (!opts.keepWhenClean) storage.removeItem(key(projectId));
      return;
    }
    storage.setItem(key(projectId), JSON.stringify({ code, at: (opts.now ?? new Date()).toISOString() }));
  } catch { /* storage full or unavailable */ }
}

export function clearDraft(projectId: string, storage: Storage = localStorage): void {
  try { storage.removeItem(key(projectId)); } catch { /* unavailable */ }
}

/** "today at 14:05", "yesterday at 09:12", or a date, for the restore banner. */
export function draftTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'earlier';
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `today at ${hm}`;
  if (diff === 1) return `yesterday at ${hm}`;
  return `${d.toLocaleDateString()} at ${hm}`;
}

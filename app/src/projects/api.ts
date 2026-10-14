import type { ProjectSummary } from '@shawarma/shared';
import { OfflineError, failure } from '../api';

// Project housekeeping and export history (server/src/http/projectRoutes.ts, exportsList.ts).

export interface ExportFile { kind: 'wav' | 'mp3' | 'small'; file: string; bytes: number }
export interface ExportEntry { name: string; createdAt: string; durationSec: number | null; files: ExportFile[] }

const call = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new OfflineError(); }
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
};
const send = (method: string, body?: unknown): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const base = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const duplicateProject = (id: string, name?: string) => call<ProjectSummary>(`${base(id)}/duplicate`, send('POST', name ? { name } : {}));
/** Moves the project to the trash: it leaves the list, its data is kept on the server. */
export const deleteProject = (id: string) => call<{ trashed: string }>(base(id), { method: 'DELETE' });
/** Shows the project folder, or one export file, in Finder (macOS). */
export const revealInFinder = (id: string, file?: string) => call<{ ok: true }>(`${base(id)}/reveal`, send('POST', file ? { file } : {}));

export const listExports = (id: string) => call<ExportEntry[]>(`${base(id)}/export-files`);
export const deleteExport = (id: string, name: string) => call<{ ok: true }>(`${base(id)}/export-files/${encodeURIComponent(name)}`, { method: 'DELETE' });
/** URL the server streams an export file from (for an <audio> element). */
export const exportFileUrl = (id: string, file: string) => `${base(id)}/export-files/${encodeURIComponent(file)}`;

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../projects/Modal';
import { type ExportEntry, deleteExport, exportFileUrl, listExports, revealInFinder } from '../projects/api';
import './exports.css';

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

export const formatDuration = (sec: number | null) => {
  if (sec === null || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const KIND_LABEL = { wav: 'WAV', mp3: 'MP3', small: 'Small MP3' } as const;

/**
 * Past exports of the open project, newest first. Each has a native audio player (nothing loads or
 * plays until the user presses play), Reveal in Finder and Delete.
 */
export function ExportsTab(props: { projectId: string | null; refreshKey: number; onNotice(text: string): void; onExport?(): void; exporting?: boolean }) {
  const [list, setList] = useState<ExportEntry[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<ExportEntry | null>(null);
  const { projectId, onNotice } = props;

  const load = useCallback(async () => {
    if (!projectId) { setList(null); return; }
    try { setList(await listExports(projectId)); setError(''); } catch (e) { setError(`Could not load exports: ${(e as Error).message}. Is the server running?`); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load, props.refreshKey]);

  const reveal = async (file?: string) => {
    if (!projectId) return;
    try { await revealInFinder(projectId, file); } catch (e) { onNotice(`Could not reveal in Finder: ${(e as Error).message}`); }
  };
  const remove = async (e: ExportEntry) => {
    setConfirm(null);
    if (!projectId) return;
    try { await deleteExport(projectId, e.name); onNotice(`Deleted export ${e.name}`); } catch (err) { onNotice(`Could not delete ${e.name}: ${(err as Error).message}`); }
    await load();
  };

  if (!projectId) return <div className="exports-empty muted">Open or create a project to see its exports.</div>;
  return (
    <div className="exports-tab">
      <div className="exports-head">
        <h2>Exports</h2>
        <button className="btn btn-outline" onClick={() => void reveal()}>Open project folder</button>
      </div>
      {error && <div role="alert" className="err-text">{error}</div>}
      {list && list.length === 0 && (
        <div className="exports-empty">
          <p>No exports yet. Export renders the song to a WAV and an MP3 in the project folder.</p>
          {props.onExport && <button className="btn btn-primary" disabled={props.exporting} onClick={props.onExport}>Export the song</button>}
        </div>
      )}
      <ul className="export-list" aria-label="Past exports">
        {list?.map((e) => {
          const playable = e.files.find((f) => f.kind === 'mp3') ?? e.files.find((f) => f.kind === 'wav') ?? e.files[0];
          return (
            <li key={e.name} className="export-item">
              <div className="export-top">
                <span className="export-name" title={e.name}>{e.name}</span>
                <span className="export-meta">
                  {e.durationSec !== null && <span>{formatDuration(e.durationSec)}</span>}
                  <span>{formatWhen(e.createdAt)}</span>
                </span>
              </div>
              {playable && (
                <audio className="export-audio" controls preload="none" src={exportFileUrl(projectId, playable.file)} aria-label={`Play ${e.name}`} />
              )}
              <div className="export-bottom">
                <span className="export-files">
                  {e.files.map((f) => <span key={f.file} className="pill" title={f.file}>{KIND_LABEL[f.kind]} · {formatBytes(f.bytes)}</span>)}
                </span>
                <span className="export-actions">
                  <button className="btn btn-outline" onClick={() => void reveal(e.files[0].file)} aria-label={`Reveal ${e.name} in Finder`}>Reveal in Finder</button>
                  <button className="btn btn-outline danger" onClick={() => setConfirm(e)} aria-label={`Delete ${e.name}`}>Delete</button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm && (
        <ConfirmDialog title="Delete export" confirmLabel="Delete export" danger onClose={() => setConfirm(null)} onConfirm={() => remove(confirm)}>
          <p>Delete <strong>{confirm.name}</strong> ({confirm.files.map((f) => f.file).join(', ')})? The files are removed from disk; the song itself is not touched.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

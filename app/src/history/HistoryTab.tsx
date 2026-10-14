import { useCallback, useEffect, useState } from 'react';
import { hunks, type VersionMeta } from '@shawarma/shared';
import { getProject, getVersion } from '../api';
import { ConfirmDialog } from '../projects/Modal';
import './history.css';

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
};

/** Short label for a version: its message, with the initial and manual saves named plainly. */
export const versionLabel = (v: VersionMeta) => {
  const m = v.message.trim();
  if (!m || m === 'manual save') return v.source === 'ai' ? 'Change from Shawarma' : 'Saved';
  if (m === 'initial') return 'Created';
  return m;
};

/**
 * The project's saved versions, newest first. Each can show what it changed (an inline diff against
 * the version before it) and be restored into the editor; restoring over unsaved edits asks first.
 */
export function HistoryTab(props: {
  projectId: string | null; refreshKey: number; isDirty(): boolean; onRestore(code: string, version: VersionMeta): void;
}) {
  const { projectId } = props;
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [open, setOpen] = useState<Record<string, { before: string; after: string } | 'loading'>>({});
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ v: VersionMeta; code: string } | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setVersions(null); return; }
    try { setVersions((await getProject(projectId)).versions); setError(''); } catch (e) { setError(`Could not load the history: ${(e as Error).message}`); }
  }, [projectId]);
  useEffect(() => { setOpen({}); }, [projectId]);
  useEffect(() => { void load(); }, [load, props.refreshKey]);

  const toggleDiff = async (v: VersionMeta, prev: VersionMeta | undefined) => {
    if (!projectId) return;
    if (open[v.id]) { setOpen(({ [v.id]: _, ...rest }) => rest); return; }
    setOpen((o) => ({ ...o, [v.id]: 'loading' }));
    try {
      const [after, before] = await Promise.all([getVersion(projectId, v.id), prev ? getVersion(projectId, prev.id) : Promise.resolve({ code: '' })]);
      setOpen((o) => ({ ...o, [v.id]: { before: before.code, after: after.code } }));
    } catch (e) {
      setOpen(({ [v.id]: _, ...rest }) => rest);
      setError(`Could not load that version: ${(e as Error).message}`);
    }
  };

  const restore = async (v: VersionMeta) => {
    if (!projectId) return;
    try {
      const { code } = await getVersion(projectId, v.id);
      if (props.isDirty()) setConfirm({ v, code }); else props.onRestore(code, v);
    } catch (e) { setError(`Could not load that version: ${(e as Error).message}`); }
  };

  if (!projectId) return <div className="history-empty muted">Open or create a project to see its history.</div>;
  // oldest first from the server; shown newest first, each diffed against the one before it
  const list = versions ?? [];
  return (
    <div className="history-tab">
      <div className="history-head"><h2>History</h2>{versions && <span className="muted">{versions.length} {versions.length === 1 ? 'version' : 'versions'}</span>}</div>
      {error && <div role="alert" className="err-text">{error}</div>}
      {versions && versions.length === 0 && <p className="history-empty muted">No saved versions yet. Save, or accept a change from chat, to add one.</p>}
      <ol className="version-list" aria-label="Versions">
        {[...list].reverse().map((v, i) => {
          const prev = list[list.length - 2 - i];
          const diff = open[v.id];
          const changes = diff && diff !== 'loading' ? hunks(diff.before, diff.after).filter((h) => h.kind === 'change') : [];
          return (
            <li key={v.id} className="version-item">
              <div className="version-row">
                <span className={`chip version-source ${v.source}`}>{v.source === 'ai' ? 'Shawarma' : 'You'}</span>
                <span className="version-label" title={v.message}>{versionLabel(v)}</span>
                <span className="version-time">{when(v.createdAt)}</span>
              </div>
              <div className="version-actions">
                <button className="btn btn-outline" aria-expanded={Boolean(diff)} onClick={() => void toggleDiff(v, prev)}>{diff ? 'Hide changes' : 'Show changes'}</button>
                <button className="btn btn-outline" onClick={() => void restore(v)} aria-label={`Restore ${versionLabel(v)} (${when(v.createdAt)})`}>Restore</button>
              </div>
              {diff === 'loading' && <div className="muted">Loading…</div>}
              {diff && diff !== 'loading' && (
                <div className="version-diff" aria-label={`Changes in ${versionLabel(v)}`}>
                  {changes.length === 0 && <div className="muted">{prev ? 'Same code as the version before.' : 'Empty song.'}</div>}
                  {changes.map((h) => (
                    <pre key={h.id} className="hunk-ro">
                      {h.removed && <span className="del">{h.removed.replace(/\n$/, '').replace(/^/gm, '- ')}</span>}
                      {h.added && <span className="add">{h.added.replace(/\n$/, '').replace(/^/gm, '+ ')}</span>}
                    </pre>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {confirm && (
        <ConfirmDialog title="Replace unsaved edits?" confirmLabel="Restore this version" onClose={() => setConfirm(null)}
          onConfirm={() => { const c = confirm; setConfirm(null); props.onRestore(c.code, c.v); }}>
          <p>The editor has edits you have not saved. Restoring <strong>{versionLabel(confirm.v)}</strong> ({when(confirm.v.createdAt)}) replaces them.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

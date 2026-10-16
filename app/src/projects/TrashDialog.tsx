// The Trash: projects deleted from the list, with Restore and Delete forever. The rule, also on screen:
// trashed projects don't count toward the project limit, but their files count toward storage until they
// are deleted forever (hosted mode empties the trash after 30 days).
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@shawarma/shared';
import { deleteForever, listTrash, restoreProject, type TrashedProject } from './api';
import { Modal } from './Modal';

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(0, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function TrashDialog(props: { onClose(): void; onRestored(p: ProjectSummary): void; onNotice?(m: string): void }) {
  const [items, setItems] = useState<TrashedProject[] | null>(null);
  const [purgeDays, setPurgeDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const load = () => listTrash().then((t) => { setItems(t.projects); setPurgeDays(t.purgeDays); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const act = async (uuid: string, fn: () => Promise<void>) => {
    setBusy(uuid); setError(null);
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); setSure(null); }
  };

  return (
    <Modal title="Trash" onClose={props.onClose} wide className="trash-dialog">
      <section className="modal-section">
        <p className="muted">
          {purgeDays ? `Deleted projects stay here for ${purgeDays} days, then they and their files are removed for good. ` : 'Deleted projects stay here until you delete them forever. '}
          They don't count toward your project limit, but their sounds and exports still count toward your storage until you delete them forever.
        </p>
      </section>
      <section className="modal-section">
        {items === null && !error && <p className="muted">Loading…</p>}
        {items?.length === 0 && <p className="muted">The trash is empty.</p>}
        {!!items?.length && (
          <ul className="trash-list" aria-label="Deleted projects">
            {items.map((p) => (
              <li key={p.uuid} className="trash-item">
                <div className="trash-what">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    Deleted {new Date(p.trashedAt).toLocaleDateString()}{p.bytes ? ` · ${size(p.bytes)} of files` : ''}
                    {p.daysLeft !== null && ` · ${p.daysLeft === 0 ? 'removed today' : `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left`}`}
                  </span>
                </div>
                <div className="row">
                  <button className="btn btn-outline" disabled={busy !== null} aria-label={`Restore ${p.name}`}
                    onClick={() => void act(p.uuid, async () => { const r = await restoreProject(p.uuid); props.onRestored(r); props.onNotice?.(`Restored ${r.name}`); })}>Restore</button>
                  {sure === p.uuid
                    ? <button className="btn btn-danger" disabled={busy !== null} aria-label={`Really delete ${p.name} forever`}
                        onClick={() => void act(p.uuid, async () => { await deleteForever(p.uuid); props.onNotice?.(`Deleted ${p.name} forever`); })}>Really delete</button>
                    : <button className="btn btn-ghost" disabled={busy !== null} aria-label={`Delete ${p.name} forever`} onClick={() => setSure(p.uuid)}>Delete forever</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <div role="alert" className="err-text">{error}</div>}
      </section>
    </Modal>
  );
}

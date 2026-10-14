import { Mark } from '../brand/Mark';
import { useMemo, useState, type ReactNode } from 'react';
import type { ProjectSummary } from '@shawarma/shared';

/** Project actions offered in each row's menu; optional ones only show when provided. */
export interface ProjectActions {
  onOpen(id: string): void;
  onNew(): void;
  onRename(id: string): void;
  onDuplicate?(id: string): void;
  onDelete?(id: string): void;
  /** Copies a strudel.cc link carrying the project's code. */
  onShare?(id: string): void;
  onReveal?(id: string): void;
  /** Opens the New project dialog on its Import tab. */
  onImport?(): void;
}

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};

/** The left column: the app's name, New project, the project list and Settings (Claude-style). */
export function Sidebar(props: ProjectActions & {
  projects: ProjectSummary[]; projectId: string | null; disabled?: boolean; onSettings(): void; onCollapse(): void;
  /** Hosted mode: the account menu, above Settings. */
  account?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...props.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return q ? sorted.filter((p) => p.name.toLowerCase().includes(q)) : sorted;
  }, [props.projects, query]);
  const act = (fn?: (id: string) => void, id?: string) => () => { setMenu(null); if (fn && id) fn(id); };

  return (
    <nav className="sidebar" aria-label="Projects">
      <div className="sidebar-head app-header">
        <span className="wordmark"><Mark size={24} />Shawarma REPL</span>
        <button className="btn btn-ghost btn-icon" aria-label="Hide sidebar" title="Hide sidebar" onClick={props.onCollapse}>⟨</button>
      </div>
      <div className="sidebar-actions">
        <button className="btn new-project" disabled={props.disabled} onClick={props.onNew}><span aria-hidden>＋</span>New project</button>
        {props.projects.length > 6 && (
          <input className="sidebar-search" type="search" placeholder="Find a project" aria-label="Find a project" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </div>
      <h2 className="sidebar-label">Songs</h2>
      <ul className="project-list">
        {!props.projectId && <li><span className="project-item active" aria-current="page"><span className="project-name">Scratch buffer</span></span></li>}
        {list.map((p) => (
          <li key={p.id} className={menu === p.id ? 'menu-open' : undefined}>
            <button className={`project-item${p.id === props.projectId ? ' active' : ''}`} aria-current={p.id === props.projectId ? 'page' : undefined}
              aria-label={p.name} title={`${p.name}, edited ${ago(p.updatedAt)}`}
              disabled={props.disabled} onClick={() => props.onOpen(p.id)}>
              <span className="project-name">{p.name}</span>
              <span className="project-when">{ago(p.updatedAt)}</span>
            </button>
            <button className="btn btn-ghost btn-icon project-more" aria-label={`More actions for ${p.name}`} aria-expanded={menu === p.id}
              disabled={props.disabled} onClick={() => setMenu(menu === p.id ? null : p.id)}>⋯</button>
            {menu === p.id && (
              <div className="menu" role="menu" onMouseLeave={() => setMenu(null)}>
                <button role="menuitem" onClick={act(props.onRename, p.id)}>Rename</button>
                {props.onDuplicate && <button role="menuitem" onClick={act(props.onDuplicate, p.id)}>Duplicate</button>}
                {props.onShare && <button role="menuitem" onClick={act(props.onShare, p.id)}>Copy strudel.cc link</button>}
                {props.onReveal && <button role="menuitem" onClick={act(props.onReveal, p.id)}>Reveal in Finder</button>}
                {props.onImport && <button role="menuitem" onClick={() => { setMenu(null); props.onImport!(); }}>Import…</button>}
                {props.onDelete && <><div className="sidebar-divider" role="separator" /><button role="menuitem" className="danger" onClick={act(props.onDelete, p.id)}>Delete…</button></>}
              </div>
            )}
          </li>
        ))}
        {query && list.length === 0 && <li className="muted sidebar-empty">No project matches “{query}”.</li>}
      </ul>
      <div className="sidebar-foot">
        {props.account}
        <button className="btn btn-ghost settings-link" aria-label="Settings" onClick={props.onSettings}><span aria-hidden>⚙</span>Settings</button>
      </div>
    </nav>
  );
}

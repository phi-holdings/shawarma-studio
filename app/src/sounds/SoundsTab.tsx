import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { deleteSample, listSamples, uploadSample, type ProjectSamples } from '../api';
import { getRuntime } from '../runtime/client';
import type { SoundInfo } from '../runtime/protocol';
import {
  AUDIO_FILE, FILTERS, ROW_HEIGHT, SECTION_TITLES, bankInsertText, buildRows, buildSections, filterCounts, folderNameFor, insertTextFor,
  moveIndex, visibleRange, type Filter, type NavItem, type Row, type SectionId, type Sound,
} from './model';
import { usedSoundNames } from './usage';
import './sounds.css';

type Status = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PAD_MIN = 74;
const PAD_GAP = 6;
const SIDE_PAD = 12;

/**
 * Sound browser: every sound the song runtime has loaded (drum machines as pad grids, sample sets with
 * their variants, synths, soundfont instruments) plus this project's own samples. Click or Enter plays
 * one short hit; Add to chat (or Cmd/Ctrl+Enter) puts the code for it in the message to Shawarma.
 */
export function SoundsTab(props: { onPick(code: string): void; projectId: string | null; code?: string }) {
  const { onPick, projectId, code = '' } = props;
  const [catalog, setCatalog] = useState<SoundInfo[]>([]);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(() => new Set());
  const [samples, setSamples] = useState<ProjectSamples | null>(null);
  const [samplesError, setSamplesError] = useState('');
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [sounding, setSounding] = useState<Record<string, number>>({});
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [folder, setFolder] = useState('');

  const rt = getRuntime();
  const say = useCallback((text: string, error = false) => setMessage({ text, error }), []);

  // ---- the catalog, from the runtime ----
  const loadCatalog = useCallback(async () => {
    try {
      const list = await rt.request({ type: 'listSounds' });
      setCatalog(list);
      setStatus({ state: 'ready' });
    } catch (e) {
      setStatus({ state: 'error', message: errText(e) });
    }
  }, [rt]);

  // ---- this project's samples: server listing -> loaded into the runtime ----
  const samplesRef = useRef<ProjectSamples | null>(null);
  const pushSamples = useCallback(async (s: ProjectSamples | null) => {
    samplesRef.current = s;
    setSamples(s);
    try {
      await rt.request({ type: 'loadSamples', url: s && s.folders.length ? s.mapUrl : '', ...(s ? { version: s.version } : {}) });
      setSamplesError('');
    } catch (e) {
      setSamplesError(`Your samples are saved but the song can't use them yet: ${errText(e)}`);
    }
    await loadCatalog();
  }, [rt, loadCatalog]);

  useEffect(() => {
    let stale = false;
    setSamples(null);
    if (!projectId) { void pushSamples(null); return; }
    listSamples(projectId).then((s) => { if (!stale) void pushSamples(s); }, (e) => {
      if (stale) return;
      setSamplesError(`Couldn't list this project's samples: ${errText(e)}`);
      void pushSamples(null);
    });
    return () => { stale = true; };
  }, [projectId, pushSamples]);

  // a (re)loaded runtime has only the built-in sounds: give it the project's samples again
  useEffect(() => rt.on('ready', () => { void pushSamples(samplesRef.current); }), [rt, pushSamples]);

  // ---- derived lists ----
  const project = useMemo<Sound[]>(() => (samples?.folders ?? []).map((f) => ({
    name: f.name, label: f.name, type: 'sample', count: f.files.length, project: true,
  })), [samples]);
  const aliases = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of catalog) if (s.type === 'drum-machine' && s.bank) for (const t of s.tags ?? []) m.set(t, s.bank.toLowerCase());
    return m;
  }, [catalog]);
  const available = useMemo(() => new Set([...catalog.map((s) => s.name), ...project.map((p) => p.name)]), [catalog, project]);
  // the code changes on every keystroke: recompute what it uses only after a short pause
  const [usedCode, setUsedCode] = useState(code);
  useEffect(() => { const t = setTimeout(() => setUsedCode(code), 300); return () => clearTimeout(t); }, [code]);
  const used = useMemo(() => usedSoundNames(usedCode, available, aliases), [usedCode, available, aliases]);
  const sections = useMemo(() => buildSections({ catalog, project, used, query, filter }), [catalog, project, used, query, filter]);
  const counts = useMemo(() => filterCounts(catalog, project, query), [catalog, project, query]);

  // ---- windowing ----
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600, width: 480 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView((v) => (v.height === el.clientHeight && v.width === el.clientWidth ? v : { ...v, height: el.clientHeight, width: el.clientWidth }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const columns = Math.max(3, Math.floor((view.width - SIDE_PAD * 2 + PAD_GAP) / (PAD_MIN + PAD_GAP)));
  const model = useMemo(() => buildRows(sections, { columns, collapsed, hasProject: Boolean(projectId), query, loading: status.state !== 'ready' }), [sections, columns, collapsed, projectId, query, status.state]);
  const [first, last] = visibleRange(model.offsets, view.top, view.height);

  // the active item stays valid as the list changes; a new search starts at the top
  useEffect(() => { setActive(0); scroller.current?.scrollTo({ top: 0 }); }, [query, filter]);
  const activeIndex = model.items.length ? Math.min(active, model.items.length - 1) : -1;
  const activeItem: NavItem | undefined = model.items[activeIndex];

  const reveal = (index: number) => {
    const item = model.items[index];
    const el = scroller.current;
    if (!item || !el) return;
    const top = model.offsets[item.row];
    const bottom = top + ROW_HEIGHT[model.rows[item.row].kind];
    if (top < el.scrollTop + 8) el.scrollTop = Math.max(0, top - 48);
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + 8;
  };

  // ---- actions ----
  const variantOf = (s: Sound) => Math.min(variants[s.name] ?? 0, Math.max(0, s.count - 1));
  const audition = async (s: Sound, n = variantOf(s)) => {
    setSounding((m) => ({ ...m, [s.name]: (m[s.name] ?? 0) + 1 }));
    setTimeout(() => setSounding((m) => { const { [s.name]: k = 1, ...rest } = m; return k > 1 ? { ...rest, [s.name]: k - 1 } : rest; }), 420);
    try { await rt.request({ type: 'audition', name: s.name, ...(n > 0 ? { n } : {}) }); }
    catch (e) { say(errText(e), true); }
  };
  const insert = (text: string) => { onPick(text); say(`Added ${text} to your message to Shawarma.`); };
  const insertSound = (s: Sound) => insert(insertTextFor(s, variantOf(s)));
  const step = (s: Sound, d: number) => setVariants((v) => ({ ...v, [s.name]: Math.min(Math.max(0, (v[s.name] ?? 0) + d), Math.max(0, s.count - 1)) }));

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // typing in the drop zone's sound name field
    const k = e.key;
    if (k === 'Enter' && activeItem) {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) insertSound(activeItem.sound); else void audition(activeItem.sound);
      return;
    }
    if (k === '[' || k === ']') { if (activeItem) { e.preventDefault(); step(activeItem.sound, k === ']' ? 1 : -1); } return; }
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') {
      e.preventDefault();
      const next = moveIndex(model.items, activeIndex, k);
      if (next >= 0) { setActive(next); reveal(next); }
      return;
    }
    if (k === '/' || (k.length === 1 && /[a-z0-9]/i.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey)) {
      // typing in the list goes to the search box
      search.current?.focus();
      if (k === '/') e.preventDefault();
    }
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); list.current?.focus(); reveal(activeIndex); }
    else if (e.key === 'Enter' && activeItem) { e.preventDefault(); if (e.metaKey || e.ctrlKey) insertSound(activeItem.sound); else void audition(activeItem.sound); }
    else if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
  };
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // ---- uploads ----
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = async (files: File[]) => {
    if (!projectId) { say('Open a project first; samples are kept per project.', true); return; }
    const audio = files.filter((f) => AUDIO_FILE.test(f.name));
    const skipped = files.length - audio.length;
    if (!audio.length) { say('Only WAV, MP3, OGG and FLAC files can be added as samples.', true); return; }
    const errors: string[] = [];
    let last: ProjectSamples | null = null;
    let added: string[] = [];
    setUpload({ done: 0, total: audio.length });
    for (const [i, f] of audio.entries()) {
      const target = folderNameFor(folder) ?? folderNameFor(f.name) ?? 'samples';
      try {
        const r = await uploadSample(projectId, target, f, f.name);
        last = r;
        added = [...added, r.added.folder];
      } catch (e) { errors.push(`${f.name}: ${errText(e)}`); }
      setUpload({ done: i + 1, total: audio.length });
    }
    setUpload(null);
    if (last) await pushSamples(last);
    const names = [...new Set(added)];
    const parts = [
      names.length ? `Added ${added.length} file${added.length === 1 ? '' : 's'}; use ${names.slice(0, 3).map((n) => `s("${n}")`).join(', ')}${names.length > 3 ? '…' : ''}.` : '',
      skipped ? `Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? "isn't" : "aren't"} audio.` : '',
      errors.length ? `Couldn't add ${errors.join('; ')}` : '',
    ].filter(Boolean);
    say(parts.join(' '), errors.length > 0 && !names.length);
  };
  const removeSample = async (s: Sound) => {
    if (!projectId || !window.confirm(`Delete the sample "${s.name}" (${s.count} file${s.count === 1 ? '' : 's'}) from this project?`)) return;
    try { await pushSamples(await deleteSample(projectId, s.name)); say(`Deleted ${s.name}.`); }
    catch (e) { say(`Couldn't delete ${s.name}: ${errText(e)}`, true); }
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dragDepth = useRef(0);
  const drag = {
    onDragEnter: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = projectId ? 'copy' : 'none'; },
    onDragLeave: (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void addFiles(Array.from(e.dataTransfer.files));
    },
  };

  // ---- rendering ----
  const toggleSection = (id: SectionId) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const optionProps = (index: number) => ({
    id: model.items[index]?.id,
    role: 'option' as const,
    'aria-selected': index === activeIndex,
    onMouseDown: (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); setActive(index); list.current?.focus({ preventScroll: true }); },
  });

  const renderRow = (row: Row): ReactNode => {
    switch (row.kind) {
      case 'section': {
        const id = row.section;
        return (
          <div className="snd-section">
            <button className="snd-section-toggle" aria-expanded={!row.collapsed} onClick={() => toggleSection(id)} tabIndex={-1}>
              <Chevron open={!row.collapsed} />
              <span>{SECTION_TITLES[id]}</span>
              <span className="snd-count">{row.total}</span>
            </button>
            {id === 'project' && projectId && (
              <button className="btn btn-outline snd-small" tabIndex={-1} onClick={() => fileInput.current?.click()} disabled={upload !== null}>Add files</button>
            )}
          </div>
        );
      }
      case 'bank': {
        const g = row.group;
        return (
          <div className="snd-bank">
            <span className="snd-bank-name">{g.bank || 'Default kit'}</span>
            <span className="snd-count">{g.sounds.length}</span>
            {g.bank
              ? <button className="btn btn-outline snd-small" tabIndex={-1} aria-label={`Add a beat with ${g.bank} to chat`} onClick={() => insert(bankInsertText(g.bank, g.sounds))}>Add beat</button>
              : <span className="snd-hint">s("bd") with no bank</span>}
          </div>
        );
      }
      case 'pads':
        return (
          <div className="snd-pads" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {row.items.map(({ sound: s, index }) => (
              <div key={s.name} {...optionProps(index)} className={`snd-pad${index === activeIndex ? ' active' : ''}${sounding[s.name] ? ' sounding' : ''}`}>
                <button className="snd-pad-hit" tabIndex={-1} aria-label={`Play ${s.label}${s.bank ? ` (${s.bank})` : ''}`} title={`${s.name}${s.count > 1 ? ` · ${s.count} variants` : ''}`} onClick={() => void audition(s)}>
                  <span className="snd-pad-label">{s.label}</span>
                  {s.count > 1 && <span className="snd-pad-count">{s.count}</span>}
                </button>
                <button className="snd-pad-insert" tabIndex={-1} aria-label={`Add ${s.label}${s.bank ? ` from ${s.bank}` : ''} to chat`} title={insertTextFor(s, variantOf(s))} onClick={() => insertSound(s)}>
                  <PlusIcon />
                </button>
              </div>
            ))}
          </div>
        );
      case 'sound': {
        const s = row.sound;
        const n = variantOf(s);
        return (
          <div {...optionProps(row.index)} className={`snd-row${row.index === activeIndex ? ' active' : ''}${sounding[s.name] ? ' sounding' : ''}`}>
            <button className="snd-play" tabIndex={-1} aria-label={`Play ${s.label}`} onClick={() => void audition(s)}><PlayIcon /></button>
            <span className="snd-name" title={s.name}>{s.label}{s.bank && row.section === 'used' && <span className="snd-dim"> · {s.bank}</span>}</span>
            <span className="snd-kind">{s.count > 1 ? <span className="snd-range" title={`${s.count} variants`}>:0..{s.count - 1}</span> : kindLabel(s)}</span>
            {s.count > 1 && (
              <span className="snd-stepper" aria-label={`Variant ${n} of ${s.count}`}>
                <button tabIndex={-1} aria-label={`Previous variant of ${s.label}`} disabled={n === 0} onClick={() => { step(s, -1); void audition(s, n - 1); }}>−</button>
                <span className="snd-variant">:{n}</span>
                <button tabIndex={-1} aria-label={`Next variant of ${s.label}`} disabled={n >= s.count - 1} onClick={() => { step(s, 1); void audition(s, n + 1); }}>+</button>
              </span>
            )}
            {s.project && <button className="btn btn-ghost snd-small snd-delete" tabIndex={-1} aria-label={`Delete ${s.name}`} onClick={() => void removeSample(s)}>Delete</button>}
            <button className="btn btn-ghost snd-small snd-insert" tabIndex={-1} aria-label={`Add ${s.label} to chat`} title={insertTextFor(s, n)} onClick={() => insertSound(s)}><PlusIcon /><span className="snd-insert-label">Add to chat</span></button>
          </div>
        );
      }
      case 'drop':
        return (
          <div className={`snd-drop${dragging ? ' over' : ''}`}>
            <div className="snd-drop-text">
              <p><strong>Drop audio files here</strong> to use them in this song</p>
              <p className="muted" title='Each file becomes s("its_name"); a sound name keeps several files together as variants.'>WAV, MP3, OGG or FLAC, up to {Math.round((samples?.limits.maxBytes ?? 25 * 1024 * 1024) / 1024 / 1024)} MB each</p>
            </div>
            <div className="snd-drop-actions">
              <input className="snd-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Sound name (optional)" aria-label="Sound name for added files" />
              <button className="btn snd-small" tabIndex={-1} onClick={() => fileInput.current?.click()} disabled={upload !== null}>
                {upload ? `Adding ${Math.min(upload.done + 1, upload.total)} of ${upload.total}…` : 'Choose files'}
              </button>
            </div>
          </div>
        );
      case 'note':
        return <p className="snd-note muted">{row.text}</p>;
    }
  };

  const notReady = status.state !== 'ready';
  return (
    <div className={`sounds${dragging ? ' dragging' : ''}`} {...drag}>
      <div className="snd-head">
        <div className="snd-search">
          <SearchIcon />
          <input ref={search} type="search" placeholder="Search sounds, e.g. 808 or piano" aria-label="Search sounds" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} aria-controls="sound-list" />
        </div>
        <div className="snd-filters" role="group" aria-label="Sound type">
          {FILTERS.map((f) => (
            <button key={f.id} className="snd-filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}<span className="snd-filter-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <input ref={fileInput} type="file" multiple hidden accept=".wav,.mp3,.ogg,.flac,audio/wav,audio/mpeg,audio/ogg,audio/flac" aria-label="Add audio files"
        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void addFiles(files); }} />
      {notReady && (
        <div className={`snd-state${status.state === 'error' ? ' error' : ''}`} role={status.state === 'error' ? 'alert' : 'status'}>
          {status.state === 'loading'
            ? <p>Loading sounds from the song runtime…</p>
            : <>
                <p><strong>The song runtime isn't ready yet.</strong> {status.message}</p>
                <button className="btn snd-small" onClick={() => { setStatus({ state: 'loading' }); void loadCatalog(); }}>Try again</button>
              </>}
        </div>
      )}
      {samplesError && <p className="snd-state error" role="alert">{samplesError}</p>}

      <div ref={scroller} className="snd-scroll" onScroll={(e) => { const top = e.currentTarget.scrollTop; setView((v) => (v.top === top ? v : { ...v, top })); }}>
        <div ref={list} id="sound-list" className="snd-list" role="listbox" aria-label="Sounds" tabIndex={0} onKeyDown={onListKey}
          aria-activedescendant={activeItem && first <= activeItem.row && activeItem.row < last ? activeItem.id : undefined}
          style={{ height: model.height }}>
          {model.rows.slice(first, last).map((row, i) => (
            <div key={row.key} className={`snd-slot snd-slot-${row.kind}`} style={{ top: model.offsets[first + i], height: ROW_HEIGHT[row.kind] }}>
              {renderRow(row)}
            </div>
          ))}
        </div>
        {status.state === 'ready' && model.items.length === 0 && query.trim() && (
          <div className="snd-empty">
            <p>No sounds match “{query.trim()}”.</p>
            <button className="btn snd-small" onClick={() => setQuery('')}>Clear search</button>
          </div>
        )}
      </div>

      <footer className="snd-foot">
        <span className={`snd-message${message?.error ? ' error' : ''}`} role="status" title={message?.text}>{message?.text ?? ''}</span>
        <span className="snd-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>⏎</kbd> play <kbd>⌘</kbd><kbd>⏎</kbd> add to chat</span>
      </footer>
      {dragging && <div className="snd-drag-veil" aria-hidden="true"><p>{projectId ? "Drop to add to this project's samples" : 'Open a project to add samples'}</p></div>}
    </div>
  );
}

function kindLabel(s: Sound): string {
  if (s.project) return 'your sample';
  if (s.type === 'drum-machine') return 'drum';
  if (s.type === 'soundfont') return 'instrument';
  if (s.type === 'synth') return s.tags?.includes('wavetable') ? 'wavetable' : 'synth';
  return s.tags?.includes('pitched') ? 'pitched' : 'sample';
}

const PlayIcon = () => (<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M1 1.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L1.9.7a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>);
const PlusIcon = () => (<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>);
const SearchIcon = () => (<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9.3 9.3 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>);
const Chevron = ({ open }: { open: boolean }) => (<svg className={`snd-chevron${open ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l3.5 3L3 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>);

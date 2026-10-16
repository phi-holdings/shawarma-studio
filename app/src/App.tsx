import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '@shawarma/shared';
import { type AppSettings, type Me, OfflineError, ServerError, signOut, StaleVersionError, chatReady, createProject, getProject, getSettings, listProjects, renameProject, saveProject } from './api';
import { checkProblem } from './chat/saveCheck';
import { Editor, type EditorHandle } from './editor/Editor';
import { Sidebar } from './shell/Sidebar';
import { RowSplitter, Splitter, WorkPanel } from './shell/WorkPanel';
import { SoundsTab } from './sounds/SoundsTab';
import { ConsoleBadge, ConsoleTab } from './console/ConsoleTab';
import { consoleStore, isFailureNotice, logNotice } from './console/store';
import { ToastArea } from './console/Toast';
import { toasts } from './console/toastStore';
import { StatusBar } from './editor/StatusBar';
import { restoreOutput } from './settings/audioOutput';
import { errorLocation, RuntimeError } from './runtime/errors';
import { snapToExpression, soloProgram } from '@shawarma/shared';
import { useInspect } from './sections/useInspect';
import { ChatPanel } from './chat/ChatPanel';
import { analyseRange, exportSong } from './export/exportSong';
import { SettingsDialog } from './settings/SettingsDialog';
import { VisualsPanel } from './visuals/VisualsPanel';
import { getRuntime } from './runtime/client';
import { ExportsTab } from './export/ExportsTab';
import { DEFAULT_RANGE, ExportOptions, type RangeChoice, toExportRange } from './export/ExportOptions';
import { HistoryTab, versionLabel } from './history/HistoryTab';
import { ConfirmDialog } from './projects/Modal';
import { type NewProjectMode, NewProjectDialog, RenameDialog } from './projects/NewProjectDialog';
import { deleteProject, duplicateProject, revealInFinder } from './projects/api';
import { type Draft, clearDraft, draftTime, loadDraft, syncDraft } from './projects/drafts';
import { strudelLink } from './projects/share';
import { AccountMenu } from './account/AccountMenu';
import { AllowanceMeter } from './account/AllowanceMeter';
import { UpgradeDialog } from './account/UpgradeDialog';
import { getBillingStatus, openPortal, trialAction, type BillingStatus } from './account/billingApi';

const SCRATCH = 's("bd sd")\n';

/** `me`: from /api/me; hosted mode adds the account menu, plan limits and the Upgrade flow. */
export function App(props: { me?: Me | null } = {}) {
  const hostedMe = props.me?.mode === 'hosted' ? props.me : null;
  const [billing, setBilling] = useState<BillingStatus | null>(hostedMe?.billing ?? null);
  const refreshBilling = useCallback(() => { if (hostedMe) getBillingStatus().then(setBilling).catch(() => {}); }, [hostedMe]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const plan = billing?.plan ?? hostedMe?.plan ?? 'free';
  const trialDays = billing?.trialDays ?? hostedMe?.billing.trialDays ?? 7;
  const manageBilling = async () => { const { url } = await openPortal(); window.location.assign(url); };
  const doSignOut = async () => { await signOut(); window.location.assign('/'); };
  const editor = useRef<EditorHandle>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [initial, setInitial] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [pickedSound, setPickedSound] = useState<{ code: string; id: number } | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (settingsOpen) refreshBilling(); }, [settingsOpen, refreshBilling]);
  const loadSettings = () => getSettings().then(setSettings).catch(() => {});
  const [smallCopy, setSmallCopy] = useState(false);
  const scratchDirty = useRef(false);
  // code as last loaded from / saved to the server; the editor is dirty when it differs
  const savedCode = useRef<string | null>(null);
  const isDirty = () => savedCode.current !== null && (editor.current?.getCode() ?? code) !== savedCode.current;
  // unsaved edits are kept per project in localStorage (drafts.ts) while they differ from the saved code
  const projectRef = useRef<string | null>(null);
  const [draftOffer, setDraftOfferState] = useState<{ projectId: string; draft: Draft } | null>(null);
  const draftOfferRef = useRef(draftOffer);
  const setDraftOffer = (o: typeof draftOffer) => { draftOfferRef.current = o; setDraftOfferState(o); };
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDraft = () => {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    const id = projectRef.current;
    if (!id || savedCode.current === null || !editor.current) return;
    syncDraft(id, editor.current.getCode(), savedCode.current, { keepWhenClean: draftOfferRef.current?.projectId === id });
  };
  const scheduleDraft = () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(flushDraft, 400);
  };
  useEffect(() => {
    const flush = () => flushDraft();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
  const confirmDiscard = () => {
    if (!isDirty()) return true;
    if (!window.confirm('You have unsaved changes in this project. Discard them and switch?')) return false;
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    if (projectRef.current) clearDraft(projectRef.current);
    return true;
  };
  // dialogs: new project (template or import), rename, delete
  type DialogState = { kind: 'new'; mode: NewProjectMode } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string } | null;
  const [dialog, setDialog] = useState<DialogState>(null);
  // bumps when versions or exports change, so the History and Exports tabs reload
  const [historyRev, setHistoryRev] = useState(0);
  const [exportsRev, setExportsRev] = useState(0);
  const [rangeChoice, setRangeChoice] = useState<RangeChoice>(DEFAULT_RANGE);

  const { report, inspected, offline: inspectOffline } = useInspect(code, 600, projectId);
  const [notice, setNoticeText] = useState('');
  // a notice shows in the Code tab's status line; on any other tab it pops up as a toast instead
  // (only one of the two is on the page at a time), and it is kept in the Console tab
  const tabRef = useRef('code');
  /** The status line's notice; also kept in the Console tab (failures there as errors). */
  const setNotice = useCallback((m: string) => {
    setNoticeText(m);
    logNotice(m);
    if (tabRef.current !== 'code') toasts.show(m, isFailureNotice(m) ? 'error' : 'notice');
  }, []);
  /** An error from playing or a widget: notice, and a console error that links to its line. */
  const reportError = (e: unknown) => {
    const message = note(e);
    setNoticeText(message);
    if (tabRef.current !== 'code') toasts.show(message, 'error');
    const at = e instanceof RuntimeError && e.line ? { line: e.line, col: e.col } : {};
    consoleStore.push({ kind: 'error', source: 'eval', message, ...at });
  };
  // layout: sidebar shown, the song panel's width (kept between visits), the active song tab
  const [sidebarOpen, setSidebar] = useState(() => localStorage.getItem('shawarma.sidebar') !== 'closed' && window.innerWidth >= 1100);
  useEffect(() => { localStorage.setItem('shawarma.sidebar', sidebarOpen ? 'open' : 'closed'); }, [sidebarOpen]);
  const [workWidth, setWorkWidthState] = useState(() => Number(localStorage.getItem('shawarma.workWidth')) || Math.round(Math.max(520, window.innerWidth * 0.46)));
  const [splitSounds, setSplitSoundsState] = useState(() => localStorage.getItem('shawarma.splitSounds') === '1');
  const [soundsShare, setSoundsShareState] = useState(() => Number(localStorage.getItem('shawarma.soundsShare')) || 0.5);
  const setSoundsShare = useCallback((f: number) => { setSoundsShareState(f); localStorage.setItem('shawarma.soundsShare', f.toFixed(3)); }, []);
  const toggleSplitSounds = () => {
    const on = !splitSounds;
    setSplitSoundsState(on);
    localStorage.setItem('shawarma.splitSounds', on ? '1' : '0');
    if (on && tab === 'sounds') setTab('code');
  };
  const setWorkWidth = useCallback((w: number) => { setWorkWidthState(w); localStorage.setItem('shawarma.workWidth', String(Math.round(w))); }, []);
  const [tab, setTab] = useState('code');
  tabRef.current = tab;
  // back on the Code tab the status line has the notice: no toast on top of it
  useEffect(() => { if (tab === 'code') { const t = toasts.get(); if (t) toasts.dismiss(t.id); } }, [tab]);

  const safely = async (fn: () => Promise<unknown> | unknown) => {
    try { await fn(); } catch (e) { reportError(e); }
  };
  const runSelection = () => safely(async () => {
    const e = editor.current!;
    const src = e.getCode();
    const sel = e.getSelection();
    if (sel.to <= sel.from) { setNotice(''); await e.play(); return; }   // nothing selected: Run all
    const snapped = snapToExpression(src, e.getSelection());
    if (!snapped) { setNotice('Select part of an expression (e.g. a layer) to run it.'); return; }
    setNotice(`Running: ${snapped.text.slice(0, 60)}`);
    await e.play(soloProgram(src, snapped), { from: snapped.from, to: snapped.to });
  });

  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__editor = editor;   // e2e hook
  }, []);

  const note = (e: unknown) => {
    if (e instanceof OfflineError) setOffline(true);
    return e instanceof Error ? e.message : String(e);
  };

  /** Loads a project's code into the editor (or sets initial code if the editor isn't mounted yet). */
  const openProject = async (id: string, list?: ProjectSummary[]) => {
    const p = await getProject(id);
    if (list) setProjects(list);
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    setProjectId(id);
    projectRef.current = id;
    savedCode.current = p.code;
    // an unsaved buffer left from last time (tab closed, crash) is offered back, not applied silently
    const draft = loadDraft(id, p.code);
    setDraftOffer(draft ? { projectId: id, draft } : null);
    setRangeChoice(DEFAULT_RANGE);
    if (editor.current) editor.current.setCode(p.code); else { setInitial(p.code); setCode(p.code); }
  };
  const bootstrap = async () => {
    let list = await listProjects();
    if (!list.length) list = [await createProject('first-song')];
    await openProject(list[0].id, list);
  };

  // settings (has a key? fake AI?) decide whether chat is usable; reload when the server comes back
  useEffect(() => { if (!offline) void loadSettings(); }, [offline]);

  // check results in the console: replaced as a set by each new check
  useEffect(() => {
    if (!report) return;
    consoleStore.replaceSource('inspect', report.issues.map((i) => ({
      kind: i.kind === 'eval_error' ? 'error' as const : 'warning' as const,
      message: i.message,
      ...(errorLocation(i.message) ?? {}),
    })));
  }, [report]);

  // the remembered audio output device (Settings → Audio)
  useEffect(() => restoreOutput((m) => setNotice(`Audio output: ${m}`)), []);

  // the song navigated the runtime away: it was reset and reloaded, playback stopped
  useEffect(() => getRuntime().on('reloaded', () => setNotice('Song runtime reloaded (the song navigated it away); playback stopped.')), []);

  useEffect(() => {
    bootstrap().then(() => setOffline(false)).catch((e) => {
      // server down: mount the editor on a local scratch buffer; Save/Export/chat stay disabled
      note(e);
      setOffline(true);
      setInitial(SCRATCH); setCode(SCRATCH);
    });
  }, []);

  // while offline, poll the server every 10 s; clear the banner when it answers
  useEffect(() => {
    if (!offline) return;
    const t = setInterval(() => {
      listProjects().then(async (list) => {
        if (!projectId) {
          if (scratchDirty.current) { setProjects(list); setNotice('Server is back. Your scratch buffer was kept; reload the page to open a project.'); return; }
          await bootstrap();
        }
        setOffline(false);
      }).catch(() => {});
    }, 10_000);
    return () => clearInterval(t);
  }, [offline, projectId]);

  const switchProject = (id: string) => safely(async () => {
    if (id === projectId || !confirmDiscard()) return;
    await openProject(id);
    setNotice('');
  });
  const renameProjectById = (id: string) => {
    if (projects.some((p) => p.id === id)) setDialog({ kind: 'rename', id });
  };
  const doRename = async (id: string, name: string) => {
    const renamed = await renameProject(id, name);   // errors show in the dialog
    setProjects(await listProjects());
    setDialog(null);
    setNotice(`Renamed to ${renamed.name}`);
  };
  // no discard question: the open project's unsaved edits stay as its draft and are offered back later
  const newProject = (mode: NewProjectMode = 'template') => setDialog({ kind: 'new', mode });
  const doCreate = async (name: string, code: string) => {
    let created: ProjectSummary;
    try {
      created = await createProject(name, code);
    } catch (e) {
      const m = note(e);
      if (e instanceof ServerError && e.code === 'project_limit') throw new Error(m);
      throw new Error(/exist|already|409/i.test(m) ? `A project named "${name}" already exists. Pick another name.` : `Could not create the project: ${m}`);
    }
    setDialog(null);
    flushDraft();
    await openProject(created.id, await listProjects());
    setNotice(`Created ${created.name}`);
  };
  const duplicate = (id: string) => safely(async () => {
    const copy = await duplicateProject(id);
    setProjects(await listProjects());
    setNotice(`Duplicated as ${copy.name}`);
  });
  const doDelete = (id: string) => safely(async () => {
    setDialog(null);
    const name = projects.find((p) => p.id === id)?.name ?? id;
    await deleteProject(id);
    clearDraft(id);
    let list = await listProjects();
    if (id === projectId) {
      // the open project went: open the most recent other one, or start a fresh one
      savedCode.current = null;
      if (!list.length) list = [await createProject('Untitled song')];
      await openProject(list[0].id, list);
    } else {
      setProjects(list);
    }
    setNotice(`Moved ${name} to the trash`);
  });
  const share = (id: string) => safely(async () => {
    const src = id === projectId ? (editor.current?.getCode() ?? code) : (await getProject(id)).code;
    const link = strudelLink(src);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      throw new Error('Could not copy to the clipboard (the browser refused). Allow clipboard access for this page and try again.');
    }
    setNotice(`Copied a strudel.cc link (${link.length.toLocaleString()} characters)${id === projectId && isDirty() ? ', including unsaved edits' : ''}`);
  });
  const reveal = (id: string) => safely(async () => { await revealInFinder(id); });
  const save = async () => {
    if (!projectId) return;
    const current = editor.current?.getCode() ?? code;
    // checked before it becomes a version: code that doesn't run is only saved when you say so
    const problem = await checkProblem(current);
    if (problem && !window.confirm(`${problem}\n\nSave this version anyway?`)) { setNotice(`Not saved. ${problem}`); return; }
    try {
      const v = await saveProject(projectId, current);
      savedCode.current = current;
      setDraftOffer(null);
      flushDraft();
      setHistoryRev((n) => n + 1);
      setNotice(`Saved ${v.id}`);
    } catch (e) { setNotice(e instanceof StaleVersionError ? e.message : `Save failed: ${note(e)}`); }
  };

  // one export at a time from this page (the server also caps concurrent uploads)
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const runExport = async () => {
    if (!projectId || exportBusy.current) return;
    exportBusy.current = true;
    setExporting(true);
    try {
      setNotice('Exporting…');
      const r = await exportSong(editor.current!, projectId, { small: smallCopy, range: toExportRange(rangeChoice) });
      setExportsRev((n) => n + 1);
      const small = r.small
        ? ` and ${r.small.path} (${r.small.kbps}k${r.small.channels === 1 ? ' mono' : ''}, ${(r.small.bytes / 1e6).toFixed(1)} MB${r.small.note ? `: ${r.small.note}` : ''})`
        : '';
      setNotice(`Exported ${r.range.label === 'whole song' ? '' : `${r.range.label}: `}${r.wav} and ${r.mp3}${small} (peak ${r.peakDb.toFixed(1)} dBFS)${r.longRender ? ' — note: a sound that never stops (a drone) meant parts of the song were rendered in one long piece, which uses more memory; give it a rest now and then to keep exports light' : ''}`);
    } catch (e) { setNotice(`Export failed: ${note(e)}`); }
    finally { exportBusy.current = false; setExporting(false); }
  };

  if (initial === null) return <div className="loading">Loading…</div>;
  const current = projects.find((p) => p.id === projectId);
  const soundsTab = <SoundsTab projectId={projectId} code={code} onPick={(c) => setPickedSound((p) => ({ code: c, id: (p?.id ?? 0) + 1 }))} />;
  const codeTab = (
    <div className="code-tab">
      {draftOffer && draftOffer.projectId === projectId && (
        <div className="draft-banner" role="status">
          <span>Restore your unsaved edits from {draftTime(draftOffer.draft.at)}?</span>
          <button className="btn btn-primary" onClick={() => { const d = draftOffer.draft; setDraftOffer(null); editor.current?.setCode(d.code); setNotice('Restored your unsaved edits. Save to keep them.'); }}>Restore</button>
          <button className="btn btn-outline" onClick={() => { setDraftOffer(null); flushDraft(); }}>Discard</button>
        </div>
      )}
      <Editor ref={editor} initialCode={initial} onChange={(c) => { scratchDirty.current ||= c !== SCRATCH; setCode(c); scheduleDraft(); }} issues={report?.issues}
        inspected={inspected} onError={reportError} onSelectionChange={setHasSelection} />
      <VisualsPanel />
      <StatusBar editor={editor} code={code} report={report} inspected={inspected} inspectOffline={inspectOffline}
        notice={tab === 'code' ? notice : ''} hasSelection={hasSelection} onRunSelection={runSelection} onError={reportError}
        splitSounds={splitSounds} onToggleSplitSounds={toggleSplitSounds} />
      {splitSounds && <>
        <RowSplitter share={soundsShare} onShare={setSoundsShare} />
        <div className="split-sounds" style={{ flexBasis: `${soundsShare * 100}%` }}>{soundsTab}</div>
      </>}
    </div>
  );
  /** From the console: show the code tab and put the cursor on the line (after the tab is visible). */
  const jumpToLine = (line: number, col?: number) => {
    setTab('code');
    requestAnimationFrame(() => editor.current?.goToLine(line, col));
  };
  const tools = (
    <>
      <button className="btn" disabled={!projectId} title="Save this code as a new version" onClick={() => void save()}>Save</button>
      <div className="export-group">
        <button className="btn btn-primary" disabled={!projectId || exporting} aria-busy={exporting} title="Export the song as WAV and MP3" onClick={() => void runExport()}>⤓ <span className="tool-label">Export</span></button>
        <details className="popover export-opts">
          <summary className="btn btn-primary btn-icon" aria-label="Export options" title="Export options">▾</summary>
          <div className="popover-panel">
            <ExportOptions map={report?.map ?? null} choice={rangeChoice} onChoice={setRangeChoice} small={smallCopy} onSmall={setSmallCopy} />
          </div>
        </details>
      </div>
    </>
  );
  return (
    <div className={`app${sidebarOpen ? '' : ' no-sidebar'}`} style={{ ['--work-w' as string]: `${workWidth}px` }}>
      {sidebarOpen
        ? <Sidebar projects={projects} projectId={projectId} disabled={offline} onOpen={switchProject} onNew={() => newProject()} onRename={renameProjectById}
            onDuplicate={duplicate} onDelete={(id) => setDialog({ kind: 'delete', id })} onShare={share} onReveal={hostedMe ? undefined : reveal} onImport={() => newProject('import')}
            onSettings={() => setSettingsOpen(true)} onCollapse={() => setSidebar(false)}
            account={hostedMe && <AccountMenu me={hostedMe} billing={billing} onUpgrade={() => setUpgradeOpen(true)} onManageBilling={manageBilling} onSignOut={doSignOut} onOpen={refreshBilling} />} />
        : <button className="btn btn-ghost btn-icon sidebar-show" aria-label="Show sidebar" title="Show sidebar" onClick={() => setSidebar(true)}>⟩</button>}
      <main className="center">
        {offline && !projectId && <div className="banner" role="alert">The server isn't reachable, so you're editing a scratch buffer. Save, Export and chat come back when it does.</div>}
        <ChatPanel
          projectId={projectId}
          title={current?.name ?? 'Scratch buffer'}
          onRename={projectId ? () => renameProjectById(projectId) : undefined}
          offline={offline}
          onOffline={() => setOffline(true)}
          onOnline={() => setOffline(false)}
          currentCode={code}
          getCode={() => editor.current!.getCode()}
          getSelection={() => editor.current?.getSelection() ?? { from: 0, to: 0 }}
          applyCode={(c) => editor.current!.setCode(c)}
          onSaved={(c) => { savedCode.current = c; setDraftOffer(null); flushDraft(); setHistoryRev((n) => n + 1); }}
          getSavedCode={() => savedCode.current}
          analyse={(c, from, to) => analyseRange(editor.current!, c, from, to)}
          play={(c) => editor.current!.play(c)}
          stopPlayback={() => editor.current?.stop()}
          getEditorView={() => editor.current?.getView() ?? null}
          onShowCode={() => setTab('code')}
          report={report}
          needsKey={settings !== null && !chatReady(settings)}
          onOpenSettings={() => setSettingsOpen(true)}
          onKeyMissing={() => void loadSettings()}
          pickedSound={pickedSound}
          {...(hostedMe ? { hosted: { thinkDeeper: plan === 'pro' && !billing?.trial, trialDays }, onUpgrade: () => setUpgradeOpen(true), onTurnEnd: refreshBilling } : {})}
        />
      </main>
      <Splitter width={workWidth} min={460} max={Math.max(480, window.innerWidth - 640)} onWidth={setWorkWidth} />
      <WorkPanel active={tab} onActive={setTab} tools={tools} tabs={[
        { id: 'code', label: 'Code', content: codeTab },
        ...(splitSounds ? [] : [{ id: 'sounds', label: 'Sounds', content: soundsTab }]),
        { id: 'console', label: 'Console', badge: <ConsoleBadge />, content: <ConsoleTab visible={tab === 'console'} onJump={jumpToLine} /> },
        { id: 'history', label: 'History', content: (
          <HistoryTab projectId={projectId} refreshKey={historyRev} isDirty={isDirty} onRestore={(c, v) => {
            editor.current?.setCode(c);
            setTab('code');
            setNotice(`Restored "${versionLabel(v)}" into the editor. Save to keep it.`);
          }} />
        ) },
        { id: 'exports', label: 'Exports', content: (
          <ExportsTab projectId={projectId} refreshKey={exportsRev} onNotice={setNotice} exporting={exporting} onExport={() => void runExport()} />
        ) },
      ]} />
      {dialog?.kind === 'new' && <NewProjectDialog initialMode={dialog.mode} onCreate={doCreate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && (
        <RenameDialog current={projects.find((p) => p.id === dialog.id)?.name ?? dialog.id} onRename={(n) => doRename(dialog.id, n)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog title="Delete project" confirmLabel="Delete project" danger onClose={() => setDialog(null)} onConfirm={() => doDelete(dialog.id)}>
          <p>Delete <strong>{projects.find((p) => p.id === dialog.id)?.name ?? dialog.id}</strong>? It moves to the trash and leaves your projects list. Its versions, chat and audio files are kept.</p>
          {dialog.id === projectId && isDirty() && <p className="warn">It has unsaved edits, which are deleted too.</p>}
        </ConfirmDialog>
      )}
      {tab !== 'code' && <ToastArea onOpenConsole={() => setTab('console')} />}
      {settingsOpen && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)}
        hostedPanel={hostedMe ? (
          <section className="modal-section settings-plan">
            <h3>Your plan</h3>
            <p className="muted">{plan === 'free'
              ? "You're on Free: the editor, sounds and export, 3 projects and 200 MB of files. Shawarma's AI comes with Pro."
              : `You're on ${billing?.trial ? "Pro's free trial" : 'Pro'}${billing?.periodEnd ? `; it ${billing.cancelAtPeriodEnd ? 'ends' : billing.trial ? 'becomes paid Pro' : 'renews'} on ${new Date(billing.periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}` : ''}.`}</p>
            {billing && <AllowanceMeter status={billing} onUpgrade={() => { setSettingsOpen(false); setUpgradeOpen(true); }} />}
            <div className="row">
              {plan === 'free'
                ? <button className="btn btn-primary" onClick={() => { setSettingsOpen(false); setUpgradeOpen(true); }}>{trialAction(trialDays)}</button>
                : <button className="btn btn-outline" onClick={() => void manageBilling().catch((e) => setNotice((e as Error).message))}>Manage billing</button>}
            </div>
          </section>
        ) : undefined} />}
      {upgradeOpen && <UpgradeDialog trialDays={trialDays} onClose={() => setUpgradeOpen(false)} />}
    </div>
  );
}

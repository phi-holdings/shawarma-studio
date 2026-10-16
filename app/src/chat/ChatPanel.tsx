import { getRuntime } from '../runtime/client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { applyMerge, merge3, scopeLabel, type AnalysisReport, type ChatEvent, type Decision, type InspectReport, type Proposal, type Range } from '@shawarma/shared';
import {
  OfflineError, ServerError, trackHead, acceptProposal, getProject, getSettings, getVersion, postAnalysis, recordDecision, saveProject, stopChat, streamChat,
} from '../api';
import { cancelReview, dropReview, isReviewing, setCodeMinimal, startReview } from '../editor/review';
import { cardStatuses, fromStoredChat, quickActions, settleProposal, upsertLive, usd, withSound, errorItem, type Item } from './chatModel';
import { DiffCard, type CardFailure } from './DiffCard';
import { CheckFailedError, checkProblem } from './saveCheck';
import { trialAction } from '../account/billingApi';
import './chat.css';

const NO_KEY_MESSAGE = 'Add your Anthropic API key in Settings'; // server's 400 when no key is stored

export function ChatPanel(props: {
  projectId: string | null;
  /** The open project's name, shown at the top of the chat. */
  title: string;
  onRename?(): void;
  offline: boolean;
  onOffline(): void;
  onOnline(): void;
  currentCode: string;
  getCode(): string;
  getSelection(): Range;
  applyCode(code: string): void;
  /** The given code is now stored on the server as the project's current code. */
  onSaved(code: string): void;
  /** The code as last loaded from / saved to the server (null: nothing loaded). */
  getSavedCode(): string | null;
  analyse(code: string, fromSec: number, toSec: number): Promise<AnalysisReport>;
  /** Plays code without touching the editor or saving (Preview, Play original). */
  play(code: string): Promise<void>;
  stopPlayback(): void;
  /** The editor's CodeMirror view, for reviewing a proposal in place. */
  getEditorView(): EditorView | null;
  /** Brings the Code tab forward (Review in editor). */
  onShowCode?(): void;
  /** The latest check of the buffer: drives the section-aware quick actions. */
  report?: InspectReport | null;
  /** No API key is stored (and the server is not in fake AI mode): show the call-to-action, disable Send. */
  needsKey: boolean;
  onOpenSettings(): void;
  /** The server refused a chat because no key is stored. */
  onKeyMissing(): void;
  /** A sound picked in the Sounds tab, to mention in the message (a new id each pick). */
  pickedSound?: { code: string; id: number } | null;
  /**
   * Hosted mode: no dollar amounts (the account menu shows the allowance), Think deeper only on plans
   * that include it (not during Pro's trial), and "Start N-day free trial" on refusals that offer it.
   */
  hosted?: { thinkDeeper: boolean; trialDays: number };
  onUpgrade?(): void;
  /** After each chat turn (hosted: refresh the allowance). */
  onTurnEnd?(): void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [input, setInput] = useState('');
  const [deep, setDeep] = useState(false);
  const deepLocked = Boolean(props.hosted && !props.hosted.thinkDeeper);
  const [useSel, setUseSel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [reviewing, setReviewing] = useState<{ id: string; original: string } | null>(null);
  const [previewing, setPreviewing] = useState<{ id: string; which: 'proposal' | 'original' } | null>(null);
  // playback stopped some other way (Cmd+., a section widget): the card's preview is over too
  useEffect(() => getRuntime().on('stopped', () => setPreviewing(null)), []);
  const picked = props.pickedSound;
  const pickedSeen = useRef(picked?.id);   // a remount must not re-add the last pick
  useEffect(() => {
    if (!picked || picked.id === pickedSeen.current) return;
    pickedSeen.current = picked.id;
    setInput((d) => withSound(d, picked.code));
  }, [picked]);
  const [acting, setActing] = useState<string | null>(null);   // a card whose accept/revert is running
  const [failures, setFailures] = useState<Map<string, CardFailure>>(new Map());
  const [cost, setCost] = useState<{ last?: number; today?: number }>({});
  const abort = useRef<AbortController | null>(null);
  const projectId = props.projectId;
  const latest = useRef(props);
  latest.current = props;

  const loadChat = (id: string, keep = () => true, track = false) => getProject(id).then((p) => {
    if (!keep()) return;
    if (track) trackHead(id, p.versions);   // the project as opened: the base of the next save
    const { items: list, decisions: d } = fromStoredChat(p.chat);
    setItems(list);
    setDecisions(d);
  });
  // load the chat history on mount / project switch
  useEffect(() => {
    setItems([]); setDecisions(new Map()); setFailures(new Map()); setPreviewing(null);
    setCost((c) => ({ today: c.today }));
    const view = latest.current.getEditorView();
    if (view && isReviewing(view)) dropReview(view);
    setReviewing(null);
    if (!projectId) return;
    let cancelled = false;
    loadChat(projectId, () => !cancelled, true).catch((e) => { if (e instanceof OfflineError) props.onOffline(); });
    return () => { cancelled = true; };
  }, [projectId]);
  // today's spend, until the next reply reports it
  useEffect(() => { getSettings().then((s) => setCost((c) => ({ ...c, today: c.today ?? s.spentTodayUsd }))).catch(() => {}); }, []);

  // keep the newest message in view by scrolling the message list itself, never the page
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [items.length, busy]);

  // the editor selection the next message would be limited to (refreshed when the composer is used)
  const [sel, setSel] = useState<{ range: Range; label: string }>({ range: { from: 0, to: 0 }, label: '' });
  const readSelection = () => {
    const range = props.getSelection();
    setSel({ range, label: range.to > range.from ? scopeLabel(props.getCode(), range) : '' });
  };

  // the composer grows with its text (up to a third of the window)
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.3))}px`;
  }, [input]);

  const statuses = useMemo(() => cardStatuses(items, decisions), [items, decisions]);
  const setFailure = (id: string, f: CardFailure | null) => setFailures((m) => {
    const n = new Map(m);
    if (f) n.set(id, f); else n.delete(id);
    return n;
  });
  const decide = (d: Decision) => setDecisions((m) => new Map(m).set(d.proposalId, d));

  // ---- chat turn ------------------------------------------------------------------------------------

  const send = async (text = input) => {
    if (!projectId || !text.trim() || busy || props.needsKey) return;
    const code = props.getCode();
    const range = props.getSelection();
    if (useSel && !(range.to > range.from)) {
      setItems((x) => [...x, { kind: 'error', text: 'Select some code in the editor first, or turn off "Edit selection only".' }]);
      return;
    }
    const selection = useSel ? range : null;
    const scope = selection ? scopeLabel(code, selection) : undefined;
    setItems((x) => [...x, { kind: 'user', text, selection, ...(scope ? { scope } : {}) }, { kind: 'assistant', text: '', tools: [] }]);
    setInput('');
    setBusy(true);
    setStopping(false);
    const ac = new AbortController();
    abort.current = ac;
    const patchAssistant = (f: (a: Extract<Item, { kind: 'assistant' }>) => void) =>
      setItems((x) => {
        const copy = [...x];
        for (let i = copy.length - 1; i >= 0; i--) if (copy[i].kind === 'assistant') { const a = { ...(copy[i] as Extract<Item, { kind: 'assistant' }>) }; f(a); copy[i] = a; break; }
        return copy;
      });
    const onEvent = async (e: ChatEvent) => {
      if (e.type === 'text') patchAssistant((a) => { a.text += e.delta; });
      else if (e.type === 'tool') patchAssistant((a) => { a.tools = [...a.tools, `${e.name}: ${e.summary}`]; });
      else if (e.type === 'proposal_partial') {
        const { type: _, ...p } = e;
        setItems((x) => upsertLive(x, p));
      } else if (e.type === 'proposal') {
        const { type: _, ...p } = e;
        setItems((x) => settleProposal(x, p));
      } else if (e.type === 'done') {
        patchAssistant((a) => { a.cost = e.costUsd; if (e.stopped) a.stopped = true; });
        setCost({ last: e.costUsd, today: e.spentTodayUsd });
      } else if (e.type === 'error') {
        // hosted limit codes mid-turn (allowance, pro_required, global_cap, trial_cap) are plain sentences already;
        // canUpgrade adds the trial / upgrade button
        if (e.code && e.code !== 'auth') {
          const upgrade = Boolean(e.canUpgrade) && Boolean(props.onUpgrade);
          setItems((x) => [...x, { kind: 'error', text: e.message, ...(upgrade ? { upgrade: true } : {}) }]);
        } else setItems((x) => [...x, errorItem(e.message, e.code === 'auth')]);
      }
      else if (e.type === 'analysis_request') {
        let report: AnalysisReport | { error: string };
        try { report = await props.analyse(e.code, e.fromSec, e.toSec); }
        catch (err) { report = { error: (err as Error).message }; }
        try { await postAnalysis(e.requestId, report); }
        catch (err) {
          setItems((x) => [...x, { kind: 'error', text: `Could not send the audio analysis: ${(err as Error).message}` }]);
          // the report itself was rejected: tell the waiting turn now instead of letting it time out
          if (!('error' in report) && !(err instanceof OfflineError)) {
            await postAnalysis(e.requestId, { error: `analysis rejected by the server: ${(err as Error).message}` }).catch(() => {});
          }
        }
      }
    };
    try {
      await streamChat(projectId, { code, selection, message: text, deep: deep && !deepLocked, ...(scope ? { scope } : {}) }, (e) => void onEvent(e), ac.signal);
      props.onOnline();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // stopped from this page without the server's help: what it kept (a partial proposal) is in the chat log
        setTimeout(() => { if (projectId === latest.current.projectId) loadChat(projectId).catch(() => {}); }, 800);
      } else if (err instanceof OfflineError) {
        props.onOffline();
        setItems((x) => x.filter((it, i) => !(i === x.length - 1 && it.kind === 'assistant' && !it.text && !it.tools.length)));
      } else {
        if ((err as Error).message === NO_KEY_MESSAGE) props.onKeyMissing();
        // hosted refusals (no AI on Free, allowance, Think deeper, the global and trial caps) are already plain sentences
        if (err instanceof ServerError && err.code && err.status !== 500) {
          const upgrade = err.canUpgrade && Boolean(props.onUpgrade);
          setItems((x) => [...x, { kind: 'error', text: err.message, ...(upgrade ? { upgrade: true } : {}) }]);
        } else setItems((x) => [...x, errorItem((err as Error).message)]);
        props.onOnline();   // the server answered, so it is reachable
      }
    }
    props.onTurnEnd?.();
    // a turn that never got to stream anything leaves no empty reply behind, and a stream cut short leaves
    // no half-written proposal (the server keeps what it finished; it shows on the next load)
    setItems((x) => x.filter((it, i) => !(i === x.length - 1 && it.kind === 'assistant' && !it.text && !it.tools.length && it.cost === undefined)
      && !(it.kind === 'proposal' && it.live)));
    abort.current = null;
    setBusy(false);
    setStopping(false);
  };

  /** Stop: the server ends the turn and still sends the edits so far; if it can't be reached, drop the stream. */
  const stop = async () => {
    if (!busy || !projectId || stopping) return;
    setStopping(true);
    try {
      const r = await stopChat(projectId);
      if (!r.stopped) abort.current?.abort();
    } catch {
      abort.current?.abort();
    }
  };

  // ---- accepting, rejecting, reverting ----------------------------------------------------------------

  /** Writes the user's unsaved edits as their own version first, so Claude's version holds only Claude's change. */
  const saveOwnEdits = async (pre: string, message: string) => {
    const saved = props.getSavedCode();
    if (!projectId || saved === null || pre === saved) return;
    await saveProject(projectId, pre, message);
    props.onSaved(pre);
  };

  /** Shows `code` in the editor with the smallest edit (no jump of the cursor or scroll). */
  const show = (code: string) => {
    const view = props.getEditorView();
    if (view) setCodeMinimal(view, code); else props.applyCode(code);
  };

  const accept = async (p: Proposal, code: string, pre: string, taken: number, total: number, opts: { force?: boolean; inEditor?: boolean } = {}) => {
    if (!projectId) return;
    setActing(p.id);
    setFailure(p.id, null);
    try {
      if (!opts.force) {
        const problem = await checkProblem(code);
        if (problem) throw new CheckFailedError(problem);
      }
      await saveOwnEdits(pre, 'Your edits before Shawarma\'s change');
      const what = p.summary.join('; ') || 'Shawarma\'s change';
      const message = taken < total ? `${what} (${taken} of ${total} changes)` : what;
      const v = await acceptProposal(projectId, { code, message, proposalId: p.id, accepted: taken, total });
      props.onSaved(code);
      if (!opts.inEditor) show(code);
      decide({ proposalId: p.id, status: 'accepted', accepted: taken, total, versionId: v.id, previousVersionId: v.previousVersionId });
    } catch (e) {
      if (e instanceof CheckFailedError) {
        setFailure(p.id, { problem: e.problem, retry: () => accept(p, code, pre, taken, total, { ...opts, force: true }) });
      } else {
        if (e instanceof OfflineError) props.onOffline();
        setFailure(p.id, { error: `Not saved: ${e instanceof Error ? e.message : String(e)}` });
      }
    } finally {
      setActing(null);
    }
  };

  const reject = async (p: Proposal) => {
    if (!projectId) return;
    const d = await recordDecision(projectId, { proposalId: p.id, status: 'rejected' });
    decide(d);
    setFailure(p.id, null);
  };

  /**
   * Undo an accepted change: Claude's edit is taken back out of the buffer as it is now (a 3-way merge,
   * so later edits stay), and the result is saved as a new version.
   */
  const revert = async (p: Proposal, d: Decision) => {
    if (!projectId || !d.versionId || !d.previousVersionId) return;
    setActing(p.id);
    setFailure(p.id, null);
    try {
      const [after, before] = await Promise.all([getVersion(projectId, d.versionId), getVersion(projectId, d.previousVersionId)]);
      const current = props.getCode();
      const m = merge3(after.code, before.code, current);
      const code = applyMerge(m);
      const kept = m.hunks.filter((h) => h.kind === 'conflict').length;
      if (code === current) throw new Error('Nothing to revert: the code no longer contains this change.');
      await saveOwnEdits(current, 'Your edits before reverting Shawarma\'s change');
      const v = await saveProject(projectId, code, `Reverted: ${p.summary.join('; ') || 'Shawarma\'s change'}`);
      props.onSaved(code);
      show(code);
      decide(await recordDecision(projectId, { proposalId: p.id, status: 'reverted', versionId: v.id }));
      if (kept) setFailure(p.id, { error: `Reverted, except ${kept === 1 ? 'one place' : `${kept} places`} you edited since; those keep your version.` });
    } catch (e) {
      setFailure(p.id, { error: `Could not revert: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setActing(null);
    }
  };

  const review = (p: Proposal, proposed: string) => {
    const view = props.getEditorView();
    if (!view) return;
    if (reviewing) cancelReview(view);
    props.onShowCode?.();
    stopPreview();
    const original = view.state.doc.toString();
    const started = startReview(view, {
      original,
      proposed,
      title: p.summary.join('; '),
      onFinish: (r) => {
        setReviewing(null);
        if (r.code === r.original) void reject(p).catch((e) => setFailure(p.id, { error: (e as Error).message }));
        else void accept(p, r.code, r.original, Math.max(1, r.accepted), Math.max(r.total, r.accepted, 1), { inEditor: true });
      },
      onCancel: () => setReviewing(null),
    });
    if (started) { setReviewing({ id: p.id, original }); view.focus(); }
  };

  const preview = (id: string, code: string, which: 'proposal' | 'original') => {
    setPreviewing({ id, which });
    props.play(code).catch((e) => { setPreviewing(null); setFailure(id, { error: `Could not play it: ${e instanceof Error ? e.message : String(e)}` }); });
  };
  const stopPreview = () => {
    if (!previewing) return;
    setPreviewing(null);
    props.stopPlayback();
  };

  // ---- view -------------------------------------------------------------------------------------------

  const hasSel = sel.range.to > sel.range.from;
  const chips = quickActions(props.report ?? null);
  const pick = (text: string) => { setInput(text); requestAnimationFrame(() => box.current?.focus()); };
  // while a review runs, the other cards compare against the buffer as it was before it
  const baseForCards = reviewing ? reviewing.original : props.currentCode;

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <h2 className="chat-title" title={props.title}><span className="visually-hidden">Chat: </span>{props.title}</h2>
        {!props.hosted && (cost.last !== undefined || cost.today !== undefined) && (
          <span className="chat-cost" title="What Shawarma's last reply cost, and the total spent today (the daily cap is in Settings)">
            {cost.last !== undefined && <>Last reply {usd(cost.last)}<span aria-hidden="true"> · </span></>}
            {cost.today !== undefined && <>Today {usd(cost.today)}</>}
          </span>
        )}
        {props.onRename && <button className="btn btn-outline" onClick={props.onRename}>Rename</button>}
      </div>
      {props.offline && <div className="banner" role="alert">Chat is offline until the server is reachable again.</div>}
      {props.needsKey && !props.offline && (
        <div className="cta">
          <span>Chat needs an Anthropic API key.</span>
          <button className="btn btn-primary" onClick={props.onOpenSettings}>Add your Anthropic API key</button>
        </div>
      )}
      <div className="chat" ref={list} aria-label="Messages">
        {items.length === 0 && (
          <div className="chat-empty">
            <p className="chat-empty-title">What should {projectId ? <span className="chat-empty-name">{props.title}</span> : 'this song'} do next?</p>
            <p className="muted">Ask for a change in your own words. Shawarma suggests edits; you listen, pick and accept them.</p>
            {projectId && (
              <div className="quick-chips" aria-label="Suggestions">
                {chips.map((c) => <button key={c} className="quick-chip" onClick={() => pick(c)}>{c}</button>)}
              </div>
            )}
          </div>
        )}
        {items.map((it, k) =>
          it.kind === 'user' ? (
            <div key={k} className="msg user">
              <div className="msg-label">You</div>
              {it.selection && <span className="chip" title={`Characters ${it.selection.from}–${it.selection.to}`}>{it.scope ?? 'Selection only'}</span>}
              {it.text}
            </div>
          ) : it.kind === 'assistant' ? (
            <div key={k} className="msg ai">
              <div className="msg-label">Shawarma</div>
              {it.tools.map((t, i) => <div key={i} className="msg-tool">{t}</div>)}
              {it.text || (busy && k === items.length - 1 && !it.tools.length ? <span className="typing" aria-label="Shawarma is writing"><i /><i /><i /></span> : null)}
              {it.stopped && <div className="msg-stopped">Stopped. Any edits made so far are below as a partial suggestion.</div>}
              {it.cost !== undefined && !props.hosted && <div className="msg-cost">{usd(it.cost)}</div>}
            </div>
          )
          : it.kind === 'proposal' ? (() => {
              const p = it.proposal;
              const d = decisions.get(p.id);
              return (
                <DiffCard key={`p-${p.id}`} proposal={p} status={statuses.get(p.id) ?? 'pending'} decision={d}
                  currentCode={baseForCards}
                  locked={acting !== null || (reviewing !== null && reviewing.id !== p.id)}
                  reviewing={reviewing?.id === p.id}
                  previewing={previewing?.id === p.id ? previewing.which : null}
                  failure={failures.get(p.id)}
                  onAccept={(code, taken, total) => accept(p, code, props.getCode(), taken, total)}
                  onReject={() => reject(p)}
                  onReview={(code) => review(p, code)}
                  onPreview={(code, which) => preview(p.id, code, which)}
                  onStopPreview={stopPreview}
                  onRevert={() => (d ? revert(p, d) : Promise.resolve())} />
              );
            })()
          : <div key={k} className="msg err" role="alert">
              <span>{it.text}</span>
              {it.auth && <button className="btn btn-outline" onClick={props.onOpenSettings}>Open Settings</button>}
              {it.upgrade && props.onUpgrade && <button className="btn btn-outline" onClick={props.onUpgrade}>{trialAction(props.hosted?.trialDays ?? 7)}</button>}
            </div>,
        )}
      </div>
      <div className="composer">
        {items.length > 0 && projectId && !busy && (
          <div className="quick-chips compact" aria-label="Suggestions">
            {chips.map((c) => <button key={c} className="quick-chip" onClick={() => pick(c)}>{c}</button>)}
          </div>
        )}
        <div className="composer-box">
          <textarea ref={box} value={input} onChange={(e) => setInput(e.target.value)} placeholder="make the drop heavier…" rows={2}
            aria-label="Message Shawarma"
            onFocus={readSelection}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              else if (e.key === 'Escape' && busy) { e.preventDefault(); void stop(); }
            }} />
          <div className="composer-bar">
            <label className={`toggle${useSel ? ' on' : ''}`} title="The next message may only change the code you selected">
              <input type="checkbox" checked={useSel} onChange={(e) => { setUseSel(e.target.checked); readSelection(); }} />
              {useSel ? (hasSel ? sel.label : 'Select some code') : 'Edit selection only'}
            </label>
            <label className={`toggle${deep ? ' on' : ''}${deepLocked ? ' locked' : ''}`}
              title={deepLocked ? 'Think deeper is part of Pro (after the trial)' : 'Takes longer and costs more, for bigger rewrites'}>
              <input type="checkbox" checked={deep && !deepLocked} disabled={deepLocked} onChange={(e) => setDeep(e.target.checked)} />
              Think deeper
            </label>
            {busy
              ? <button className="btn send stop" onClick={() => void stop()} disabled={stopping} title="Stop Shawarma (Esc). Edits made so far are kept as a partial suggestion.">{stopping ? 'Stopping…' : '■ Stop'}</button>
              : <button className="btn btn-primary send" disabled={!projectId || props.needsKey} title={props.needsKey ? 'Add your Anthropic API key in Settings first' : undefined} onClick={() => void send()}>Send ⌘⏎</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

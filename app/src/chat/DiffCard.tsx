// One of Claude's proposals in the chat: the summary and entry point for reviewing it. The proposal is
// rebased onto the editor buffer as it is now (shared/merge.ts), so edits you made since asking are kept;
// changes that touch the same lines as yours are marked as conflicts, per change. Accept the ticked
// changes here, or review them in the editor; listen first with Preview / Play original.
import { useEffect, useMemo, useState } from 'react';
import { applyMerge, defaultChoice, merge3, scopeLabel, sectionAt, type Decision, type Proposal } from '@shawarma/shared';
import type { CardStatus } from './chatModel';
import { hunkRows, type Row } from './hunkView';

export interface CardFailure {
  /** The check found the code would not run; `retry` saves it anyway. */
  problem?: string;
  error?: string;
  retry?(): Promise<void>;
}

export interface DiffCardProps {
  proposal: Proposal;
  status: CardStatus;
  decision?: Decision;
  /** The editor buffer the proposal is rebased onto. */
  currentCode: string;
  /** Another card's action is running (or a chat turn): this one waits. */
  locked: boolean;
  reviewing: boolean;
  /** What a preview from this card is playing, if anything. */
  previewing: 'proposal' | 'original' | null;
  failure?: CardFailure;
  onAccept(code: string, taken: number, total: number): Promise<void>;
  onReject(): Promise<void>;
  onReview(code: string): void;
  onPreview(code: string, which: 'proposal' | 'original'): void;
  onStopPreview(): void;
  onRevert(): Promise<void>;
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className="hunk-rows" role="presentation">
      {rows.map((r, i) => (
        <div key={i} className={`hunk-row r-${r.kind}`}>
          <span className="hunk-n" aria-hidden="true">{r.n ?? ''}</span>
          <span className="hunk-sign" aria-hidden="true">{r.kind === 'del' ? '−' : r.kind === 'add' ? '+' : ''}</span>
          <code className="hunk-code">
            {r.kind === 'del' && <span className="visually-hidden">removed: </span>}
            {r.kind === 'add' && <span className="visually-hidden">added: </span>}
            {r.segs.length === 0 ? ' ' : r.segs.map((s, k) => (s.hl ? <mark key={k}>{s.text}</mark> : <span key={k}>{s.text}</span>))}
          </code>
        </div>
      ))}
    </div>
  );
}

const statusText: Partial<Record<CardStatus, string>> = {
  superseded: 'Superseded by a newer suggestion.',
  rejected: 'Rejected.',
  reverted: 'Reverted.',
};

export function DiffCard(props: DiffCardProps) {
  const { proposal: p, status } = props;
  // an open proposal is shown against the buffer now; a decided or superseded one as it was proposed
  const live = status === 'pending' || status === 'live';
  const against = live ? props.currentCode : p.baseCode;
  const merge = useMemo(() => merge3(p.baseCode, p.code, against), [p.baseCode, p.code, against]);
  // the ticked changes: every clean one by default, conflicts keep your text until you tick them
  const signature = merge.hunks.map((h) => `${h.kind}:${h.proposed}`).join('\u0000');
  const [take, setTake] = useState(() => defaultChoice(merge));
  useEffect(() => { setTake(defaultChoice(merge)); }, [signature]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(status === 'pending' || status === 'live');
  useEffect(() => { if (status !== 'pending' && status !== 'live') setOpen(false); }, [status]);

  const actionable = status === 'pending' && !props.reviewing;
  const merged = useMemo(() => applyMerge(merge, take), [merge, take]);
  const conflicts = merge.hunks.filter((h) => h.kind === 'conflict').length;
  const total = merge.hunks.length;
  const scope = p.selection ? scopeLabel(p.baseCode, p.selection) : null;
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const toggle = (id: number) => setTake((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const failure = props.failure;
  const disabled = busy || props.locked;
  const accepted = props.decision?.status === 'accepted' ? props.decision : null;

  return (
    <section className={`diffcard status-${status}${props.reviewing ? ' reviewing' : ''}`} aria-label="Suggested change">
      <header className="diffcard-head">
        <span className="diffcard-title">{status === 'live' ? 'Shawarma is editing…' : 'Suggested change'}</span>
        {p.partial && <span className="pill warn" title="You stopped Shawarma before it finished; these are the edits made until then">Partial</span>}
        {scope && <span className="pill" title="The request was limited to this part of the code">{scope}</span>}
        {status === 'superseded' && <span className="pill dim">Superseded</span>}
        {status === 'accepted' && <span className="pill ok">Accepted</span>}
        {status === 'rejected' && <span className="pill dim">Rejected</span>}
        {status === 'reverted' && <span className="pill dim">Reverted</span>}
        {status !== 'pending' && status !== 'live' && (
          <button className="btn btn-outline diffcard-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide changes' : 'Show changes'}</button>
        )}
      </header>
      {p.summary.length > 0 && (
        <ul className="diff-summary">{p.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
      )}
      {p.check && <div className="diff-check">{p.check}</div>}

      {open && (status === 'pending' || status === 'live') && merge.hunks.length === 0 && (
        <p className="muted">{status === 'live' ? 'No changes yet.' : 'Nothing left to apply: these changes are already in your code.'}</p>
      )}
      {open && conflicts > 0 && actionable && (
        <p className="diff-conflicts" role="note">
          You changed {conflicts === 1 ? 'the same lines as one of these changes' : `the same lines as ${conflicts} of these changes`} since asking.
          Your version is kept unless you tick it.
        </p>
      )}
      {open && merge.hunks.map((h) => {
        const section = sectionAt(against, h.offset);
        const where = `Line ${h.line}${section ? ` · ${section}` : ''}`;
        const conflict = h.kind === 'conflict';
        return (
          <div key={h.id} className={`hunk${conflict ? ' conflict' : ''}${take.has(h.id) ? '' : ' off'}`}>
            <div className="hunk-head">
              {actionable ? (
                <label className="hunk-pick">
                  <input type="checkbox" checked={take.has(h.id)} onChange={() => toggle(h.id)} disabled={disabled}
                    aria-label={`${conflict ? 'Use Shawarma\'s version at' : 'Apply the change at'} ${where}`} />
                  <span>{where}</span>
                </label>
              ) : <span className="hunk-where">{where}</span>}
              {conflict && <span className="pill err">Conflict: you edited these lines too</span>}
            </div>
            <Rows rows={hunkRows(against, h)} />
          </div>
        );
      })}

      {failure?.problem && (
        <div className="diff-problem" role="alert">
          <span>{failure.problem}. Untick the change that breaks it, ask Shawarma to fix it, or save it anyway.</span>
          {failure.retry && <button className="btn" disabled={disabled} onClick={() => void run(failure.retry!)}>Accept anyway</button>}
        </div>
      )}
      {(failure?.error || error) && <div className="diff-error" role="alert">{failure?.error || error}</div>}

      {props.reviewing && <p className="diff-note">Reviewing in the editor. Accept or reject each change there; the song plays the proposal meanwhile.</p>}
      {statusText[status] && <p className="diff-note">{statusText[status]}</p>}
      {accepted && (
        <div className="diff-actions">
          <span className="diff-note">
            {accepted.total && accepted.accepted !== undefined && accepted.accepted < accepted.total
              ? `Accepted ${accepted.accepted} of ${accepted.total} changes.` : 'Accepted.'}
          </span>
          {accepted.previousVersionId && (
            <button className="btn btn-outline" disabled={disabled} onClick={() => void run(props.onRevert)}
              title="Undo this change in the editor and save that as a new version (your later edits are kept)">Revert this change</button>
          )}
        </div>
      )}

      {actionable && total > 0 && (
        <div className="diff-actions">
          <button className="btn btn-primary" disabled={disabled || take.size === 0}
            onClick={() => void run(() => props.onAccept(merged, take.size, total))}>
            {take.size === total ? (total === 1 ? 'Accept' : `Accept all ${total}`) : `Accept ${take.size} of ${total}`}
          </button>
          <button className="btn" disabled={disabled} onClick={() => props.onReview(merged)} title="Show the changes in the editor, accept or reject each there">Review in editor</button>
          <span className="diff-listen">
            {props.previewing === 'proposal'
              ? <button className="btn btn-live" onClick={props.onStopPreview} aria-pressed="true">■ Stop preview</button>
              : <button className="btn" onClick={() => props.onPreview(merged, 'proposal')} title="Play the code with the ticked changes, without saving anything">▶ Preview</button>}
            {props.previewing === 'original'
              ? <button className="btn btn-live" onClick={props.onStopPreview} aria-pressed="true">■ Stop</button>
              : <button className="btn btn-outline" onClick={() => props.onPreview(props.currentCode, 'original')} title="Play your code as it is, to compare">Play original</button>}
          </span>
          <button className="btn btn-outline diff-reject" disabled={disabled} onClick={() => void run(props.onReject)}>Reject</button>
        </div>
      )}
      {actionable && total === 0 && (
        <div className="diff-actions">
          <button className="btn btn-outline" disabled={disabled} onClick={() => void run(props.onReject)}>Dismiss</button>
        </div>
      )}
    </section>
  );
}

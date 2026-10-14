import type { InspectReport } from '@shawarma/shared';

export function CheckBadges({ report, offline }: { report: InspectReport | null; offline: boolean }) {
  if (offline) return <span className="badge warn">Checks offline</span>;
  if (!report) return <span className="badge">Checking…</span>;
  if (report.issues.length === 0) return <span className="badge ok">✓ Checks pass</span>;
  return (
    <span className="badges">
      {report.issues.map((i, k) => (
        <span key={k} className={`badge ${i.kind === 'eval_error' ? 'err' : 'warn'}`} title={i.message}>⚠ {i.kind.replace('_', ' ')}</span>
      ))}
    </span>
  );
}

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileText } from 'lucide-react';

// Renders the structured Evaluate-MN result: a per-line table of
// what Elena pulled from the document, the decision, and the rule referenced.

function DecisionBadge({ decision }) {
  const map = {
    Yes: { cls: 'bg-green-500/15 text-green-400 border-green-500/30', Icon: CheckCircle2 },
    Invalid: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', Icon: AlertTriangle },
    No: { cls: 'bg-red-500/15 text-red-400 border-red-500/30', Icon: XCircle },
  };
  const { cls, Icon } = map[decision] || map.No;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      <Icon size={12} /> {decision}
    </span>
  );
}

export default function MNEvaluationTable({ data }) {
  if (!data) return null;
  const { filename, product, coverage_path, rows = [], clinicals, verdict, gap_note } = data;
  const established = verdict === 'Established';

  return (
    <div className="message-content w-full space-y-3">
      {/* Header / verdict */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm text-elena-text">
          <FileText size={15} className="text-elena-muted" />
          {filename || 'Document'}
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
            established
              ? 'bg-green-500/15 text-green-400 border-green-500/30'
              : 'bg-red-500/15 text-red-400 border-red-500/30'
          }`}
        >
          {established ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {verdict || 'Unknown'}
        </span>
        {product && <span className="text-xs text-elena-muted">{product}</span>}
        {coverage_path && <span className="text-xs text-elena-muted">· {coverage_path} path</span>}
      </div>

      {/* The three-column table: what Elena pulled · decision · rule referenced */}
      <div className="overflow-x-auto rounded-xl border border-elena-border">
        <table className="w-full min-w-[680px] text-sm border-collapse">
          <thead>
            <tr className="bg-elena-surface text-left text-xs text-elena-muted">
              <th className="px-3 py-2 font-medium">Requirement</th>
              <th className="px-3 py-2 font-medium">Pulled from document</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium">Rule referenced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-elena-border align-top">
                <td className="px-3 py-2 text-elena-text font-medium min-w-[130px]">{r.requirement}</td>
                <td className="px-3 py-2 text-elena-text italic">
                  {r.evidence
                    ? <span className="text-elena-text">“{r.evidence}”</span>
                    : <span className="text-elena-muted">(nothing in document)</span>}
                </td>
                <td className="px-3 py-2"><DecisionBadge decision={r.decision} /></td>
                <td className="px-3 py-2 text-elena-muted">{r.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Clinicals block */}
      {clinicals && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-elena-muted px-1">
          <span><span className="text-elena-text">Diagnosis:</span> {clinicals.diagnosis || '—'}</span>
          <span><span className="text-elena-text">Last visit:</span> {clinicals.last_visit_date || '—'}</span>
          {clinicals.mr_expiry && <span><span className="text-elena-text">MR expiry:</span> {clinicals.mr_expiry}</span>}
          {clinicals.stale_visit && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <AlertTriangle size={12} /> Stale visit (&gt;6 months)
            </span>
          )}
        </div>
      )}

      {/* Gap note for Send Request */}
      {!established && gap_note && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <span className="font-semibold">What to request: </span>{gap_note}
        </div>
      )}

      <p className="text-xs text-elena-muted px-1">
        Decision-support only — a processor confirms before advancing. Elena marks Yes only for proof quoted from the file.
      </p>
    </div>
  );
}

'use client';

import {Fragment, useState, useTransition} from 'react';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import type {Id} from '@/convex/_generated/dataModel';
import {approveClauseAsHuman, type ApproveResult} from '../actions';
import {errorText} from '@/lib/error-text';

// Rank so the receipts echo the finding: critical first, low last. This only
// reorders the DISPLAY — each row still shows its own clause number, and the
// data is untouched.
const RISK_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unassessed: 0
};
function statusBadge(status: string) {
  if (status === 'approved') return 'ok';
  if (status === 'flagged') return 'warn';
  return '';
}

export function Clauses({
  contractId,
  canApprove
}: {
  contractId: string;
  canApprove: boolean;
}) {
  const clauses = useQuery(api.contracts.listClausesByContract, {
    contractId: contractId as Id<'contracts'>
  });
  const [revealControls, setReveal] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    clauseId: string;
    res: ApproveResult;
  } | null>(null);
  const [, startTransition] = useTransition();

  const showApprove = canApprove || revealControls;

  // Highest risk at the top; ties keep document order.
  const ordered = clauses
    ? [...clauses].sort(
        (a, b) =>
          (RISK_RANK[b.riskLevel] ?? 0) - (RISK_RANK[a.riskLevel] ?? 0) ||
          a.index - b.index
      )
    : clauses;

  function onApprove(clauseId: string) {
    setPendingId(clauseId);
    setResult(null);
    startTransition(async () => {
      const res = await approveClauseAsHuman(contractId, clauseId);
      setResult({clauseId, res});
      setPendingId(null);
    });
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{margin: 0}}>Clauses</h2>
        <span style={{flex: 1}} />
        <label className="toggle">
          <input
            type="checkbox"
            checked={revealControls}
            onChange={(e) => setReveal(e.target.checked)}
          />
          Let me try approving one myself
        </label>
      </div>
      <p className="evi-lead">
        The contract, split into clauses. Each row shows the risk the agent
        assessed and who signed off.{' '}
        {!canApprove && (
          <>
            Your role cannot approve, so the button is hidden. Tick the box to
            show it and force the action. In intersection mode, the backend
            still says no. A hidden button proves nothing. A real{' '}
            <code>403</code> does.
          </>
        )}
      </p>

      {clauses === undefined ? (
        <div className="empty">
          <span className="spinner" /> Loading clauses…
        </div>
      ) : clauses.length === 0 ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden="true">
            📄
          </span>
          This contract has no clauses yet.
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Clause</th>
                <th>Risk</th>
                <th>Status</th>
                <th>Decided by</th>
                {showApprove && <th></th>}
              </tr>
            </thead>
            <tbody>
              {ordered!.map((c) => (
                <Fragment key={c._id}>
                  <tr
                    className={
                      c.riskLevel === 'critical'
                        ? 'row-critical'
                        : c.riskLevel === 'high'
                          ? 'row-high'
                          : undefined
                    }
                  >
                    <td className="muted">{c.index}</td>
                    <td className="clause-text">{c.text}</td>
                    <td>
                      <span className={`ev-tag risk-${c.riskLevel}`}>
                        {c.riskLevel}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      <div className="mono">{c.decidedBy ?? '-'}</div>
                      {c.decisionCorrelationId && (
                        <div className="mono">{c.decisionCorrelationId}</div>
                      )}
                    </td>
                    {showApprove && (
                      <td>
                        <button
                          className="btn-primary"
                          disabled={
                            pendingId === c._id || c.status === 'approved'
                          }
                          onClick={() => onApprove(c._id)}
                        >
                          {pendingId === c._id ? 'Approving…' : 'Approve'}
                        </button>
                      </td>
                    )}
                  </tr>
                  {result?.clauseId === c._id && (
                    <tr>
                      <td
                        colSpan={showApprove ? 6 : 5}
                        style={{borderBottom: 'none'}}
                      >
                        <ApproveNotice res={result.res} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApproveNotice({res}: {res: ApproveResult}) {
  if (res.ok) {
    return (
      <div className="notice allow">
        Approved in {res.mode} mode. The action went through the crew endpoint.
        Kinde authorized it.
      </div>
    );
  }
  if (res.status === 403) {
    return (
      <div className="notice deny">
        Denied by the backend. HTTP 403, {res.mode} mode. Reason:{' '}
        <code>{errorText(res.reason, 'denied')}</code>
        {res.requiredScopes && res.requiredScopes.length > 0 && (
          <>
            {' '}
            · requiredScopes: <code>{res.requiredScopes.join(', ')}</code>
          </>
        )}
        {res.correlationId && (
          <>
            {' '}
            · correlationId: <span className="mono">{res.correlationId}</span>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="notice deny">
      {errorText(res.error, 'error')} (HTTP {res.status})
      {res.reason ? <>. {errorText(res.reason, '')}</> : null}
    </div>
  );
}

'use client';

import {Fragment, useState, useTransition} from 'react';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import type {Id} from '@/convex/_generated/dataModel';
import {approveClauseAsHuman, type ApproveResult} from '../actions';
import {errorText} from '@/lib/error-text';

function riskClass(level: string) {
  return `risk-${level}`;
}
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
          Dev: reveal approve controls
        </label>
      </div>
      {!canApprove && (
        <p className="muted" style={{fontSize: '0.82rem', marginTop: 0}}>
          Your role has no <code>clauses:approve</code> permission, so the
          approve control is hidden. Toggle it on to force the action — in
          intersection mode the backend still denies it (a hidden button proves
          nothing).
        </p>
      )}

      {clauses === undefined ? (
        <div className="empty">Loading…</div>
      ) : (
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
            {clauses.map((c) => (
              <Fragment key={c._id}>
                <tr>
                  <td className="muted">{c.index}</td>
                  <td className="clause-text">{c.text}</td>
                  <td className={riskClass(c.riskLevel)}>{c.riskLevel}</td>
                  <td>
                    <span className={`badge ${statusBadge(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <div className="mono">{c.decidedBy ?? '—'}</div>
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
      )}
    </div>
  );
}

function ApproveNotice({res}: {res: ApproveResult}) {
  if (res.ok) {
    return (
      <div className="notice allow">
        ✅ Approved (mode <strong>{res.mode}</strong>). The action went through
        the crew endpoint and was authorized.
      </div>
    );
  }
  if (res.status === 403) {
    return (
      <div className="notice deny">
        ⛔ <strong>Denied by the backend</strong> (HTTP 403, mode{' '}
        <strong>{res.mode}</strong>). reason:{' '}
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
      ⚠️ {errorText(res.error, 'error')} (HTTP {res.status})
      {res.reason ? <> — {errorText(res.reason, '')}</> : null}
    </div>
  );
}

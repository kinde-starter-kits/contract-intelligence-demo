'use client';

import {usePaginatedQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';

export function Audit({orgCode}: {orgCode: string}) {
  const {results, status, loadMore} = usePaginatedQuery(
    api.dashboard.auditPage,
    {orgCode},
    {initialNumItems: 8}
  );

  const rows = results.filter((r) => r.decision !== null);

  return (
    <div className="card">
      <h2>
        Audit trail <span className="sub">component decisions</span>
      </h2>
      {status === 'LoadingFirstPage' ? (
        <div className="empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No decisions recorded yet.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Decision</th>
                <th>Action</th>
                <th>Reason</th>
                <th>Ceiling (scopesUsed)</th>
                <th>correlationId</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td>
                    <span
                      className={`badge ${r.decision === 'allow' ? 'ok' : 'bad'}`}
                    >
                      <span className="dot" />
                      {r.decision}
                    </span>
                  </td>
                  <td className="mono">{r.action ?? '—'}</td>
                  <td>{r.reason ?? '—'}</td>
                  <td className="mono">
                    {r.scopesUsed ? r.scopesUsed.join(', ') : '—'}
                  </td>
                  <td className="mono">{r.correlationId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {status === 'CanLoadMore' && (
            <div className="toolbar" style={{marginTop: '0.75rem'}}>
              <button onClick={() => loadMore(8)}>Load more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

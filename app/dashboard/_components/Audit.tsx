'use client';

import {usePaginatedQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';

/**
 * The receipts: every decision the Kinde component actually made, from its audit
 * log. A denied sign-off in the timeline writes a row here — the correlationId
 * is the same in both places, so a skeptic can tie them together.
 */
export function Audit({orgCode}: {orgCode: string}) {
  const {results, status, loadMore} = usePaginatedQuery(
    api.dashboard.auditPage,
    {orgCode},
    {initialNumItems: 10}
  );

  const rows = results.filter((r) => r.decision !== null);

  return (
    <div className="card">
      <h2>
        Audit trail <span className="sub">straight from the component</span>
      </h2>
      <p className="evi-lead">
        This is every decision the Kinde component made. In intersection mode,
        each denied sign-off adds a row here. To match a denial in the timeline
        to its row, use the{' '}
        <span className="hintword">
          correlationId
          <span className="hint">
            a unique id that links this decision to the timeline step and your
            logs
          </span>
        </span>
        .
      </p>

      {status === 'LoadingFirstPage' ? (
        <div className="empty">
          <span className="spinner" /> Loading decisions…
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden="true">
            🧾
          </span>
          No decisions yet. Run a review in intersection mode. Every allow and
          deny appears here.
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Action</th>
                  <th>Reason</th>
                  <th>
                    <span className="hintword">
                      Ceiling
                      <span className="hint">
                        the acting user&apos;s permissions. The crew cannot
                        exceed them.
                      </span>
                    </span>
                  </th>
                  <th>correlationId</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r._id}
                    className={r.decision === 'deny' ? 'row-deny' : undefined}
                  >
                    <td>
                      <span
                        className={`badge ${r.decision === 'allow' ? 'ok' : 'bad'}`}
                      >
                        <span className="dot" />
                        {r.decision}
                      </span>
                    </td>
                    <td className="mono">{r.action ?? '-'}</td>
                    <td>{r.reason ?? '-'}</td>
                    <td className="mono">
                      {r.scopesUsed && r.scopesUsed.length > 0
                        ? r.scopesUsed.join(', ')
                        : '-'}
                    </td>
                    <td>
                      {r.correlationId ? (
                        <code className="cid-chip">{r.correlationId}</code>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status === 'CanLoadMore' && (
            <div className="toolbar" style={{marginTop: '0.75rem'}}>
              <button onClick={() => loadMore(10)}>Load more decisions</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';

export function Runs({orgCode}: {orgCode: string}) {
  const runs = useQuery(api.dashboard.listReviewRuns, {orgCode});
  return (
    <div className="card">
      <h2>Review runs</h2>
      {runs === undefined ? (
        <div className="empty">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="empty">No review runs yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Acting subject</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 12).map((r) => (
              <tr key={r._id}>
                <td className="mono">{r.actingSubject}</td>
                <td>
                  <span
                    className={`badge ${r.mode === 'broken' ? 'bad' : 'ok'}`}
                  >
                    {r.mode}
                  </span>
                </td>
                <td>{r.status}</td>
                <td className="muted">
                  {new Date(r.startedAt).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

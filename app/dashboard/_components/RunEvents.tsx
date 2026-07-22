'use client';

import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import type {Id} from '@/convex/_generated/dataModel';

const TYPE_LABEL: Record<string, string> = {
  run_started: '▶ run started',
  extractor_started: '· extractor started',
  clause_extracted: '· clause extracted',
  clause_assessed: '· clause assessed',
  clause_flagged: '⚑ clause flagged',
  signoff_attempted: '· sign-off attempted',
  signoff_allowed: '✅ sign-off allowed',
  signoff_denied: '⛔ sign-off denied',
  run_complete: '■ run complete'
};

/**
 * Minimal live render of a review run's step events (R1 — the real timeline UI
 * is R2). Subscribes to the latest run for the contract via Convex reactivity,
 * so events appear as the crew emits them.
 */
export function RunEvents({contractId}: {contractId: string}) {
  const run = useQuery(api.runEvents.latestReviewRun, {
    contractId: contractId as Id<'contracts'>
  });
  const events = useQuery(
    api.runEvents.listRunEvents,
    run ? {reviewRunId: run._id} : 'skip'
  );

  return (
    <div className="card">
      <h2>
        Live run{' '}
        <span className="sub">
          {run ? `${run.mode} · ${run.status}` : 'no run yet'}
        </span>
      </h2>
      {!run ? (
        <div className="empty">No review run for this contract yet.</div>
      ) : events === undefined ? (
        <div className="empty">Loading…</div>
      ) : events.length === 0 ? (
        <div className="empty">Waiting for events…</div>
      ) : (
        <ol style={{margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem'}}>
          {events.map((e) => (
            <li key={e._id} style={{marginBottom: '0.15rem'}}>
              <span
                className={
                  e.type === 'signoff_denied'
                    ? 'risk-high'
                    : e.type === 'signoff_allowed'
                      ? 'risk-low'
                      : undefined
                }
              >
                {TYPE_LABEL[e.type] ?? e.type}
              </span>{' '}
              <span className="muted">{e.message}</span>
              {e.detail?.correlationId && (
                <span className="mono"> · {e.detail.correlationId}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

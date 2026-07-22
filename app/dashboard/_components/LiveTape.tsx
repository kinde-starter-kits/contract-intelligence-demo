'use client';

import {Fragment} from 'react';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import type {Id} from '@/convex/_generated/dataModel';

const LABEL: Record<string, string> = {
  run_started: 'Run started',
  extractor_started: 'Extractor started',
  clause_extracted: 'Clause extracted',
  clause_assessed: 'Risk assessed',
  clause_flagged: 'Clause flagged',
  signoff_attempted: 'Sign-off attempted',
  signoff_allowed: 'Sign-off allowed',
  signoff_denied: 'Sign-off denied',
  run_complete: 'Run complete'
};

const ICON: Record<string, string> = {
  run_started: '▶',
  extractor_started: '⌕',
  clause_extracted: '¶',
  clause_assessed: '◇',
  clause_flagged: '⚑',
  signoff_attempted: '⋯',
  signoff_allowed: '✓',
  signoff_denied: '✕',
  run_complete: '✦'
};

/**
 * The live timeline — the watch experience. Subscribes to the latest run's
 * events (Convex reactivity) and renders them as they land, with the two
 * money-moment callouts breaking out of the stream when they actually occur:
 *   - broken mode approving a HIGH-risk clause the actor can't approve → the
 *     confused deputy;
 *   - a real 403 sign-off denial → Kinde holding the line.
 * These fire on REAL server events, never a scripted animation.
 */
export function LiveTape({
  contractId,
  actorNoun,
  actorCanApprove,
  runError
}: {
  contractId: string;
  actorNoun: string;
  actorCanApprove: boolean;
  runError?: string | null;
}) {
  const run = useQuery(api.runEvents.latestReviewRun, {
    contractId: contractId as Id<'contracts'>
  });
  const events = useQuery(
    api.runEvents.listRunEvents,
    run ? {reviewRunId: run._id} : 'skip'
  );

  const errored = !!runError || run?.status === 'failed';
  const running = run?.status === 'running' && !errored;
  const mode = run?.mode;
  const hasComplete = (events ?? []).some((e) => e.type === 'run_complete');

  // Risk per clause, from the assessment events — used to spot the high-risk
  // approval that makes the confused deputy visceral.
  const riskByClause: Record<string, string> = {};
  for (const e of events ?? []) {
    if (
      e.type === 'clause_assessed' &&
      e.detail?.clauseId &&
      e.detail?.riskLevel
    ) {
      riskByClause[e.detail.clauseId] = e.detail.riskLevel;
    }
  }

  let badShown = false;
  let goodShown = false;

  return (
    <div className="tape-card">
      <div className="tape-head">
        <h2>
          <span className={`livedot${running ? '' : ' idle'}`} />
          Live review timeline
        </h2>
        {run && (
          <span className="tape-run-meta">
            <span className={`badge ${mode === 'broken' ? 'bad' : 'ok'}`}>
              {mode}
            </span>
            <span>{errored ? 'error' : run.status}</span>
          </span>
        )}
      </div>

      {errored && (
        <div className="tape-error" role="alert">
          The run didn’t finish.{' '}
          {runError ?? 'Something went wrong partway through.'} The steps so far
          are below. Press Run review to try again.
        </div>
      )}

      {!run ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden="true">
            ▶
          </span>
          Press Run review. The agent works through the contract, one clause at
          a time. Watch the high-risk clause.
        </div>
      ) : events === undefined ? (
        <div className="empty">
          <span className="spinner" /> Loading the run…
        </div>
      ) : events.length === 0 ? (
        <div className="empty">
          <span className="spinner" /> Waiting for the first step…
        </div>
      ) : (
        <ol className="tape">
          {events.map((e) => {
            const risk = e.detail?.clauseId
              ? riskByClause[e.detail.clauseId]
              : undefined;
            const showRisk =
              (e.type === 'clause_assessed' ||
                e.type === 'signoff_attempted' ||
                e.type === 'signoff_allowed' ||
                e.type === 'signoff_denied') &&
              risk;

            // The first high-risk sign-off that goes through in broken mode. If
            // the acting human can't approve, it's the confused deputy; if they
            // happen to hold approve (Admin), it's still broken mode's point —
            // it wouldn't have checked either way — but we say so accurately.
            const isHighBrokenApproval =
              e.type === 'signoff_allowed' &&
              mode === 'broken' &&
              risk === 'high' &&
              !badShown;
            if (isHighBrokenApproval) badShown = true;
            const isConfusedDeputy = isHighBrokenApproval && !actorCanApprove;
            const isBrokenAdmin = isHighBrokenApproval && actorCanApprove;

            const isBlocked = e.type === 'signoff_denied' && !goodShown;
            if (isBlocked) goodShown = true;

            return (
              <Fragment key={e._id}>
                <li className={`ev t-${e.type}`}>
                  <span className="ev-ico" aria-hidden="true">
                    {ICON[e.type] ?? '•'}
                  </span>
                  <div className="ev-row">
                    <span className="ev-label">{LABEL[e.type] ?? e.type}</span>
                    <span className="ev-msg">{e.message}</span>
                    {showRisk && (
                      <span className={`ev-tag risk-${risk}`}>{risk} risk</span>
                    )}
                    {e.detail?.correlationId && (
                      <span className="ev-cid">{e.detail.correlationId}</span>
                    )}
                  </div>
                </li>

                {isConfusedDeputy && (
                  <div className="rupture bad">
                    <div className="r-eyebrow">⚠ Confused deputy</div>
                    <p className="r-say">
                      The agent approved a high-risk clause. It used its own
                      permissions. The {actorNoun} who started this run cannot
                      approve clauses. The agent did it for them anyway.
                    </p>
                    <div className="r-machine">
                      <span>
                        <b>mode</b> broken
                      </span>
                      <span>
                        <b>user checked</b> no
                      </span>
                    </div>
                  </div>
                )}

                {isBrokenAdmin && (
                  <div className="rupture note">
                    <div className="r-eyebrow">⚙ Broken mode</div>
                    <p className="r-say">
                      The agent approved a high-risk clause on its own
                      authority. This {actorNoun} has approve permission. But in
                      broken mode, the approval goes through even without it.
                      That is the gap broken mode hides.
                    </p>
                    <div className="r-machine">
                      <span>
                        <b>mode</b> broken
                      </span>
                      <span>
                        <b>user checked</b> no
                      </span>
                    </div>
                  </div>
                )}

                {isBlocked && (
                  <div className="rupture good">
                    <div className="r-eyebrow">✋ Blocked by Kinde</div>
                    <p className="r-say">
                      Kinde blocked it. The {actorNoun} does not have approve
                      permission. Kinde denied the agent acting for them.
                    </p>
                    <div className="r-machine">
                      <span>
                        <b>reason</b> {e.detail?.reason ?? 'insufficient_scope'}
                      </span>
                      {e.detail?.correlationId && (
                        <span>
                          <b>correlationId</b> {e.detail.correlationId}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </ol>
      )}

      {run && events && events.length > 0 && !errored && (
        <div className={`tape-foot${hasComplete ? ' done' : ''}`}>
          {hasComplete ? (
            <>✦ Review complete</>
          ) : (
            <>
              <span className="spinner" /> streaming…
            </>
          )}
        </div>
      )}
    </div>
  );
}

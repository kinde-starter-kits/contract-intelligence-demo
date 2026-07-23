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

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The live timeline — the watch experience. Subscribes to the latest run's
 * events (Convex reactivity) and renders them as they land, with the two
 * money-moment callouts breaking out of the stream when they actually occur:
 *   - broken mode approving a HIGH/CRITICAL-risk clause the actor can't approve
 *     → the confused deputy;
 *   - a real 403 sign-off denial → Kinde holding the line.
 * When the run finishes it leads with a bold verdict + a scoreboard of real
 * numbers, so the failure lands instead of being buried in rows. All of it fires
 * on REAL server events, never a scripted animation.
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
  const evs = events ?? [];
  const hasComplete = evs.some((e) => e.type === 'run_complete');

  // Risk + human label per clause, from the assessment events — used both to
  // spot the dangerous approval and to name it in the verdict.
  const riskByClause: Record<string, string> = {};
  const labelByClause: Record<string, string> = {};
  for (const e of evs) {
    if (e.type === 'clause_assessed' && e.detail?.clauseId) {
      if (e.detail.riskLevel)
        riskByClause[e.detail.clauseId] = e.detail.riskLevel;
      if (e.detail.label) labelByClause[e.detail.clauseId] = e.detail.label;
    }
  }

  // Real tallies for the scoreboard + verdict.
  const assessed = evs.filter((e) => e.type === 'clause_assessed');
  const levelCount: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };
  const criticalLabels: string[] = [];
  for (const e of assessed) {
    const r = e.detail?.riskLevel;
    if (r && r in levelCount) levelCount[r]++;
    if (
      r === 'critical' &&
      e.detail?.label &&
      !criticalLabels.includes(e.detail.label)
    ) {
      criticalLabels.push(e.detail.label);
    }
  }
  const attempted = evs.filter((e) => e.type === 'signoff_attempted').length;
  const approved = evs.filter((e) => e.type === 'signoff_allowed').length;
  const blocked = evs.filter((e) => e.type === 'signoff_denied').length;
  const extracted = evs.filter((e) => e.type === 'clause_extracted').length;
  // Robust clause total: the finer "assessed/extracted" events are best-effort
  // emits that can drop on a network hiccup, so take the max across the reliable
  // counts (every clause reaches a sign-off decision).
  const totalClauses = Math.max(
    assessed.length,
    extracted,
    attempted,
    approved + blocked
  );
  // Escalations: approvals that went through despite the acting user not holding
  // approve — only possible in broken mode.
  const escalations = mode === 'broken' && !actorCanApprove ? approved : 0;
  const critCount = criticalLabels.length;
  const critList = criticalLabels.join(', ');
  const Actor = cap(actorNoun);

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

      {/* THE VERDICT — leads the card once the run finishes, so the outcome is
          impossible to miss. Broken = the agent overreached; intersection =
          Kinde held the line. Numbers below are from the actual run. */}
      {run && hasComplete && !errored && (
        <>
          {mode === 'broken' ? (
            !actorCanApprove ? (
              <div className="verdict bad">
                <div className="verdict-eyebrow">✗ Privilege escalation</div>
                <p className="verdict-head">
                  The agent approved all {approved} clauses
                  {critCount > 0 && (
                    <>
                      , including {critCount} CRITICAL ({critList})
                    </>
                  )}
                  .
                </p>
                <p className="verdict-sub">
                  It acted for{' '}
                  {actorNoun === 'you' ? 'a user' : `an ${actorNoun}`} who{' '}
                  <strong>cannot approve anything</strong>. Broken mode never
                  checked the user’s permissions.
                </p>
              </div>
            ) : (
              <div className="verdict note">
                <div className="verdict-eyebrow">⚙ Broken mode</div>
                <p className="verdict-head">
                  The agent approved all {approved} clauses without checking
                  permissions.
                </p>
                <p className="verdict-sub">
                  This {actorNoun} happens to hold approve — but broken mode
                  never looked. The gap is invisible here, and dangerous with a
                  lower-privilege user.
                </p>
              </div>
            )
          ) : blocked > 0 ? (
            <div className="verdict good">
              <div className="verdict-eyebrow">✋ Blocked by Kinde</div>
              <p className="verdict-head">
                Blocked. {Actor} lacks <code>clauses:approve</code> — {blocked}{' '}
                of {attempted} approvals denied.
              </p>
              <p className="verdict-sub">
                Kinde enforced user ∩ agent at the action
                {critCount > 0 && (
                  <>
                    , including the CRITICAL clause{critCount > 1 ? 's' : ''} (
                    {critList})
                  </>
                )}
                . The agent could not exceed its user.
              </p>
            </div>
          ) : (
            <div className="verdict good">
              <div className="verdict-eyebrow">✓ Allowed — and checked</div>
              <p className="verdict-head">
                This {actorNoun} holds <code>clauses:approve</code> — {approved}{' '}
                approvals went through.
              </p>
              <p className="verdict-sub">
                Each one was still checked by Kinde (user ∩ agent). Allowed
                because the user is genuinely permitted, not because no one
                looked.
              </p>
            </div>
          )}

          <div className="scoreboard" role="group" aria-label="Run metrics">
            <div className="stat">
              <span className="stat-n">{totalClauses}</span>
              <span className="stat-k">clauses</span>
            </div>
            <div className="stat">
              <span className="stat-n">{attempted}</span>
              <span className="stat-k">approvals tried</span>
            </div>
            <div
              className={`stat${approved > 0 && mode === 'broken' ? ' warn' : ''}`}
            >
              <span className="stat-n">{approved}</span>
              <span className="stat-k">approved</span>
            </div>
            <div className={`stat${blocked > 0 ? ' good' : ''}`}>
              <span className="stat-n">{blocked}</span>
              <span className="stat-k">blocked</span>
            </div>
            <div className={`stat${escalations > 0 ? ' bad' : ''}`}>
              <span className="stat-n">{escalations}</span>
              <span className="stat-k">priv. escalations</span>
            </div>
          </div>
        </>
      )}

      {!run ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden="true">
            ▶
          </span>
          Press Run review. The agent works through the contract, one clause at
          a time. Watch the critical clause.
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
            const clauseLabel = e.detail?.clauseId
              ? labelByClause[e.detail.clauseId]
              : undefined;
            const showRisk =
              (e.type === 'clause_assessed' ||
                e.type === 'signoff_attempted' ||
                e.type === 'signoff_allowed' ||
                e.type === 'signoff_denied') &&
              risk;

            // The first HIGH/CRITICAL sign-off that goes through in broken mode.
            // If the acting human can't approve, it's the confused deputy; if
            // they hold approve (Admin), it's still broken mode's point.
            const isDangerBrokenApproval =
              e.type === 'signoff_allowed' &&
              mode === 'broken' &&
              (risk === 'high' || risk === 'critical') &&
              !badShown;
            if (isDangerBrokenApproval) badShown = true;
            const isConfusedDeputy = isDangerBrokenApproval && !actorCanApprove;
            const isBrokenAdmin = isDangerBrokenApproval && actorCanApprove;

            const isBlocked = e.type === 'signoff_denied' && !goodShown;
            if (isBlocked) goodShown = true;

            const riskWord = risk === 'critical' ? 'critical' : 'high';

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
                      The agent just approved a {riskWord}-risk clause
                      {clauseLabel ? ` (${clauseLabel})` : ''}. It used its own
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
                      The agent approved a {riskWord}-risk clause
                      {clauseLabel ? ` (${clauseLabel})` : ''} on its own
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

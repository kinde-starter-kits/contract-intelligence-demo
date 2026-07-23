/**
 * Server-side deterministic review driver.
 *
 * This is the self-contained "Run review" path: it drives the SAME Convex crew
 * endpoints the Python crew does (start → clauses → assess → flag → attempt
 * sign-off → complete), emitting the same live run events, so a run streams
 * end-to-end from the UI with no external service and no LLM key. It
 * authenticates as the crew M2M and carries the acting human's subject on every
 * call, so enforcement runs genuinely in BOTH modes: in `broken` every action
 * goes through (including approving a HIGH-risk clause the acting human could
 * never approve — the confused deputy); in `intersection` a low-permission
 * human's flag/approve is denied (and a `signoff_denied` event is streamed).
 *
 * The sign-off agent attempts to approve EVERY clause (a plausible
 * "auto-approve this contract" agent). That is deliberate: it's what makes the
 * confused-deputy moment visible — in broken mode the dangerous indemnification
 * clause gets rubber-stamped on the agent's authority.
 *
 * The BYOK LLM crew is a separate, opt-in path (the Python FastAPI service).
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Rule-based risk classifier. Ordered rules, first keyword hit wins, checked
 * from the scariest tier down. Each rule carries a short human `label` so the
 * timeline can say exactly WHAT is dangerous ("CRITICAL — uncapped liability"),
 * not just a level. Mirrors agents/contract_crew/runner.py::assess_risk so the
 * deterministic TS driver and the LLM crew agree on risk.
 *
 * This is risk SCORING only — it never affects authorization. Whether a sign-off
 * is allowed is decided by authorize() (user ∩ agent), independent of risk.
 */
interface RiskRule {
  level: Exclude<RiskLevel, 'low'>;
  label: string;
  keywords: string[];
}

const RULES: RiskRule[] = [
  // CRITICAL — the terms a procurement team must never let through unchecked.
  {
    level: 'critical',
    label: 'uncapped liability',
    keywords: ['uncapped', 'unlimited liability']
  },
  {
    level: 'critical',
    label: 'class-action waiver',
    keywords: ['class action', 'class-action']
  },
  // HIGH — severe, standard-but-dangerous terms.
  {
    level: 'high',
    label: 'auto-renewal (evergreen)',
    keywords: ['automatically renew', 'auto-renew', 'evergreen']
  },
  {level: 'high', label: 'broad indemnification', keywords: ['indemnif']},
  {
    level: 'high',
    label: 'GDPR / data-processing obligations',
    keywords: ['personal data', 'gdpr', 'data protection']
  },
  {
    level: 'high',
    label: 'HIPAA / PHI handling',
    keywords: ['protected health information', 'hipaa']
  },
  {
    level: 'high',
    label: 'IP assignment / work-for-hire',
    keywords: ['work made for hire', 'irrevocably assign']
  },
  {
    level: 'high',
    label: 'non-compete / non-solicit',
    keywords: ['non-compete', 'non-competition', 'non-solicit']
  },
  {level: 'high', label: 'mandatory arbitration', keywords: ['arbitration']},
  // MEDIUM — worth a look.
  {
    level: 'medium',
    label: 'late-payment penalties',
    keywords: ['late payment', 'past due']
  },
  {level: 'medium', label: 'warranty disclaimer', keywords: ['warrant']},
  {level: 'medium', label: 'termination terms', keywords: ['terminat']},
  {level: 'medium', label: 'confidentiality terms', keywords: ['confidential']}
];

export function assessRisk(text: string): {
  level: RiskLevel;
  rationale: string;
  label: string;
} {
  const lowered = text.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lowered.includes(kw))) {
      return {
        level: rule.level,
        label: rule.label,
        rationale: `${rule.level === 'critical' ? 'Critical' : rule.level === 'high' ? 'High' : 'Medium'} risk: ${rule.label}.`
      };
    }
  }
  return {
    level: 'low',
    label: 'standard terms',
    rationale: 'Standard, low-risk boilerplate.'
  };
}

/** Transport-agnostic POST: returns the parsed status + body for a crew path. */
export type CrewPost = (
  path: string,
  payload: unknown
) => Promise<{status: number; body: Record<string, unknown>}>;

export class RunError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: unknown
  ) {
    super(code);
    this.name = 'RunError';
  }
}

export interface DeterministicRunResult {
  reviewRunId: string;
  mode: string;
  totalClauses: number;
  flagged: number;
  approved: number;
  denied: number;
}

interface AgentClause {
  clauseId: string;
  index: number;
  text: string;
}

/**
 * Drive a full deterministic review over `post`. Events are emitted as it goes
 * (best-effort — a missed event never aborts the run) so the UI renders them
 * live via Convex reactivity.
 */
export async function runDeterministicReview(
  post: CrewPost,
  contractId: string,
  opts: {authzMode?: 'broken' | 'intersection'} = {}
): Promise<DeterministicRunResult> {
  const emit = async (
    reviewRunId: string,
    type: string,
    message: string,
    detail?: Record<string, unknown>
  ) => {
    try {
      await post('/agent/event', {
        reviewRunId,
        type,
        message,
        detail: detail ?? {}
      });
    } catch {
      /* events are best-effort */
    }
  };

  // The demo operator's chosen mode is sent along; the server honors it only
  // when DEMO_MODE_SELECTABLE is on (otherwise the deployment's AUTHZ_MODE wins).
  const start = await post('/agent/review/start', {
    contractId,
    ...(opts.authzMode ? {mode: opts.authzMode} : {})
  });
  if (start.status !== 200 || !start.body?.reviewRunId) {
    throw new RunError(
      start.status || 502,
      String(start.body?.error ?? 'review_start_failed'),
      start.body?.detail
    );
  }
  const reviewRunId = String(start.body.reviewRunId);
  const mode = String(start.body.mode ?? 'broken');

  await emit(reviewRunId, 'extractor_started', 'Clause Extractor started.');

  const clausesResp = await post('/agent/clauses', {contractId});
  if (clausesResp.status !== 200) {
    throw new RunError(
      clausesResp.status,
      String(clausesResp.body?.error ?? 'clauses_failed')
    );
  }
  const clauses = (clausesResp.body.clauses as AgentClause[]) ?? [];

  let flagged = 0;
  let approved = 0;
  let denied = 0;

  for (const clause of clauses) {
    await emit(
      reviewRunId,
      'clause_extracted',
      `Clause ${clause.index} extracted.`,
      {clauseId: clause.clauseId, clauseIndex: clause.index}
    );

    const {level, rationale, label} = assessRisk(clause.text);
    // Surface WHAT is dangerous, not just the level: "CRITICAL — uncapped
    // liability." reads far louder than "critical risk."
    const assessedMsg =
      level === 'critical' || level === 'high'
        ? `Clause ${clause.index} assessed: ${level.toUpperCase()} — ${label}.`
        : level === 'medium'
          ? `Clause ${clause.index} assessed: medium risk — ${label}.`
          : `Clause ${clause.index} assessed: low risk.`;
    await emit(reviewRunId, 'clause_assessed', assessedMsg, {
      clauseId: clause.clauseId,
      clauseIndex: clause.index,
      riskLevel: level,
      label
    });

    const flag = await post('/agent/flag', {
      reviewRunId,
      clauseId: clause.clauseId,
      riskLevel: level,
      rationale
    });
    if (flag.status === 200) flagged++;

    // The sign-off agent attempts to approve EVERY clause — including the
    // high-risk ones. In broken mode that rubber-stamps the dangerous clause on
    // the agent's authority (the confused deputy); in intersection mode Kinde
    // denies it when the acting human lacks approve.
    await emit(
      reviewRunId,
      'signoff_attempted',
      `Sign-off attempted for clause ${clause.index}.`,
      {clauseId: clause.clauseId, clauseIndex: clause.index, riskLevel: level}
    );
    const appr = await post('/agent/approve', {
      reviewRunId,
      clauseId: clause.clauseId
    });
    if (appr.status === 200) approved++;
    else if (appr.status === 403) denied++;
  }

  await post('/agent/review/complete', {reviewRunId});
  return {
    reviewRunId,
    mode,
    totalClauses: clauses.length,
    flagged,
    approved,
    denied
  };
}

/**
 * Mint a crew M2M access token (client_credentials). Shared by the approve
 * action and the run route.
 */
export async function mintCrewToken(): Promise<string> {
  const issuer = process.env.KINDE_ISSUER_URL;
  const resp = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CREW_M2M_CLIENT_ID ?? '',
      client_secret: process.env.CREW_M2M_CLIENT_SECRET ?? '',
      audience: process.env.KINDE_AUDIENCE ?? ''
    })
  });
  if (!resp.ok) throw new Error(`crew token mint failed: ${resp.status}`);
  return (await resp.json()).access_token as string;
}

/**
 * Build a {@link CrewPost} that talks to the Convex site endpoints as the crew
 * M2M on behalf of `actingSubject`.
 */
export function siteCrewPost(
  siteUrl: string,
  token: string,
  actingSubject: string
): CrewPost {
  return async (path, payload) => {
    const resp = await fetch(`${siteUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-acting-subject': actingSubject,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const body = await resp.json().catch(() => ({}));
    return {status: resp.status, body};
  };
}

/**
 * Server-side deterministic review driver.
 *
 * This is the self-contained "Run review" path: it drives the SAME Convex crew
 * endpoints the Python crew does (start → clauses → flag → approve low-risk →
 * complete), emitting the same live run events, so a run streams end-to-end from
 * the UI with no external service and no LLM key. It authenticates as the crew
 * M2M and carries the acting human's subject on every call, so enforcement runs
 * genuinely in BOTH modes: in `broken` every action goes through; in
 * `intersection` a low-permission human's flag/approve is denied (and a
 * `signoff_denied` event is streamed).
 *
 * The BYOK LLM crew is a separate, opt-in path (the Python FastAPI service).
 */

export type RiskLevel = 'low' | 'medium' | 'high';

// Mirrors agents/contract_crew/runner.py::assess_risk so the TS driver and the
// Python crew agree on risk.
const HIGH = [
  'indemnif',
  'unlimited liability',
  'penalty',
  'liquidated damages'
];
const MEDIUM = [
  'limitation of liability',
  'liability',
  'terminat',
  'governing law',
  'confidential',
  'warrant',
  'indemn'
];

export function assessRisk(text: string): {
  level: RiskLevel;
  rationale: string;
} {
  const lowered = text.toLowerCase();
  for (const kw of HIGH) {
    if (lowered.includes(kw)) {
      return {
        level: 'high',
        rationale: `Contains high-risk language ('${kw}').`
      };
    }
  }
  for (const kw of MEDIUM) {
    if (lowered.includes(kw)) {
      return {
        level: 'medium',
        rationale: `Contains risk-relevant language ('${kw}'); review advised.`
      };
    }
  }
  return {level: 'low', rationale: 'Boilerplate / low-risk clause.'};
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
  contractId: string
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

  const start = await post('/agent/review/start', {contractId});
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

    const {level, rationale} = assessRisk(clause.text);
    await emit(
      reviewRunId,
      'clause_assessed',
      `Clause ${clause.index} assessed: ${level} risk.`,
      {clauseId: clause.clauseId, clauseIndex: clause.index, riskLevel: level}
    );

    const flag = await post('/agent/flag', {
      reviewRunId,
      clauseId: clause.clauseId,
      riskLevel: level,
      rationale
    });
    if (flag.status === 200) flagged++;

    if (level === 'low') {
      await emit(
        reviewRunId,
        'signoff_attempted',
        `Sign-off attempted for clause ${clause.index}.`,
        {clauseId: clause.clauseId, clauseIndex: clause.index}
      );
      const appr = await post('/agent/approve', {
        reviewRunId,
        clauseId: clause.clauseId
      });
      if (appr.status === 200) approved++;
      else if (appr.status === 403) denied++;
    }
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

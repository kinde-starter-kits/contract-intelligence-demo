# Agent service (CrewAI)

A Python [CrewAI](https://docs.crewai.com) service (`agents/`) that reviews a contract **on behalf of a human**. It authenticates as the **crew M2M** application, calls the app over HTTP, and uses the app's Weaviate retrieval seam for risk context. It never touches Convex or Weaviate directly.

## The three agents

1. **Clause Extractor** — pulls the contract's clauses via the API.
2. **Risk Flagger** — for each clause, retrieves similar clauses for context, assesses risk (low/medium/high), and flags it with a rationale.
3. **Sign-off Agent** — approves clauses that pass (low risk).

## Identity & the acting-subject mechanism

Every request the crew makes carries **two** things:

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <token>` | The crew's **machine identity** — a Kinde M2M access token the crew mints itself (client_credentials grant, audience `contract-intelligence-api`). The app verifies it through the agent-auth component's `verifyCaller`. |
| `X-Acting-Subject: <kinde user id>` | The **human** on whose behalf this run acts. |

**Why a header for the acting subject:** it is metadata about the request, not the crew's identity, and it must be independent of the token so the app can compare the two. This is the value the authz phases (5–6) will enforce against: the decision becomes _crew capabilities ∩ what this human delegated_. For now it is recorded on the review run and credited on each clause decision — no enforcement yet.

The acting subject is **never** trusted as an identity by itself; it only selects _whose_ delegation applies. The crew's authority still comes from its verified token.

## The endpoint / token flow

```
crew  --mint-->  Kinde /oauth2/token           (client_credentials, audience=API)
crew  --Bearer + X-Acting-Subject-->  app endpoints:
   POST {CONVEX_SITE_URL}/agent/review/start    -> { reviewRunId, instanceId }
   POST {CONVEX_SITE_URL}/agent/clauses         -> { clauses: [...] }
   POST {APP_BASE_URL}/api/agent/similar        -> { matches: [...] }   (Next.js)
   POST {CONVEX_SITE_URL}/agent/flag            -> flags a clause
   POST {CONVEX_SITE_URL}/agent/approve         -> approves a clause
   POST {CONVEX_SITE_URL}/agent/review/complete -> closes the run
```

Each endpoint verifies the crew token via the component **first**, then acts. Missing/invalid token ⇒ 401.

### Why two base URLs (a deliberate split)

- **Convex httpActions** (`CONVEX_SITE_URL`, `convex/http.ts`) handle review / clauses / flag / approve: token verification and every write happen inside Convex (via the component and `internal.*` mutations) — no admin key, no trust-boundary hop.
- **One Next.js route** (`APP_BASE_URL`, `app/api/agent/similar`) handles vector similarity, because it embeds the query with Transformers.js (the ONNX runtime), which Convex's runtime cannot host. It verifies the same crew token via the component's public `verifyAgentToken` action before searching the org's Weaviate tenant.

## Review runs & instances

`/agent/review/start` opens a real agent-auth **run instance** (`instances.start`) and records a `reviewRuns` row tying the run to the `actingSubject`, the `instanceId`, and the `mode` (`intersection` | `broken`, recorded only for now). Phases 5–6 authorize each action against exactly this `instanceId` + acting subject.

## Running it

```bash
cd agents
python3 -m venv .venv && . .venv/bin/activate
pip install -e .

# Configure (see agents/.env.example) — endpoints, crew M2M creds, LLM key:
export CONVEX_SITE_URL=https://<deployment>.convex.site
export APP_BASE_URL=http://localhost:3000
export KINDE_DOMAIN=devrelstudio.kinde.com
export CREW_M2M_CLIENT_ID=<crew client id>
export CREW_M2M_CLIENT_SECRET=<crew client secret>
export KINDE_AUDIENCE=contract-intelligence-api
export ANTHROPIC_API_KEY=<key>            # for --mode crew (LLM)

# Run the LLM crew (needs the app running for /api/agent/similar, and Weaviate):
python -m contract_crew.main --contract-id <id> --acting-subject <kinde user id>

# Or the deterministic runner (no LLM key — same endpoints/tools, rule-based risk):
python -m contract_crew.main --contract-id <id> --acting-subject <kinde user id> --mode deterministic
```

## LLM

Configurable via `CREW_LLM_MODEL` + a provider key. Defaults to Claude (`anthropic/claude-haiku-4-5-20251001`) — set `ANTHROPIC_API_KEY`. The `--mode deterministic` runner needs no LLM and drives the identical endpoints (useful for CI and for isolating the authorization flow, which is the demo's point).

## Tests

`cd agents && .venv/bin/python -m pytest -q` — wiring tests (no network, no real LLM): the deterministic runner drives the full endpoint flow, the client sends the token + acting subject, the crew is wired with three agents holding the four tools, and the risk rules are deterministic.

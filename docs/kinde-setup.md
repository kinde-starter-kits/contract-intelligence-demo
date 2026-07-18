# Kinde setup

This document is the **source of truth** for what to create in the Kinde dashboard for this demo. The app does not create any of this; Shola configures it in Kinde, and the app reads it back from verified tokens.

The demo has two kinds of caller:

- **Humans** — sign in through the Next.js app (`@kinde-oss/kinde-auth-nextjs`), scoped to an organization, and hold **permissions** granted via **roles**.
- **The crew** — an AI agent that authenticates as a **machine (M2M)** application and is registered in the agent-auth component as an agent.

---

## 1. Permissions

Create these three **permissions** in Kinde (Settings → Permissions). They are the exact keys the app checks (`lib/permissions.ts`):

| Permission key    | Meaning                    |
| ----------------- | -------------------------- |
| `contracts:read`  | Read contracts and clauses |
| `clauses:flag`    | Flag a clause as risky     |
| `clauses:approve` | Approve a clause           |

> The app enforces on the **permission**, never the role. Roles are only how a human comes to hold a permission — so you may rename/restructure roles freely as long as the permission keys above are what end up in the token.

## 2. Roles

Create three **roles** and grant permissions as follows (Settings → Roles):

| Role        | `contracts:read` | `clauses:flag` | `clauses:approve` |
| ----------- | :--------------: | :------------: | :---------------: |
| **Admin**   |        ✅        |       ✅       |        ✅         |
| **Analyst** |        ✅        |       ✅       |        ⛔         |
| **Intern**  |        ✅        |       ⛔       |        ⛔         |

Assign one role to each of the three test users you sign in with during verification.

## 3. Organization

Create (or reuse) an **organization** for the demo and note its **org code** (e.g. `org_xxxxxxxxxxxx`). Enable the permissions above for the org and add your three test users to it with the roles from §2. Login is org-scoped: the app sends the human through Kinde and the resulting session carries this `org_code`.

## 4. Human web application (Next.js)

Create a **Back-end web** application in Kinde for the app itself. From it, set these env vars in `.env.local` (see `.env.example`):

| Env var                          | Value                             |
| -------------------------------- | --------------------------------- |
| `KINDE_CLIENT_ID`                | the web app's client id           |
| `KINDE_CLIENT_SECRET`            | the web app's client secret       |
| `KINDE_ISSUER_URL`               | `https://<your-tenant>.kinde.com` |
| `KINDE_SITE_URL`                 | `http://localhost:3000`           |
| `KINDE_POST_LOGIN_REDIRECT_URL`  | `http://localhost:3000/dashboard` |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | `http://localhost:3000`           |

In the Kinde app's **Callback URLs**, allow:

- Allowed callback URL: `http://localhost:3000/api/auth/kinde_callback`
- Allowed logout redirect URL: `http://localhost:3000`

## 5. Machine (M2M) application — the crew

Create a **Machine to machine (M2M)** application in Kinde for the AI crew.

- **Client id** — this is the value registered as the agent's `kindeClientId` (see §7). The component maps an incoming token's `azp` (this client id) to the registered agent during `verifyCaller`.
- **Client secret** — used only to mint tokens during verification; never committed.
- **Audience** — authorize the M2M app for an **API** whose audience/identifier equals `KINDE_AUDIENCE`. The component requires this match in live mode: a token minted for a different audience in the same tenant is rejected (fail-closed against cross-audience replay).
- **Scopes** — grant the crew a **deliberately broad** scope set, broader than what any single human delegates. Suggested for this demo:

  ```
  contracts:read  clauses:flag  clauses:approve
  ```

  > ⚠️ **Intentional over-provisioning.** The crew's M2M scopes include `clauses:approve` even though an Analyst or Intern who invokes the crew cannot approve. That gap is the whole point of the demo: in the **broken** mode the crew acts on its own broad scopes (the confused deputy). The **intersection** fix (later phase) narrows every action to `crew scopes ∩ the human's delegated permissions`, so a clause the human can't approve can't be approved by the crew acting for them either.

## 6. API + audience

Create an **API** in Kinde (Settings → APIs) whose **audience/identifier** is the value you use for `KINDE_AUDIENCE` (e.g. `contract-intelligence-api`). Authorize both the human web app and the crew M2M app for this API so their access tokens carry the matching `aud`. Set the same value as `KINDE_AUDIENCE` on:

- the Convex deployment (`npx convex env set KINDE_AUDIENCE <audience>`), and
- `.env.local` for the app.

## 7. Register the crew as an agent

Once the M2M app exists, register its client id as an agent in the component, **once**, against the real deployment. This runs the admin-only host wrapper `internal.agents.provisionAgent` (an `internalMutation` — not publicly callable):

```bash
npx convex run agents:provisionAgent '{
  "kindeClientId": "<crew M2M client id>",
  "name": "Contract Review Crew",
  "slug": "contract-review-crew",
  "orgCode": "<your org code>",
  "scopes": ["contracts:read", "clauses:flag", "clauses:approve"],
  "allowedTools": ["retrieve_clause", "flag_clause", "approve_clause"]
}'
```

It is idempotent — a second run returns the existing agent id with `created: false` instead of registering a duplicate. See `scripts/provision-agent.sh` for a convenience wrapper.

## 8. Verify a minted M2M token

Mint a real M2M token and confirm the component accepts it and resolves the registered agent (an `internalAction`, admin-CLI only):

```bash
# Mint a token (client credentials grant):
curl -s --request POST "https://<your-tenant>.kinde.com/oauth2/token" \
  --data grant_type=client_credentials \
  --data "client_id=<crew M2M client id>" \
  --data "client_secret=<crew M2M client secret>" \
  --data "audience=<KINDE_AUDIENCE>" | jq -r .access_token

# Then verify it (paste the token):
npx convex run agentIdentity:verifyCrewToken '{
  "token": "<access token>",
  "expectedOrgCode": "<your org code>"
}'
```

A successful result reports `accepted: true` with `agentId` set to the agent registered in §7 and `scopes` equal to the crew's granted scopes.

---

## Environment variable summary

| Where | Vars |
| --- | --- |
| Convex deployment | `KINDE_DOMAIN`, `KINDE_AUDIENCE`, `DELEGATION_SIGNING_SECRET`, `MODE` (`live` for real enforcement) |
| App `.env.local` | `KINDE_CLIENT_ID`, `KINDE_CLIENT_SECRET`, `KINDE_ISSUER_URL`, `KINDE_SITE_URL`, `KINDE_POST_LOGIN_REDIRECT_URL`, `KINDE_POST_LOGOUT_REDIRECT_URL`, `NEXT_PUBLIC_CONVEX_URL` |

`KINDE_DOMAIN` is the tenant host **without** protocol (e.g. `myapp.kinde.com`); `KINDE_ISSUER_URL` is the same tenant **with** `https://`.

<!-- Ideally, this should get auto-generated via tools like [auto-changelog](https://github.com/CookPete/auto-changelog). Eventually, this will get set up as part of the repository template. -->

# Changelog

## 0.1.0 — Contract Intelligence demo

The initial demo application, built on top of the org repository template. It demonstrates the **confused deputy problem in AI agents** and its fix — **permission intersection** via the `kinde-convex-agent-auth` Convex component.

- **App:** Next.js (App Router) + Convex, with `kinde-convex-agent-auth` mounted as a component (vendored from a tarball until the `@kinde-oss` package is published). Kinde-authenticated dashboard showing contracts, clauses, review runs, a server-driven `AUTHZ_MODE` indicator, and a paginated component audit panel.
- **Agent service:** a Python **CrewAI** service (`agents/`) — Clause Extractor, Risk Flagger, Sign-off — that authenticates as a **crew M2M** and calls the app over HTTP, carrying the acting human via an `X-Acting-Subject` header.
- **Retrieval:** contract ingestion + a deterministic clause chunker; clauses embedded into **Weaviate** with **client-side vectors** and **native multi-tenancy** (one tenant per org). Local Docker and Weaviate Cloud are interchangeable via two env vars.
- **Authorization:** server-decided `AUTHZ_MODE`. `broken` authorizes on the agent's identity alone (a read-only Intern's proxy approves a high-risk clause); `intersection` enforces the acting human's permissions ∩ the agent's via the component's `authorize()` (Intern denied with `insufficient_scope` + `correlationId` + audit row, Admin allowed). Human permission ceilings are resolved from the **Kinde Management API** by subject.
- **Verification:** reset / repro scripts and a one-command end-to-end narrative (`npm run e2e`); a CI-friendly mode-flip test that needs no live credentials.
- **Docs:** README plus `docs/kinde-setup.md`, `docs/weaviate-setup.md`, `docs/agent-service.md`.

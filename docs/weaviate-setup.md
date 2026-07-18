# Weaviate setup

The demo embeds contract clauses into [Weaviate](https://weaviate.io) and retrieves nearest-neighbor clauses **scoped to one org**. This document covers how to stand up an instance, the tenancy model, and the embedding approach.

## Tenancy model — native multi-tenancy (a tenant per org)

The `Clause` collection is created with **native multi-tenancy enabled**, one **tenant per `orgCode`**. Every clause is written under its org's tenant, and every query is issued against a single tenant (`withTenant(orgCode)`).

Why multi-tenancy rather than an `orgCode` property filter:

- **Isolation is enforced by Weaviate, not by remembering a filter.** A query on tenant A physically cannot see tenant B's objects — there is no `.where()` to forget. A property-filter approach leaks the moment one query omits the filter.
- **Operational fit.** Tenants can be offloaded/activated and deleted independently — a natural match for per-org data lifecycle.

The cross-org isolation guarantee is verified live by `scripts/weaviate-isolation-check.ts` (see BUILD_LOG Phase 3).

## Embedding — client-side vectors (portable)

Vectors are computed **client-side** in the app layer with **`Xenova/all-MiniLM-L6-v2`** (384-dim) via [Transformers.js](https://huggingface.co/docs/transformers.js), mean-pooled and L2-normalized. The `Clause` collection uses a **`none` (self-provided) vectorizer** — the app sends the vector with each object and embeds the query text the same way before searching (`nearVector`).

This means there is **no server-side vectorizer module dependency**. The exact same code runs against local Docker Weaviate and Weaviate Cloud; the only difference between them is `WEAVIATE_URL` + `WEAVIATE_API_KEY`.

Because the ONNX runtime can't run inside Convex functions, embedding lives in the app/agent layer (`lib/weaviate.ts`), not in a Convex function. Convex owns the structured clause rows; the vector layer owns the embeddings.

## Option A — local Docker (used for development and the isolation check)

```bash
./scripts/weaviate-up.sh        # brings up a bare Weaviate, waits for ready
npx tsx scripts/weaviate-isolation-check.ts   # proves cross-org isolation
```

`docker/weaviate/docker-compose.yml` runs a single **bare Weaviate** node (REST `:8080`, gRPC `:50051`) with **no vectorizer module** — exactly like a Cloud cluster. Anonymous access is enabled for local use only. `.env.local` points at it:

```
WEAVIATE_URL=http://localhost:8080
WEAVIATE_API_KEY=
```

When `WEAVIATE_URL` is empty or a `localhost`/`http://` URL, the client connects to this local instance. Tear down with `docker compose -f docker/weaviate/docker-compose.yml down` (add `-v` to also drop the data volume).

The all-MiniLM model weights download once (to `.cache/transformers`, git-ignored) on first embed.

## Option B — Weaviate Cloud (for the deployed demo) — a two-value swap

Because vectors are client-side and the collection uses a `none` vectorizer, moving to Weaviate Cloud is just pointing at the cluster — **no vectorizer module to enable, no code change**:

1. Create a free [Weaviate Cloud](https://console.weaviate.cloud) sandbox cluster. Note its **REST endpoint** (e.g. `https://xxxx.weaviate.network`) and an **admin API key**.
2. Set the two values for the app (and, if a server-side/agent process embeds, wherever that process runs):

   ```
   WEAVIATE_URL=https://<cluster>.weaviate.network
   WEAVIATE_API_KEY=<admin key>
   ```

That's it — `ensureClauseCollection`, `upsertClauses`, and `retrieveSimilarClauses` behave identically against Cloud.

## The retrieval seam

`retrieveSimilarClauses(orgCode, text, limit)` in `lib/weaviate.ts` embeds the query client-side and returns the nearest clauses within one org's tenant. This is the seam the crew's Risk Flagger consumes in the next phase; no agent logic lives here yet. (It is a plain module rather than a Convex function precisely because embedding runs the ONNX runtime, which Convex functions can't.)

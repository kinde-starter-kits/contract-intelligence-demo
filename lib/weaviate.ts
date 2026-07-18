import {join} from 'node:path';
import weaviate, {ApiKey, type WeaviateClient} from 'weaviate-client';
import {
  pipeline,
  env as transformersEnv,
  type FeatureExtractionPipeline
} from '@xenova/transformers';

/**
 * Weaviate integration for clause embedding + tenant-scoped retrieval.
 *
 * TENANCY MODEL — native multi-tenancy, one tenant per `orgCode`. Each org's
 * clauses live in a physically separate shard; a query is issued against a
 * single tenant and can only ever see that tenant's objects. Stronger than an
 * `orgCode` property filter (one forgotten `.where()` from a leak) — isolation
 * is enforced by Weaviate itself. See docs/weaviate-setup.md.
 *
 * EMBEDDING — vectors are computed CLIENT-SIDE with all-MiniLM-L6-v2 (384-dim)
 * via Transformers.js, and the `Clause` collection uses a `none` (self-provided)
 * vectorizer. So there is NO server-side vectorizer module dependency: the exact
 * same code runs against local Docker Weaviate and Weaviate Cloud — the only
 * difference is WEAVIATE_URL + WEAVIATE_API_KEY.
 */

export const CLAUSE_COLLECTION = 'Clause';
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

// Cache model weights under .cache/ (git-ignored by the template rule).
transformersEnv.cacheDir = join(process.cwd(), '.cache', 'transformers');

export interface ClauseRecord {
  clauseId: string;
  contractId: string;
  orgCode: string;
  clauseIndex: number;
  text: string;
}

export interface RetrievedClause {
  clauseId: string;
  contractId: string;
  orgCode: string;
  clauseIndex: number;
  text: string;
  distance: number | null;
}

// ---- Client-side embedding (all-MiniLM-L6-v2) ----

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL);
  }
  return extractorPromise;
}

/**
 * Embed a single piece of text into a 384-dim, mean-pooled, L2-normalized
 * vector — the standard sentence-transformers representation for
 * all-MiniLM-L6-v2. Deterministic for a given input.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, {pooling: 'mean', normalize: true});
  return Array.from(output.data as Float32Array);
}

// ---- Weaviate ----

/**
 * Connect to Weaviate. Weaviate Cloud when `WEAVIATE_URL` is a remote https URL,
 * otherwise a local instance (Docker). `WEAVIATE_API_KEY` is used when present.
 */
export async function connectWeaviate(): Promise<WeaviateClient> {
  const url = (process.env.WEAVIATE_URL ?? '').trim();
  const apiKey = (process.env.WEAVIATE_API_KEY ?? '').trim();
  const isLocal =
    url === '' ||
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.startsWith('http://');

  if (!isLocal) {
    return weaviate.connectToWeaviateCloud(url, {
      authCredentials: apiKey ? new ApiKey(apiKey) : undefined
    });
  }
  return weaviate.connectToLocal({
    host: '127.0.0.1',
    port: 8080,
    grpcPort: 50051
  });
}

/**
 * Create the multi-tenant `Clause` collection if it does not exist. Uses a
 * `none` (self-provided) vectorizer — we supply the vectors ourselves, so no
 * server-side vectorizer module is required (works on local + Cloud alike).
 */
export async function ensureClauseCollection(
  client: WeaviateClient
): Promise<void> {
  if (await client.collections.exists(CLAUSE_COLLECTION)) return;
  await client.collections.create({
    name: CLAUSE_COLLECTION,
    vectorizers: weaviate.configure.vectorizer.none(),
    multiTenancy: weaviate.configure.multiTenancy({
      enabled: true,
      autoTenantCreation: true
    }),
    properties: [
      {name: 'clauseId', dataType: 'text'},
      {name: 'contractId', dataType: 'text'},
      {name: 'orgCode', dataType: 'text'},
      {name: 'clauseIndex', dataType: 'int'},
      {name: 'text', dataType: 'text'}
    ]
  });
}

/** Ensure a tenant exists for the given orgCode (idempotent). */
async function ensureTenant(
  client: WeaviateClient,
  orgCode: string
): Promise<void> {
  const collection = client.collections.get(CLAUSE_COLLECTION);
  const existing = await collection.tenants
    .getByName(orgCode)
    .catch(() => null);
  if (!existing) {
    await collection.tenants.create([{name: orgCode}]);
  }
}

/**
 * Embed a batch of clauses CLIENT-SIDE and store them (with their vectors) in
 * Weaviate under their org's tenant. All records are expected to share one
 * `orgCode`.
 */
export async function upsertClauses(
  client: WeaviateClient,
  orgCode: string,
  records: ClauseRecord[]
): Promise<number> {
  if (records.length === 0) return 0;
  await ensureClauseCollection(client);
  await ensureTenant(client, orgCode);

  // Embed sequentially for deterministic ordering.
  const objects = [];
  for (const r of records) {
    const vector = await embedText(r.text);
    objects.push({
      properties: {
        clauseId: r.clauseId,
        contractId: r.contractId,
        orgCode: r.orgCode,
        clauseIndex: r.clauseIndex,
        text: r.text
      },
      vectors: vector
    });
  }

  const tenant = client.collections.get(CLAUSE_COLLECTION).withTenant(orgCode);
  const result = await tenant.data.insertMany(objects);
  if (result.hasErrors) {
    throw new Error(`Weaviate insert failed: ${JSON.stringify(result.errors)}`);
  }
  return Object.keys(result.uuids).length;
}

/**
 * Nearest-neighbor clause retrieval scoped to one org's tenant. The query text
 * is embedded CLIENT-SIDE the same way as the stored clauses, then searched via
 * `nearVector`. Physically cannot return another org's clauses. This is the
 * seam the crew's Risk Flagger consumes in a later phase.
 */
export async function retrieveSimilarClauses(
  client: WeaviateClient,
  orgCode: string,
  text: string,
  limit = 3
): Promise<RetrievedClause[]> {
  const queryVector = await embedText(text);
  const tenant = client.collections.get(CLAUSE_COLLECTION).withTenant(orgCode);
  const res = await tenant.query.nearVector(queryVector, {
    limit,
    returnMetadata: ['distance']
  });
  return res.objects.map((o) => ({
    clauseId: String(o.properties.clauseId ?? ''),
    contractId: String(o.properties.contractId ?? ''),
    orgCode: String(o.properties.orgCode ?? ''),
    clauseIndex: Number(o.properties.clauseIndex ?? 0),
    text: String(o.properties.text ?? ''),
    distance: o.metadata?.distance ?? null
  }));
}

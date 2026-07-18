/**
 * Cross-org tenant-isolation check against a REAL Weaviate instance.
 *
 * Ingests two fixture contracts into two separate org tenants, then proves a
 * retrieval for org A never returns org B's clauses — even when the query text
 * is copied verbatim from an org B clause. This is the Phase 3 key evidence.
 *
 * Run against local Docker Weaviate (scripts/weaviate-up.sh) or a cloud instance
 * (set WEAVIATE_URL / WEAVIATE_API_KEY):
 *
 *   npx tsx scripts/weaviate-isolation-check.ts
 */
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chunkContract} from '../convex/chunker';
import {
  connectWeaviate,
  ensureClauseCollection,
  upsertClauses,
  retrieveSimilarClauses,
  CLAUSE_COLLECTION,
  type ClauseRecord
} from '../lib/weaviate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '..', 'fixtures');

const ORG_A = 'org_acme';
const ORG_B = 'org_globex';

function recordsFor(
  orgCode: string,
  contractId: string,
  file: string
): ClauseRecord[] {
  const text = readFileSync(join(fixtures, file), 'utf-8');
  return chunkContract(text).map((c) => ({
    clauseId: `${contractId}_${c.index}`,
    contractId,
    orgCode,
    clauseIndex: c.index,
    text: c.text
  }));
}

async function main() {
  const client = await connectWeaviate();
  try {
    // Clean slate so the check is repeatable.
    if (await client.collections.exists(CLAUSE_COLLECTION)) {
      await client.collections.delete(CLAUSE_COLLECTION);
    }
    await ensureClauseCollection(client);

    const acme = recordsFor(ORG_A, 'contract_acme_msa', 'acme-msa.txt');
    const globex = recordsFor(ORG_B, 'contract_globex_nda', 'globex-nda.txt');

    const nA = await upsertClauses(client, ORG_A, acme);
    const nB = await upsertClauses(client, ORG_B, globex);
    console.log(`Embedded ${nA} clauses for ${ORG_A}, ${nB} for ${ORG_B}.`);

    // Give the vectorizer a moment to index.
    await new Promise((r) => setTimeout(r, 1500));

    // Query text taken VERBATIM from an org B (Globex) clause.
    const bClause = globex.find((c) => c.text.includes('injunctive relief'));
    if (!bClause)
      throw new Error('Expected an org B clause about injunctive relief.');
    const query = bClause.text;

    // 1. Retrieve from org A's tenant using org B's clause text.
    const fromA = await retrieveSimilarClauses(client, ORG_A, query, 5);
    console.log(`\nRetrieval for ${ORG_A} using an ${ORG_B} clause as query:`);
    for (const c of fromA) {
      console.log(
        `  [${c.orgCode}] ${c.contractId}#${c.clauseIndex} d=${c.distance?.toFixed(4)} :: ${c.text.slice(0, 60)}...`
      );
    }

    // 2. Sanity: the same query against org B's own tenant DOES find the clause.
    const fromB = await retrieveSimilarClauses(client, ORG_B, query, 1);

    // ---- Assertions ----
    const leaked = fromA.filter((c) => c.orgCode !== ORG_A);
    const foundBClauseInA = fromA.some((c) => c.clauseId === bClause.clauseId);
    const bFindsItself = fromB.some((c) => c.clauseId === bClause.clauseId);

    console.log('\n--- Results ---');
    console.log(`org A results all belong to org A : ${leaked.length === 0}`);
    console.log(`org B's clause NOT present in A    : ${!foundBClauseInA}`);
    console.log(`org B finds its own clause         : ${bFindsItself}`);

    if (leaked.length > 0) {
      throw new Error(
        `TENANT LEAK: org A retrieval returned ${leaked.length} row(s) from another org: ${JSON.stringify(leaked.map((c) => c.orgCode))}`
      );
    }
    if (foundBClauseInA) {
      throw new Error('TENANT LEAK: org B clause was returned to org A.');
    }
    if (!bFindsItself) {
      throw new Error(
        'Retrieval sanity failed: org B could not find its own clause.'
      );
    }

    console.log(
      '\n✅ PASS — cross-org retrieval isolation holds against live Weaviate.'
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('\n❌ FAIL —', err instanceof Error ? err.message : err);
  process.exit(1);
});

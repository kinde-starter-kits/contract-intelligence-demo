import {describe, test, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {internal, api} from './_generated/api';
import {initConvexTest} from './setup.test';

const acmeText = readFileSync(
  join(__dirname, '..', 'fixtures', 'acme-msa.txt'),
  'utf-8'
);

describe('ingestion: fixture contract → contract row + ordered clauses', () => {
  test('ingestContractText writes a contract and its clauses in order', async () => {
    const t = initConvexTest();

    const {contractId, clauseCount} = await t.mutation(
      internal.ingest.ingestContractText,
      {
        orgCode: 'org_acme',
        uploadedBy: 'kp_user_admin',
        title: 'Acme MSA',
        text: acmeText
      }
    );

    expect(clauseCount).toBe(14); // preamble + 13 numbered clauses

    // Contract row exists with session-derived fields.
    const contract = await t.run(async (ctx) => ctx.db.get(contractId));
    expect(contract?.orgCode).toBe('org_acme');
    expect(contract?.uploadedBy).toBe('kp_user_admin');
    expect(contract?.status).toBe('uploaded');

    // Clauses are stored in document order, unassessed + pending.
    const clauses = await t.query(api.contracts.listClausesByContract, {
      contractId
    });
    expect(clauses.map((c) => c.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
    ]);
    expect(clauses[1].text.startsWith('1. Term and Automatic Renewal.')).toBe(
      true
    );
    expect(clauses.every((c) => c.riskLevel === 'unassessed')).toBe(true);
    expect(clauses.every((c) => c.status === 'pending')).toBe(true);
    expect(clauses.every((c) => c.orgCode === 'org_acme')).toBe(true);
  });

  test('ingestUploadedContract reads stored text and writes ordered clauses', async () => {
    const t = initConvexTest();

    // Simulate the upload: store the fixture as a blob, create the contract row.
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([acmeText], {type: 'text/plain'}))
    );
    const contractId = await t.run(async (ctx) =>
      ctx.db.insert('contracts', {
        title: 'Acme MSA',
        orgCode: 'org_acme',
        storageId,
        uploadedBy: 'kp_user_admin',
        status: 'uploaded',
        createdAt: Date.now()
      })
    );

    const result = await t.action(
      internal.ingestActions.ingestUploadedContract,
      {
        contractId
      }
    );
    // Convex writes the structured clause rows; embedding is a client-side step
    // in the app layer (Transformers.js), not a Convex function.
    expect(result.clauseCount).toBe(14);

    const clauses = await t.query(api.contracts.listClausesByContract, {
      contractId
    });
    expect(clauses.map((c) => c.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
    ]);
  });
});

describe('upload: contract bound to the verified session', () => {
  test('createContractFromUpload derives orgCode + uploadedBy from the session', async () => {
    const t = initConvexTest();
    const asUser = t.withIdentity({
      subject: 'kp_user_admin',
      org_code: 'org_acme'
    });

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['dummy'], {type: 'text/plain'}))
    );
    const contractId = await asUser.mutation(
      api.upload.createContractFromUpload,
      {storageId, title: 'Session Bound MSA'}
    );

    const contract = await t.run(async (ctx) => ctx.db.get(contractId));
    expect(contract?.orgCode).toBe('org_acme'); // from session, not input
    expect(contract?.uploadedBy).toBe('kp_user_admin'); // from session subject
  });

  test('createContractFromUpload rejects an unauthenticated caller', async () => {
    const t = initConvexTest();
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['dummy'], {type: 'text/plain'}))
    );
    await expect(
      t.mutation(api.upload.createContractFromUpload, {
        storageId,
        title: 'No Session'
      })
    ).rejects.toThrow(/Not authenticated/);
  });
});

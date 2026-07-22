import {mintCrewToken, siteCrewPost} from '@/lib/agent-run';
import {withWeaviate, upsertClauses, type ClauseRecord} from '@/lib/weaviate';
import {errorText} from '@/lib/error-text';

export interface IngestResult {
  ok: boolean;
  status: number;
  contractId?: string;
  clauseCount?: number;
  embedded?: number;
  embedError?: string | null;
  error?: string;
  message?: string;
}

/**
 * Ingest a plain-text contract for an org and embed its clauses — the shared
 * server-side path behind both "upload your own" and "load the sample". Drives
 * the crew-authenticated `/agent/ingest` endpoint (contract + ordered clause
 * rows for the caller's org, uploader credited to `subject`), then embeds the
 * clauses into the org's Weaviate tenant.
 *
 * Embedding is best-effort: a run doesn't require vectors, so a Weaviate hiccup
 * is reported but never fails the ingest — the clauses are already reviewable.
 */
export async function ingestAndEmbed(args: {
  subject: string;
  orgCode: string;
  title: string;
  text: string;
}): Promise<IngestResult> {
  const {subject, orgCode, title, text} = args;

  if (text.trim().length < 20) {
    return {
      ok: false,
      status: 400,
      error: 'text_too_short',
      message: 'That file has too little text to review.'
    };
  }
  if (text.length > 200_000) {
    return {
      ok: false,
      status: 400,
      error: 'text_too_large',
      message: 'That file is too large (200KB max).'
    };
  }

  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) {
    return {ok: false, status: 500, error: 'convex_site_unconfigured'};
  }

  let token: string;
  try {
    token = await mintCrewToken();
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: 'mint_failed',
      message: errorText(e, 'Could not authorize the upload.')
    };
  }

  const post = siteCrewPost(site, token, subject);
  const ingest = await post('/agent/ingest', {title, text});
  if (ingest.status !== 200) {
    const code = errorText(ingest.body?.error, 'ingest_failed');
    return {ok: false, status: ingest.status, error: code, message: code};
  }

  const contractId = String(ingest.body.contractId);
  const clauseCount = Number(ingest.body.clauseCount ?? 0);
  const clauses = (ingest.body.clauses as ClauseRecord[]) ?? [];

  let embedded = 0;
  let embedError: string | null = null;
  try {
    embedded = await withWeaviate((c) => upsertClauses(c, orgCode, clauses));
  } catch (e) {
    embedError = errorText(e, 'embedding_failed');
  }

  return {ok: true, status: 200, contractId, clauseCount, embedded, embedError};
}

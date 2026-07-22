'use client';

import {useState} from 'react';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import {errorText} from '@/lib/error-text';

type AuthzMode = 'broken' | 'intersection';
type Engine = 'deterministic' | 'crew';

/**
 * Steps 3 + 4 — choose the enforcement mode (watch the problem vs the fix) and
 * run the review. Mode is normally server-decided; this demo lets the operator
 * pick it per run (when DEMO_MODE_SELECTABLE is on) so both can be seen without a
 * redeploy. The live steps appear in the timeline as the run streams.
 */
export function RunConsole({contractId}: {contractId: string}) {
  const authz = useQuery(api.dashboard.getAuthzMode);
  const [authzMode, setAuthzMode] = useState<AuthzMode>('broken');
  const [engine, setEngine] = useState<Engine>('deterministic');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState<string | null>(null);

  const selectable = authz?.selectable ?? false;
  const serverMode = authz?.mode;
  const effectiveMode: AuthzMode = selectable
    ? authzMode
    : (serverMode ?? 'broken');

  async function run() {
    setStatus('running');
    setMessage(null);
    try {
      const resp = await fetch('/api/run', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          contractId,
          mode: engine,
          authzMode: selectable ? authzMode : undefined,
          apiKey: engine === 'crew' ? apiKey : undefined
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        setStatus('done');
        setMessage('Run complete — the timeline shows every step.');
      } else {
        setStatus('error');
        setMessage(errorText(data?.message ?? data?.error, 'Run failed.'));
      }
    } catch {
      setStatus('error');
      setMessage('Could not reach the run endpoint.');
    }
  }

  return (
    <div className="card console">
      {/* Step 3 — enforcement mode */}
      <div className="block">
        <div className="block-label">
          <span className="n">03</span>
          <h3>Enforcement mode</h3>
        </div>
        <div className="seg cols-2">
          <button
            className="seg-btn danger"
            aria-pressed={effectiveMode === 'broken'}
            disabled={!selectable}
            onClick={() => setAuthzMode('broken')}
          >
            <span className="t">
              Broken <span className="risk-high">▲</span>
            </span>
            <span className="d">
              Agent acts on its own authority — watch the problem
            </span>
          </button>
          <button
            className="seg-btn safe"
            aria-pressed={effectiveMode === 'intersection'}
            disabled={!selectable}
            onClick={() => setAuthzMode('intersection')}
          >
            <span className="t">
              Intersection <span className="risk-low">◆</span>
            </span>
            <span className="d">
              The human&apos;s limits are enforced — watch the fix
            </span>
          </button>
        </div>
        {!selectable && serverMode && (
          <p
            className="muted"
            style={{fontSize: '0.78rem', margin: '0.55rem 0 0'}}
          >
            Mode is set server-side to <strong>{serverMode}</strong> on this
            deployment. Set{' '}
            <code className="mono">DEMO_MODE_SELECTABLE=true</code> to switch it
            here per run.
          </p>
        )}
      </div>

      {/* Step 4 — run */}
      <div className="block">
        <div className="block-label">
          <span className="n">04</span>
          <h3>Run the review</h3>
        </div>
        <div className="seg cols-2" style={{marginBottom: '0.6rem'}}>
          <button
            className="seg-btn"
            aria-pressed={engine === 'deterministic'}
            onClick={() => setEngine('deterministic')}
          >
            <span className="t">Deterministic</span>
            <span className="d">No key — runs instantly</span>
          </button>
          <button
            className="seg-btn"
            aria-pressed={engine === 'crew'}
            onClick={() => setEngine('crew')}
          >
            <span className="t">Crew (LLM)</span>
            <span className="d">BYOK — your key, this run only</span>
          </button>
        </div>

        {engine === 'crew' && (
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-… (your Anthropic/OpenAI key, never stored)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{marginBottom: '0.6rem'}}
          />
        )}

        <button
          className="btn-primary btn-lg"
          disabled={status === 'running' || (engine === 'crew' && !apiKey)}
          onClick={run}
        >
          {status === 'running' ? (
            <>
              <span className="spinner" /> Running the review…
            </>
          ) : (
            `Run review · ${effectiveMode}`
          )}
        </button>

        {message && (
          <p className={`run-note ${status === 'error' ? 'err' : 'ok'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

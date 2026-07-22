'use client';

import {useState} from 'react';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import {errorText} from '@/lib/error-text';
import {CrewInfoModal} from './CrewInfoModal';

type AuthzMode = 'broken' | 'intersection';
type Engine = 'deterministic' | 'crew';

/**
 * Steps 3 + 4 — choose the enforcement mode (watch the problem vs the fix) and
 * run the review. Mode is normally server-decided; this demo lets the operator
 * pick it per run (when DEMO_MODE_SELECTABLE is on) so both can be seen without a
 * redeploy. The live steps appear in the timeline as the run streams.
 */
export function RunConsole({
  contractId,
  crewAvailable = false,
  onStart,
  onError
}: {
  contractId: string;
  crewAvailable?: boolean;
  onStart?: () => void;
  onError?: (message: string | null) => void;
}) {
  const authz = useQuery(api.dashboard.getAuthzMode);
  const [authzMode, setAuthzMode] = useState<AuthzMode>('broken');
  const [engine, setEngine] = useState<Engine>('deterministic');
  const [apiKey, setApiKey] = useState('');
  const [showCrewModal, setShowCrewModal] = useState(false);
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
    onStart?.();
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
        setMessage(
          'Run complete. The timeline has every step. To compare, switch the mode above and run again.'
        );
        onError?.(null);
      } else {
        const msg = errorText(data?.message ?? data?.error, 'Run failed.');
        setStatus('error');
        setMessage(msg);
        onError?.(msg);
      }
    } catch {
      const msg =
        'Could not reach the run endpoint. Check your connection. Try again.';
      setStatus('error');
      setMessage(msg);
      onError?.(msg);
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
            <span className="d">The agent acts on its own authority.</span>
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
              The user&apos;s permissions are enforced too.
            </span>
          </button>
        </div>
        {!selectable && serverMode && (
          <p
            className="muted"
            style={{fontSize: '0.78rem', margin: '0.55rem 0 0'}}
          >
            The mode is set on the deployment to <strong>{serverMode}</strong>.
            To switch it per run from here, set{' '}
            <code className="mono">DEMO_MODE_SELECTABLE=true</code>.
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
            <span className="d">No key needed. Runs instantly.</span>
          </button>
          <button
            className="seg-btn"
            aria-pressed={crewAvailable && engine === 'crew'}
            onClick={() =>
              crewAvailable ? setEngine('crew') : setShowCrewModal(true)
            }
          >
            <span className="t">
              Crew (LLM){' '}
              {!crewAvailable && <span className="tagpill">local</span>}
            </span>
            <span className="d">
              {crewAvailable
                ? 'Your own key, used for this run only.'
                : 'A real agent crew. Run it locally.'}
            </span>
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

      {showCrewModal && (
        <CrewInfoModal onClose={() => setShowCrewModal(false)} />
      )}
    </div>
  );
}

'use client';

import {useState} from 'react';
import {errorText} from '@/lib/error-text';

/**
 * Triggers a BYOK crew run. The LLM key lives ONLY in this component's state for
 * the session — it is sent with the run request and never stored anywhere (not
 * localStorage, not a cookie, not Convex). The live steps appear in the Run
 * activity panel via Convex reactivity as the crew emits them.
 */
export function RunPanel({contractId}: {contractId: string}) {
  const [apiKey, setApiKey] = useState('');
  // Default to the self-contained deterministic run so the button works with no
  // external service/key; BYOK crew (real LLM) is opt-in.
  const [mode, setMode] = useState<'crew' | 'deterministic'>('deterministic');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setStatus('running');
    setMessage(null);
    try {
      const resp = await fetch('/api/run', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          contractId,
          mode,
          apiKey: mode === 'crew' ? apiKey : undefined
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        setStatus('done');
        setMessage('Run complete — see the activity below.');
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
    <div className="card">
      <h2>Run a review</h2>
      <p className="muted" style={{marginTop: 0, fontSize: '0.82rem'}}>
        Deterministic runs live with no key. Crew (LLM) is BYOK — your key is
        used for that run only and never stored.
      </p>

      <div className="grid" style={{gap: '0.5rem'}}>
        <label style={{fontSize: '0.85rem'}}>
          <span className="muted">Mode</span>
          <select
            value={mode}
            onChange={(e) =>
              setMode(e.target.value === 'crew' ? 'crew' : 'deterministic')
            }
            style={{marginLeft: '0.5rem'}}
          >
            <option value="deterministic">Deterministic (no key)</option>
            <option value="crew">Crew (LLM · BYOK)</option>
          </select>
        </label>

        {mode === 'crew' && (
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-… (your Anthropic/OpenAI key)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        )}

        <button
          className="btn-primary"
          disabled={status === 'running' || (mode === 'crew' && !apiKey)}
          onClick={run}
        >
          {status === 'running' ? 'Running…' : 'Run review'}
        </button>

        {message && (
          <p
            className={status === 'error' ? 'risk-high' : 'risk-low'}
            style={{margin: 0, fontSize: '0.85rem'}}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

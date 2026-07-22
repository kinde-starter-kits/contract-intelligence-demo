'use client';

import {useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';
import {errorText} from '@/lib/error-text';

/**
 * Step 2 — pick a contract to review, or upload your own .txt. Existing
 * contracts (reactive, org-scoped) are listed; the sample loads the Acme MSA;
 * upload reads the file in the browser and ingests + embeds it server-side, then
 * opens the review stage for it.
 */
export function ContractPicker({orgCode}: {orgCode: string}) {
  const router = useRouter();
  const contracts = useQuery(api.contracts.listContractsByOrg, {orgCode});
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'sample' | 'upload'>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function open(contractId: string) {
    router.push(`/dashboard/contracts/${contractId}`);
  }

  async function loadSample() {
    setBusy('sample');
    setErr(null);
    try {
      const resp = await fetch('/api/sample', {method: 'POST'});
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.contractId) open(data.contractId);
      else
        setErr(
          errorText(data?.message ?? data?.error, 'Could not load the sample.')
        );
    } catch {
      setErr('Could not load the sample.');
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(file: File) {
    if (!file) return;
    setBusy('upload');
    setErr(null);
    try {
      const text = await file.text();
      const title = file.name.replace(/\.txt$/i, '');
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({title, text})
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.contractId) open(data.contractId);
      else setErr(errorText(data?.message ?? data?.error, 'Upload failed.'));
    } catch {
      setErr('Could not read that file.');
    } finally {
      setBusy(null);
    }
  }

  const list = contracts ?? [];

  return (
    <div>
      {/* One uniform grid: existing contracts, the sample, and upload — all the
          same height so nothing has dead space. */}
      <div className="pick-grid">
        {list.slice(0, 6).map((c) => (
          <button
            key={c._id}
            className="pick"
            style={{cursor: 'pointer'}}
            onClick={() => open(c._id)}
          >
            <span className="title">{c.title}</span>
            <span className="meta">
              {c.status} · {new Date(c.createdAt).toLocaleDateString()}
            </span>
          </button>
        ))}

        <button
          className="pick"
          style={{cursor: 'pointer'}}
          disabled={busy !== null}
          onClick={loadSample}
        >
          <span className="title">
            {busy === 'sample' ? 'Loading sample…' : '＋ Load the sample'}
          </span>
          <span className="meta">Acme Master Services Agreement</span>
        </button>

        <label
          className={`dropzone${drag ? ' drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            style={{display: 'none'}}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <strong>
            {busy === 'upload' ? 'Ingesting…' : 'Upload your own'}
          </strong>
          <div className="meta">Drop a .txt contract, or click to choose</div>
        </label>
      </div>

      {err && (
        <p className="run-note err" style={{marginTop: '0.7rem'}}>
          {err}
        </p>
      )}
    </div>
  );
}

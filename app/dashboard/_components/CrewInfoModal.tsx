'use client';

import {useEffect} from 'react';

const REPO = 'https://github.com/kinde-starter-kits/contract-intelligence-demo';
const README_SECTION = `${REPO}#run-the-crew-llm-mode-locally`;

/**
 * Crew (LLM) mode isn't hosted — it runs the real agent crew on a Python service
 * you run locally, with your own key. On the hosted demo the Crew button opens
 * this explainer instead of attempting a run (no scary config error), and points
 * at the exact README steps. Deterministic proves the same authorization flow
 * with no key.
 */
export function CrewInfoModal({onClose}: {onClose: () => void}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crew-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="eyebrow">Crew (LLM) mode</div>
        <h3 id="crew-modal-title">Run the real LLM crew locally</h3>
        <p>
          Crew mode runs a real CrewAI agent crew. It uses your own LLM key, on
          a Python service you run on your machine. It is not part of this
          hosted demo. Your key stays with you.
        </p>
        <p className="modal-note">
          Deterministic is the default here. It proves the same authorization
          flow, with no key. The per-role allow and deny, the 403s, and the
          audit rows are all the same. The only difference is that a real LLM
          drives the steps instead of fixed rules.
        </p>
        <div className="modal-actions">
          <a
            className="btn btn-primary"
            href={README_SECTION}
            target="_blank"
            rel="noreferrer"
          >
            Local setup steps →
          </a>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">
            View the repo
          </a>
        </div>
      </div>
    </div>
  );
}

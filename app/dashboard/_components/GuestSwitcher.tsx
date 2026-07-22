'use client';

import {useRouter} from 'next/navigation';
import {useTransition} from 'react';

const ROLES = ['intern', 'analyst', 'admin'] as const;

/**
 * "View as Intern / Analyst / Admin" — establishes a guest session for the
 * mapped, pre-provisioned Kinde test user (server-side). Real enforcement runs
 * through it; this is UX convenience over real auth, not a bypass.
 */
export function GuestSwitcher({current}: {current: string | null}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function pick(role: string | null) {
    start(async () => {
      if (role) {
        await fetch('/api/guest', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({role})
        });
      } else {
        await fetch('/api/guest', {method: 'DELETE'});
      }
      router.refresh();
    });
  }

  return (
    <div className="role-switch">
      <span className="rs-label">acting as</span>
      <div className="rs-group" role="group" aria-label="Acting role">
        {ROLES.map((r) => (
          <button
            key={r}
            className="rs-btn"
            aria-pressed={current === r}
            disabled={pending}
            onClick={() => pick(r)}
          >
            {r}
          </button>
        ))}
      </div>
      {current && (
        <button
          className="rs-exit"
          disabled={pending}
          onClick={() => pick(null)}
        >
          exit
        </button>
      )}
    </div>
  );
}

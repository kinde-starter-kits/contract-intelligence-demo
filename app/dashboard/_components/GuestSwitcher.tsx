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
    <div className="row" style={{gap: '0.4rem'}}>
      <span className="muted" style={{fontSize: '0.82rem'}}>
        View as:
      </span>
      {ROLES.map((r) => (
        <button
          key={r}
          className={current === r ? 'btn-primary' : ''}
          disabled={pending}
          onClick={() => pick(r)}
        >
          {r}
        </button>
      ))}
      {current && (
        <button disabled={pending} onClick={() => pick(null)}>
          exit guest
        </button>
      )}
    </div>
  );
}

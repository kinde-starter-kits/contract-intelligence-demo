'use client';

import {useRouter} from 'next/navigation';
import {useTransition} from 'react';
import {LoginLink} from '@kinde-oss/kinde-auth-nextjs/components';

type Role = 'intern' | 'analyst' | 'admin';

const ROLES: {role: Role; can: string}[] = [
  {role: 'intern', can: 'read only'},
  {role: 'analyst', can: 'read + flag'},
  {role: 'admin', can: 'read + flag + approve'}
];

/**
 * Step 1 — who are you acting as? Picking a role starts a REAL session for that
 * pre-provisioned Kinde test user (so enforcement is genuine), or you can sign
 * in as yourself. The capability line tells a newcomer what each role may do.
 */
export function RoleChooser({current}: {current: Role | null}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function pick(role: Role) {
    start(async () => {
      await fetch('/api/guest', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({role})
      });
      router.refresh();
    });
  }

  const active = ROLES.find((r) => r.role === current) ?? null;

  return (
    <div>
      <div className="seg cols-3">
        {ROLES.map(({role, can}) => (
          <button
            key={role}
            className="seg-btn role-card"
            aria-pressed={current === role}
            disabled={pending}
            onClick={() => pick(role)}
          >
            <span className="t" style={{textTransform: 'capitalize'}}>
              {role}
            </span>
            <span className="d">{can}</span>
            <span className="role-check" aria-hidden={current !== role}>
              ✓ selected
            </span>
          </button>
        ))}
      </div>

      {active ? (
        <p className="role-confirm">
          You&apos;re acting as{' '}
          <strong style={{textTransform: 'capitalize'}}>{active.role}</strong> —{' '}
          {active.can}. Now pick a contract below.
        </p>
      ) : (
        <p
          className="muted"
          style={{fontSize: '0.82rem', margin: '0.75rem 0 0'}}
        >
          Pick a role to start. Each role is a real Kinde user; permissions come
          from Kinde and the demo enforces what each can do. To use your own
          account, <LoginLink>sign in as yourself</LoginLink>.
        </p>
      )}
    </div>
  );
}

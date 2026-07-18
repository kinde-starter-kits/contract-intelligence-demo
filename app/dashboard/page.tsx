import {LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {resolveSessionPermissions} from '@/lib/kinde';
import {PERMISSIONS} from '@/lib/permissions';

// Dynamic: reads the signed-in human's session/cookies every request.
export const dynamic = 'force-dynamic';

const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.CONTRACTS_READ]: 'Read contracts',
  [PERMISSIONS.CLAUSES_FLAG]: 'Flag clauses',
  [PERMISSIONS.CLAUSES_APPROVE]: 'Approve clauses'
};

export default async function Dashboard() {
  const session = await resolveSessionPermissions();

  if (!session.authenticated) {
    return (
      <main className="container">
        <h1>Dashboard</h1>
        <p className="muted">You are not signed in.</p>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Dashboard</h1>
      <p>
        Signed in as <strong>{session.email ?? session.userId}</strong>
        {session.orgCode ? (
          <>
            {' '}
            in org <code>{session.orgCode}</code>
          </>
        ) : null}
        .
      </p>

      <h2>Your resolved permissions</h2>
      <p className="muted">
        Read from your verified Kinde session — not inferred from your role.
      </p>
      <ul>
        {Object.entries(session.granted).map(([key, isGranted]) => (
          <li key={key}>
            <code>{key}</code> — {PERMISSION_LABELS[key] ?? key}:{' '}
            <strong>{isGranted ? '✅ granted' : '⛔ not granted'}</strong>
          </li>
        ))}
      </ul>

      <p>
        <LogoutLink>Sign out</LogoutLink>
      </p>
    </main>
  );
}

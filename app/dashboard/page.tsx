import {LoginLink, LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {resolveSessionPermissions} from '@/lib/kinde';
import {PERMISSIONS} from '@/lib/permissions';
import {ModeBadge} from './_components/ModeBadge';
import {Contracts} from './_components/Contracts';
import {Runs} from './_components/Runs';
import {Audit} from './_components/Audit';

export const dynamic = 'force-dynamic';

const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.CONTRACTS_READ]: 'Read contracts',
  [PERMISSIONS.CLAUSES_FLAG]: 'Flag clauses',
  [PERMISSIONS.CLAUSES_APPROVE]: 'Approve clauses'
};

export default async function Dashboard() {
  const session = await resolveSessionPermissions();

  if (!session.authenticated || !session.orgCode) {
    return (
      <main className="wrap">
        <p className="muted">
          You are not signed in to an organization.{' '}
          <LoginLink>Sign in</LoginLink>
        </p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="topbar">
        <h1>Contract Intelligence</h1>
        <div className="row">
          <span className="muted">{session.email ?? session.userId}</span>
          <LogoutLink className="btn">Sign out</LogoutLink>
        </div>
      </div>

      <div style={{marginBottom: '1.25rem'}}>
        <ModeBadge />
      </div>

      <div className="grid two">
        <div className="grid">
          <Contracts orgCode={session.orgCode} />
          <Audit orgCode={session.orgCode} />
        </div>
        <div className="grid">
          <div className="card">
            <h2>Your permissions</h2>
            <p className="muted" style={{marginTop: 0, fontSize: '0.82rem'}}>
              Read from your verified Kinde session — the ceiling the crew is
              held to when acting for you (in intersection mode).
            </p>
            <ul style={{margin: 0, paddingLeft: '1.1rem'}}>
              {Object.entries(session.granted).map(([key, granted]) => (
                <li key={key} style={{fontSize: '0.87rem'}}>
                  <code>{key}</code> — {PERMISSION_LABELS[key] ?? key}:{' '}
                  <strong className={granted ? 'risk-low' : 'risk-high'}>
                    {granted ? 'granted' : 'not granted'}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
          <Runs orgCode={session.orgCode} />
        </div>
      </div>
    </main>
  );
}

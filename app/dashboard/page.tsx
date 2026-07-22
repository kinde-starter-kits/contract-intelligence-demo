import {LoginLink, LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {getActingIdentity} from '@/lib/acting-identity';
import {PERMISSIONS} from '@/lib/permissions';
import {ModeBadge} from './_components/ModeBadge';
import {GuestSwitcher} from './_components/GuestSwitcher';
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
  const identity = await getActingIdentity();

  if (identity.kind === 'none' || !identity.orgCode || !identity.subject) {
    return (
      <main className="wrap">
        <div className="topbar">
          <h1>Contract Intelligence</h1>
          <GuestSwitcher current={null} />
        </div>
        <p className="muted">
          Pick a role above to try the demo as a pre-provisioned test user, or{' '}
          <LoginLink>sign in as yourself</LoginLink>.
        </p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="topbar">
        <h1>Contract Intelligence</h1>
        <div className="row">
          <span className="muted">{identity.label}</span>
          <GuestSwitcher current={identity.role} />
          {identity.kind === 'kinde' && (
            <LogoutLink className="btn">Sign out</LogoutLink>
          )}
        </div>
      </div>

      <div style={{marginBottom: '1.25rem'}}>
        <ModeBadge />
      </div>

      <div className="grid two">
        <div className="grid">
          <Contracts orgCode={identity.orgCode} />
          <Audit orgCode={identity.orgCode} />
        </div>
        <div className="grid">
          <div className="card">
            <h2>Your permissions</h2>
            <p className="muted" style={{marginTop: 0, fontSize: '0.82rem'}}>
              Resolved live from Kinde for the acting user — the ceiling the
              crew is held to when acting for you (in intersection mode).
            </p>
            <ul style={{margin: 0, paddingLeft: '1.1rem'}}>
              {Object.entries(identity.granted).map(([key, granted]) => (
                <li key={key} style={{fontSize: '0.87rem'}}>
                  <code>{key}</code> — {PERMISSION_LABELS[key] ?? key}:{' '}
                  <strong className={granted ? 'risk-low' : 'risk-high'}>
                    {granted ? 'granted' : 'not granted'}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
          <Runs orgCode={identity.orgCode} />
        </div>
      </div>
    </main>
  );
}

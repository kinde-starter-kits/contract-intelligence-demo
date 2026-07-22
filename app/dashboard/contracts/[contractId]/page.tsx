import Link from 'next/link';
import {fetchQuery} from 'convex/nextjs';
import {LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {api} from '@/convex/_generated/api';
import type {Id} from '@/convex/_generated/dataModel';
import {getActingIdentity} from '@/lib/acting-identity';
import {PERMISSIONS} from '@/lib/permissions';
import {RoleChooser} from '../../_components/RoleChooser';
import {GuestSwitcher} from '../../_components/GuestSwitcher';
import {ReviewWorkbench} from '../../_components/ReviewWorkbench';
import {Clauses} from '../../_components/Clauses';
import {Audit} from '../../_components/Audit';
import {SiteFooter} from '../../_components/SiteFooter';

export const dynamic = 'force-dynamic';

const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.CONTRACTS_READ]: 'Read contracts',
  [PERMISSIONS.CLAUSES_FLAG]: 'Flag clauses',
  [PERMISSIONS.CLAUSES_APPROVE]: 'Approve clauses'
};

export default async function Stage({
  params
}: {
  params: Promise<{contractId: string}>;
}) {
  const {contractId} = await params;
  const identity = await getActingIdentity();

  if (identity.kind === 'none' || !identity.orgCode || !identity.subject) {
    return (
      <main className="shell">
        <div className="topbar">
          <div className="brand">
            <span className="glyph">⧉</span> Confused Deputy
          </div>
        </div>
        <section className="frame">
          <div className="eyebrow">Choose a role first</div>
          <h1>Choose a role to review this contract.</h1>
        </section>
        <div className="step" style={{maxWidth: 640}}>
          <RoleChooser current={null} />
        </div>
      </main>
    );
  }

  const meta = await fetchQuery(api.contracts.getContractMeta, {
    contractId: contractId as Id<'contracts'>
  });

  const guestRole = identity.kind === 'guest' ? identity.role : null;
  const actorNoun = guestRole ?? 'you';
  const canApprove = identity.granted[PERMISSIONS.CLAUSES_APPROVE] ?? false;
  const canFlag = identity.granted[PERMISSIONS.CLAUSES_FLAG] ?? false;
  const capability = canApprove
    ? 'read + flag + approve'
    : canFlag
      ? 'read + flag'
      : 'read only';

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="glyph">⧉</span> Confused Deputy
          <span className="sub">agent authorization demo</span>
        </div>
        <div className="topbar-right">
          <GuestSwitcher current={guestRole} />
          {identity.kind === 'kinde' && (
            <LogoutLink className="btn btn-ghost">Sign out</LogoutLink>
          )}
        </div>
      </div>

      <div className="crumbs">
        <Link href="/dashboard">← Setup</Link>
      </div>

      <div className="setup-ribbon">
        <span className="rib">
          <span className="k">acting as</span>
          <span className="v" style={{textTransform: 'capitalize'}}>
            {guestRole ?? identity.label}
          </span>
          <span className="muted mono">· {capability}</span>
        </span>
        <span className="rib">
          <span className="k">contract</span>
          <span className="v">{meta?.title ?? 'this contract'}</span>
        </span>
        <Link
          href="/dashboard"
          style={{marginLeft: 'auto', fontSize: '0.82rem'}}
        >
          change
        </Link>
      </div>

      <ReviewWorkbench
        contractId={contractId}
        actorNoun={actorNoun}
        actorCanApprove={canApprove}
        crewAvailable={!!process.env.CREW_SERVICE_URL}
      />

      <div className="evidence-wrap">
        <div className="evidence-title">The records</div>
        <p className="evidence-lead">
          None of this is staged. Below is the raw proof. It shows the clauses
          the agent acted on. It shows every decision Kinde&apos;s component
          logged. A denied sign-off in the timeline and its audit row share the
          same <code className="mono">correlationId</code>.
        </p>
        <details className="evidence">
          <summary>
            The clauses
            <span className="summ-note">raw contract + decisions</span>
          </summary>
          <div className="evidence-body">
            <Clauses contractId={contractId} canApprove={canApprove} />
          </div>
        </details>

        <details className="evidence">
          <summary>
            Audit trail
            <span className="summ-note">every authorize() decision</span>
          </summary>
          <div className="evidence-body">
            <Audit orgCode={identity.orgCode} />
          </div>
        </details>

        <details className="evidence">
          <summary>
            The acting user&apos;s permissions
            <span className="summ-note">resolved live from Kinde</span>
          </summary>
          <div className="evidence-body">
            <ul style={{margin: 0, paddingLeft: '1.1rem'}}>
              {Object.entries(identity.granted).map(([key, granted]) => (
                <li
                  key={key}
                  style={{fontSize: '0.87rem', color: 'var(--bone-dim)'}}
                >
                  {PERMISSION_LABELS[key] ?? key} (
                  <code className="mono">{key}</code>):{' '}
                  <strong className={granted ? 'risk-low' : 'risk-high'}>
                    {granted ? 'granted' : 'not granted'}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>

      <SiteFooter />
    </main>
  );
}

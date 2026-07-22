import Link from 'next/link';
import {LoginLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {getActingIdentity} from '@/lib/acting-identity';
import {PERMISSIONS} from '@/lib/permissions';
import {ModeBadge} from '../../_components/ModeBadge';
import {GuestSwitcher} from '../../_components/GuestSwitcher';
import {Clauses} from '../../_components/Clauses';
import {RunEvents} from '../../_components/RunEvents';
import {RunPanel} from '../../_components/RunPanel';

export const dynamic = 'force-dynamic';

export default async function ContractDetail({
  params
}: {
  params: Promise<{contractId: string}>;
}) {
  const {contractId} = await params;
  const identity = await getActingIdentity();

  if (identity.kind === 'none' || !identity.orgCode || !identity.subject) {
    return (
      <main className="wrap">
        <div className="topbar">
          <h1>Contract Intelligence</h1>
          <GuestSwitcher current={null} />
        </div>
        <p className="muted">
          Pick a role above, or <LoginLink>sign in as yourself</LoginLink>.
        </p>
      </main>
    );
  }

  const canApprove = identity.granted[PERMISSIONS.CLAUSES_APPROVE] ?? false;

  return (
    <main className="wrap">
      <div className="topbar">
        <h1>Contract Intelligence</h1>
        <div className="row">
          <span className="muted">{identity.label}</span>
          <GuestSwitcher current={identity.role} />
        </div>
      </div>

      <div className="crumbs">
        <Link href="/dashboard">← Dashboard</Link>
      </div>

      <div style={{marginBottom: '1.25rem'}}>
        <ModeBadge />
      </div>

      <div className="grid two">
        <Clauses contractId={contractId} canApprove={canApprove} />
        <div className="grid">
          <RunPanel contractId={contractId} />
          <RunEvents contractId={contractId} />
        </div>
      </div>
    </main>
  );
}

import Link from 'next/link';
import {LoginLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {resolveSessionPermissions} from '@/lib/kinde';
import {PERMISSIONS} from '@/lib/permissions';
import {ModeBadge} from '../../_components/ModeBadge';
import {Clauses} from '../../_components/Clauses';

export const dynamic = 'force-dynamic';

export default async function ContractDetail({
  params
}: {
  params: Promise<{contractId: string}>;
}) {
  const {contractId} = await params;
  const session = await resolveSessionPermissions();

  if (!session.authenticated || !session.orgCode) {
    return (
      <main className="wrap">
        <p className="muted">
          Not signed in. <LoginLink>Sign in</LoginLink>
        </p>
      </main>
    );
  }

  const canApprove = session.granted[PERMISSIONS.CLAUSES_APPROVE] ?? false;

  return (
    <main className="wrap">
      <div className="topbar">
        <h1>Contract Intelligence</h1>
        <span className="muted">{session.email ?? session.userId}</span>
      </div>

      <div className="crumbs">
        <Link href="/dashboard">← Dashboard</Link>
      </div>

      <div style={{marginBottom: '1.25rem'}}>
        <ModeBadge />
      </div>

      <Clauses contractId={contractId} canApprove={canApprove} />
    </main>
  );
}

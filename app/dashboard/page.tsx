import {LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {getActingIdentity} from '@/lib/acting-identity';
import {RoleChooser} from './_components/RoleChooser';
import {ContractPicker} from './_components/ContractPicker';
import {AuthorityGap} from './_components/AuthorityGap';
import {SiteFooter} from './_components/SiteFooter';

export const dynamic = 'force-dynamic';

export default async function Launcher() {
  const identity = await getActingIdentity();
  const ready =
    identity.kind !== 'none' && !!identity.orgCode && !!identity.subject;
  const guestRole =
    identity.kind === 'guest'
      ? (identity.role as 'intern' | 'analyst' | 'admin')
      : null;

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="glyph">⧉</span> Confused Deputy
          <span className="sub">agent authorization demo</span>
        </div>
        <div className="topbar-right">
          {ready && (
            <span className="whoami">acting as · {identity.label}</span>
          )}
          {identity.kind === 'kinde' && (
            <LogoutLink className="btn btn-ghost">Sign out</LogoutLink>
          )}
        </div>
      </div>

      <section className="frame">
        <div className="eyebrow">The confused deputy, live</div>
        <h1>
          Watch an AI agent get <span className="hl-bad">tricked</span> — then
          watch Kinde <span className="hl-good">stop it</span>.
        </h1>
        <p className="lede">
          AI <span className="term">agents</span> usually run with their own
          permissions. So an agent can be led into doing something the person
          who triggered it isn&apos;t allowed to do — a flaw called the{' '}
          <span className="term">confused deputy</span>. Below, you&apos;ll run
          an agent that reviews a contract, watch it rubber-stamp a risky clause
          it never should, and then watch Kinde&apos;s permission check block
          the exact same action.
        </p>
        <AuthorityGap />
      </section>

      <div className="steps">
        <section className="step">
          <div className="step-head">
            <span className="step-num">1</span>
            <h2>Who are you acting as?</h2>
            <span className="hint">the human the agent acts for</span>
          </div>
          <RoleChooser current={guestRole} />
        </section>

        <section className="step">
          <div className="step-head">
            <span className="step-num">2</span>
            <h2>Pick a contract to review</h2>
            <span className="hint">use the sample or upload a .txt</span>
          </div>
          {ready ? (
            <ContractPicker orgCode={identity.orgCode as string} />
          ) : (
            <p className="muted" style={{fontSize: '0.88rem', margin: 0}}>
              Choose a role above first — then pick or upload a contract.
            </p>
          )}
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

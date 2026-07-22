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
  const actingLabel = guestRole ?? identity.label;

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="glyph">⧉</span> Confused Deputy
          <span className="sub">agent authorization demo</span>
        </div>
        <div className="topbar-right">
          {ready && (
            <span className="whoami">
              acting as
              <strong className="whoami-role">{actingLabel}</strong>
            </span>
          )}
          {identity.kind === 'kinde' && (
            <LogoutLink className="btn btn-ghost">Sign out</LogoutLink>
          )}
          <a
            className="kinde-link"
            href="https://kinde.com"
            target="_blank"
            rel="noreferrer"
          >
            Kinde ↗
          </a>
        </div>
      </div>

      <section className="frame">
        <div className="eyebrow">The confused deputy, live</div>
        <h1>
          See an AI agent get <span className="hl-bad">tricked</span>, and see
          Kinde <span className="hl-good">stop it</span>.
        </h1>
        <p className="lede">
          An AI agent usually runs with its own permissions. So the agent can be
          tricked into doing something its user is not allowed to do. This
          problem has a name: the <span className="term">confused deputy</span>.
          In this demo you run an agent that reviews a contract. You watch it
          approve a risky clause that it should not. Then you watch Kinde block
          the same action.
        </p>
        <AuthorityGap />
      </section>

      <div className="steps">
        <section className="step">
          <div className="step-head">
            <span className="step-num">1</span>
            <h2>Who do you act as?</h2>
            <span className="hint">the user the agent acts for</span>
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
            <p className="step-locked">
              ↑ Choose a role in step 1 first. Then the sample contract and
              upload appear here.
            </p>
          )}
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

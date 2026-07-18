import {LoginLink, RegisterLink} from '@kinde-oss/kinde-auth-nextjs/components';

export default function Home() {
  return (
    <main className="container">
      <h1>Contract Intelligence</h1>
      <p>
        A demo of the <strong>confused deputy problem</strong> in AI agents —
        and how the Kinde agent-auth Convex component fixes it with permission
        intersection.
      </p>
      <p className="muted">
        Sign in with your org account to see your resolved permissions.
      </p>
      <p>
        <LoginLink>Sign in</LoginLink> · <RegisterLink>Sign up</RegisterLink> ·{' '}
        <a href="/dashboard">Dashboard</a>
      </p>
    </main>
  );
}

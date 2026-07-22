/**
 * A short, honest developer aside: what you'd wire in your own system to get the
 * behavior in the timeline. Kept brief — full docs/branding are elsewhere.
 */
export function MapsToApp() {
  return (
    <div className="aside">
      <h3>How this maps to your app</h3>
      <ul className="maplist">
        <li>
          <strong>Check at the action boundary.</strong> Call the
          component&apos;s <code>authorize()</code> right where the agent takes
          the action (approve), not just at login.
        </li>
        <li>
          <strong>Pass the acting human&apos;s ceiling.</strong> Resolve the
          triggering human&apos;s permissions and enforce{' '}
          <code>human ∩ agent</code> — the agent can never exceed the person it
          acts for.
        </li>
        <li>
          <strong>Keep the receipt.</strong> Every decision writes an audit row
          with a <code>correlationId</code>, so an allow or deny is traceable
          later.
        </li>
      </ul>
    </div>
  );
}

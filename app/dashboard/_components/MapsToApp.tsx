/**
 * A short, honest developer takeaway: the real shape of what you'd wire in your
 * own system to get the behavior in the timeline. The snippet mirrors what this
 * demo actually runs at the approve endpoint.
 */
export function MapsToApp() {
  return (
    <div className="aside">
      <h3>How this maps to your app</h3>
      <p className="aside-sub">
        Three lines of intent, at the point the agent acts:
      </p>
      <pre className="codeblock">
        <span className="c">
          {'// at the action boundary — not just at login'}
        </span>
        {'\n'}
        <span className="k">const</span>
        {' { decision } = '}
        <span className="k">await</span>
        {' agentAuth.'}
        <span className="k">authorize</span>
        {'(ctx, token, {'}
        {'\n  instanceId, action: '}
        <span className="s">{"'clauses:approve'"}</span>
        {' // human ∩ agent'}
        {'\n});'}
        {'\n'}
        <span className="k">if</span>
        {' (!decision.allowed) '}
        <span className="k">return</span>
        {' deny(decision.'}
        <span className="d">reason</span>
        {', decision.correlationId);'}
      </pre>
      <ul className="maplist">
        <li>
          <strong>Check at the action boundary.</strong> Authorize where the
          agent acts (approve), not once at login.
        </li>
        <li>
          <strong>Enforce human ∩ agent.</strong> The agent can never exceed the
          permissions of the person it acts for.
        </li>
        <li>
          <strong>Keep the receipt.</strong> Every decision writes an audit row
          with a <code>correlationId</code> you can trace later.
        </li>
      </ul>
    </div>
  );
}

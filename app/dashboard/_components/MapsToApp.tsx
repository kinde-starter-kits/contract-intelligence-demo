/**
 * A short, honest developer takeaway: the real shape of what you'd wire in your
 * own system to get the behavior in the timeline. The snippet mirrors what this
 * demo actually runs at the approve endpoint.
 */
export function MapsToApp() {
  return (
    <div className="aside">
      <h3>How this maps to your app</h3>
      <p className="aside-sub">The key call, where the agent acts:</p>
      <pre className="codeblock">
        <span className="c">{'// at the action boundary, not at login'}</span>
        {'\n'}
        <span className="k">const</span>
        {' { decision } = '}
        <span className="k">await</span>
        {' agentAuth.'}
        <span className="k">authorize</span>
        {'(ctx, token, {'}
        {'\n  instanceId, action: '}
        <span className="s">{"'clauses:approve'"}</span>
        {' // user ∩ agent'}
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
          <strong>Check at the action.</strong> Call authorize where the agent
          acts, not once at login.
        </li>
        <li>
          <strong>Enforce user ∩ agent.</strong> The agent cannot exceed its
          user&apos;s permissions.
        </li>
        <li>
          <strong>Keep the receipt.</strong> Every decision writes an audit row
          with a <code>correlationId</code>. You can trace it later.
        </li>
      </ul>
    </div>
  );
}

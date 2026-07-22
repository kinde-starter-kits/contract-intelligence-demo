/**
 * The thesis, visualized: a read-only human triggers an agent that holds far
 * more power. The gap between what the human may do and what the agent does on
 * their behalf IS the confused deputy. Static, restrained — it just frames the
 * idea before the steps.
 */
export function AuthorityGap() {
  return (
    <div className="gap-motif">
      <div className="auth-card human">
        <span className="who">The user</span>
        <span className="name">Intern</span>
        <span className="perm">
          <span className="x">✗</span> cannot approve clauses
        </span>
      </div>
      <div className="gap-arrow" aria-hidden="true">
        <span className="lbl">acts for</span>
        <span className="line" />
      </div>
      <div className="auth-card agent">
        <span className="who">The AI agent</span>
        <span className="name">Contract crew</span>
        <span className="perm">
          <span className="ok">✓</span> can approve everything
        </span>
      </div>
      <div className="gap-note">
        The agent can do what the user cannot.{' '}
        <strong>That gap is the confused deputy.</strong>
      </div>
    </div>
  );
}

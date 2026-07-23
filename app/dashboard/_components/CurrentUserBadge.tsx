import Link from 'next/link';

/**
 * The always-visible Current User badge. It states who the agent is acting for
 * and, as a checklist, exactly what that user may do: ✓ Read, ✓/✗ Flag, ✗
 * Approve. It sticks to the top of the review so that every approval the agent
 * makes in broken mode visibly contradicts a ✗ on this badge — that contradiction
 * is the whole point. Permissions come from `identity.granted` (resolved live
 * from Kinde), never hardcoded.
 */
export function CurrentUserBadge({
  roleLabel,
  canRead,
  canFlag,
  canApprove,
  contractTitle,
  changeHref
}: {
  roleLabel: string;
  canRead: boolean;
  canFlag: boolean;
  canApprove: boolean;
  contractTitle: string;
  changeHref: string;
}) {
  const perm = (label: string, granted: boolean) => (
    <span className={`cu-perm ${granted ? 'ok' : 'no'}`}>
      <b aria-hidden="true">{granted ? '✓' : '✗'}</b> {label}
    </span>
  );

  return (
    <div className="current-user">
      <div className="cu-id">
        <span className="cu-eyebrow">Current user</span>
        <span className="cu-role">{roleLabel}</span>
      </div>
      <div className="cu-perms" aria-label="This user's permissions">
        {perm('Read', canRead)}
        {perm('Flag', canFlag)}
        {perm('Approve', canApprove)}
      </div>
      <div className="cu-contract">
        <span className="cu-eyebrow">Reviewing</span>
        <span className="cu-cname" title={contractTitle}>
          {contractTitle}
        </span>
        <Link href={changeHref} className="cu-change">
          change
        </Link>
      </div>
    </div>
  );
}

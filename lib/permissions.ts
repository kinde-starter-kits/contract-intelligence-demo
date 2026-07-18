/**
 * The permission set this app enforces. These are the source-of-truth keys the
 * app checks; they are GRANTED to humans in Kinde via roles (see
 * docs/kinde-setup.md). The app never maps roles → permissions itself — it reads
 * the permissions carried by the verified token/session. Roles are only how a
 * human comes to hold a permission.
 */
export const PERMISSIONS = {
  /** Read contracts and their clauses. */
  CONTRACTS_READ: 'contracts:read',
  /** Flag a clause as risky. */
  CLAUSES_FLAG: 'clauses:flag',
  /** Approve a clause. */
  CLAUSES_APPROVE: 'clauses:approve'
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All permission keys, handy for resolving a full claim set. */
export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

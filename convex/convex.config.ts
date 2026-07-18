import {defineApp} from 'convex/server';
import {v} from 'convex/values';
import agentAuth from '@kinde-oss/kinde-convex-agent-auth/convex.config';

// The Kinde agent-auth component: agent identity, delegation, authorization,
// human-in-the-loop elevation, reactive revocation, and audit, backed by
// Kinde M2M. Host-app wrappers around its functions are added in later phases.
//
// The component declares required env (KINDE_DOMAIN, DELEGATION_SIGNING_SECRET;
// KINDE_AUDIENCE/MODE optional), so the app declares them too and threads them
// through on mount. Values are supplied at deploy time via the Convex env.
const app = defineApp({
  env: {
    KINDE_DOMAIN: v.string(),
    KINDE_AUDIENCE: v.optional(v.string()),
    DELEGATION_SIGNING_SECRET: v.string(),
    MODE: v.optional(v.union(v.literal('test'), v.literal('live')))
  }
});

app.use(agentAuth, {
  env: {
    KINDE_DOMAIN: app.env.KINDE_DOMAIN,
    KINDE_AUDIENCE: app.env.KINDE_AUDIENCE,
    DELEGATION_SIGNING_SECRET: app.env.DELEGATION_SIGNING_SECRET,
    MODE: app.env.MODE
  }
});

export default app;

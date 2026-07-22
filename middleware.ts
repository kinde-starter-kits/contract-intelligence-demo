import {withAuth} from '@kinde-oss/kinde-auth-nextjs/middleware';

/**
 * The dashboard is a "try it live" surface: reachable by a GUEST (who picked a
 * role → mapped to a real Kinde test user) OR by a signed-in human. So it's a
 * public path here — it is NOT force-redirected to login. The page resolves the
 * acting identity (guest cookie or Kinde session) and renders accordingly, and
 * the real login ("sign in as yourself") stays available. Kinde's middleware
 * still runs (session refresh) on matched paths.
 */
export default withAuth(async function middleware() {}, {
  publicPaths: [/^\/dashboard(\/.*)?$/]
});

export const config = {
  matcher: ['/dashboard/:path*']
};

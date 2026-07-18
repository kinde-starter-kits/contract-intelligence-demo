import {withAuth} from '@kinde-oss/kinde-auth-nextjs/middleware';

// Protect the app surface behind a Kinde session. The public marketing page (/)
// and Kinde's own /api/auth/* endpoints stay open; everything matched below
// requires a signed-in human, redirecting to login otherwise.
export default withAuth;

export const config = {
  matcher: ['/dashboard/:path*']
};

import {handleAuth} from '@kinde-oss/kinde-auth-nextjs/server';

// Kinde's auth endpoints: /api/auth/login, /register, /logout, and the
// /kinde_callback the tenant redirects back to. Configured by the KINDE_* env
// vars (see .env.example / docs/kinde-setup.md).
export const GET = handleAuth();

import {NextRequest, NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {GUEST_COOKIE, isGuestRole} from '@/lib/acting-identity';

/**
 * The guest "view as ROLE" switcher. Sets an httpOnly cookie naming the role;
 * the server maps it to the pre-provisioned Kinde test user for that role. The
 * client never sees a subject or any credentials — only the role name it chose.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const role = body?.role;
  if (!isGuestRole(role)) {
    return NextResponse.json({error: 'invalid_role'}, {status: 400});
  }
  const jar = await cookies();
  jar.set(GUEST_COOKIE, role, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8
  });
  return NextResponse.json({ok: true, role});
}

/** Exit guest mode (fall back to the real signed-in session, if any). */
export async function DELETE() {
  const jar = await cookies();
  jar.delete(GUEST_COOKIE);
  return NextResponse.json({ok: true});
}

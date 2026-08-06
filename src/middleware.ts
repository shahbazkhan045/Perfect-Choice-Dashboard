import { NextResponse, type NextRequest } from 'next/server';

const TOKEN_COOKIE = 'pcd_access';
const SIX_MONTHS = 60 * 60 * 24 * 180;

/**
 * Access links look like https://…/?k=<token>. The first time someone opens
 * one we move the token into an httpOnly cookie and strip it from the URL, so
 * it stops travelling in referrers, browser history and shared screenshots.
 * The link itself keeps working forever — it just re-seeds the cookie.
 */
export function middleware(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('k');
  if (!token) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.searchParams.delete('k');

  const res = NextResponse.redirect(url);
  res.cookies.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SIX_MONTHS,
  });
  return res;
}

export const config = {
  matcher: ['/'],
};

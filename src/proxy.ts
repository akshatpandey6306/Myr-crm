import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/sign-in', '/api', '/_next', '/favicon.ico'];
const PUBLIC_ASSET_PATH = /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) || PUBLIC_ASSET_PATH.test(pathname)) {
    return NextResponse.next();
  }
  const session = request.cookies.get('myr_session')?.value;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

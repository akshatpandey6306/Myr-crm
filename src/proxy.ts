import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/api", "/_next", "/favicon.ico"];
const PUBLIC_ASSET_PATH = /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/i;

function withSecurityHeaders(response: NextResponse, policy: string) {
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://secure.payu.in https://test.payu.in",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    || PUBLIC_ASSET_PATH.test(pathname);
  if (!isPublic && !request.cookies.get("myr_session")?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return withSecurityHeaders(NextResponse.redirect(url), policy);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withSecurityHeaders(response, policy);
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";

/**
 * Optimistic auth gate only (Next.js 16 Proxy, formerly "Middleware").
 * This checks the MERE PRESENCE of the session cookie — no database call,
 * per Next.js guidance (Proxy runs on every navigation, including
 * prefetches, so it must stay cheap). It exists purely so an unauthenticated
 * visitor is bounced to /login before any page renders, and a logged-in
 * visitor isn't shown the login screen again.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. A cookie can be present but expired,
 * revoked, or belong to a suspended/deleted user — only getCurrentUser()
 * (a real DB lookup) can tell. Every Server Action and Route Handler must
 * independently call requirePermission()/requireUser() regardless of
 * whether Proxy let the request through — see src/server/auth/permissions.ts.
 */

const PUBLIC_PREFIXES = ["/login", "/public"];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true; // the root page does its own redirect
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (isPublicPath(pathname)) {
    // Logged-in visitor hitting /login again -> send them onward instead.
    if (pathname === "/login" && hasSessionCookie) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Runs on everything except static assets, image optimization, and
  // /api/* (Route Handlers are self-protecting, see comment above).
  matcher: ["/((?!api|_next/static|_next/image|.*\\.).*)"],
};

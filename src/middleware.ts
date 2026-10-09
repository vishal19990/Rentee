import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * First line of defence: every request except the login page and static assets needs a
 * valid session cookie. Pages redirect to /login; API routes get 401.
 * (Pages, route handlers and server actions also re-check via requireUser().)
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // The login page itself decides (with a DB check) whether to bounce a signed-in user.
  if (pathname === "/login") return NextResponse.next();
  // Public landing page (marketing only; it reads the session cookie just to pick its button).
  if (pathname === "/") return NextResponse.next();
  // Public receipt (/r/<token>) and UPI pay (/p/<token>) links: no login, but each page only
  // renders for a valid HMAC-signed token (checked there). The path is passed on so their
  // not-found page can tell an expired link from an invalid one.
  // Shared virtual tours (/t/<token>, plus its token-checked images) work the same way.
  if (pathname.startsWith("/r/") || pathname.startsWith("/p/") || pathname.startsWith("/t/")) {
    const headers = new Headers(req.headers);
    headers.set("x-rentee-path", pathname);
    return NextResponse.next({ request: { headers } });
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    if (pathname !== "/" && req.method === "GET") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|brand/).*)"],
};

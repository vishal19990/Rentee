import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { TENANT_COOKIE, verifyTenantSession } from "@/lib/tenant-session";

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
  // Uptime pingers (keep the free Render instance awake): no auth, no data.
  if (pathname === "/api/health") return NextResponse.next();
  // MCP connector + OAuth endpoints authenticate themselves (bearer tokens / client credentials).
  if (
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/api/oauth/") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/")
  ) {
    return NextResponse.next();
  }
  // Public receipt (/r/<token>) and UPI pay (/p/<token>) links: no login, but each page only
  // renders for a valid HMAC-signed token (checked there). The path is passed on so their
  // not-found page can tell an expired link from an invalid one.
  // Shared virtual tours (/t/<token>, plus its token-checked images) work the same way.
  if (pathname.startsWith("/r/") || pathname.startsWith("/p/") || pathname.startsWith("/t/")) {
    const headers = new Headers(req.headers);
    headers.set("x-rentee-path", pathname);
    return NextResponse.next({ request: { headers } });
  }

  // Tenant portal: its own cookie and token (lib/tenant-session.ts); never the admin session.
  // Login and invite pages are public; everything else needs a tenant session. A tenant cookie
  // is never considered below, so it can't open admin pages or APIs.
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    if (pathname === "/portal/login" || pathname.startsWith("/portal/invite/")) return NextResponse.next();
    const tenant = await verifyTenantSession(req.cookies.get(TENANT_COOKIE)?.value);
    if (tenant) return NextResponse.next();
    if (pathname.startsWith("/portal/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/portal/login", req.url));
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

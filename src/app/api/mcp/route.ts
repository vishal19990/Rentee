import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";
import { bearerToken, oauthUrls, wwwAuthenticate } from "@/lib/oauth/core";
import { CORS_HEADERS, json, preflight, requestBase } from "@/lib/oauth/http";
import { verifyAccessToken } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized(base: string, tokenSent: boolean): Response {
  return json(
    { error: tokenSent ? "invalid_token" : "unauthorized", error_description: tokenSent ? "The access token is invalid or expired" : "Bearer token required" },
    401,
    { "WWW-Authenticate": wwwAuthenticate(base, tokenSent) },
  );
}

/**
 * Remote MCP server (Streamable HTTP, stateless, JSON responses) protected by OAuth 2.1 bearer
 * tokens issued by Rentee's own authorization server. Tokens are only accepted from the
 * Authorization header and only for this resource.
 */
export async function POST(req: Request) {
  const base = requestBase(req);
  const header = req.headers.get("authorization");
  const token = bearerToken(header);
  if (!token) return unauthorized(base, !!header);
  const ctx = await verifyAccessToken(token, oauthUrls(base).resource);
  if (!ctx) return unauthorized(base, true);

  const server = buildMcpServer({ ...ctx, base });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req, {
      authInfo: { token, clientId: ctx.clientId, scopes: ctx.scopes, extra: { userId: ctx.userId } },
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    headers.set("Cache-Control", "no-store");
    const body = await res.text();
    return new Response(body || null, { status: res.status, headers });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

/** No server-initiated SSE stream in stateless mode. */
export async function GET(req: Request) {
  const base = requestBase(req);
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return unauthorized(base, !!req.headers.get("authorization"));
  return json({ error: "method_not_allowed", error_description: "Use POST" }, 405, { Allow: "POST, OPTIONS" });
}

export async function DELETE() {
  return json({ error: "method_not_allowed", error_description: "Stateless server: no sessions" }, 405, { Allow: "POST, OPTIONS" });
}

export function OPTIONS() {
  return preflight();
}

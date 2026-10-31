import "server-only";
import { baseUrlFrom } from "./core";

/**
 * CORS for the endpoints browser-based MCP clients call directly (metadata, register, token,
 * revoke, mcp). No cookies are involved (credentials are not allowed), so `*` is safe.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...CORS_HEADERS, ...extra },
  });
}

export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, extra);
}

/** Public base URL for this request (APP_URL, else the request origin). */
export function requestBase(req: Request): string {
  return baseUrlFrom(process.env.APP_URL, req.headers, new URL(req.url).origin);
}

/** Reads an application/x-www-form-urlencoded body (JSON is accepted too, for lenient clients). */
export async function readForm(req: Request): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    const text = await req.text();
    if (text.length > 20_000) return null;
    if (type.includes("application/json")) {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) if (typeof v === "string") p.set(k, v);
      return p;
    }
    return new URLSearchParams(text);
  } catch {
    return null;
  }
}

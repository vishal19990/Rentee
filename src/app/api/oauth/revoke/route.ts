import { clientFromRequest } from "@/lib/oauth/client-auth";
import { CORS_HEADERS, oauthError, preflight, readForm, requestIp, tooManyRequests } from "@/lib/oauth/http";
import { hitRateLimit } from "@/lib/rate-limit";
import { LIMITS } from "@/lib/rate-limit-core";
import { revokeToken } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/** RFC 7009 token revocation: revokes the whole grant. Unknown tokens still get 200. */
export async function POST(req: Request) {
  const rl = await hitRateLimit("oauth-revoke", requestIp(req), LIMITS.oauthRevokePerIp);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);
  const form = await readForm(req);
  if (!form) return oauthError("invalid_request", "Malformed request body");
  const auth = await clientFromRequest(req, form);
  if (!auth.ok) return oauthError(auth.e.error, auth.e.error_description, auth.e.status);
  await revokeToken(auth.client, form.get("token") ?? "");
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", ...CORS_HEADERS } });
}

export function OPTIONS() {
  return preflight();
}

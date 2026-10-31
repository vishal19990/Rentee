import { clientIp } from "@/lib/login-throttle";
import { validateRegistration } from "@/lib/oauth/core";
import { json, oauthError, preflight } from "@/lib/oauth/http";
import { registerClient } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/** RFC 7591 Dynamic Client Registration (open, rate-limited per IP, capped in total). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 20_000) return oauthError("invalid_client_metadata", "Request too large");
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const parsed = validateRegistration(body);
  if (!parsed.ok) return oauthError(parsed.error, parsed.description);
  const ip = clientIp(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip"));
  const res = await registerClient(parsed.value, ip);
  if (!res.ok) return oauthError(res.e.error, res.e.error_description, res.e.status);
  return json(res.body, 201);
}

export function OPTIONS() {
  return preflight();
}

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { verifyConsentToken } from "@/lib/oauth/consent";
import {
  authorizeParamsFrom,
  baseUrlFrom,
  checkAuthorizeRequest,
  clientRedirect,
  grantedScopes,
  oauthUrls,
} from "@/lib/oauth/core";
import { createAuthorizationCode, findClient } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

/**
 * The consent decision (same-origin fetch from the consent form; no CORS). Requires the admin
 * session cookie and the CSRF token bound to this exact request; re-validates everything.
 * Answers JSON { redirect } — the client's callback with a code (approve) or access_denied.
 */
export async function POST(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return fail("Cross-site request refused.", 403);
  const h = await headers();
  const base = baseUrlFrom(process.env.APP_URL, h);
  const origin = req.headers.get("origin");
  const requestOrigin = new URL(req.url).origin;
  if (origin && origin !== base && origin !== requestOrigin) return fail("Cross-site request refused.", 403);

  const user = await getCurrentUser();
  if (!user) return fail("Your session has ended. Sign in again.", 401);

  let form: URLSearchParams;
  try {
    const text = await req.text();
    if (text.length > 20_000) return fail("Request too large.", 413);
    form = new URLSearchParams(text);
  } catch {
    return fail("Malformed request.", 400);
  }
  const params = authorizeParamsFrom((k) => form.get(k));
  if (!verifyConsentToken(form.get("csrf") ?? "", user.id, params)) {
    return fail("This page has expired. Go back to the app and connect again.", 403);
  }
  const urls = oauthUrls(base);
  const client = await findClient(params.clientId);
  const check = checkAuthorizeRequest(params, client, urls.resource);
  if (!check.ok) {
    if (check.kind === "fatal") return fail(check.message, 400);
    return Response.json(
      { redirect: clientRedirect(params.redirectUri, { error: check.error, error_description: check.description, state: params.state, iss: urls.issuer }) },
      { headers: noStore },
    );
  }

  if (form.get("decision") !== "approve") {
    return Response.json(
      { redirect: clientRedirect(params.redirectUri, { error: "access_denied", error_description: "The user denied access", state: params.state, iss: urls.issuer }) },
      { headers: noStore },
    );
  }

  const code = await createAuthorizationCode({
    clientId: client!.clientId,
    userId: user.id,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scopes: grantedScopes(params.scope, form.get("allow_write") === "on"),
    resource: urls.resource,
  });
  return Response.json({ redirect: clientRedirect(params.redirectUri, { code, state: params.state, iss: urls.issuer }) }, { headers: noStore });
}

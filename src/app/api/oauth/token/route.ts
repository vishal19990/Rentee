import { clientFromRequest } from "@/lib/oauth/client-auth";
import { json, oauthError, preflight, readForm } from "@/lib/oauth/http";
import { exchangeCode, refreshTokens } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/** OAuth 2.1 token endpoint: authorization_code (+PKCE) and refresh_token (rotating). */
export async function POST(req: Request) {
  const form = await readForm(req);
  if (!form) return oauthError("invalid_request", "Malformed request body");
  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
  }
  const auth = await clientFromRequest(req, form);
  if (!auth.ok) {
    const extra: Record<string, string> = auth.e.status === 401 ? { "WWW-Authenticate": 'Basic realm="rentee"' } : {};
    return oauthError(auth.e.error, auth.e.error_description, auth.e.status, extra);
  }
  if (!auth.client.grantTypes.includes(grantType)) return oauthError("unauthorized_client", `This client may not use ${grantType}`);

  const res =
    grantType === "authorization_code"
      ? await exchangeCode(auth.client, {
          code: form.get("code") ?? "",
          redirectUri: form.get("redirect_uri") ?? "",
          codeVerifier: form.get("code_verifier") ?? "",
          resource: form.get("resource"),
        })
      : await refreshTokens(auth.client, {
          refreshToken: form.get("refresh_token") ?? "",
          scope: form.get("scope"),
          resource: form.get("resource"),
        });
  if (!res.ok) return oauthError(res.e.error, res.e.error_description, res.e.status);
  return json(res.body);
}

export function OPTIONS() {
  return preflight();
}

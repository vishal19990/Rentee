import "server-only";
import { parseBasicAuth } from "./core";
import { authenticateClient, type ClientInfo, type OAuthError } from "./store";

/** Client authentication from HTTP Basic or the form body (client_id [+ client_secret]). */
export async function clientFromRequest(
  req: Request,
  form: URLSearchParams,
): Promise<{ ok: true; client: ClientInfo } | { ok: false; e: OAuthError }> {
  const basic = parseBasicAuth(req.headers.get("authorization"));
  const bodyId = form.get("client_id");
  if (basic) {
    if (bodyId && bodyId !== basic.clientId) {
      return { ok: false, e: { error: "invalid_request", error_description: "client_id mismatch", status: 400 } };
    }
    return authenticateClient({ clientId: basic.clientId, clientSecret: basic.clientSecret, method: "client_secret_basic" });
  }
  const secret = form.get("client_secret");
  return authenticateClient({
    clientId: bodyId ?? "",
    clientSecret: secret || null,
    method: secret ? "client_secret_post" : "none",
  });
}

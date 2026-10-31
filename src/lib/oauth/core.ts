/**
 * OAuth 2.1 authorization server for the MCP connector — pure rules (no database, no Next.js).
 *
 * - Opaque random tokens / codes / client secrets; only their SHA-256 hashes are stored.
 * - Authorization code + PKCE (S256 only), exact redirect URI matching, resource indicators.
 * - Refresh tokens rotate on every use; replaying a rotated one revokes the whole grant family.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPE_READ = "rentee:read";
export const SCOPE_WRITE = "rentee:write";
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

export const CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Dynamic client registration limits. */
export const DCR_MAX_PER_HOUR = 20;
export const DCR_WINDOW_MINUTES = 60;
export const MAX_CLIENTS = 200;

export const MCP_PATH = "/api/mcp";
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/* ---------- random values & hashing ---------- */

/** 32 random bytes, base64url (43 chars). Used for codes, tokens and client secrets. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time string comparison (different lengths compare false without leaking where). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing roughly equal
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/* ---------- PKCE ---------- */

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return PKCE_CHALLENGE.test(challenge);
}

/** S256: BASE64URL(SHA256(verifier)) === challenge. Only S256 is supported (never "plain"). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER.test(verifier) || !isValidCodeChallenge(challenge)) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return safeEqual(computed, challenge);
}

/* ---------- redirect URIs ---------- */

/**
 * A registrable redirect URI: absolute https://…, or http:// on localhost / 127.0.0.1 / [::1]
 * (local clients such as Claude Code). No fragments, no wildcards, no credentials.
 */
export function redirectUriError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "redirect_uri must be a non-empty string";
  if (raw.length > 2000) return "redirect_uri is too long";
  if (raw.includes("*")) return "Wildcard redirect URIs are not allowed";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "redirect_uri must be an absolute URL";
  }
  if (u.hash || raw.includes("#")) return "redirect_uri must not contain a fragment";
  if (u.username || u.password) return "redirect_uri must not contain credentials";
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return null;
  return "redirect_uri must use https (http is allowed only for localhost)";
}

/** Exact match against the registered list (no normalisation, no prefix matching). */
export function isRegisteredRedirect(registered: readonly string[], candidate: string): boolean {
  return registered.some((r) => safeEqual(r, candidate));
}

/* ---------- scopes ---------- */

/** Known scopes from a space-separated scope string (unknown ones are ignored). */
export function parseScopes(raw: string | null | undefined): string[] {
  const parts = (raw ?? "").split(/\s+/).filter(Boolean);
  return SUPPORTED_SCOPES.filter((s) => parts.includes(s));
}

/** Whether the consent screen should offer write access (no scope asked = everything offered). */
export function writeRequested(rawScope: string | null | undefined): boolean {
  if (!rawScope || !rawScope.trim()) return true;
  return parseScopes(rawScope).includes(SCOPE_WRITE);
}

/** Scopes granted at consent: read always, write only when offered and ticked. */
export function grantedScopes(rawScope: string | null | undefined, allowWrite: boolean): string[] {
  return allowWrite && writeRequested(rawScope) ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
}

/**
 * Scopes for a refreshed token: a requested subset of the original grant. Asking for anything
 * not in the original grant is an error (scopes can only narrow). No request = unchanged.
 */
export function narrowScopes(original: readonly string[], rawRequested: string | null | undefined): string[] | null {
  if (!rawRequested || !rawRequested.trim()) return [...original];
  const asked = rawRequested.split(/\s+/).filter(Boolean);
  if (asked.some((s) => !original.includes(s))) return null;
  const out = original.filter((s) => asked.includes(s));
  return out.length ? out : null;
}

export function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.includes(scope);
}

/* ---------- resource indicators ---------- */

const stripSlash = (s: string) => s.replace(/\/+$/, "");

/** RFC 8707: a `resource` parameter, when present, must name this MCP server. */
export function resourceMatches(requested: string | null | undefined, resource: string): boolean {
  if (requested === null || requested === undefined || requested === "") return true;
  return stripSlash(requested) === stripSlash(resource);
}

/* ---------- base URL ---------- */

/**
 * Public base URL: APP_URL when set (production on Render), else the request's origin (local
 * dev), honouring X-Forwarded-Host / -Proto. Never ends with a slash.
 */
export function baseUrlFrom(appUrl: string | undefined, h: { get(name: string): string | null }, fallbackOrigin?: string): string {
  const fromEnv = appUrl?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host");
  if (!host) return stripSlash(fallbackOrigin ?? "http://localhost:3000");
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0].trim() || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export type OAuthUrls = {
  issuer: string;
  resource: string;
  resourceMetadata: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
};

export function oauthUrls(base: string): OAuthUrls {
  return {
    issuer: base,
    resource: `${base}${MCP_PATH}`,
    resourceMetadata: `${base}${PROTECTED_RESOURCE_METADATA_PATH}`,
    authorizationEndpoint: `${base}/oauth/authorize`,
    tokenEndpoint: `${base}/api/oauth/token`,
    registrationEndpoint: `${base}/api/oauth/register`,
    revocationEndpoint: `${base}/api/oauth/revoke`,
  };
}

export function protectedResourceMetadata(base: string) {
  const u = oauthUrls(base);
  return {
    resource: u.resource,
    authorization_servers: [u.issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Rentee",
  };
}

export function authorizationServerMetadata(base: string) {
  const u = oauthUrls(base);
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorizationEndpoint,
    token_endpoint: u.tokenEndpoint,
    registration_endpoint: u.registrationEndpoint,
    revocation_endpoint: u.revocationEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...SUPPORTED_SCOPES],
  };
}

/** `WWW-Authenticate` for a 401 from the MCP endpoint. */
export function wwwAuthenticate(base: string, tokenSent: boolean): string {
  const meta = oauthUrls(base).resourceMetadata;
  return tokenSent
    ? `Bearer error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="${meta}"`
    : `Bearer resource_metadata="${meta}"`;
}

/* ---------- dynamic client registration ---------- */

export const TOKEN_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type TokenAuthMethod = (typeof TOKEN_AUTH_METHODS)[number];

export type RegistrationInput = {
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  authMethod: TokenAuthMethod;
};

export type RegistrationResult = { ok: true; value: RegistrationInput } | { ok: false; error: string; description: string };

/** Validates an RFC 7591 registration request body. */
export function validateRegistration(body: unknown): RegistrationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris is required" };
  }
  if (uris.length > 10) return { ok: false, error: "invalid_redirect_uri", description: "At most 10 redirect_uris" };
  for (const u of uris) {
    const err = redirectUriError(u);
    if (err) return { ok: false, error: "invalid_redirect_uri", description: err };
  }
  const grantTypes = b.grant_types === undefined ? ["authorization_code", "refresh_token"] : b.grant_types;
  if (
    !Array.isArray(grantTypes) ||
    grantTypes.length === 0 ||
    grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token") ||
    !grantTypes.includes("authorization_code")
  ) {
    return { ok: false, error: "invalid_client_metadata", description: "grant_types must be authorization_code (and optionally refresh_token)" };
  }
  if (b.response_types !== undefined && (!Array.isArray(b.response_types) || b.response_types.some((r) => r !== "code"))) {
    return { ok: false, error: "invalid_client_metadata", description: "Only the code response type is supported" };
  }
  const method = b.token_endpoint_auth_method === undefined ? "client_secret_basic" : b.token_endpoint_auth_method;
  if (!(TOKEN_AUTH_METHODS as readonly unknown[]).includes(method)) {
    return { ok: false, error: "invalid_client_metadata", description: "Unsupported token_endpoint_auth_method" };
  }
  const rawName = typeof b.client_name === "string" ? b.client_name.trim() : "";
  return {
    ok: true,
    value: {
      clientName: (rawName || "Unnamed app").slice(0, 100),
      redirectUris: [...new Set(uris as string[])],
      grantTypes: [...new Set(grantTypes as string[])],
      authMethod: method as TokenAuthMethod,
    },
  };
}

/** Rolling-window DCR rate limit per IP: allowed while fewer than `max` in the window. */
export function registrationAllowed(t: { count: number; firstAt: Date } | null, now: Date, max = DCR_MAX_PER_HOUR): boolean {
  if (!t) return true;
  if (now.getTime() - t.firstAt.getTime() >= DCR_WINDOW_MINUTES * 60_000) return true;
  return t.count < max;
}

/** The counter after one more registration (new window once the old one has passed). */
export function afterRegistration(t: { count: number; firstAt: Date } | null, now: Date): { count: number; firstAt: Date } {
  if (!t || now.getTime() - t.firstAt.getTime() >= DCR_WINDOW_MINUTES * 60_000) return { count: 1, firstAt: now };
  return { count: t.count + 1, firstAt: t.firstAt };
}

/* ---------- authorization request ---------- */

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
};

export function authorizeParamsFrom(get: (name: string) => string | null | undefined): AuthorizeParams {
  const s = (n: string) => {
    const v = get(n);
    return typeof v === "string" ? v : null;
  };
  return {
    clientId: s("client_id") ?? "",
    redirectUri: s("redirect_uri") ?? "",
    responseType: s("response_type") ?? "",
    codeChallenge: s("code_challenge") ?? "",
    codeChallengeMethod: s("code_challenge_method") ?? "",
    state: s("state"),
    scope: s("scope"),
    resource: s("resource"),
  };
}

/**
 * Validates an authorization request against the registered client.
 * - "fatal": the client or redirect URI can't be trusted — show an error page, never redirect.
 * - "redirect": a protocol error that may be sent back to the (validated) redirect URI.
 */
export type AuthorizeCheck =
  | { ok: true }
  | { ok: false; kind: "fatal"; message: string }
  | { ok: false; kind: "redirect"; error: string; description: string };

export function checkAuthorizeRequest(
  p: AuthorizeParams,
  client: { redirectUris: string[] } | null,
  resource: string,
): AuthorizeCheck {
  if (!p.clientId || !client) return { ok: false, kind: "fatal", message: "Unknown application (client_id). Ask the app to connect again." };
  if (!p.redirectUri || !isRegisteredRedirect(client.redirectUris, p.redirectUri)) {
    return { ok: false, kind: "fatal", message: "The redirect address doesn't match the one this application registered." };
  }
  if (p.responseType !== "code") return { ok: false, kind: "redirect", error: "unsupported_response_type", description: "response_type must be code" };
  if (!p.codeChallenge) return { ok: false, kind: "redirect", error: "invalid_request", description: "code_challenge is required (PKCE)" };
  if (p.codeChallengeMethod !== "S256") {
    return { ok: false, kind: "redirect", error: "invalid_request", description: "code_challenge_method must be S256" };
  }
  if (!isValidCodeChallenge(p.codeChallenge)) return { ok: false, kind: "redirect", error: "invalid_request", description: "Malformed code_challenge" };
  if (!resourceMatches(p.resource, resource)) return { ok: false, kind: "redirect", error: "invalid_target", description: "Unknown resource" };
  if (p.state !== null && p.state.length > 1000) return { ok: false, kind: "redirect", error: "invalid_request", description: "state is too long" };
  return { ok: true };
}

/** The redirect back to the client: ?code=…&state=… or ?error=…&state=… (iss per RFC 9207). */
export function clientRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/* ---------- code exchange & refresh rules ---------- */

export type StoredCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type GrantCheck = { ok: true } | { ok: false; error: "invalid_grant" | "invalid_target"; description: string; revokeFamily?: boolean };

/** Checks an authorization code exchange (the code was looked up by its hash). */
export function checkCodeExchange(
  code: StoredCode | null,
  req: { clientId: string; redirectUri: string; codeVerifier: string; resource: string | null },
  now: Date,
): GrantCheck {
  if (!code) return { ok: false, error: "invalid_grant", description: "Unknown authorization code" };
  if (code.usedAt) return { ok: false, error: "invalid_grant", description: "Authorization code already used", revokeFamily: true };
  if (code.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "invalid_grant", description: "Authorization code expired" };
  if (!safeEqual(code.clientId, req.clientId)) return { ok: false, error: "invalid_grant", description: "Code was issued to another client" };
  if (!safeEqual(code.redirectUri, req.redirectUri)) return { ok: false, error: "invalid_grant", description: "redirect_uri mismatch" };
  if (!verifyPkceS256(req.codeVerifier, code.codeChallenge)) return { ok: false, error: "invalid_grant", description: "PKCE verification failed" };
  if (!resourceMatches(req.resource, code.resource)) return { ok: false, error: "invalid_target", description: "resource mismatch" };
  return { ok: true };
}

export type StoredRefresh = { clientId: string; expiresAt: Date; rotatedAt: Date | null };

/** Checks a refresh token. A rotated (already used) token means replay: revoke the family. */
export function checkRefresh(token: StoredRefresh | null, clientId: string, now: Date): GrantCheck {
  if (!token) return { ok: false, error: "invalid_grant", description: "Unknown refresh token" };
  if (!safeEqual(token.clientId, clientId)) return { ok: false, error: "invalid_grant", description: "Token was issued to another client" };
  if (token.rotatedAt) return { ok: false, error: "invalid_grant", description: "Refresh token already used", revokeFamily: true };
  if (token.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "invalid_grant", description: "Refresh token expired" };
  return { ok: true };
}

/** Parses an HTTP Basic client authentication header (RFC 6749 §2.3.1: form-encoded parts). */
export function parseBasicAuth(header: string | null): { clientId: string; clientSecret: string } | null {
  if (!header || !/^basic\s+/i.test(header)) return null;
  try {
    const decoded = Buffer.from(header.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return { clientId: decodeURIComponent(decoded.slice(0, i)), clientSecret: decodeURIComponent(decoded.slice(i + 1)) };
  } catch {
    return null;
  }
}

/** Bearer token from an Authorization header (never from the query string). */
export function bearerToken(header: string | null): string | null {
  const m = /^bearer\s+([A-Za-z0-9\-._~+/]+=*)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

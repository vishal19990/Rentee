import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  afterRegistration,
  authorizationServerMetadata,
  baseUrlFrom,
  bearerToken,
  checkAuthorizeRequest,
  checkCodeExchange,
  checkRefresh,
  clientRedirect,
  grantedScopes,
  narrowScopes,
  parseBasicAuth,
  parseScopes,
  protectedResourceMetadata,
  randomToken,
  redirectUriError,
  registrationAllowed,
  resourceMatches,
  safeEqual,
  sha256Hex,
  validateRegistration,
  verifyPkceS256,
  writeRequested,
  wwwAuthenticate,
  type AuthorizeParams,
} from "./core";

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const BASE = "https://rentee.example.com";
const RESOURCE = `${BASE}/api/mcp`;
const hdr = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("PKCE S256", () => {
  it("accepts the matching verifier (RFC 7636 example)", () => {
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });
  it("rejects a wrong or malformed verifier, and plain", () => {
    expect(verifyPkceS256(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(verifyPkceS256("short", challenge)).toBe(false);
    expect(verifyPkceS256(challenge, challenge)).toBe(false); // "plain" (verifier === challenge) never passes
  });
});

describe("redirect URIs", () => {
  it("allows https and http on localhost only", () => {
    expect(redirectUriError("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriError("https://claude.com/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriError("http://localhost:33418/callback")).toBeNull();
    expect(redirectUriError("http://127.0.0.1/cb")).toBeNull();
    expect(redirectUriError("http://evil.com/cb")).toMatch(/https/);
    expect(redirectUriError("https://*.evil.com/cb")).toMatch(/Wildcard/);
    expect(redirectUriError("https://a.com/cb#frag")).toMatch(/fragment/);
    expect(redirectUriError("javascript:alert(1)")).not.toBeNull();
    expect(redirectUriError("/relative")).not.toBeNull();
  });
});

describe("dynamic client registration", () => {
  it("registers a public Claude client", () => {
    const r = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        clientName: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        authMethod: "none",
      },
    });
  });
  it("rejects bad redirect URIs, missing URIs and implicit/password grants", () => {
    expect(validateRegistration({ redirect_uris: ["http://evil.com/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(validateRegistration({ client_name: "x" })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(validateRegistration({ redirect_uris: ["https://a.com/cb"], grant_types: ["implicit"] })).toMatchObject({ ok: false });
    expect(validateRegistration({ redirect_uris: ["https://a.com/cb"], grant_types: ["password"] })).toMatchObject({ ok: false });
    expect(validateRegistration({ redirect_uris: ["https://a.com/cb"], response_types: ["token"] })).toMatchObject({ ok: false });
    expect(validateRegistration({ redirect_uris: ["https://a.com/cb"], token_endpoint_auth_method: "private_key_jwt" })).toMatchObject({ ok: false });
  });
  it("defaults to a confidential client_secret_basic client", () => {
    const r = validateRegistration({ redirect_uris: ["https://a.com/cb"] });
    expect(r.ok && r.value.authMethod).toBe("client_secret_basic");
  });
  it("rate-limits per IP in a rolling hour", () => {
    const t0 = new Date("2026-11-01T10:00:00Z");
    let t: { count: number; firstAt: Date } | null = null;
    for (let i = 0; i < 20; i++) {
      expect(registrationAllowed(t, t0)).toBe(true);
      t = afterRegistration(t, t0);
    }
    expect(registrationAllowed(t, t0)).toBe(false);
    expect(registrationAllowed(t, new Date(t0.getTime() + 61 * 60_000))).toBe(true);
  });
});

describe("scopes", () => {
  it("always grants read; write only when offered and ticked", () => {
    expect(grantedScopes(null, false)).toEqual(["rentee:read"]);
    expect(grantedScopes(null, true)).toEqual(["rentee:read", "rentee:write"]);
    expect(grantedScopes("rentee:read", true)).toEqual(["rentee:read"]);
    expect(grantedScopes("rentee:read rentee:write", true)).toEqual(["rentee:read", "rentee:write"]);
    expect(writeRequested("rentee:read")).toBe(false);
    expect(parseScopes("openid rentee:write")).toEqual(["rentee:write"]);
  });
  it("refresh can only narrow", () => {
    const both = ["rentee:read", "rentee:write"];
    expect(narrowScopes(both, null)).toEqual(both);
    expect(narrowScopes(both, "rentee:read")).toEqual(["rentee:read"]);
    expect(narrowScopes(["rentee:read"], "rentee:read rentee:write")).toBeNull();
    expect(narrowScopes(["rentee:read"], "admin")).toBeNull();
  });
});

describe("resource indicators and metadata", () => {
  it("matches the MCP resource exactly (trailing slash tolerated)", () => {
    expect(resourceMatches(null, RESOURCE)).toBe(true);
    expect(resourceMatches(RESOURCE, RESOURCE)).toBe(true);
    expect(resourceMatches(`${RESOURCE}/`, RESOURCE)).toBe(true);
    expect(resourceMatches("https://other.example.com/api/mcp", RESOURCE)).toBe(false);
  });
  it("derives every URL from APP_URL, else the request", () => {
    expect(baseUrlFrom("https://rentee.onrender.com/", hdr({ host: "internal:10000" }))).toBe("https://rentee.onrender.com");
    expect(baseUrlFrom(undefined, hdr({ host: "localhost:3100" }))).toBe("http://localhost:3100");
    expect(baseUrlFrom("", hdr({ host: "x", "x-forwarded-host": "rentee.example.com", "x-forwarded-proto": "https" }))).toBe(BASE);
    expect(protectedResourceMetadata(BASE)).toMatchObject({ resource: RESOURCE, authorization_servers: [BASE], bearer_methods_supported: ["header"] });
    const as = authorizationServerMetadata(BASE);
    expect(as.issuer).toBe(BASE);
    expect(as.token_endpoint).toBe(`${BASE}/api/oauth/token`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(wwwAuthenticate(BASE, false)).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
    expect(wwwAuthenticate(BASE, true)).toMatch(/^Bearer error="invalid_token"/);
  });
});

describe("authorization request", () => {
  const client = { redirectUris: ["https://claude.ai/api/mcp/auth_callback"] };
  const good: AuthorizeParams = {
    clientId: "c1",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    responseType: "code",
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state: "xyz",
    scope: null,
    resource: RESOURCE,
  };
  it("accepts a valid request", () => {
    expect(checkAuthorizeRequest(good, client, RESOURCE)).toEqual({ ok: true });
  });
  it("never redirects for an unknown client or unregistered redirect", () => {
    expect(checkAuthorizeRequest(good, null, RESOURCE)).toMatchObject({ ok: false, kind: "fatal" });
    expect(checkAuthorizeRequest({ ...good, redirectUri: "https://claude.ai/api/mcp/auth_callback/x" }, client, RESOURCE)).toMatchObject({
      ok: false,
      kind: "fatal",
    });
  });
  it("requires PKCE S256 and the right resource", () => {
    expect(checkAuthorizeRequest({ ...good, codeChallenge: "" }, client, RESOURCE)).toMatchObject({ ok: false, error: "invalid_request" });
    expect(checkAuthorizeRequest({ ...good, codeChallengeMethod: "plain" }, client, RESOURCE)).toMatchObject({ ok: false, error: "invalid_request" });
    expect(checkAuthorizeRequest({ ...good, responseType: "token" }, client, RESOURCE)).toMatchObject({ error: "unsupported_response_type" });
    expect(checkAuthorizeRequest({ ...good, resource: "https://evil.com/api/mcp" }, client, RESOURCE)).toMatchObject({ error: "invalid_target" });
  });
  it("builds the callback with code and state", () => {
    expect(clientRedirect("https://claude.ai/cb?x=1", { code: "abc", state: "s", iss: BASE })).toBe(
      `https://claude.ai/cb?x=1&code=abc&state=s&iss=${encodeURIComponent(BASE)}`,
    );
  });
});

describe("code exchange", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const code = {
    clientId: "c1",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeChallenge: challenge,
    resource: RESOURCE,
    expiresAt: new Date(now.getTime() + 60_000),
    usedAt: null,
  };
  const req = { clientId: "c1", redirectUri: code.redirectUri, codeVerifier: verifier, resource: RESOURCE };
  it("accepts the right verifier", () => expect(checkCodeExchange(code, req, now)).toEqual({ ok: true }));
  it("rejects a wrong verifier", () => expect(checkCodeExchange(code, { ...req, codeVerifier: verifier.slice(1) + "A" }, now)).toMatchObject({ error: "invalid_grant" }));
  it("rejects a reused code and asks to revoke its tokens", () =>
    expect(checkCodeExchange({ ...code, usedAt: now }, req, now)).toMatchObject({ error: "invalid_grant", revokeFamily: true }));
  it("rejects an expired code (older than 60 s)", () =>
    expect(checkCodeExchange(code, req, new Date(now.getTime() + 61_000))).toMatchObject({ error: "invalid_grant" }));
  it("rejects another client or redirect_uri", () => {
    expect(checkCodeExchange(code, { ...req, clientId: "c2" }, now)).toMatchObject({ error: "invalid_grant" });
    expect(checkCodeExchange(code, { ...req, redirectUri: "https://claude.ai/other" }, now)).toMatchObject({ error: "invalid_grant" });
  });
  it("checks the resource", () => expect(checkCodeExchange(code, { ...req, resource: "https://x.com/api/mcp" }, now)).toMatchObject({ error: "invalid_target" }));
});

describe("refresh rotation", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const t = { clientId: "c1", expiresAt: new Date(now.getTime() + 86_400_000), rotatedAt: null };
  it("accepts a fresh refresh token", () => expect(checkRefresh(t, "c1", now)).toEqual({ ok: true }));
  it("treats reuse of a rotated token as replay (revoke the family)", () =>
    expect(checkRefresh({ ...t, rotatedAt: now }, "c1", now)).toMatchObject({ error: "invalid_grant", revokeFamily: true }));
  it("rejects expired, unknown or another client's token", () => {
    expect(checkRefresh({ ...t, expiresAt: now }, "c1", now)).toMatchObject({ error: "invalid_grant" });
    expect(checkRefresh(null, "c1", now)).toMatchObject({ error: "invalid_grant" });
    expect(checkRefresh(t, "c2", now)).toMatchObject({ error: "invalid_grant" });
  });
});

describe("helpers", () => {
  it("hashes, compares and generates tokens", () => {
    expect(sha256Hex("abc")).toHaveLength(64);
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "ab")).toBe(false);
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
  it("parses Basic and Bearer headers", () => {
    expect(parseBasicAuth(`Basic ${Buffer.from("id%3A1:s%20ecret").toString("base64")}`)).toEqual({ clientId: "id:1", clientSecret: "s ecret" });
    expect(parseBasicAuth("Bearer x")).toBeNull();
    expect(bearerToken("Bearer abc-DEF_123")).toBe("abc-DEF_123");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

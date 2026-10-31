import "server-only";
import { randomUUID } from "node:crypto";
import { Types, isValidObjectId } from "mongoose";
import { connectDB } from "../db";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_TTL_SECONDS,
  MAX_CLIENTS,
  REFRESH_TOKEN_TTL_SECONDS,
  afterRegistration,
  checkCodeExchange,
  checkRefresh,
  narrowScopes,
  randomToken,
  registrationAllowed,
  safeEqual,
  sha256Hex,
  type RegistrationInput,
} from "./core";
import { LoginThrottle } from "@/models/LoginThrottle";
import { McpAuditLog } from "@/models/McpAuditLog";
import { OAuthClient } from "@/models/OAuthClient";
import { OAuthCode } from "@/models/OAuthCode";
import { OAuthToken } from "@/models/OAuthToken";
import { User } from "@/models/User";

export type OAuthError = { error: string; error_description: string; status: number };
const err = (error: string, error_description: string, status = 400): OAuthError => ({ error, error_description, status });

/* ---------- clients ---------- */

export type ClientInfo = { clientId: string; name: string; redirectUris: string[]; authMethod: string; grantTypes: string[] };

export async function findClient(clientId: string): Promise<ClientInfo | null> {
  if (!clientId || clientId.length > 200) return null;
  await connectDB();
  const c = await OAuthClient.findOne({ clientId }).lean();
  return c ? { clientId: c.clientId, name: c.name, redirectUris: c.redirectUris, authMethod: c.authMethod, grantTypes: c.grantTypes } : null;
}

/**
 * Registers a client (RFC 7591), rate-limited per IP (counter kept in the login-throttle
 * collection under "dcr:<ip>") and capped at MAX_CLIENTS: the oldest clients without live
 * tokens are pruned to make room.
 */
export async function registerClient(
  input: RegistrationInput,
  ip: string,
  now = new Date(),
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; e: OAuthError }> {
  await connectDB();
  const key = `dcr:${ip}`;
  const t = await LoginThrottle.findOne({ key }).select("count firstAt").lean();
  const current = t ? { count: t.count, firstAt: t.firstAt } : null;
  if (!registrationAllowed(current, now)) return { ok: false, e: err("rate_limited", "Too many registrations from this address. Try again later.", 429) };
  await LoginThrottle.updateOne({ key }, { $set: { ...afterRegistration(current, now), lockedUntil: null, updatedAt: now } }, { upsert: true });

  const total = await OAuthClient.estimatedDocumentCount();
  if (total >= MAX_CLIENTS) {
    const inUse = await OAuthToken.distinct("clientId");
    const victims = await OAuthClient.find({ clientId: { $nin: inUse } })
      .sort({ lastUsedAt: 1, createdAt: 1 })
      .limit(total - MAX_CLIENTS + 1)
      .select("_id")
      .lean();
    if (victims.length === 0) return { ok: false, e: err("temporarily_unavailable", "Too many registered applications.", 503) };
    await OAuthClient.deleteMany({ _id: { $in: victims.map((v) => v._id) } });
  }

  const clientId = `rentee_${randomToken(16)}`;
  const secret = input.authMethod === "none" ? null : randomToken(32);
  const doc = await OAuthClient.create({
    clientId,
    secretHash: secret ? sha256Hex(secret) : null,
    name: input.clientName,
    redirectUris: input.redirectUris,
    grantTypes: input.grantTypes,
    authMethod: input.authMethod,
  });
  return {
    ok: true,
    body: {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(doc.createdAt.getTime() / 1000),
      client_name: input.clientName,
      redirect_uris: input.redirectUris,
      grant_types: input.grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: input.authMethod,
    },
  };
}

/**
 * Authenticates a client at the token / revocation endpoint. Public clients send only their
 * client_id; confidential clients must use the secret method they registered with.
 */
export async function authenticateClient(
  creds: { clientId: string; clientSecret: string | null; method: "none" | "client_secret_post" | "client_secret_basic" },
): Promise<{ ok: true; client: ClientInfo } | { ok: false; e: OAuthError }> {
  await connectDB();
  const c = creds.clientId ? await OAuthClient.findOne({ clientId: creds.clientId }).lean() : null;
  const invalid = { ok: false as const, e: err("invalid_client", "Client authentication failed", 401) };
  if (!c) return invalid;
  if (c.authMethod === "none") {
    if (creds.clientSecret) return invalid;
  } else {
    if (!creds.clientSecret || !c.secretHash) return invalid;
    if (!safeEqual(sha256Hex(creds.clientSecret), c.secretHash)) return invalid;
    // client_secret_basic and _post are both accepted for a confidential client.
  }
  return { ok: true, client: { clientId: c.clientId, name: c.name, redirectUris: c.redirectUris, authMethod: c.authMethod, grantTypes: c.grantTypes } };
}

/* ---------- authorization codes ---------- */

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
}, now = new Date()): Promise<string> {
  await connectDB();
  const code = randomToken(32);
  await OAuthCode.create({
    codeHash: sha256Hex(code),
    clientId: input.clientId,
    user: new Types.ObjectId(input.userId),
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource,
    expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
    purgeAt: new Date(now.getTime() + 15 * 60 * 1000),
  });
  return code;
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

async function issueTokens(g: {
  family: string;
  clientId: string;
  userId: Types.ObjectId;
  scopes: string[];
  resource: string;
  grantedAt: Date;
  withRefresh: boolean;
}, now: Date): Promise<TokenResponse> {
  const access = randomToken(32);
  const refresh = g.withRefresh ? randomToken(32) : null;
  const base = { family: g.family, clientId: g.clientId, user: g.userId, scopes: g.scopes, resource: g.resource, grantedAt: g.grantedAt };
  await OAuthToken.insertMany([
    { ...base, tokenHash: sha256Hex(access), kind: "access", expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000) },
    ...(refresh
      ? [{ ...base, tokenHash: sha256Hex(refresh), kind: "refresh", expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000) }]
      : []),
  ]);
  await OAuthClient.updateOne({ clientId: g.clientId }, { $set: { lastUsedAt: now } });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    ...(refresh ? { refresh_token: refresh } : {}),
    scope: g.scopes.join(" "),
  };
}

/** authorization_code grant: single use; a replayed code revokes the tokens it produced. */
export async function exchangeCode(
  client: ClientInfo,
  req: { code: string; redirectUri: string; codeVerifier: string; resource: string | null },
  now = new Date(),
): Promise<{ ok: true; body: TokenResponse } | { ok: false; e: OAuthError }> {
  await connectDB();
  if (!req.code) return { ok: false, e: err("invalid_request", "code is required") };
  const codeHash = sha256Hex(req.code);
  const stored = await OAuthCode.findOne({ codeHash }).lean();
  const check = checkCodeExchange(
    stored
      ? {
          clientId: stored.clientId,
          redirectUri: stored.redirectUri,
          codeChallenge: stored.codeChallenge,
          resource: stored.resource,
          expiresAt: stored.expiresAt,
          usedAt: stored.usedAt ?? null,
        }
      : null,
    { clientId: client.clientId, redirectUri: req.redirectUri, codeVerifier: req.codeVerifier, resource: req.resource },
    now,
  );
  if (!check.ok) {
    if (check.revokeFamily && stored?.family) await OAuthToken.deleteMany({ family: stored.family });
    // A failed attempt still burns the code (no retries with other verifiers).
    if (stored && !stored.usedAt) await OAuthCode.updateOne({ _id: stored._id, usedAt: null }, { $set: { usedAt: now } });
    return { ok: false, e: err(check.error, check.description) };
  }
  // Claim the code atomically: only one exchange can win.
  const family = randomUUID();
  const claimed = await OAuthCode.findOneAndUpdate({ _id: stored!._id, usedAt: null }, { $set: { usedAt: now, family } }).lean();
  if (!claimed) return { ok: false, e: err("invalid_grant", "Authorization code already used") };
  if (!(await User.exists({ _id: stored!.user }))) return { ok: false, e: err("invalid_grant", "The approving user no longer exists") };
  const body = await issueTokens(
    {
      family,
      clientId: client.clientId,
      userId: stored!.user as Types.ObjectId,
      scopes: stored!.scopes,
      resource: stored!.resource,
      grantedAt: now,
      withRefresh: client.grantTypes.includes("refresh_token"),
    },
    now,
  );
  return { ok: true, body };
}

/** refresh_token grant with rotation; replaying a rotated token revokes the whole family. */
export async function refreshTokens(
  client: ClientInfo,
  req: { refreshToken: string; scope: string | null; resource: string | null },
  now = new Date(),
): Promise<{ ok: true; body: TokenResponse } | { ok: false; e: OAuthError }> {
  await connectDB();
  if (!req.refreshToken) return { ok: false, e: err("invalid_request", "refresh_token is required") };
  const stored = await OAuthToken.findOne({ tokenHash: sha256Hex(req.refreshToken), kind: "refresh" }).lean();
  const check = checkRefresh(
    stored ? { clientId: stored.clientId, expiresAt: stored.expiresAt, rotatedAt: stored.rotatedAt ?? null } : null,
    client.clientId,
    now,
  );
  if (!check.ok) {
    if (check.revokeFamily && stored) await OAuthToken.deleteMany({ family: stored.family });
    return { ok: false, e: err(check.error, check.description) };
  }
  if (req.resource && req.resource.replace(/\/+$/, "") !== stored!.resource.replace(/\/+$/, "")) {
    return { ok: false, e: err("invalid_target", "resource mismatch") };
  }
  const scopes = narrowScopes(stored!.scopes, req.scope);
  if (!scopes) return { ok: false, e: err("invalid_scope", "Requested scope exceeds the original grant") };
  const rotated = await OAuthToken.findOneAndUpdate({ _id: stored!._id, rotatedAt: null }, { $set: { rotatedAt: now } }).lean();
  if (!rotated) {
    await OAuthToken.deleteMany({ family: stored!.family });
    return { ok: false, e: err("invalid_grant", "Refresh token already used") };
  }
  if (!(await User.exists({ _id: stored!.user }))) {
    await OAuthToken.deleteMany({ family: stored!.family });
    return { ok: false, e: err("invalid_grant", "The approving user no longer exists") };
  }
  // Old access tokens of the family stop working once a new pair is issued.
  await OAuthToken.deleteMany({ family: stored!.family, kind: "access" });
  const body = await issueTokens(
    {
      family: stored!.family,
      clientId: client.clientId,
      userId: stored!.user as Types.ObjectId,
      scopes,
      resource: stored!.resource,
      grantedAt: stored!.grantedAt,
      withRefresh: true,
    },
    now,
  );
  return { ok: true, body };
}

/** RFC 7009: revokes the grant family of a token owned by this client. Unknown tokens are ignored. */
export async function revokeToken(client: ClientInfo, token: string): Promise<void> {
  if (!token) return;
  await connectDB();
  const stored = await OAuthToken.findOne({ tokenHash: sha256Hex(token) }).select("family clientId").lean();
  if (stored && safeEqual(stored.clientId, client.clientId)) await OAuthToken.deleteMany({ family: stored.family });
}

/* ---------- access tokens (MCP endpoint) ---------- */

export type AccessContext = {
  tokenId: string;
  family: string;
  clientId: string;
  clientName: string;
  userId: string;
  userName: string;
  scopes: string[];
};

/** Resolves a bearer token for this resource, or null (unknown, expired, wrong audience, user deleted). */
export async function verifyAccessToken(token: string, resource: string, now = new Date()): Promise<AccessContext | null> {
  if (!token || token.length > 200) return null;
  await connectDB();
  const t = await OAuthToken.findOne({ tokenHash: sha256Hex(token), kind: "access" }).lean();
  if (!t || t.expiresAt.getTime() <= now.getTime()) return null;
  if (t.resource.replace(/\/+$/, "") !== resource.replace(/\/+$/, "")) return null;
  const [user, client] = await Promise.all([
    User.findById(t.user).select("name").lean(),
    OAuthClient.findOne({ clientId: t.clientId }).select("name").lean(),
  ]);
  if (!user || !client) return null;
  return {
    tokenId: String(t._id),
    family: t.family,
    clientId: t.clientId,
    clientName: client.name,
    userId: String(t.user),
    userName: user.name,
    scopes: t.scopes,
  };
}

/** Records the grant's last use (at most once a minute per token, to keep writes low). */
export async function touchGrant(ctx: AccessContext, now = new Date()): Promise<void> {
  await OAuthToken.updateOne(
    { _id: ctx.tokenId, $or: [{ lastUsedAt: null }, { lastUsedAt: { $lt: new Date(now.getTime() - 60_000) } }] },
    { $set: { lastUsedAt: now } },
  ).catch(() => undefined);
}

export async function auditWrite(ctx: AccessContext, tool: string, summary: string, ok: boolean): Promise<void> {
  await McpAuditLog.create({
    tool,
    summary: summary.slice(0, 500),
    ok,
    user: new Types.ObjectId(ctx.userId),
    clientId: ctx.clientId,
    clientName: ctx.clientName,
  }).catch((e) => console.error("[mcp] audit log failed:", e));
}

/* ---------- Settings → Connected apps ---------- */

export type GrantRow = {
  family: string;
  clientName: string;
  clientId: string;
  userName: string;
  scopes: string[];
  grantedAt: string;
  lastUsedAt: string | null;
};

export async function listGrants(now = new Date()): Promise<GrantRow[]> {
  await connectDB();
  const rows = await OAuthToken.aggregate<{
    _id: string;
    clientId: string;
    user: Types.ObjectId;
    scopes: string[];
    grantedAt: Date;
    lastUsedAt: Date | null;
  }>([
    { $match: { expiresAt: { $gt: now }, $or: [{ kind: "access" }, { kind: "refresh", rotatedAt: null }] } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$family",
        clientId: { $first: "$clientId" },
        user: { $first: "$user" },
        scopes: { $first: "$scopes" },
        grantedAt: { $min: "$grantedAt" },
        lastUsedAt: { $max: "$lastUsedAt" },
      },
    },
    { $sort: { grantedAt: -1 } },
    { $limit: 200 },
  ]);
  const [clients, users] = await Promise.all([
    OAuthClient.find({ clientId: { $in: rows.map((r) => r.clientId) } }).select("clientId name").lean(),
    User.find({ _id: { $in: rows.map((r) => r.user) } }).select("name").lean(),
  ]);
  const clientName = new Map(clients.map((c) => [c.clientId, c.name]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  return rows.map((r) => ({
    family: r._id,
    clientId: r.clientId,
    clientName: clientName.get(r.clientId) ?? "(removed app)",
    userName: userName.get(String(r.user)) ?? "(deleted admin)",
    scopes: r.scopes,
    grantedAt: r.grantedAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

/** Revokes one grant: deletes every token of the family. */
export async function revokeGrant(family: string): Promise<number> {
  if (!family || family.length > 100) return 0;
  await connectDB();
  const res = await OAuthToken.deleteMany({ family });
  return res.deletedCount ?? 0;
}

export type AuditRow = { id: string; tool: string; summary: string; ok: boolean; clientName: string; userName: string; at: string };

export async function recentAudit(limit = 20): Promise<AuditRow[]> {
  await connectDB();
  const rows = await McpAuditLog.find().sort({ at: -1 }).limit(limit).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.user).filter((u) => isValidObjectId(u)) } }).select("name").lean();
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  return rows.map((r) => ({
    id: String(r._id),
    tool: r.tool,
    summary: r.summary ?? "",
    ok: r.ok,
    clientName: r.clientName ?? "",
    userName: userName.get(String(r.user)) ?? "(deleted admin)",
    at: r.at.toISOString(),
  }));
}

/**
 * End-to-end check of the MCP connector + OAuth 2.1 server against a THROWAWAY database.
 *
 *   NEXT_DIST_DIR=.next-verify npm run build      # build first (any dist dir)
 *   NEXT_DIST_DIR=.next-verify node scripts/mcp-e2e.mjs
 *
 * It starts its own mongod (mongodb-memory-server, temp dir, port E2E_MONGO_PORT=27391), seeds
 * the demo admin + data, runs `next start` on E2E_APP_PORT=3391 with APP_URL set to that origin,
 * and then exercises: discovery → DCR → authorize (sign in + consent) → token (PKCE) → refresh
 * (rotation + replay) → MCP initialize / tools/list / tools/call (read, write with and without
 * rentee:write) → revoke, using both raw HTTP and the official SDK client with its OAuth flow.
 * It never reads .env files and never touches any other database. Everything is stopped at the end.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { MongoMemoryServer } from "mongodb-memory-server";

const MONGO_PORT = Number(process.env.E2E_MONGO_PORT || 27391);
const APP_PORT = Number(process.env.E2E_APP_PORT || 3391);
const BASE = `http://localhost:${APP_PORT}`;
const MCP = `${BASE}/api/mcp`;
const ADMIN = { email: "admin@rentee.local", password: "rentee123" };
const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || ".next";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${out}`))));
  });
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** All <input type="hidden"> name/value pairs in an HTML string. */
function hiddenInputs(html) {
  const out = [];
  for (const tag of html.match(/<input\b[^>]*>/g) ?? []) {
    if (!/type="hidden"/.test(tag)) continue;
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const value = /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (name) out.push([decode(name), decode(value)]);
  }
  return out;
}

function setCookies(res) {
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

/** Signs in through the real login form (its server action, submitted as a plain form post). */
async function signIn(next) {
  const page = await fetch(`${BASE}/login?next=${encodeURIComponent(next)}`);
  const html = await page.text();
  const fd = new FormData();
  for (const [k, v] of hiddenInputs(html)) fd.append(k, v);
  fd.set("next", next);
  fd.set("email", ADMIN.email);
  fd.set("password", ADMIN.password);
  const res = await fetch(`${BASE}/login`, { method: "POST", body: fd, redirect: "manual" });
  const cookie = setCookies(res);
  if (res.status !== 303) {
    const body = await res.text().catch(() => "");
    const alert = body.match(/role="alert"[^>]*>(?:<[^>]+>)*([^<]{3,200})/)?.[1];
    console.log(`  (login returned ${res.status}${alert ? `: ${alert}` : ""})`);
  }
  return { status: res.status, location: res.headers.get("location"), cookie };
}

/** Opens the consent page and approves (optionally with write), returning the client redirect. */
async function consent(authorizeUrl, cookie, { allowWrite, decision = "approve" }) {
  const page = await fetch(authorizeUrl, { headers: { cookie }, redirect: "manual" });
  const html = await page.text();
  const fields = hiddenInputs(html);
  const body = new URLSearchParams(fields);
  body.set("decision", decision);
  if (allowWrite) body.set("allow_write", "on");
  const res = await fetch(`${BASE}/oauth/authorize/decision`, {
    method: "POST",
    headers: { cookie, origin: BASE, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { pageStatus: page.status, html, hasCsrf: fields.some(([k]) => k === "csrf"), status: res.status, json };
}

async function form(url, params, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params),
  });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
}

let rpcId = 1;
async function rpc(token, method, params = {}) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, json, text };
}
const callTool = (token, name, args = {}) => rpc(token, "tools/call", { name, arguments: args });
const toolText = (r) => r.json?.result?.content?.[0]?.text ?? "";
const toolJson = (r) => {
  try {
    return JSON.parse(toolText(r));
  } catch {
    return null;
  }
};

/** Raw OAuth: register a public client, sign in, consent, exchange the code. */
async function rawGrant({ allowWrite, cookie, redirectUri = "https://claude.ai/api/mcp/auth_callback" }) {
  const reg = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: allowWrite ? "E2E raw (write)" : "E2E raw (read)", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
  });
  const client = await reg.json();
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(8));
  const authUrl = new URL(`${BASE}/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "rentee:read rentee:write",
    resource: MCP,
  }))
    authUrl.searchParams.set(k, v);
  const c = await consent(authUrl.toString(), cookie, { allowWrite });
  const back = new URL(c.json.redirect);
  const code = back.searchParams.get("code");
  const tok = await form(`${BASE}/api/oauth/token`, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: client.client_id,
    resource: MCP,
  });
  return { reg, client, state, back, code, verifier, tok, authUrl, redirectUri };
}

class MemoryProvider {
  constructor(redirectUrl) {
    this._redirect = redirectUrl;
    this.authUrl = null;
  }
  get redirectUrl() {
    return this._redirect;
  }
  get clientMetadata() {
    return {
      client_name: "E2E SDK client",
      redirect_uris: [this._redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this._client;
  }
  saveClientInformation(c) {
    this._client = c;
  }
  tokens() {
    return this._tokens;
  }
  saveTokens(t) {
    this._tokens = t;
  }
  redirectToAuthorization(url) {
    this.authUrl = url;
  }
  saveCodeVerifier(v) {
    this._verifier = v;
  }
  codeVerifier() {
    return this._verifier;
  }
}

async function main() {
  if (await portOpen(MONGO_PORT)) throw new Error(`Port ${MONGO_PORT} is in use; set E2E_MONGO_PORT.`);
  if (await portOpen(APP_PORT)) throw new Error(`Port ${APP_PORT} is in use; set E2E_APP_PORT.`);
  if (!fs.existsSync(path.join(root, distDir, "BUILD_ID"))) throw new Error(`No production build in ${distDir}. Run the build first.`);

  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "rentee-e2e-"));
  console.log(`[e2e] mongod on ${MONGO_PORT} (data: ${dbPath})`);
  const mongo = await MongoMemoryServer.create({ instance: { port: MONGO_PORT, ip: "127.0.0.1", dbPath } });
  const uri = `mongodb://127.0.0.1:${MONGO_PORT}/rentee_e2e`;
  // A clean environment: only what the app needs (no inherited MONGODB_URI / APP_URL).
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    MONGODB_URI: uri,
    AUTH_SECRET: b64url(randomBytes(32)),
    APP_URL: BASE,
    NEXT_DIST_DIR: distDir,
    NEXT_TELEMETRY_DISABLED: "1",
    // Explicit values win over the developer's .env (which Next/seed also load): no robot check
    // for the scripted login, and a throwaway file-encryption key.
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    ADMIN_NAME: "E2E Admin",
    TURNSTILE_SITE_KEY: " ", // a space (not "") so Next.js does not refill it from .env; trimmed = off
    TURNSTILE_SECRET_KEY: " ",
    FILES_ENCRYPTION_KEY: b64url(randomBytes(32)),
  };
  let app;
  try {
    console.log("[e2e] seeding demo data");
    await run(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/seed.ts"], env);

    console.log(`[e2e] next start on ${APP_PORT}`);
    app = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
      cwd: root,
      env: { ...env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let appLog = "";
    app.stdout.on("data", (d) => (appLog += d));
    app.stderr.on("data", (d) => (appLog += d));
    for (let i = 0; i < 120 && !(await portOpen(APP_PORT)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await portOpen(APP_PORT))) throw new Error(`next start did not come up:\n${appLog}`);

    console.log("\n== Discovery");
    const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
    check("PRM resource = <APP_URL>/api/mcp", prm.resource === MCP, JSON.stringify(prm));
    check("PRM authorization_servers = [APP_URL]", JSON.stringify(prm.authorization_servers) === JSON.stringify([BASE]));
    const prm2 = await fetch(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
    check("path-suffixed PRM answers 200", prm2.status === 200);
    const asmRes = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    const asm = await asmRes.json();
    check("AS metadata issuer = APP_URL", asm.issuer === BASE);
    check("AS metadata S256 only", JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]');
    check("AS metadata endpoints", asm.token_endpoint === `${BASE}/api/oauth/token` && asm.registration_endpoint === `${BASE}/api/oauth/register`);
    check("CORS on metadata", asmRes.headers.get("access-control-allow-origin") === "*");

    console.log("\n== 401 without / with a bad token");
    const noTok = await rpc(null, "tools/list");
    check("no token -> 401", noTok.status === 401);
    check(
      "WWW-Authenticate has resource_metadata",
      noTok.headers.get("www-authenticate") === `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`,
      noTok.headers.get("www-authenticate"),
    );
    const badTok = await rpc("not-a-real-token", "tools/list");
    check("bad token -> 401 invalid_token", badTok.status === 401 && /error="invalid_token"/.test(badTok.headers.get("www-authenticate") ?? ""));

    console.log("\n== Dynamic client registration");
    const evil = await fetch(`${BASE}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.com/cb"], token_endpoint_auth_method: "none" }),
    });
    check("http://evil.com redirect -> 400 invalid_redirect_uri", evil.status === 400 && (await evil.json()).error === "invalid_redirect_uri");

    console.log("\n== Sign in (real login form)");
    const login = await signIn("/oauth/authorize?x=1");
    check("login redirects back to /oauth/authorize", login.status === 303 && (login.location ?? "").includes("/oauth/authorize"), `${login.status} ${login.location}`);
    check("session cookie set", login.cookie.includes("rentee_session="));
    const cookie = login.cookie;

    const signedOut = await fetch(`${BASE}/oauth/authorize?client_id=x`, { redirect: "manual" });
    check("signed-out authorize -> redirect to /login?next=", signedOut.status >= 300 && (signedOut.headers.get("location") ?? "").includes("/login?next="));

    console.log("\n== Raw OAuth flow (read + write)");
    const w = await rawGrant({ allowWrite: true, cookie });
    check("DCR (claude.ai callback, public) -> 201, no secret", w.reg.status === 201 && w.client.client_id && !w.client.client_secret);
    check("redirect carries code + state", !!w.code && w.back.searchParams.get("state") === w.state && w.back.origin + w.back.pathname === w.redirectUri);
    check("token: 200 Bearer, expires_in 3600, refresh", w.tok.status === 200 && w.tok.json.token_type === "Bearer" && w.tok.json.expires_in === 3600 && !!w.tok.json.refresh_token);
    check("token: scope read+write", w.tok.json.scope === "rentee:read rentee:write", w.tok.json.scope);
    check("token: Cache-Control no-store", (w.tok.headers.get("cache-control") ?? "").includes("no-store"));
    const reuse = await form(`${BASE}/api/oauth/token`, {
      grant_type: "authorization_code",
      code: w.code,
      redirect_uri: w.redirectUri,
      code_verifier: w.verifier,
      client_id: w.client.client_id,
    });
    check("reused code -> invalid_grant", reuse.status === 400 && reuse.json.error === "invalid_grant");
    const afterReuse = await rpc(w.tok.json.access_token, "tools/list");
    check("reused code revokes the tokens issued from it", afterReuse.status === 401);

    // Fresh grant (the replay above revoked the first one).
    const g = await rawGrant({ allowWrite: true, cookie });
    let access = g.tok.json.access_token;

    // Wrong verifier on another code.
    const wv = await rawGrant({ allowWrite: false, cookie });
    const wrongVerifier = await (async () => {
      const { challenge } = pkce();
      const u = new URL(wv.authUrl);
      u.searchParams.set("code_challenge", challenge);
      const c = await consent(u.toString(), cookie, { allowWrite: false });
      const code = new URL(c.json.redirect).searchParams.get("code");
      return form(`${BASE}/api/oauth/token`, { grant_type: "authorization_code", code, redirect_uri: wv.redirectUri, code_verifier: wv.verifier, client_id: wv.client.client_id });
    })();
    check("wrong PKCE verifier -> invalid_grant", wrongVerifier.status === 400 && wrongVerifier.json.error === "invalid_grant");

    // Authorize edge cases.
    const noPkce = new URL(g.authUrl);
    noPkce.searchParams.delete("code_challenge");
    const np = await fetch(noPkce, { headers: { cookie }, redirect: "manual" });
    const npLoc = np.headers.get("location") ?? "";
    check("authorize without PKCE -> invalid_request, no code", np.status >= 300 && npLoc.includes("error=invalid_request") && !npLoc.includes("code="), `${np.status} ${npLoc}`);
    const wrongRedirect = new URL(g.authUrl);
    wrongRedirect.searchParams.set("redirect_uri", "https://evil.example/cb");
    const wr = await fetch(wrongRedirect, { headers: { cookie }, redirect: "manual" });
    const wrHtml = await wr.text();
    check("unregistered redirect_uri -> error page, no redirect", wr.status === 200 && wrHtml.includes("Can&#x27;t connect this app") && !wr.headers.get("location"));
    const deny = await consent(g.authUrl.toString(), cookie, { allowWrite: false, decision: "deny" });
    check("deny -> access_denied", new URL(deny.json.redirect).searchParams.get("error") === "access_denied");
    const csrfBad = await fetch(`${BASE}/oauth/authorize/decision`, {
      method: "POST",
      headers: { cookie, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(g.authUrl.searchParams), decision: "approve", csrf: "123.abc" }),
    });
    check("consent without a valid CSRF token -> 403", csrfBad.status === 403);

    console.log("\n== Refresh rotation");
    const r1 = await form(`${BASE}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: g.tok.json.refresh_token, client_id: g.client.client_id });
    check("refresh -> new pair", r1.status === 200 && r1.json.refresh_token && r1.json.refresh_token !== g.tok.json.refresh_token);
    check("old access token stops after rotation", (await rpc(access, "tools/list")).status === 401);
    access = r1.json.access_token;
    check("new access token works", (await rpc(access, "tools/list")).status === 200);
    const widen = await form(`${BASE}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: r1.json.refresh_token, client_id: g.client.client_id, scope: "rentee:read rentee:write admin" });
    check("refresh asking for more scope -> invalid_scope", widen.status === 400 && widen.json.error === "invalid_scope");
    const replay = await form(`${BASE}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: g.tok.json.refresh_token, client_id: g.client.client_id });
    check("replayed rotated refresh -> invalid_grant", replay.status === 400 && replay.json.error === "invalid_grant");
    check("replay revokes the whole family (access 401)", (await rpc(access, "tools/list")).status === 401);
    const r2 = await form(`${BASE}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: r1.json.refresh_token, client_id: g.client.client_id });
    check("replay revokes the whole family (refresh rejected)", r2.status === 400);

    console.log("\n== MCP over raw HTTP with a read+write token");
    const g2 = await rawGrant({ allowWrite: true, cookie });
    access = g2.tok.json.access_token;
    const init = await rpc(access, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    check("initialize -> serverInfo rentee", init.status === 200 && init.json?.result?.serverInfo?.name === "rentee", init.text.slice(0, 300));
    const list = await rpc(access, "tools/list");
    const names = (list.json?.result?.tools ?? []).map((t) => t.name);
    check(`tools/list -> ${names.length} tools`, names.length === 22 && names.includes("get_dashboard") && !names.some((n) => /delete/.test(n)), names.join(","));
    const recordTool = list.json.result.tools.find((t) => t.name === "record_rent_payment");
    check("write tool annotated readOnlyHint=false, destructiveHint=false", recordTool.annotations?.readOnlyHint === false && recordTool.annotations?.destructiveHint === false);
    check("read tool annotated readOnlyHint=true", list.json.result.tools.find((t) => t.name === "get_dashboard").annotations?.readOnlyHint === true);
    const dash = await callTool(access, "get_dashboard");
    const dj = toolJson(dash);
    check("get_dashboard returns data", !!dj && typeof dj.occupancy?.percent === "number" && typeof dj.collectedThisMonth?.paise === "number", toolText(dash).slice(0, 300));
    console.log(`        dashboard: occupancy ${dj?.occupancy?.occupied}/${dj?.occupancy?.properties}, collected ${dj?.collectedThisMonth?.formatted}, overdue ${dj?.overdue?.total?.formatted} (${dj?.overdue?.rentals?.length} rentals)`);
    const rentals = toolJson(await callTool(access, "list_rentals"));
    const rental = rentals?.[0];
    check("list_rentals returns active rentals", Array.isArray(rentals) && rentals.length > 0);
    const tenant = toolJson(await callTool(access, "get_tenant", { tenantId: rental.tenant.id }));
    check("get_tenant has no idNumber / documents / photo", tenant && !("idNumber" in tenant) && !("documents" in tenant) && !("photo" in tenant) && !JSON.stringify(tenant).includes("idNumber"));
    const before = toolJson(await callTool(access, "get_rental", { rentalId: rental.id }));
    check("get_rental returns schedule + deposit", Array.isArray(before?.schedule) && !!before?.deposit);
    const month = new Date().toISOString().slice(0, 7);
    const zero = await callTool(access, "record_rent_payment", { rentalId: rental.id, forMonth: month, amount: 0 });
    check("amount 0 -> tool error", zero.json?.result?.isError === true && /greater than zero/.test(toolText(zero)), toolText(zero));
    const outside = await callTool(access, "record_rent_payment", { rentalId: rental.id, forMonth: "2001-01", amount: 100 });
    check("month outside rental -> tool error", outside.json?.result?.isError === true && /move-in/.test(toolText(outside)), toolText(outside));
    const paid = await callTool(access, "record_rent_payment", { rentalId: rental.id, forMonth: month, amount: 123.45, method: "upi", note: "via MCP e2e" });
    check("record_rent_payment with rentee:write -> recorded", paid.json?.result?.isError !== true && toolJson(paid)?.recorded === true, toolText(paid));
    const after = toolJson(await callTool(access, "get_rental", { rentalId: rental.id }));
    check("payment visible (paid +12345 paise)", after.totalPaid.paise - before.totalPaid.paise === 12345);
    const enq = await callTool(access, "create_enquiry", { name: "E2E Lead", phone: "+91 98765 00000", source: "olx" });
    check("create_enquiry -> created", toolJson(enq)?.created === true, toolText(enq));
    const note = await callTool(access, "add_enquiry_note", { enquiryId: toolJson(enq).enquiryId, text: "Called, will visit Sunday", kind: "call" });
    check("add_enquiry_note -> added", toolJson(note)?.added === true);
    const enqDetail = toolJson(await callTool(access, "get_enquiry", { enquiryId: toolJson(enq).enquiryId }));
    check("get_enquiry has timeline", enqDetail?.timeline?.length === 2);
    const props = toolJson(await callTool(access, "list_properties"));
    const maint = await callTool(access, "create_maintenance_request", { propertyId: props[0].id, title: "Leaking tap", priority: "high" });
    check("create_maintenance_request -> created", toolJson(maint)?.created === true, toolText(maint));
    const ms = await callTool(access, "update_maintenance_status", { maintenanceId: toolJson(maint).maintenanceId, status: "done" });
    check("update_maintenance_status -> updated", toolJson(ms)?.updated === true);
    for (const [tool, args] of [
      ["list_overdue_rent", {}],
      ["list_payments", {}],
      ["list_expenses", {}],
      ["get_profit_report", {}],
      ["list_enquiries", {}],
      ["list_maintenance", { status: "all" }],
      ["list_notifications", {}],
      ["list_agreements_expiring", {}],
      ["list_tenants", { search: rental.tenant.name.split(" ")[0] }],
      ["get_property", { propertyId: props[0].id }],
    ]) {
      const r = await callTool(access, tool, args);
      check(`${tool} ok`, r.status === 200 && r.json?.result && !r.json.result.isError && toolJson(r) !== null, toolText(r).slice(0, 200));
    }
    const badId = await callTool(access, "get_rental", { rentalId: "nope" });
    check("invalid input -> error, not a crash", badId.status === 200 && (badId.json?.result?.isError === true || !!badId.json?.error));

    console.log("\n== Official SDK client with OAuth (read-only consent)");
    const provider = new MemoryProvider("http://localhost:9/callback");
    const transport = new StreamableHTTPClientTransport(new URL(MCP), { authProvider: provider });
    const sdk = new Client({ name: "rentee-e2e", version: "1.0.0" });
    let unauthorized = false;
    try {
      await sdk.connect(transport);
    } catch (e) {
      unauthorized = e instanceof UnauthorizedError;
      if (!unauthorized) console.log("        connect error:", e);
    }
    check("SDK: discovery + DCR, then asks for authorization", unauthorized && !!provider.authUrl && !!provider.clientInformation()?.client_id);
    const sdkAuth = new URL(provider.authUrl);
    check("SDK authorize request has S256 + resource", sdkAuth.searchParams.get("code_challenge_method") === "S256" && sdkAuth.searchParams.get("resource") === MCP, sdkAuth.toString());
    const sc = await consent(provider.authUrl.toString(), cookie, { allowWrite: false });
    check("consent page rendered with CSRF", sc.pageStatus === 200 && sc.hasCsrf && sc.html.includes("Also allow changes"));
    const sdkCode = new URL(sc.json.redirect).searchParams.get("code");
    await transport.finishAuth(sdkCode);
    check("SDK: token exchange (PKCE) ok, read-only scope", provider.tokens()?.scope === "rentee:read", JSON.stringify(provider.tokens()?.scope));
    const sdk2 = new Client({ name: "rentee-e2e", version: "1.0.0" });
    await sdk2.connect(new StreamableHTTPClientTransport(new URL(MCP), { authProvider: provider }));
    const tools = await sdk2.listTools();
    check("SDK: tools/list", tools.tools.length === 22);
    const sdkDash = await sdk2.callTool({ name: "get_dashboard", arguments: {} });
    check("SDK: tools/call get_dashboard", !sdkDash.isError && JSON.parse(sdkDash.content[0].text).occupancy !== undefined);
    const before2 = JSON.parse((await sdk2.callTool({ name: "get_rental", arguments: { rentalId: rental.id } })).content[0].text);
    const ro = await sdk2.callTool({ name: "record_rent_payment", arguments: { rentalId: rental.id, forMonth: month, amount: 500 } });
    check("read-only token: write tool -> error mentioning rentee:write", ro.isError === true && /rentee:write/.test(ro.content[0].text), ro.content[0].text);
    const after2 = JSON.parse((await sdk2.callTool({ name: "get_rental", arguments: { rentalId: rental.id } })).content[0].text);
    check("read-only token: no data changed", after2.totalPaid.paise === before2.totalPaid.paise);
    await sdk2.close();

    console.log("\n== Settings -> Connected apps, revoke");
    const settings = await (await fetch(`${BASE}/settings`, { headers: { cookie } })).text();
    check("Settings shows Connected apps with the SDK client + audit", settings.includes("Connected apps") && settings.includes("E2E SDK client") && settings.includes("record_rent_payment"));
    const rv = await form(`${BASE}/api/oauth/revoke`, { token: g2.tok.json.refresh_token, client_id: g2.client.client_id });
    check("RFC 7009 revoke -> 200", rv.status === 200);
    check("revoked grant -> 401 on /api/mcp", (await rpc(access, "tools/list")).status === 401);
    const optionsRes = await fetch(MCP, { method: "OPTIONS" });
    check("CORS preflight on /api/mcp", optionsRes.status === 204 && optionsRes.headers.get("access-control-allow-origin") === "*");

    console.log("\n== Request limits");
    // Earlier steps already sent some unauthenticated requests this minute; flood until refused.
    let firstLimited = null;
    for (let i = 1; i <= 40 && !firstLimited; i++) {
      const r = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status === 429) firstLimited = { i, retry: r.headers.get("retry-after"), body: await r.json().catch(() => ({})) };
    }
    check("flood without a token -> 429 within 40 requests", !!firstLimited, firstLimited ? `after ${firstLimited.i}` : "never limited");
    check("429 carries Retry-After (1–60 s)", !!firstLimited && Number(firstLimited.retry) >= 1 && Number(firstLimited.retry) <= 60, firstLimited?.retry);
    check("429 body is rate_limited", firstLimited?.body?.error === "rate_limited");
    let tokenLimited = null;
    for (let i = 1; i <= 40 && !tokenLimited; i++) {
      const r = await form(`${BASE}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: "bogus", client_id: "bogus" });
      if (r.status === 429) tokenLimited = i;
    }
    check("token endpoint flood -> 429 within 40 requests", !!tokenLimited, tokenLimited ? `after ${tokenLimited}` : "never limited");
  } finally {
    if (app) {
      app.kill();
      await new Promise((r) => setTimeout(r, 500));
    }
    await mongo.stop({ doCleanup: true, force: true }).catch(() => undefined);
    fs.rmSync(dbPath, { recursive: true, force: true });
  }
  console.log(`\n[e2e] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

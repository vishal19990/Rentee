/**
 * End-to-end check of the TENANT PORTAL against a THROWAWAY database.
 *
 *   NEXT_DIST_DIR=.next-verify npm run build      # build first (any dist dir)
 *   NEXT_DIST_DIR=.next-verify node scripts/portal-e2e.mjs
 *
 * Starts its own mongod (mongodb-memory-server, temp dir, port E2E_MONGO_PORT=27392), seeds the
 * demo admin + data, runs `next start` on E2E_APP_PORT=3392, then: admin invites two tenants
 * (A = Asha, B = Rahul) and a moved-out tenant (C = Meera); each sets a password through the real
 * invite page and signs in with the real login form. It then checks the spec's matrix: isolation
 * (tenant A guessing tenant B's receipt / deposit receipt / document / maintenance photo ids and
 * submitting B's ids to portal server actions), tenant cookie on admin pages / APIs / server
 * actions / MCP, admin cookie on the portal, expired / used invites, weak passwords, login in
 * any phone format, wrong password, lockout, disable / enable, UPI pay section on and off,
 * maintenance with photo (+ non-image refused, admin notification, "From tenant" badge), profile
 * phone uniqueness and the change log. It never reads .env files and never touches any other
 * database. Everything it starts is stopped at the end.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { MongoClient, GridFSBucket, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const MONGO_PORT = Number(process.env.E2E_MONGO_PORT || 27392);
const APP_PORT = Number(process.env.E2E_APP_PORT || 3392);
const BASE = `http://localhost:${APP_PORT}`;
const ADMIN = { email: "admin@rentee.local", password: "rentee123" };
const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || ".next";
const KEEP_APP = process.env.E2E_KEEP_APP === "1"; // leave the app running (for screenshots) until Ctrl+C

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`);
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

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (html) => decode(html.replace(/<!--.*?-->/g, ""));

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
const formsIn = (html) => html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
const formWith = (html, needle) => formsIn(html).find((f) => f.includes(needle));

function cookieFrom(res, name) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    if (kv.startsWith(`${name}=`)) return kv;
  }
  return null;
}

let ipSeq = 10;
const freshIp = () => `10.9.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`;

async function get(p, cookie, extra = {}) {
  const res = await fetch(`${BASE}${p}`, { headers: { ...(cookie ? { cookie } : {}), ...extra }, redirect: "manual" });
  const body = await res.text().catch(() => "");
  return { status: res.status, location: res.headers.get("location"), body, headers: res.headers };
}
async function getBytes(p, cookie) {
  const res = await fetch(`${BASE}${p}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, type: res.headers.get("content-type") ?? "", bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Submits a rendered server-action form as a browser without JS would (multipart). */
async function submit(pagePath, formHtml, values, cookie, { files = {}, ip = freshIp() } = {}) {
  const fd = new FormData();
  for (const [k, v] of hiddenInputs(formHtml)) fd.append(k, v);
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  for (const [k, f] of Object.entries(files)) fd.set(k, new Blob([f.bytes], { type: f.type }), f.name);
  const res = await fetch(`${BASE}${pagePath}`, {
    method: "POST",
    body: fd,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), "x-forwarded-for": ip },
  });
  return { status: res.status, location: res.headers.get("location"), body: await res.text().catch(() => ""), res };
}

/** Calls a server action directly (as the client runtime does): Next-Action header + JSON args. */
async function callAction(pagePath, actionId, args, cookie) {
  const res = await fetch(`${BASE}${pagePath}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "next-action": actionId,
      "content-type": "text/plain;charset=UTF-8",
      accept: "text/x-component",
      "x-forwarded-for": freshIp(),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(args),
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    actionRedirect: res.headers.get("x-action-redirect"),
    body: await res.text().catch(() => ""),
    res,
  };
}

const isLoginRedirect = (r, to = "/login") => [303, 307, 308].includes(r.status) && !!r.location && new URL(r.location, BASE).pathname === to;
const deniedAction = (r) =>
  isLoginRedirect(r) || (r.actionRedirect ?? "").startsWith("/login") || r.status === 401 || r.status === 404 || /Server action not found/i.test(r.body);

function actionIds() {
  const m = JSON.parse(fs.readFileSync(path.join(root, distDir, "server/server-reference-manifest.json"), "utf8"));
  const out = {};
  for (const [id, v] of Object.entries(m.node)) out[`${v.exportedName}@${String(v.filename).replaceAll("\\", "/")}`] = id;
  const find = (name, fileIncludes) => {
    const k = Object.keys(out).find((x) => x.startsWith(`${name}@`) && x.includes(fileIncludes));
    if (!k) throw new Error(`action ${name} (${fileIncludes}) not in manifest`);
    return out[k];
  };
  return find;
}

async function adminSignIn() {
  const page = await get("/login");
  const form = formWith(page.body, 'name="email"');
  const r = await submit("/login", form, { email: ADMIN.email, password: ADMIN.password, next: "/dashboard" }, null);
  return cookieFrom(r.res, "rentee_session");
}

async function main() {
  if (await portOpen(MONGO_PORT)) throw new Error(`Port ${MONGO_PORT} is in use; set E2E_MONGO_PORT.`);
  if (await portOpen(APP_PORT)) throw new Error(`Port ${APP_PORT} is in use; set E2E_APP_PORT.`);
  if (!fs.existsSync(path.join(root, distDir, "BUILD_ID"))) throw new Error(`No production build in ${distDir}. Run the build first.`);
  const action = actionIds();

  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "rentee-portal-e2e-"));
  console.log(`[e2e] mongod on ${MONGO_PORT} (data: ${dbPath})`);
  const mongo = await MongoMemoryServer.create({ instance: { port: MONGO_PORT, ip: "127.0.0.1", dbPath } });
  const uri = `mongodb://127.0.0.1:${MONGO_PORT}/rentee_portal_e2e`;
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    MONGODB_URI: uri,
    AUTH_SECRET: randomBytes(32).toString("base64url"),
    APP_URL: BASE,
    NEXT_DIST_DIR: distDir,
    NEXT_TELEMETRY_DISABLED: "1",
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    ADMIN_NAME: "E2E Admin",
    TURNSTILE_SITE_KEY: " ",
    TURNSTILE_SECRET_KEY: " ",
    FILES_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  };
  let app;
  const client = new MongoClient(uri);
  try {
    console.log("[e2e] seeding demo data");
    await run(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/seed.ts"], env);
    await client.connect();
    const db = client.db();
    const tenants = db.collection("tenants");
    const A = await tenants.findOne({ name: "Asha Menon" });
    const B = await tenants.findOne({ name: "Rahul Verma" });
    const C = await tenants.findOne({ name: "Meera Iyer" });
    const V = await tenants.findOne({ name: "Vikram Shah" });
    const rentalA = await db.collection("rentals").findOne({ tenant: A._id });
    const rentalB = await db.collection("rentals").findOne({ tenant: B._id });

    // Documents for A and B (plain PDF bytes in the "documents" bucket), A's agreement links its doc.
    const docs = new GridFSBucket(db, { bucketName: "documents" });
    async function addDoc(tenant, rental, title) {
      const fileId = new ObjectId();
      const bytes = Buffer.from(`%PDF-1.4\n% ${title}\n%%EOF\n`);
      await new Promise((res, rej) => docs.openUploadStreamWithId(fileId, String(fileId)).once("finish", res).once("error", rej).end(bytes));
      const r = await db.collection("tenantdocuments").insertOne({
        tenant: tenant._id, rental: rental._id, type: "agreement", title, file: fileId, contentType: "application/pdf", size: bytes.length, uploadedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      });
      return r.insertedId;
    }
    const docA = await addDoc(A, rentalA, "Asha agreement");
    const docB = await addDoc(B, rentalB, "Rahul secret ID");
    await db.collection("agreements").insertOne({ rental: rentalA._id, startDate: rentalA.moveInDate, endDate: new Date(Date.now() + 200 * 86400000), document: docA, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("appsettings").updateOne({ key: "app" }, { $set: { upiId: "landlord@okbank", upiPayeeName: "E2E Landlord" } }, { upsert: true });

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

    const admin = await adminSignIn();
    check("admin signs in", !!admin);

    console.log("\n== Invite (admin)");
    const tenantPage = `/tenants/${A._id}`;
    const card = await get(tenantPage, admin);
    check("tenant page shows the Tenant portal card, Not invited", card.status === 200 && card.body.includes("Tenant portal") && card.body.includes("Not invited"));
    const invite = async (t) => {
      const r = await callAction(`/tenants/${t._id}`, action("inviteTenantToPortal", "portal-actions"), [String(t._id), {}], admin);
      const link = /\/portal\/invite\/([A-Za-z0-9_-]{43})/.exec(r.body);
      const wa = /https:\/\/wa\.me\/(\d+)\?text=[^"\\]+/.exec(r.body);
      return { r, token: link?.[1] ?? null, wa: wa?.[0] ?? null, waPhone: wa?.[1] ?? null };
    };
    const invA = await invite(A);
    check("invite link created (APP_URL/portal/invite/<43-char token>)", !!invA.token && invA.r.body.includes(`${BASE}/portal/invite/`), invA.r.body.slice(0, 300));
    check("WhatsApp link prefilled to the tenant's phone", invA.waPhone === "919845011223" && /portal%2Finvite/.test(invA.wa ?? ""), invA.wa);
    const storedA = await tenants.findOne({ _id: A._id });
    check("only the SHA-256 hash of the token is stored", !!storedA.portal?.inviteTokenHash && storedA.portal.inviteTokenHash !== invA.token && !JSON.stringify(storedA).includes(invA.token));
    const exp = storedA.portal.inviteExpiresAt.getTime() - Date.now();
    check("invite expires in 7 days", exp > 6.9 * 86400000 && exp <= 7 * 86400000);
    check("card now says Invited", (await get(tenantPage, admin)).body.includes("Invited"));

    await tenants.updateOne({ _id: V._id }, { $set: { phone: "12" } });
    const invNoPhone = await invite(V);
    check("tenant without a valid phone -> 'Add a phone number first'", !invNoPhone.token && invNoPhone.r.body.includes("Add a phone number first"));

    console.log("\n== Accept invite");
    const invPage = await get(`/portal/invite/${invA.token}`);
    check("invite page: first name + property", invPage.status === 200 && text(invPage.body).includes("Welcome, Asha") && invPage.body.includes("Palm Grove Villa"));
    check("invite page is noindex + no-referrer", /noindex/.test(invPage.body) && /no-referrer/.test(invPage.body));
    const invForm = formWith(invPage.body, 'name="confirmPassword"');
    const weak = await submit(`/portal/invite/${invA.token}`, invForm, { password: "short", confirmPassword: "short" });
    check("weak password -> field error", weak.status === 200 && weak.body.includes("at least 8"));
    const digitsOnly = await submit(`/portal/invite/${invA.token}`, invForm, { password: "9845011223", confirmPassword: "9845011223" });
    check("phone number as password -> field error", digitsOnly.body.includes("phone number"));
    const mismatch = await submit(`/portal/invite/${invA.token}`, invForm, { password: "asha-garden-7", confirmPassword: "asha-garden-8" });
    check("mismatched confirm -> field error", mismatch.body.includes("Passwords do not match"));
    const okA = await submit(`/portal/invite/${invA.token}`, invForm, { password: "asha-garden-7", confirmPassword: "asha-garden-7" });
    let cookieA = cookieFrom(okA.res, "rentee_tenant");
    check("valid password -> signed in, redirect to /portal", okA.status === 303 && new URL(okA.location, BASE).pathname === "/portal" && !!cookieA, `${okA.status} ${okA.location}`);
    const setCookie = (okA.res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("rentee_tenant=")) ?? "";
    check("tenant cookie: HttpOnly, SameSite=lax, Path=/portal, 30 days, Secure in production", /HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie) && /Path=\/portal/i.test(setCookie) && /Max-Age=2592000/.test(setCookie) && /Secure/i.test(setCookie), setCookie);
    check("no admin cookie is set for a tenant", !cookieFrom(okA.res, "rentee_session"));
    const used = await get(`/portal/invite/${invA.token}`);
    check("used invite -> friendly error page", used.body.includes("Ask your landlord for a new link"));
    const reuse = await submit(`/portal/invite/${invA.token}`, invForm, { password: "another-pass-1", confirmPassword: "another-pass-1" });
    check("used invite can't set a password again", reuse.status === 200 && !cookieFrom(reuse.res, "rentee_tenant"));
    check("garbage token -> friendly error page", (await get("/portal/invite/not-a-token")).body.includes("Ask your landlord for a new link"));

    // B and C accept too.
    async function accept(t, password) {
      const inv = await invite(t);
      const page = await get(`/portal/invite/${inv.token}`);
      const r = await submit(`/portal/invite/${inv.token}`, formWith(page.body, 'name="confirmPassword"'), { password, confirmPassword: password });
      return cookieFrom(r.res, "rentee_tenant");
    }
    let cookieB = await accept(B, "rahul-lotus-9");
    const cookieC = await accept(C, "meera-cedar-5");
    check("tenants B and C activated", !!cookieB && !!cookieC);

    // Expired invite.
    const invV0 = await tenants.updateOne({ _id: V._id }, { $set: { phone: "097300 22110" } });
    void invV0;
    const invV = await invite(V);
    await tenants.updateOne({ _id: V._id }, { $set: { "portal.inviteExpiresAt": new Date(Date.now() - 1000) } });
    check("expired invite -> friendly error page", (await get(`/portal/invite/${invV.token}`)).body.includes("Ask your landlord for a new link"));
    check("admin card shows Invite expired", (await get(`/tenants/${V._id}`, admin)).body.includes("Invite expired"));

    console.log("\n== Login");
    const loginPage = await get("/portal/login");
    const loginForm = formWith(loginPage.body, 'name="phone"');
    check("login page has Forgot password text", text(loginPage.body).includes("Ask your landlord to send a new invite link."));
    const login = (phone, password, ip = freshIp()) => submit("/portal/login", loginForm, { phone, password }, null, { ip });
    const l1 = await login("98450 11223", "asha-garden-7");
    check("login with 10-digit phone -> /portal", l1.status === 303 && new URL(l1.location, BASE).pathname === "/portal" && !!cookieFrom(l1.res, "rentee_tenant"));
    const l2 = await login("+91-98450-11223", "asha-garden-7");
    check("login with +91 format works too", l2.status === 303);
    cookieA = cookieFrom(l2.res, "rentee_tenant") ?? cookieA;
    const l3 = await login("98450 11223", "wrong-password");
    check("wrong password -> 'Invalid phone or password'", l3.status === 200 && l3.body.includes("Invalid phone or password"));
    const l4 = await login("90000 00000", "whatever-123");
    check("unknown phone -> same generic message", l4.body.includes("Invalid phone or password"));
    const l5 = await login("98200 77889", "meera-cedar-5"); // C, before lockout
    check("tenant C signs in", l5.status === 303);
    let lastLock = null;
    for (let i = 0; i < 5; i++) lastLock = await login("98200 77889", `bad-${i}-password`);
    check("5 failures -> 15-minute lock", /Too many failed sign-in attempts. Please try again in 15 minutes/.test(lastLock.body), text(lastLock.body).match(/Too many[^<]{0,80}/)?.[0]);
    const afterLock = await login("98200 77889", "meera-cedar-5");
    check("correct password refused while locked", afterLock.status === 200 && /Too many failed/.test(afterLock.body));
    const lsLog = await tenants.findOne({ _id: A._id });
    check("lastLoginAt recorded", !!lsLog.portal.lastLoginAt);

    console.log("\n== Portal pages (tenant A)");
    const pages = ["/portal", "/portal/payments", "/portal/maintenance", "/portal/maintenance/new", "/portal/documents", "/portal/profile"];
    const htmlA = {};
    for (const p of pages) {
      const r = await get(p, cookieA);
      htmlA[p] = r.body;
      check(`A: ${p} -> 200`, r.status === 200, `${r.status} ${r.location}`);
    }
    const allA = Object.values(htmlA).join("\n");
    check("A sees their own property", htmlA["/portal"].includes("Palm Grove Villa"));
    check("A never sees B's name, property or document", !allA.includes("Rahul") && !allA.includes("Lotus Apartment") && !allA.includes("Rahul secret ID"));
    check("A never sees admin-only fields (ID number, notes)", !allA.includes("XXXX-XXXX-4521"));
    check("home shows overdue + Pay by UPI QR and button", htmlA["/portal"].includes("Overdue") && htmlA["/portal"].includes("upi://pay?pa=landlord%40okbank") && htmlA["/portal"].includes("Pay with UPI app"), [htmlA["/portal"].includes("Overdue"), htmlA["/portal"].includes("upi://pay?pa=landlord%40okbank"), htmlA["/portal"].includes("Pay with UPI app"), /upi:[^"]{0,80}/.exec(htmlA["/portal"])?.[0]].join(" "));
    const dueNow = /Due now: ([^<]+)</.exec(text(htmlA["/portal"]))?.[1];
    const am = /upi:\/\/pay\?[^"]*am=([\d.]+)/.exec(decode(htmlA["/portal"]))?.[1];
    check("UPI amount = amount due now", !!dueNow && !!am && dueNow.replace(/[^\d.]/g, "").replace(/\.00$/, "") === am.replace(/\.00$/, ""), `${dueNow} vs ${am}`);
    check("home shows deposit status", htmlA["/portal"].includes("Security deposit") && htmlA["/portal"].includes("Quoted"));
    check("payments page: schedule + receipts + deposit receipts", htmlA["/portal/payments"].includes("Rent schedule") && htmlA["/portal/payments"].includes("/portal/api/receipts/") && htmlA["/portal/payments"].includes("/portal/api/deposit-receipts/"));
    check("documents page lists A's agreement + document", htmlA["/portal/documents"].includes("Rental agreements") && htmlA["/portal/documents"].includes("Asha agreement"));
    check("maintenance: A sees the landlord's request for their home", htmlA["/portal/maintenance"].includes("Leaking kitchen tap"));
    const homeC = await get("/portal", cookieC);
    check("moved-out rental shown read-only under Past", homeC.status === 200 && homeC.body.includes("Past") && homeC.body.includes("Cedar House") && !homeC.body.includes("Pay with UPI app"));

    console.log("\n== Maintenance (tenant B, with photo)");
    await get("/portal/payments", cookieB); // opens B's deposit ledger (lazily created)
    const newB = await get("/portal/maintenance/new", cookieB);
    const mForm = formWith(newB.body, 'name="title"');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
    const notImage = await submit("/portal/maintenance/new", mForm, { title: "Fake photo", description: "", priority: "low" }, cookieB, {
      files: { photo: { bytes: Buffer.from("MZ this is an exe"), type: "image/png", name: "x.png" } },
    });
    check("non-image photo -> field error, nothing saved", notImage.status === 200 && /not a valid image/.test(notImage.body) && !(await db.collection("maintenances").findOne({ title: "Fake photo" })));
    const mB = await submit("/portal/maintenance/new", mForm, { title: "Bathroom geyser broken", description: "No hot water since Monday", priority: "high" }, cookieB, {
      files: { photo: { bytes: png, type: "image/png", name: "geyser.png" } },
    });
    check("request with photo -> redirect to list", mB.status === 303 && (mB.location ?? "").includes("/portal/maintenance"), `${mB.status} ${mB.location}`);
    const reqB = await db.collection("maintenances").findOne({ title: "Bathroom geyser broken" });
    check("stored as tenant request on B's property, status open, photo encrypted", !!reqB && reqB.createdBy === "tenant" && String(reqB.tenant) === String(B._id) && String(reqB.property) === String(rentalB.property) && reqB.status === "open" && !!reqB.photo);
    const chunk = reqB ? await db.collection("maintenance.chunks").findOne({ files_id: reqB.photo }) : null;
    check("photo bytes at rest are not the plain PNG", !!chunk && !Buffer.from(chunk.data.buffer).subarray(0, 8).equals(png.subarray(0, 8)));
    check("B's list shows it as Open", (await get("/portal/maintenance", cookieB)).body.includes("Bathroom geyser broken"));
    const photoB = await getBytes(`/portal/api/maintenance/${reqB._id}/photo`, cookieB);
    check("B can open their photo (decrypted)", photoB.status === 200 && photoB.type === "image/png" && photoB.bytes.equals(png));
    check("admin notification maintenance_tenant_request", !!(await db.collection("notifications").findOne({ type: "maintenance_tenant_request", maintenance: reqB._id })));
    const adminM = await get("/maintenance", admin);
    check("admin maintenance list shows 'From tenant' badge", adminM.body.includes("From tenant") && adminM.body.includes("Bathroom geyser broken"));
    check("admin can open the tenant's photo", (await getBytes(`/api/maintenance/${reqB._id}/photo`, admin)).status === 200);

    console.log("\n== Isolation: tenant A guessing tenant B's ids");
    const payB = await db.collection("payments").findOne({ rental: rentalB._id });
    const payA = await db.collection("payments").findOne({ rental: rentalA._id });
    const depB = await db.collection("depositentries").findOne({ rental: rentalB._id, kind: "received" });
    const depA = await db.collection("depositentries").findOne({ rental: rentalA._id, kind: "received" });
    check("fixtures: B has payment + deposit entry, A too", !!payB && !!depB && !!payA && !!depA);
    const own = await getBytes(`/portal/api/receipts/${payA._id}`, cookieA);
    check("A: own receipt PDF -> 200", own.status === 200 && own.type === "application/pdf" && own.bytes.subarray(0, 5).toString() === "%PDF-");
    check("A: own deposit receipt -> 200", (await getBytes(`/portal/api/deposit-receipts/${depA._id}`, cookieA)).status === 200);
    check("A: own document -> 200", (await getBytes(`/portal/api/documents/${docA}`, cookieA)).status === 200);
    for (const [label, p] of [
      ["B's rent receipt", `/portal/api/receipts/${payB._id}`],
      ["B's deposit receipt", `/portal/api/deposit-receipts/${depB._id}`],
      ["B's document", `/portal/api/documents/${docB}`],
      ["B's maintenance photo", `/portal/api/maintenance/${reqB._id}/photo`],
      ["A's own payment id as deposit receipt", `/portal/api/deposit-receipts/${payA._id}`],
      ["random id", `/portal/api/receipts/${new ObjectId()}`],
      ["malformed id", `/portal/api/documents/..%2F..%2Fetc`],
    ]) {
      const r = await getBytes(p, cookieA);
      check(`A -> ${label}: 404`, r.status === 404, `${r.status}`);
    }
    check("A's maintenance list doesn't include B's request", !(await get("/portal/maintenance", cookieA)).body.includes("Bathroom geyser"));
    // A submits B's rental id to the maintenance form.
    const newA = await get("/portal/maintenance/new", cookieA);
    const crossM = await submit("/portal/maintenance/new", formWith(newA.body, 'name="title"'), { rentalId: String(rentalB._id), title: "Cross tenant request", priority: "low" }, cookieA);
    check("A can't raise a request on B's rental", crossM.status === 200 && !(await db.collection("maintenances").findOne({ title: "Cross tenant request" })));
    // A submits B's occupant id to edit/remove.
    const occB = new ObjectId();
    await tenants.updateOne({ _id: B._id }, { $push: { occupants: { _id: occB, name: "Bob Roommate", phone: "", relation: "roommate", idLast4: "1111", notes: "", emergency: false } } });
    const profA = await get("/portal/profile", cookieA);
    const addForm = formsIn(profA.body).find((f) => f.includes('name="relation"') && !f.includes('name="occupantId"'));
    const addOcc = await submit("/portal/profile", addForm, { name: "Kiran", relation: "family", phone: "", idLast4: "4521", notes: "" }, cookieA);
    check("A adds an occupant", addOcc.status === 200 && (await tenants.findOne({ _id: A._id })).occupants.some((o) => o.name === "Kiran"));
    const profA2 = await get("/portal/profile", cookieA);
    const editForm = formsIn(profA2.body).find((f) => f.includes('name="occupantId"'));
    const crossEdit = await submit("/portal/profile", editForm, { occupantId: String(occB), name: "Hacked", relation: "other", phone: "", idLast4: "", notes: "" }, cookieA);
    const bAfter = await tenants.findOne({ _id: B._id });
    check("A can't edit B's occupant by id", crossEdit.body.includes("Person not found") && bAfter.occupants.some((o) => o.name === "Bob Roommate") && !bAfter.occupants.some((o) => o.name === "Hacked"));
    check("B's occupant still there", (await tenants.findOne({ _id: B._id })).occupants.length === bAfter.occupants.length);

    console.log("\n== Tenant cookie on admin");
    for (const p of ["/dashboard", "/tenants", `/tenants/${A._id}`, "/payments", "/settings", "/notifications", "/maintenance"]) {
      const r = await get(p, cookieA);
      check(`tenant cookie on ${p} -> redirect /login`, isLoginRedirect(r), `${r.status} ${r.location}`);
    }
    for (const p of ["/api/notifications", `/api/receipts/${payA._id}`, `/api/documents/${docA}`, `/api/maintenance/${reqB._id}/photo`, `/api/deposit-receipts/${depA._id}`, "/api/reports/ledger"]) {
      const r = await get(p, cookieA);
      check(`tenant cookie on ${p} -> 401`, r.status === 401, `${r.status}`);
    }
    const tokenValue = cookieA.split("=").slice(1).join("=");
    const asAdminCookie = await get("/dashboard", `rentee_session=${tokenValue}`);
    check("tenant token in the admin cookie -> redirect /login", isLoginRedirect(asAdminCookie));
    const mcp = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { cookie: cookieA, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    check("tenant cookie on /api/mcp -> 401", mcp.status === 401);
    const mcpBearer = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenValue}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    check("tenant token as MCP bearer -> 401", mcpBearer.status === 401);
    // Admin server actions invoked directly with the tenant cookie.
    const beforeV = await tenants.findOne({ _id: V._id });
    const sa1 = await callAction(`/tenants/${V._id}`, action("inviteTenantToPortal", "portal-actions"), [String(V._id), {}], cookieA);
    check("admin action (invite) with tenant cookie -> denied", deniedAction(sa1) && !/portal\/invite\/[A-Za-z0-9_-]{43}/.test(sa1.body), `${sa1.status} ${sa1.location}`);
    // Through portal routes (which the middleware lets a tenant reach): the action isn't served
    // there and, if it were, requireUser() would refuse — either way nothing may change.
    await callAction("/portal/login", action("disableTenantPortal", "portal-actions"), [String(B._id)], cookieA);
    check("admin action (disable B) posted via a portal route with tenant cookie -> no effect", (await tenants.findOne({ _id: B._id })).portal.enabled === true);
    const sa2b = await callAction(`/tenants/${B._id}`, action("disableTenantPortal", "portal-actions"), [String(B._id)], cookieA);
    check("admin action (disable B) on its own page with tenant cookie -> denied", deniedAction(sa2b) && (await tenants.findOne({ _id: B._id })).portal.enabled === true, `${sa2b.status} ${sa2b.location}`);
    await callAction("/portal", action("deleteTenant", "tenants/actions"), [String(V._id)], cookieA);
    const sa3 = await callAction(`/tenants/${V._id}`, action("deleteTenant", "tenants/actions"), [String(V._id)], cookieA);
    check("admin action (delete tenant) with tenant cookie -> denied, tenant still exists", deniedAction(sa3) && !!(await tenants.findOne({ _id: V._id })), `${sa3.status}`);
    const afterV = await tenants.findOne({ _id: V._id });
    const bStill = await tenants.findOne({ _id: B._id });
    check("admin data unchanged by those calls", afterV.portal?.inviteTokenHash === beforeV.portal?.inviteTokenHash && bStill?.portal?.enabled === true);

    console.log("\n== Admin cookie on the portal");
    check("admin cookie on /portal -> redirect /portal/login", isLoginRedirect(await get("/portal", admin), "/portal/login"));
    check("admin cookie on /portal/api/... -> 401", (await get(`/portal/api/receipts/${payA._id}`, admin)).status === 401);
    const pa = await callAction("/dashboard", action("updatePortalEmail", "profile"), [{}, null], admin);
    check("portal action with admin cookie -> no change", (await tenants.findOne({ _id: A._id })).email === "asha.menon@example.com", `${pa.status}`);
    check("no cookie on /portal -> redirect /portal/login", isLoginRedirect(await get("/portal/payments"), "/portal/login"));

    console.log("\n== Profile");
    const prof = await get("/portal/profile", cookieA);
    const phoneForm = formWith(prof.body, 'name="phone"');
    const taken = await submit("/portal/profile", phoneForm, { phone: "99001 44556" }, cookieA); // B's login phone
    check("phone used by another account -> field error, not saved", taken.body.includes("already used by another account") && (await tenants.findOne({ _id: A._id })).phone === "+91 98450 11223");
    const emailForm = formWith(prof.body, 'name="email"');
    const em = await submit("/portal/profile", emailForm, { email: "asha.new@example.com" }, cookieA);
    check("email saved", em.body.includes("Email saved") && (await tenants.findOne({ _id: A._id })).email === "asha.new@example.com");
    const log = await db.collection("rentee_tenant_change_logs").findOne({ tenant: A._id, field: "email" });
    check("change log entry (from -> to)", !!log && log.from === "asha.menon@example.com" && log.to === "asha.new@example.com");
    check("admin notification tenant_details_changed", !!(await db.collection("notifications").findOne({ type: "tenant_details_changed", tenant: A._id })));
    const tp = await get(`/tenants/${A._id}`, admin);
    check("admin tenant page shows 'Recent changes by tenant'", tp.body.includes("Recent changes by tenant") && tp.body.includes("asha.new@example.com"));
    // Notifications survive a full sync (event types aren't auto-resolved).
    await db.collection("appsettings").updateOne({ key: "app" }, { $set: { notificationsSyncedAt: null } });
    await get("/dashboard", admin);
    await new Promise((r) => setTimeout(r, 1500));
    check("event notifications stay open after a full sync", (await db.collection("notifications").countDocuments({ type: { $in: ["tenant_details_changed", "maintenance_tenant_request"] }, resolvedAt: null })) >= 2);
    const newPhone = await submit("/portal/profile", phoneForm, { phone: "98450 22334" }, cookieA);
    const aNew = await tenants.findOne({ _id: A._id });
    check("phone change becomes the login phone", newPhone.body.includes("Phone saved") && aNew.portal.loginPhone === "919845022334");
    check("login with the new phone works", (await login("9845022334", "asha-garden-7")).status === 303);

    console.log("\n== UPI off");
    await db.collection("appsettings").updateOne({ key: "app" }, { $set: { upiId: "" } });
    const noUpi = await get("/portal", cookieA);
    check("UPI not set -> pay section hidden", noUpi.status === 200 && !noUpi.body.includes("upi://pay") && noUpi.body.includes("Due now"));

    console.log("\n== Disable / enable");
    const dis = await callAction(`/tenants/${B._id}`, action("disableTenantPortal", "portal-actions"), [String(B._id)], admin);
    const bDis = await tenants.findOne({ _id: B._id });
    check("admin disables B", dis.status === 200 && bDis.portal.enabled === false);
    check("B's existing session ends", isLoginRedirect(await get("/portal", cookieB), "/portal/login"));
    check("B's file routes refuse the old session", (await getBytes(`/portal/api/maintenance/${reqB._id}/photo`, cookieB)).status === 401);
    const bLogin = await login("99001 44556", "rahul-lotus-9");
    check("B's login refused while disabled", bLogin.status === 200 && bLogin.body.includes("Invalid phone or password"));
    check("admin card shows Disabled", (await get(`/tenants/${B._id}`, admin)).body.includes("Disabled"));
    await callAction(`/tenants/${B._id}`, action("enableTenantPortal", "portal-actions"), [String(B._id)], admin);
    check("old session still invalid after Enable", isLoginRedirect(await get("/portal", cookieB), "/portal/login"));
    const bBack = await login("99001 44556", "rahul-lotus-9");
    check("B can sign in again after Enable", bBack.status === 303);
    cookieB = cookieFrom(bBack.res, "rentee_tenant");

    console.log("\n== Change password ends other sessions");
    const profB = await get("/portal/profile", cookieB);
    const pwForm = formWith(profB.body, 'name="currentPassword"');
    const wrongCur = await submit("/portal/profile", pwForm, { currentPassword: "nope-nope-1", password: "rahul-new-11", confirmPassword: "rahul-new-11" }, cookieB);
    check("wrong current password -> field error", wrongCur.body.includes("Current password is incorrect"));
    const otherDevice = cookieB;
    const pw = await submit("/portal/profile", pwForm, { currentPassword: "rahul-lotus-9", password: "rahul-new-11", confirmPassword: "rahul-new-11" }, cookieB);
    const freshB = cookieFrom(pw.res, "rentee_tenant");
    check("password changed, this device gets a fresh session", pw.body.includes("Password changed") && !!freshB && (await get("/portal", freshB)).status === 200);
    check("other device signed out", isLoginRedirect(await get("/portal", otherDevice), "/portal/login"));

    console.log("\n== Logout");
    const home = await get("/portal", cookieA);
    const out = await submit("/portal", formWith(home.body, "Sign out"), {}, cookieA);
    const cleared = (out.res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("rentee_tenant="));
    check("sign out clears the tenant cookie and goes to /portal/login", out.status === 303 && (out.location ?? "").includes("/portal/login") && /Max-Age=0|rentee_tenant=;/.test(cleared ?? ""), `${out.status} ${cleared}`);

    if (KEEP_APP) {
      await db.collection("appsettings").updateOne({ key: "app" }, { $set: { upiId: "landlord@okbank" } });
      const shot = await login("9845022334", "asha-garden-7");
      // For screenshots: write session cookies, keep serving until a "stop" file appears (or 10 min).
      const keepDir = process.env.E2E_KEEP_DIR || os.tmpdir();
      const cookieFile = path.join(keepDir, "rentee-portal-e2e-cookies.json");
      const stopFile = path.join(keepDir, "rentee-portal-e2e-stop");
      fs.rmSync(stopFile, { force: true });
      fs.writeFileSync(cookieFile, JSON.stringify({ tenant: cookieFrom(shot.res, "rentee_tenant"), admin, tenantId: String(A._id), base: BASE }));
      console.log(`\n[e2e] app kept running at ${BASE}; cookies in ${cookieFile}; create ${stopFile} to stop`);
      for (let i = 0; i < 1200 && !fs.existsSync(stopFile); i++) await new Promise((r) => setTimeout(r, 500));
      fs.rmSync(cookieFile, { force: true });
      fs.rmSync(stopFile, { force: true });
    }
  } finally {
    await client.close().catch(() => undefined);
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

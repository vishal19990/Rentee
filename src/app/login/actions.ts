"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import {
  EMAIL_MAX_FAILURES,
  IP_MAX_FAILURES,
  afterFailure,
  clientIp,
  lockMinutesLeft,
  lockedMessage,
  type Throttle,
} from "@/lib/login-throttle";
import { TURNSTILE_FIELD, TURNSTILE_MESSAGES, turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import { loginSchema, parseForm, type ActionState } from "@/lib/validation";
import { LoginThrottle } from "@/models/LoginThrottle";
import { User } from "@/models/User";

// bcrypt hash of a random string: compared against when the email is unknown so that
// response time does not reveal which emails exist.
const DUMMY_HASH = "$2b$12$jPKY.uKnjDsaERrJK0ENDOaKSThUVufnTm7JAPCGHDK54NWH.Omeq";

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !next.startsWith("/login")
    ? next
    : "/dashboard";
}

async function readThrottle(key: string): Promise<Throttle | null> {
  const t = await LoginThrottle.findOne({ key }).select("count firstAt lockedUntil").lean();
  return t ? { count: t.count, firstAt: t.firstAt, lockedUntil: t.lockedUntil ?? null } : null;
}

async function recordFailure(key: string, max: number, now: Date): Promise<void> {
  const next = afterFailure(await readThrottle(key), now, max);
  await LoginThrottle.updateOne({ key }, { $set: { ...next, updatedAt: now } }, { upsert: true });
}

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseForm(loginSchema, fd);
  if (!parsed.success) return parsed.state;
  const { email, password } = parsed.data;

  await connectDB();
  const h = await headers();
  const now = new Date();
  const emailKey = `email:${email.toLowerCase()}`;
  const ipKey = `ip:${clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"))}`;

  // Locked out? Refuse before checking the password (the same answer for any email).
  const [emailT, ipT] = await Promise.all([readThrottle(emailKey), readThrottle(ipKey)]);
  const wait = Math.max(lockMinutesLeft(emailT, now), lockMinutesLeft(ipT, now));
  if (wait > 0) return { ok: false, message: lockedMessage(wait), values: { email } };

  // Cloudflare Turnstile (when configured): bots never get to try a password.
  if (turnstileSiteKey()) {
    const ip = clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
    const check = await verifyTurnstile(String(fd.get(TURNSTILE_FIELD) ?? ""), ip);
    if (!check.ok) return { ok: false, message: TURNSTILE_MESSAGES[check.reason], values: { email } };
  }

  const user = await User.findOne({ email }).lean();
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await Promise.all([recordFailure(emailKey, EMAIL_MAX_FAILURES, now), recordFailure(ipKey, IP_MAX_FAILURES, now)]);
    const nowLocked = lockMinutesLeft(await readThrottle(emailKey), now);
    return { ok: false, message: nowLocked > 0 ? lockedMessage(nowLocked) : "Invalid email or password", values: { email } };
  }

  // A successful sign-in clears this account's failure count.
  await LoginThrottle.deleteOne({ key: emailKey });
  await createSession({ id: String(user._id), name: user.name, email: user.email });
  redirect(safeNext(fd.get("next")));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

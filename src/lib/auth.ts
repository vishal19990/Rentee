import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidObjectId } from "mongoose";
import { connectDB } from "./db";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from "./session";
import { User } from "@/models/User";

export type CurrentUser = { id: string; name: string; email: string };

const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(user: CurrentUser): Promise<void> {
  const token = await signSession({ sub: user.id, name: user.name, email: user.email });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Returns the signed-in admin (verified against the database) or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session || !isValidObjectId(session.sub)) return null;
  await connectDB();
  const user = await User.findById(session.sub).select("name email").lean();
  if (!user) return null;
  return { id: String(user._id), name: user.name, email: user.email };
}

/**
 * Guard for every page, route handler and server action (except login).
 * Redirects to /login when there is no valid session.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

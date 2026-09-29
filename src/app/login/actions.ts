"use server";

import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { loginSchema, parseForm, type ActionState } from "@/lib/validation";
import { User } from "@/models/User";

// bcrypt hash of a random string: compared against when the email is unknown so that
// response time does not reveal which emails exist.
const DUMMY_HASH = "$2b$12$jPKY.uKnjDsaERrJK0ENDOaKSThUVufnTm7JAPCGHDK54NWH.Omeq";

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !next.startsWith("/login")
    ? next
    : "/dashboard";
}

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseForm(loginSchema, fd);
  if (!parsed.success) return parsed.state;
  const { email, password } = parsed.data;

  await connectDB();
  const user = await User.findOne({ email }).lean();
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    return { ok: false, message: "Invalid email or password", values: { email } };
  }

  await createSession({ id: String(user._id), name: user.name, email: user.email });
  redirect(safeNext(fd.get("next")));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

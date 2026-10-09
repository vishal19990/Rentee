import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ActionForm, Hidden, SubmitButton, TextField } from "@/components/form";
import { Logo } from "@/components/shell";
import { login } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-slate-950 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-600/40 via-violet-500/20 to-transparent blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo light size="lg" />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/30 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to manage your properties.</p>
          <ActionForm action={login} className="mt-6 space-y-4">
            <Hidden name="next" value={next ?? ""} />
            <TextField name="email" label="Email" type="email" autoComplete="email" placeholder="you@example.com" />
            <TextField name="password" label="Password" type="password" autoComplete="current-password" />
            <SubmitButton className="w-full" pendingLabel="Signing in…">
              Sign in
            </SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Rentee · Rental property management</p>
      </div>
    </div>
  );
}

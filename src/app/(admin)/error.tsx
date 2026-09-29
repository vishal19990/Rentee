"use client";

import { IconAlert } from "@/components/icons";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
        <IconAlert />
      </span>
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-500">
        {error.message?.includes("ECONNREFUSED") || error.message?.includes("Server selection")
          ? "Could not reach the database. Is MongoDB running?"
          : "An unexpected error occurred while loading this page."}
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn btn-primary mt-6">
        Try again
      </button>
    </div>
  );
}

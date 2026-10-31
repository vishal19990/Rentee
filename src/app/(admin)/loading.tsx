import { SkeletonCard } from "@/components/skeleton";

/**
 * Instant placeholder for every admin page while its data loads on the server. The sidebar
 * (layout) stays put; only the page area shows this skeleton, then streams in the real page.
 */
export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-slate-200" />
          <div className="h-4 w-72 max-w-full rounded bg-slate-200/70" />
        </div>
        <div className="hidden h-9 w-32 rounded-lg bg-slate-200 sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="h-6 w-28 rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <SkeletonCard key={i} rows={4} />
        ))}
      </div>
    </div>
  );
}

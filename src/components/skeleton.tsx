import clsx from "clsx";

/** A card-shaped loading placeholder with `rows` list lines (page loading and Suspense fallbacks). */
export function SkeletonCard({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx("card animate-pulse p-5", className)} aria-hidden>
      <div className="mb-4 h-4 w-36 rounded bg-slate-200" />
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-8 shrink-0 rounded-lg bg-slate-200/80" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-slate-200" />
              <div className="h-2.5 w-1/3 rounded bg-slate-200/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

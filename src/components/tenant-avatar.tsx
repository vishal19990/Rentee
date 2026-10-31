import clsx from "clsx";

/** URL of a tenant's profile photo; the photo id busts caches when the photo changes. */
export function tenantPhotoUrl(tenantId: string, photoId: string): string {
  return `/api/tenants/${tenantId}/photo?v=${photoId}`;
}

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-xl",
  xl: "size-24 text-3xl",
} as const;

// Soft colour per tenant (stable: picked from the name) for the initials fallback.
const TONES = [
  "bg-brand-100 text-brand-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
];

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/**
 * Round tenant avatar: their profile photo, or coloured initials when there is none.
 * Works in server and client components.
 */
export function TenantAvatar({
  tenantId,
  photo,
  name,
  size = "sm",
  className,
}: {
  tenantId: string;
  photo?: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const base = clsx("inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold ring-1 ring-black/5", SIZES[size], className);
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={tenantPhotoUrl(tenantId, photo)} alt={name} loading="lazy" decoding="async" className={clsx(base, "object-cover")} />
    );
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={clsx(base, TONES[h % TONES.length])} aria-hidden>
      {initials(name)}
    </span>
  );
}

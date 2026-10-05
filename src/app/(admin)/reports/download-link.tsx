/** A plain download link to an export route (not a Next <Link>: no prefetching of file downloads). */
export function DownloadLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <a href={href} download className={`btn btn-sm ${primary ? "btn-primary" : "btn-secondary"}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
        <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
      </svg>
      {label}
    </a>
  );
}

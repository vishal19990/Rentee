import clsx from "clsx";

/**
 * Rentee brand mark and wordmark, recreated in code from the logo artwork
 * (public/brand/rentee-logo.png) so it stays crisp at any size and can switch to a
 * light variant on dark backgrounds. Gradients are CSS (not SVG <defs>) so several
 * copies on one page, some hidden, never break each other.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-[28%] shadow-lg shadow-brand-900/30",
        "bg-[linear-gradient(135deg,#3b63e6_0%,#4a4be0_45%,#6a4ee8_70%,#d58ad8_100%)]",
        className ?? "size-9",
      )}
      aria-hidden
    >
      {/* soft sheen + pink glow, as in the artwork */}
      <span className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgb(255_255_255/0.18),transparent_55%)]" />
      <span className="absolute inset-0 bg-[radial-gradient(70%_60%_at_100%_100%,rgb(236_160_220/0.55),transparent_70%)]" />
      <svg viewBox="0 0 64 64" className="relative size-[86%]" fill="none" stroke="#ece8fb" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 47V29.5L32 14l19 15.5V47" strokeWidth="6" />
        <path d="M26.5 48V37.5a5.5 5.5 0 0 1 11 0V48" strokeWidth="5.5" strokeLinecap="butt" />
      </svg>
    </span>
  );
}

export function Wordmark({ light, className }: { light?: boolean; className?: string }) {
  return (
    <span className={clsx("font-brand leading-none font-extrabold tracking-tight", className ?? "text-xl")}>
      <span className={light ? "text-white" : "text-slate-950"}>Rent</span>
      <span
        className={clsx(
          "bg-clip-text text-transparent",
          light
            ? "bg-[linear-gradient(90deg,#8b9bff,#b79bff_55%,#f0a8de)]"
            : "bg-[linear-gradient(90deg,#5b63f2,#7c63ee_55%,#d98ad6)]",
        )}
      >
        ee
      </span>
    </span>
  );
}

/** Mark + wordmark lockup. `light` for dark backgrounds. */
export function Logo({ light, size = "md" }: { light?: boolean; size?: "md" | "lg" }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className={size === "lg" ? "size-11" : "size-9"} />
      <Wordmark light={light} className={size === "lg" ? "text-2xl" : "text-xl"} />
    </span>
  );
}

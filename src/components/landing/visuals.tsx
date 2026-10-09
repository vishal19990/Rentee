/**
 * Landing page artwork, drawn in code (SVG + HTML) so the page needs no external images.
 * All figures shown are illustrative sample data.
 */
import clsx from "clsx";
import { LogoMark } from "@/components/brand";

/** A row of stylised houses with a rupee coin and keys — the hero illustration. */
export function HousesIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 300" className={className} role="img" aria-label="Illustration of rental houses">
      <defs>
        <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#818cf8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#818cf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lp-wall-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e0e7ff" />
        </linearGradient>
        <linearGradient id="lp-wall-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef2ff" />
          <stop offset="1" stopColor="#c7d2fe" />
        </linearGradient>
        <linearGradient id="lp-roof" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#3730a3" />
        </linearGradient>
        <linearGradient id="lp-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      <ellipse cx="260" cy="150" rx="250" ry="140" fill="url(#lp-sky)" />
      <rect x="20" y="262" width="480" height="6" rx="3" fill="#c7d2fe" opacity="0.5" />

      {/* Left house */}
      <g>
        <rect x="52" y="168" width="120" height="96" rx="6" fill="url(#lp-wall-b)" />
        <path d="M40 174 112 118l72 56z" fill="url(#lp-roof)" />
        <rect x="98" y="214" width="28" height="50" rx="4" fill="#4338ca" />
        <rect x="66" y="188" width="24" height="22" rx="3" fill="#a5b4fc" />
        <rect x="136" y="188" width="24" height="22" rx="3" fill="#a5b4fc" />
      </g>

      {/* Middle building */}
      <g>
        <rect x="196" y="96" width="132" height="168" rx="8" fill="url(#lp-wall-a)" />
        <rect x="188" y="84" width="148" height="18" rx="6" fill="url(#lp-roof)" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => (
            <rect
              key={`${r}-${c}`}
              x={214 + c * 36}
              y={116 + r * 38}
              width="22"
              height="24"
              rx="3"
              fill={(r + c) % 3 === 0 ? "#fde68a" : "#c7d2fe"}
            />
          )),
        )}
        <rect x="248" y="226" width="28" height="38" rx="4" fill="#4338ca" />
      </g>

      {/* Right house */}
      <g>
        <rect x="352" y="182" width="112" height="82" rx="6" fill="url(#lp-wall-b)" />
        <path d="M340 188 408 136l68 52z" fill="url(#lp-roof)" />
        <rect x="370" y="204" width="26" height="22" rx="3" fill="#fde68a" />
        <rect x="420" y="220" width="26" height="44" rx="4" fill="#4338ca" />
        <rect x="430" y="146" width="12" height="26" rx="2" fill="#3730a3" />
      </g>

      {/* Rupee coin */}
      <g transform="translate(410 70)">
        <circle r="34" fill="url(#lp-coin)" />
        <circle r="26" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" />
        <text textAnchor="middle" dy="12" fontSize="34" fontWeight="700" fill="#92400e" fontFamily="ui-sans-serif, system-ui">
          ₹
        </text>
      </g>

      {/* Key */}
      <g transform="translate(92 70) rotate(-25)" fill="none" stroke="#f59e0b" strokeWidth="7" strokeLinecap="round">
        <circle r="16" />
        <path d="M16 0h46M50 0v12M60 0v9" />
      </g>

      {/* Sparkles */}
      {[
        [178, 60],
        [352, 44],
        [486, 150],
        [30, 140],
      ].map(([x, y]) => (
        <path key={`${x}`} d={`M${x} ${y - 7}v14M${x - 7} ${y}h14`} stroke="#a5b4fc" strokeWidth="2.5" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function Pill({ tone, children }: { tone: "green" | "amber" | "rose" | "indigo"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    amber: "bg-amber-50 text-amber-700 ring-amber-600/15",
    rose: "bg-rose-50 text-rose-700 ring-rose-600/15",
    indigo: "bg-brand-50 text-brand-700 ring-brand-600/15",
  };
  return <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", tones[tone])}>{children}</span>;
}

/** A browser-framed mock of the Rentee dashboard. */
export function DashboardMockup({ className }: { className?: string }) {
  const bars = [52, 64, 58, 72, 80, 92];
  return (
    <div className={clsx("overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 shadow-brand-950/40 ring-slate-900/10", className)} aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="size-2.5 rounded-full bg-rose-400" />
        <span className="size-2.5 rounded-full bg-amber-400" />
        <span className="size-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 hidden truncate rounded-md bg-white px-3 py-0.5 text-[10px] text-slate-400 ring-1 ring-slate-200 sm:block">
          rentee.app/dashboard
        </span>
      </div>
      <div className="flex">
        <div className="hidden w-28 shrink-0 space-y-1.5 bg-slate-950 p-3 sm:block">
          <div className="mb-3 flex items-center gap-1.5">
            <LogoMark className="size-4 shadow-none" />
            <span className="h-2 w-10 rounded bg-white/70" />
          </div>
          {[1, 0, 0, 0, 0, 0, 0].map((a, i) => (
            <div key={i} className={clsx("h-2 rounded", a ? "w-16 bg-white/60" : "w-14 bg-white/15")} />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold text-slate-900">Good morning 👋</div>
            <Pill tone="rose">3 overdue</Pill>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Occupancy", "6 / 7", "text-slate-900"],
              ["Collected", "₹1,84,000", "text-emerald-600"],
              ["Overdue", "₹27,500", "text-rose-600"],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-lg border border-slate-100 p-2">
                <div className="text-[9px] text-slate-400">{label}</div>
                <div className={clsx("text-[11px] font-bold tabular-nums sm:text-xs", tone)}>{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-slate-100 p-2">
            <div className="mb-1.5 text-[9px] text-slate-400">Income · last 6 months</div>
            <div className="flex h-16 items-end gap-1.5">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className={clsx("flex-1 rounded-t", i === bars.length - 1 ? "bg-brand-600" : "bg-brand-200")}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {[
              ["Palm Villa", "Ravi K.", "Paid", "green"],
              ["Lotus 2B", "Asha M.", "Partial", "amber"],
              ["Cedar House", "Imran S.", "Overdue", "rose"],
            ].map(([p, t, s, tone]) => (
              <div key={p} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-brand-50 text-[9px] font-bold text-brand-700">
                  {p[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-semibold text-slate-800">{p}</div>
                  <div className="truncate text-[9px] text-slate-400">{t}</div>
                </div>
                <Pill tone={tone as "green" | "amber" | "rose"}>{s}</Pill>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A deterministic QR-like pattern (decorative only — not a scannable code). */
function FakeQr({ className }: { className?: string }) {
  const n = 21;
  const cells: [number, number][] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const inFinder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
      if (!inFinder && ((x * 7 + y * 13 + x * y) % 5 < 2)) cells.push([x, y]);
    }
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" fill="#0f172a" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="#0f172a" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className={className} aria-hidden shapeRendering="crispEdges">
      <rect x="-1" y="-1" width={n + 2} height={n + 2} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0f172a" />
      ))}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  );
}

/** Phone showing a WhatsApp-style rent reminder with a UPI pay card. */
export function PhoneMockup({ className }: { className?: string }) {
  return (
    <div className={clsx("relative mx-auto w-64 rounded-[2.5rem] bg-slate-900 p-2.5 shadow-2xl shadow-brand-950/30", className)} aria-hidden>
      <div className="absolute top-3.5 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full bg-slate-900" />
      <div className="overflow-hidden rounded-[2rem] bg-[#efeae2]">
        <div className="flex items-center gap-2 bg-[#075e54] px-3 pt-7 pb-2.5 text-white">
          <span className="grid size-7 place-items-center rounded-full bg-white/20 text-[11px] font-bold">R</span>
          <div>
            <div className="text-[11px] font-semibold">Ravi Kumar</div>
            <div className="text-[9px] text-white/70">online</div>
          </div>
        </div>
        <div className="space-y-2 p-3">
          <div className="ml-auto max-w-[88%] rounded-xl rounded-tr-sm bg-[#d9fdd3] p-2.5 text-[10.5px] leading-snug text-slate-800 shadow-sm">
            Hi Ravi, a friendly reminder that rent of <b>₹15,000</b> for Palm Villa is pending for <b>Oct 2026</b> (due 5 Oct).
            <span className="mt-1 block text-[#027eb5] underline">Pay by UPI: rentee.app/p/…</span>
            <span className="mt-0.5 block text-right text-[9px] text-slate-500">10:24 ✓✓</span>
          </div>
          <div className="rounded-xl bg-white p-3 text-center shadow-sm">
            <div className="text-[10px] font-medium text-slate-500">Amount due</div>
            <div className="text-lg font-bold text-slate-900">₹15,000</div>
            <FakeQr className="mx-auto my-2 size-24" />
            <div className="rounded-lg bg-brand-600 py-1.5 text-[10px] font-semibold text-white">Pay with a UPI app</div>
          </div>
          <div className="max-w-[80%] rounded-xl rounded-tl-sm bg-white p-2.5 text-[10.5px] text-slate-800 shadow-sm">
            Paid just now 🙏
            <span className="mt-0.5 block text-right text-[9px] text-slate-500">10:31</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Profit report card with an income vs expenses chart. */
export function ProfitMockup({ className }: { className?: string }) {
  const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  const income = [70, 74, 78, 76, 84, 90];
  const expense = [22, 30, 18, 40, 20, 24];
  return (
    <div className={clsx("rounded-2xl bg-white p-5 shadow-2xl ring-1 shadow-brand-950/20 ring-slate-900/5", className)} aria-hidden>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">Profit · FY 2026-27</div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">₹6,48,500</div>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
          ↑ 12% vs last year
        </span>
      </div>
      <div className="mt-5 flex h-36 items-end gap-3">
        {months.map((m, i) => (
          <div key={m} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-28 w-full items-end justify-center gap-1">
              <div className="w-1/2 rounded-t bg-brand-500" style={{ height: `${income[i]}%` }} />
              <div className="w-1/2 rounded-t bg-amber-300" style={{ height: `${expense[i]}%` }} />
            </div>
            <span className="text-[10px] text-slate-400">{m}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brand-500" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-300" /> Expenses
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
        {[
          ["Excel", "bg-emerald-50 text-emerald-700"],
          ["PDF", "bg-rose-50 text-rose-700"],
          ["ITR summary", "bg-brand-50 text-brand-700"],
        ].map(([l, c]) => (
          <span key={l} className={clsx("rounded-lg py-1.5 text-[11px] font-semibold", c)}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Small floating cards that sit around the hero mockup. */
export function FloatingCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        "absolute rounded-xl bg-white/95 p-3 shadow-xl ring-1 shadow-brand-950/20 ring-slate-900/5 backdrop-blur motion-safe:animate-float",
        className,
      )}
      aria-hidden
    >
      {children}
    </div>
  );
}

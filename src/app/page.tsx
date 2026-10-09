import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  IconBell,
  IconBolt,
  IconCalendar,
  IconChart,
  IconCheck,
  IconFile,
  IconHome,
  IconMail,
  IconPhone,
  IconReceipt,
  IconUsers,
  IconWallet,
  IconWrench,
} from "@/components/icons";
import { DashboardMockup, FloatingCard, HousesIllustration, PhoneMockup, ProfitMockup } from "@/components/landing/visuals";
import { Logo } from "@/components/shell";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: "Rentee — rental management for landlords" },
  description:
    "Track houses, tenants, rent, deposits, expenses and enquiries in one place. WhatsApp reminders, UPI pay links, rent receipts and ITR-ready reports.",
};

const FEATURES = [
  { icon: IconHome, title: "Properties", text: "Every house with photos, rent, occupancy and its full history." },
  { icon: IconUsers, title: "Tenants & documents", text: "Contacts plus Aadhaar, PAN, agreement and police verification, stored safely." },
  { icon: IconFile, title: "Monthly rentals", text: "Move-in to move-out, rent increases from any month, nothing to re-enter." },
  { icon: IconWallet, title: "Rent tracking", text: "Paid, partial, overdue and upcoming — worked out automatically each month." },
  { icon: IconPhone, title: "WhatsApp reminders", text: "One click, or send to everyone due in one go. Your template, your words." },
  { icon: IconReceipt, title: "Rent receipts", text: "Numbered PDF receipts with amount in words, shared as a private link." },
  { icon: IconBolt, title: "Electricity & water", text: "Meter readings in, bill out — added to the month's rent automatically." },
  { icon: IconBell, title: "Smart alerts", text: "Overdue rent, due soon, move-outs, repairs and agreement renewals." },
  { icon: IconChart, title: "Expenses & profit", text: "Income minus spend per house, by financial year, with Excel export." },
  { icon: IconCalendar, title: "Agreements", text: "11-month agreements with one-click renewal and expiry reminders." },
  { icon: IconMail, title: "Enquiries", text: "Track every walk-in and call from first contact to tenant — or not." },
  { icon: IconWrench, title: "Maintenance", text: "Log repairs, track their status and turn costs into expenses." },
];

const STEPS = [
  { n: "01", title: "Add your houses", text: "Enter each property once — address, rent, photos and electricity rate." },
  { n: "02", title: "Move tenants in", text: "Create a rental with move-in date, rent, deposit and due day. Upload their documents." },
  { n: "03", title: "Collect & relax", text: "Rentee tracks every month, reminds tenants on WhatsApp and issues receipts when they pay." },
];

const FAQ = [
  {
    q: "Do my tenants need an account?",
    a: "No. Only you (and any admins you add) sign in. Tenants receive WhatsApp messages with private links to their receipt or pay page — no login, no app.",
  },
  {
    q: "Does Rentee collect rent on my behalf?",
    a: "No. Tenants pay you directly with any UPI app using your UPI ID. You record the payment in Rentee and it updates everything — dues, receipts and reports.",
  },
  {
    q: "Are WhatsApp messages sent automatically?",
    a: "Rentee prepares the message and opens WhatsApp for you; you press send. That keeps it free and keeps you in control of every message.",
  },
  {
    q: "Can I use it for my tax filing?",
    a: "The financial year summary shows total rent received, expenses by category and profit per property — download it as Excel or PDF for your CA.",
  },
  {
    q: "Is my data private?",
    a: "Everything sits behind your login. Documents and photos are never public; shared receipt and pay links reveal only what that tenant needs to see.",
  },
];

export default async function LandingPage() {
  const signedIn = Boolean(await verifySession((await cookies()).get(SESSION_COOKIE)?.value));
  const cta = signedIn ? { href: "/dashboard", label: "Open dashboard" } : { href: "/login", label: "Sign in" };

  return (
    <div className="bg-white text-slate-700">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-slate-950/70 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6" aria-label="Main">
          <Link href="/" aria-label="Rentee home">
            <Logo light />
          </Link>
          <div className="hidden items-center gap-8 text-sm font-medium text-slate-300 md:flex">
            <a href="#features" className="hover:text-white">
              Features
            </a>
            <a href="#how" className="hover:text-white">
              How it works
            </a>
            <a href="#faq" className="hover:text-white">
              FAQ
            </a>
          </div>
          <Link href={cta.href} className="btn bg-white text-slate-900 shadow-sm hover:bg-brand-50 focus-visible:ring-white/30">
            {cta.label}
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-slate-950 pt-28 pb-20 sm:pt-36 lg:pb-28">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-brand-600/30 blur-3xl" />
          <div className="absolute top-40 -right-40 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] bg-[size:48px_48px]" />
        </div>

        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-10">
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-brand-200 ring-1 ring-white/10">
              <span className="size-1.5 rounded-full bg-emerald-400" /> Built for Indian landlords · ₹ · UPI · WhatsApp
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">
              Your rentals,{" "}
              <span className="bg-gradient-to-r from-brand-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent">
                on autopilot.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-pretty text-slate-300 lg:mx-0">
              Rentee keeps every house, tenant and rupee in one place — and tells you exactly who owes what, when to remind them, and
              how much you actually made this year.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <Link href={cta.href} className="btn btn-primary w-full px-6 py-3 text-base sm:w-auto">
                {cta.label} →
              </Link>
              <a
                href="#features"
                className="btn w-full px-6 py-3 text-base text-white ring-1 ring-white/20 hover:bg-white/10 focus-visible:ring-white/30 sm:w-auto"
              >
                See what it does
              </a>
            </div>
            <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-400 lg:justify-start">
              {["No tenant app needed", "Receipts in one click", "ITR-ready reports"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <IconCheck className="size-4 text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <DashboardMockup className="lg:rotate-1" />
            <FloatingCard className="-bottom-6 -left-2 w-52 sm:-left-8">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                  <IconReceipt className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-900">Receipt sent</div>
                  <div className="truncate text-[10px] text-slate-500">RNT/2026-27/0042 · ₹15,000</div>
                </div>
              </div>
            </FloatingCard>
            <FloatingCard className="-top-6 right-0 w-56 [animation-delay:-3s] sm:-right-6">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-rose-100 text-rose-700">
                  <IconBell className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-900">Rent overdue</div>
                  <div className="truncate text-[10px] text-slate-500">Cedar House · ₹12,500 · Oct</div>
                </div>
              </div>
            </FloatingCard>
          </div>
        </div>
      </section>

      {/* Strip */}
      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 text-center sm:px-6 md:grid-cols-4">
          {[
            ["12", "modules in one app"],
            ["1 click", "WhatsApp reminder"],
            ["Live", "UPI pay links"],
            ["Apr–Mar", "financial-year reports"],
          ].map(([big, small]) => (
            <div key={small}>
              <div className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{big}</div>
              <div className="mt-1 text-sm text-slate-500">{small}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Everything in one place</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-slate-900 sm:text-4xl">
              Stop juggling notebooks, spreadsheets and chats
            </h2>
            <p className="mt-4 text-lg text-pretty text-slate-600">
              From the first enquiry to the final deposit refund, every step of renting a house is covered.
            </p>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="group rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-brand-200/60 transition group-hover:from-brand-600 group-hover:to-brand-700 group-hover:text-white">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Highlight: WhatsApp + UPI */}
      <section className="overflow-hidden bg-white py-20 sm:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
          <div className="relative order-2 lg:order-1">
            <div className="absolute inset-0 -z-10 mx-auto size-80 rounded-full bg-gradient-to-br from-emerald-200/60 to-brand-200/60 blur-3xl" aria-hidden />
            <PhoneMockup />
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-sm font-semibold tracking-wide text-emerald-600 uppercase">Get paid on time</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-slate-900 sm:text-4xl">
              A polite nudge on WhatsApp, a QR code to pay
            </h2>
            <p className="mt-4 text-lg text-pretty text-slate-600">
              Rentee writes the reminder for you — tenant name, house, months and exact amount — and adds a private UPI link. Tenants
              scan, pay, done.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                ["Bulk reminders", "Everyone overdue, one after another — with progress and skip."],
                ["Always the right amount", "Pay links show the live balance, including electricity and water."],
                ["Receipts they can keep", "Numbered PDF with amount in words — perfect for HRA claims."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                    <IconCheck className="size-3.5" />
                  </span>
                  <div>
                    <div className="font-semibold text-slate-900">{t}</div>
                    <div className="text-sm text-slate-600">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Highlight: reports */}
      <section className="bg-gradient-to-b from-brand-50/60 to-white py-20 sm:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Know your numbers</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-slate-900 sm:text-4xl">
              See what each house really earns
            </h2>
            <p className="mt-4 text-lg text-pretty text-slate-600">
              Log repairs, property tax and society charges as they happen. Rentee lines them up against rent received and gives you
              profit per property for the financial year — ready for your CA.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4">
              {[
                ["Tenant ledger", "Every month, payment and deposit entry"],
                ["Monthly collections", "Who paid, who didn't, at a glance"],
                ["FY summary", "Rent received for ITR, expenses by category"],
                ["Deposits", "Received, deducted, refunded — never negative"],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-card">
                  <div className="text-sm font-semibold text-slate-900">{t}</div>
                  <div className="mt-1 text-xs text-slate-500">{d}</div>
                </div>
              ))}
            </div>
          </div>
          <ProfitMockup className="lg:-rotate-1" />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">How it works</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-slate-900 sm:text-4xl">Set up in an afternoon</h2>
              <HousesIllustration className="mt-8 w-full max-w-md" />
            </div>
            <ol className="space-y-5 lg:col-span-3">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-5 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-6">
                  <span className="text-3xl font-bold text-brand-200 tabular-nums">{s.n}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{s.title}</h3>
                    <p className="mt-1 text-slate-600">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Questions, answered</h2>
          <div className="mt-12 space-y-3">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card open:shadow-pop">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                  {q}
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white px-4 py-20 sm:px-6">
        <div className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-3xl bg-slate-950 px-6 py-16 text-center sm:px-12">
          <div className="absolute -top-24 left-1/2 -z-10 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-brand-600/40 blur-3xl" aria-hidden />
          <h2 className="text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">Spend less time chasing rent</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-pretty text-slate-300">
            Everything you need to manage your houses, in one calm, organised place.
          </p>
          <Link href={cta.href} className="btn btn-primary mt-8 px-7 py-3 text-base">
            {cta.label} →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} Rentee · Rental management for landlords</p>
          <Link href={cta.href} className="link">
            {cta.label}
          </Link>
        </div>
      </footer>
    </div>
  );
}

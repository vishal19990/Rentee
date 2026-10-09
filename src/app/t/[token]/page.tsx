import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { syncRentalStatuses } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { verifyTourToken } from "@/lib/signed-links";
import { loadTourRooms, publicRoomUrls, startRoomOf } from "@/lib/tour-store";
import { publicTourInfo, shareLinkValid } from "@/lib/tours";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { Logo } from "@/components/brand";
import { TourDisplay } from "@/components/tour-display";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Virtual tour",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Public 360° tour, opened from a signed link (no login). Shows only listing details — name,
 * city, bedrooms/bathrooms, asking rent, Available/Occupied — never tenant data or the address.
 */
export default async function PublicTourPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = verifyTourToken(token);
  if (!v.ok) notFound();
  await connectDB();
  const p = await Property.findById(v.link.propertyId).select("name city bedrooms bathrooms monthlyRent archived tour").lean();
  if (!p || p.archived || !shareLinkValid(p.tour, v.link.version)) notFound();

  await syncRentalStatuses();
  const occupied = !!(await Rental.exists({ property: p._id, status: "active" }));
  const info = publicTourInfo(p, occupied);
  const rooms = await loadTourRooms(p._id, (roomId) => publicRoomUrls(token, roomId));
  const external = p.tour?.externalUrl ?? "";

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-6 sm:py-10">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{info.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {info.city} · {info.bedrooms} bed · {info.bathrooms} bath · {formatMoney(info.monthlyRent)} / month
          </p>
        </div>
        <span
          className={
            info.availability === "Available"
              ? "rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-600/20 ring-inset"
              : "rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-500/15 ring-inset"
          }
        >
          {info.availability}
        </span>
      </header>
      {rooms.length > 0 || external ? (
        <TourDisplay rooms={rooms} startRoomId={startRoomOf(rooms, p.tour?.startRoom)} externalUrl={external} propertyName={info.name} />
      ) : (
        <p className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">The tour isn&apos;t ready yet. Check back soon.</p>
      )}
      <footer className="mt-8 flex justify-center opacity-70">
        <Logo />
      </footer>
    </main>
  );
}

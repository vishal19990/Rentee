import Link from "next/link";
import { connectDB } from "@/lib/db";
import { toId } from "@/lib/data";
import { propertyNames } from "@/lib/enquiry-data";
import { OPEN_STATUSES, formatTime } from "@/lib/enquiries";
import { formatDate } from "@/lib/format";
import { addDays, toISODate } from "@/lib/rent";
import { Enquiry } from "@/models/Enquiry";
import { Card, EmptyState } from "./ui";
import { IconMail } from "./icons";

/** Dashboard card: open enquiries, follow-ups due today or overdue (max 5) and today's visits. */
export async function EnquiriesDashboardCard({ today, className }: { today: string; className?: string }) {
  await connectDB();
  const startOfToday = new Date(`${today}T00:00:00`); // local midnight, like localToday()
  const [y, m, d] = addDays(today, 1).split("-").map(Number);
  const startOfTomorrow = new Date(y, m - 1, d);
  const [openCount, followUps, followUpCount, visits] = await Promise.all([
    Enquiry.countDocuments({ status: { $in: OPEN_STATUSES } }),
    Enquiry.find({ status: { $in: OPEN_STATUSES }, followUpDate: { $ne: null, $lte: new Date(`${today}T00:00:00Z`) } })
      .sort({ followUpDate: 1 })
      .limit(5)
      .select("name property followUpDate")
      .lean(),
    Enquiry.countDocuments({ status: { $in: OPEN_STATUSES }, followUpDate: { $ne: null, $lte: new Date(`${today}T00:00:00Z`) } }),
    Enquiry.find({ status: { $in: OPEN_STATUSES }, visitAt: { $gte: startOfToday, $lt: startOfTomorrow } })
      .sort({ visitAt: 1 })
      .select("name property visitAt")
      .lean(),
  ]);
  const names = await propertyNames([...followUps, ...visits].map((e) => e.property));
  const where = (p: unknown) => (p ? (names.get(toId(p)) ?? "") : "Any property");

  return (
    <Card
      title="Enquiries"
      description={`${openCount} open · ${followUpCount} follow-up${followUpCount === 1 ? "" : "s"} due · ${visits.length} visit${visits.length === 1 ? "" : "s"} today`}
      className={className}
      bodyClassName="p-0"
      actions={
        <Link href="/enquiries" className="text-sm link">
          View all
        </Link>
      }
    >
      {followUps.length === 0 && visits.length === 0 ? (
        <EmptyState compact icon={<IconMail />} title="Nothing to follow up today" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {visits.map((e) => (
            <li key={`v-${toId(e._id)}`}>
              <Link href={`/enquiries/${toId(e._id)}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{e.name}</p>
                  <p className="truncate text-xs text-slate-500">{where(e.property)}</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-violet-700">Visit {formatTime(e.visitAt!)}</span>
              </Link>
            </li>
          ))}
          {followUps.map((e) => {
            const date = toISODate(e.followUpDate!);
            return (
              <li key={`f-${toId(e._id)}`}>
                <Link href={`/enquiries/${toId(e._id)}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{e.name}</p>
                    <p className="truncate text-xs text-slate-500">{where(e.property)}</p>
                  </div>
                  <span className={date < today ? "shrink-0 text-xs font-medium text-rose-600" : "shrink-0 text-xs font-medium text-amber-700"}>
                    {date < today ? `Follow-up overdue · ${formatDate(date)}` : "Follow up today"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

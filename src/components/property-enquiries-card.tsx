import Link from "next/link";
import { connectDB } from "@/lib/db";
import { toId } from "@/lib/data";
import { CLOSED_STATUSES, OPEN_STATUSES } from "@/lib/enquiries";
import { formatDate } from "@/lib/format";
import { localToday } from "@/lib/rent";
import { Enquiry } from "@/models/Enquiry";
import { ButtonLink, Card, EmptyState } from "./ui";
import { EnquiryStatusBadge } from "./enquiry-status-badge";
import { IconMail, IconPlus } from "./icons";

/** Property page card: open enquiries for this property plus the most recent closed ones. */
export async function PropertyEnquiriesCard({ propertyId }: { propertyId: string }) {
  await connectDB();
  const [open, closed] = await Promise.all([
    Enquiry.find({ property: propertyId, status: { $in: OPEN_STATUSES } }).sort({ createdAt: -1 }).limit(20).select("name status createdAt").lean(),
    Enquiry.find({ property: propertyId, status: { $in: CLOSED_STATUSES } }).sort({ outcomeAt: -1 }).limit(5).select("name status createdAt outcomeAt").lean(),
  ]);
  const rows = [...open, ...closed];
  return (
    <Card
      title="Enquiries"
      description={open.length ? `${open.length} open` : undefined}
      bodyClassName="p-0"
      actions={
        <ButtonLink href={`/enquiries/new?propertyId=${propertyId}`} variant="secondary" size="sm">
          <IconPlus className="size-3.5" /> New
        </ButtonLink>
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon={<IconMail />} title="No enquiries yet" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((e) => (
            <li key={toId(e._id)}>
              <Link href={`/enquiries/${toId(e._id)}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{e.name}</p>
                  <p className="text-xs text-slate-500">{formatDate(localToday(e.createdAt))}</p>
                </div>
                <EnquiryStatusBadge status={e.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

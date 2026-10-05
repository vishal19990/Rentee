import { STATUS_LABEL, type EnquiryStatus } from "@/lib/enquiries";
import { Badge, type BadgeTone } from "./ui";

const TONE: Record<EnquiryStatus, BadgeTone> = {
  new: "brand",
  contacted: "sky",
  visit_scheduled: "violet",
  visited: "amber",
  accepted: "emerald",
  rejected: "rose",
  declined: "slate",
  no_response: "slate",
  property_let: "slate",
};

export function EnquiryStatusBadge({ status }: { status: string }) {
  const s = status as EnquiryStatus;
  return (
    <Badge tone={TONE[s] ?? "slate"} dot>
      {STATUS_LABEL[s] ?? status}
    </Badge>
  );
}

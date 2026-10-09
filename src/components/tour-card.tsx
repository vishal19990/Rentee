import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { plural } from "@/lib/format";
import { adminRoomUrls, startRoomOf, tourShareUrl } from "@/lib/tour-store";
import { TourRoom } from "@/models/TourRoom";
import { TourShareControls } from "./tour-share";
import { ButtonLink, Card, EmptyState } from "./ui";
import { IconImage } from "./icons";

type TourSettings = { enabled?: boolean | null; shareVersion?: number | null; externalUrl?: string | null; startRoom?: unknown } | null | undefined;

/** "Virtual tour" card on the property page: cover, room count, open/edit, sharing. */
export async function TourCard({ propertyId, propertyName, tour }: { propertyId: string; propertyName: string; tour: TourSettings }) {
  await connectDB();
  const rooms = (await TourRoom.find({ property: new Types.ObjectId(propertyId) }).sort({ order: 1, _id: 1 }).select("_id").lean()).map((r) => ({
    id: String(r._id),
  }));
  const external = tour?.externalUrl || "";
  const has = rooms.length > 0 || !!external;
  const start = startRoomOf(rooms, tour?.startRoom);
  const url = has && tour?.enabled ? await tourShareUrl(propertyId, tour?.shareVersion ?? 0) : "";

  return (
    <Card
      title="Virtual tour"
      actions={
        has ? (
          <ButtonLink href={`/properties/${propertyId}/tour`} variant="secondary" size="sm">
            Edit tour
          </ButtonLink>
        ) : undefined
      }
      bodyClassName={has ? "p-5" : "p-0"}
    >
      {has ? (
        <div className="space-y-4">
          {start ? (
            <a href={`/properties/${propertyId}/tour/view`} className="block overflow-hidden rounded-xl ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route */}
              <img src={adminRoomUrls(start).thumb} alt={`${propertyName} tour cover`} className="aspect-[2/1] w-full object-cover" />
            </a>
          ) : null}
          <p className="text-sm text-slate-600">
            {rooms.length > 0 ? `${plural(rooms.length, "room")} in 360°` : "No 360° rooms"}
            {external ? " · external tour" : ""}
          </p>
          <ButtonLink href={`/properties/${propertyId}/tour/view`} size="sm">
            Open tour
          </ButtonLink>
          <div className="border-t border-slate-100 pt-4">
            <TourShareControls propertyId={propertyId} propertyName={propertyName} enabled={!!tour?.enabled} url={url} />
          </div>
        </div>
      ) : (
        <EmptyState
          compact
          icon={<IconImage />}
          title="No virtual tour yet"
          description="Let people walk through the house in 360° before they visit."
          action={
            <ButtonLink href={`/properties/${propertyId}/tour`} size="sm">
              Create tour
            </ButtonLink>
          }
        />
      )}
    </Card>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { loadTourRooms, startRoomOf } from "@/lib/tour-store";
import { Property } from "@/models/Property";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { IconImage, IconPencil } from "@/components/icons";
import { TourDisplay } from "@/components/tour-display";

export const metadata: Metadata = { title: "Virtual tour" };

/** Admin "Open tour": the tour as visitors see it. */
export default async function TourViewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const p = await Property.findById(_id).select("name city tour").lean();
  if (!p) notFound();
  const rooms = await loadTourRooms(_id);
  const external = p.tour?.externalUrl ?? "";

  return (
    <>
      <PageHeader
        back={{ href: `/properties/${id}`, label: p.name }}
        title={`${p.name} — virtual tour`}
        description={p.city}
        actions={
          <ButtonLink href={`/properties/${id}/tour`} variant="secondary">
            <IconPencil className="size-4" /> Edit tour
          </ButtonLink>
        }
      />
      {rooms.length > 0 || external ? (
        <TourDisplay rooms={rooms} startRoomId={startRoomOf(rooms, p.tour?.startRoom)} externalUrl={external} propertyName={p.name} />
      ) : (
        <Card bodyClassName="p-0">
          <EmptyState
            icon={<IconImage />}
            title="No virtual tour yet"
            action={
              <ButtonLink href={`/properties/${id}/tour`} size="sm">
                Create tour
              </ButtonLink>
            }
          />
        </Card>
      )}
    </>
  );
}

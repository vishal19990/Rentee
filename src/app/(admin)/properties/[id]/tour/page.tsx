import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { loadTourRooms, startRoomOf, tourShareUrl } from "@/lib/tour-store";
import { MAX_TOUR_ROOMS } from "@/lib/tours";
import { Property } from "@/models/Property";
import { ActionForm, ConfirmAction, SubmitButton, TextField } from "@/components/form";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { IconImage } from "@/components/icons";
import { TourShareControls } from "@/components/tour-share";
import { AddRoomForm } from "@/components/tour-upload";
import { addSampleTourAction, addTourRoom, setExternalTourUrl } from "./actions";
import { TourEditor } from "./tour-editor";

export const metadata: Metadata = { title: "Edit virtual tour" };

export default async function TourEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) notFound();
  await connectDB();
  const p = await Property.findById(_id).select("name city tour").lean();
  if (!p) notFound();

  const rooms = await loadTourRooms(_id);
  const startRoomId = startRoomOf(rooms, p.tour?.startRoom);
  const external = p.tour?.externalUrl ?? "";
  const url = p.tour?.enabled ? await tourShareUrl(id, p.tour?.shareVersion ?? 0) : "";

  return (
    <>
      <PageHeader
        back={{ href: `/properties/${id}`, label: p.name }}
        title="Virtual tour"
        description="360° photos of each room, linked so visitors can walk from room to room."
        actions={
          rooms.length > 0 || external ? (
            <ButtonLink href={`/properties/${id}/tour/view`} variant="secondary">
              Open tour
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {rooms.length > 0 ? (
          <TourEditor propertyId={id} rooms={rooms} startRoomId={startRoomId} />
        ) : (
          <Card bodyClassName="p-0">
            <EmptyState
              icon={<IconImage />}
              title="No rooms yet"
              description="Add a 360° photo of each room below, or try the built-in sample tour (Living room, Bedroom, Kitchen) to see how it works."
              action={
                <ConfirmAction
                  action={addSampleTourAction.bind(null, id)}
                  label="Use sample tour"
                  prompt="Add 3 demo rooms?"
                  confirmLabel="Add sample"
                  variant="primary"
                />
              }
            />
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card
            title="Add room"
            description={`Up to ${MAX_TOUR_ROOMS} rooms. Large photos are resized to 6144 × 3072 before upload.`}
          >
            <AddRoomForm action={addTourRoom.bind(null, id)} />
          </Card>

          <div className="space-y-6">
            <Card title="Share" description="A link for people who enquire. Turn it off or reset it to stop old links working.">
              <TourShareControls propertyId={id} propertyName={p.name} enabled={!!p.tour?.enabled} url={url} />
            </Card>
            <Card title="External tour" description="Optional: a Matterport, Kuula, YouTube or Google Maps embed link.">
              <ActionForm action={setExternalTourUrl.bind(null, id)} className="space-y-3">
                <TextField name="externalUrl" label="Link" placeholder="https://my.matterport.com/show/?m=…" defaultValue={external} />
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

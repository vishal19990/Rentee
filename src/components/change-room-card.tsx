import { changeRentalProperty } from "@/app/(admin)/rentals/actions";
import { connectDB } from "@/lib/db";
import { roomChangeError } from "@/lib/room-change";
import { Property } from "@/models/Property";
import { Rental } from "@/models/Rental";
import { ActionForm, SelectField, SubmitButton } from "./form";
import { Card } from "./ui";

/**
 * "Change room" on the rental page: move a booking to another vacant property, keeping its
 * deposit/advance, agreement, charges and payments. Explains the alternative when the stay has
 * already started with rent paid.
 */
export async function ChangeRoomCard({
  rentalId,
  currentPropertyId,
  status,
  moveInDate,
  hasPayments,
  today,
}: {
  rentalId: string;
  currentPropertyId: string;
  status: string;
  moveInDate: string;
  hasPayments: boolean;
  today: string;
}) {
  if (status !== "active") return null;
  const blocked = roomChangeError({ status, moveInDate, today, hasPayments });

  await connectDB();
  const [properties, occupied] = await Promise.all([
    Property.find({ archived: { $ne: true }, _id: { $ne: currentPropertyId } }).sort({ name: 1 }).select("name city").lean(),
    Rental.distinct("property", { status: "active" }),
  ]);
  const taken = new Set(occupied.map(String));
  const vacant = properties.filter((p) => !taken.has(String(p._id)));

  return (
    <Card title="Change room" description="Booked the wrong room, or the tenant chose another one?">
      {blocked ? (
        <p className="text-sm text-slate-600">{blocked}</p>
      ) : vacant.length === 0 ? (
        <p className="text-sm text-slate-600">No other vacant property is available right now.</p>
      ) : (
        <ActionForm action={changeRentalProperty.bind(null, rentalId)} className="space-y-3">
          <SelectField
            name="propertyId"
            label="Move this rental to"
            placeholder="Select a vacant property…"
            options={vacant.map((p) => ({ value: String(p._id), label: p.city ? `${p.name} · ${p.city}` : p.name }))}
          />
          <p className="text-xs text-slate-500">Deposit and advance, agreement, charges and notes move with it. The current room becomes vacant.</p>
          <SubmitButton variant="secondary" className="w-full">
            Change room
          </SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}

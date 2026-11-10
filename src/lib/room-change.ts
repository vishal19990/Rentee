/**
 * "Change room": move a rental to another property in place (deposit, advance, agreement,
 * charges, payments and notes go with it).
 *
 * Only allowed before the stay has really started — the move-in date is today or later, or no
 * rent has been paid yet. Once the tenant has lived somewhere and paid, switching in place would
 * credit that past rent to the new room in income and profit reports; record a move-out and a
 * new rental instead.
 */
export function roomChangeError(r: { status: string; moveInDate: string; today: string; hasPayments: boolean }): string | null {
  if (r.status !== "active") return "This rental has ended. Create a new rental for the new room instead.";
  if (r.moveInDate < r.today && r.hasPayments) {
    return "Rent has already been paid for this room, so switching it would move that income to the new room. Record a move-out here, then create a new rental for the new room.";
  }
  return null;
}

/** Utility & other charges billed on top of rent for a month (pure helpers). */

export const CHARGE_TYPES = ["electricity", "water", "maintenance", "other"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  electricity: "Electricity",
  water: "Water",
  maintenance: "Maintenance",
  other: "Other",
};

export function chargeLabel(type: string): string {
  return CHARGE_TYPE_LABELS[type as ChargeType] ?? type;
}

/** Units consumed between two meter readings (rounded to 2 decimals), or null if current < previous. */
export function meterUnits(previous: number, current: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous) return null;
  return Math.round((current - previous) * 100) / 100;
}

/**
 * Electricity amount in minor units: units × rate (rate in minor units per unit), rounded.
 * prev 1200, curr 1350, rate ₹8 (800 paise) -> 150 × 800 = 120000 (₹1,200).
 */
export function electricityAmount(previous: number, current: number, rateMinor: number): number | null {
  const units = meterUnits(previous, current);
  if (units === null) return null;
  return Math.round(units * rateMinor);
}

import "server-only";
import { connectDB } from "./db";
import type { LandlordDetails } from "./receipts";
import { upiEnabled, type UpiSettings } from "./upi";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";

/** Landlord details printed on receipts (Settings → Receipts). Empty strings when not set. */
export async function getLandlordDetails(): Promise<LandlordDetails> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY })
    .select("landlordName landlordAddress landlordPhone landlordPan")
    .lean();
  return {
    name: doc?.landlordName ?? "",
    address: doc?.landlordAddress ?? "",
    phone: doc?.landlordPhone ?? "",
    pan: doc?.landlordPan ?? "",
  };
}

/**
 * UPI settings (Settings → UPI payments). `payee` is what the tenant's UPI app shows:
 * the payee name, else the landlord name, else "Landlord".
 */
export async function getUpiSettings(): Promise<UpiSettings & { payee: string; enabled: boolean }> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY }).select("upiId upiPayeeName landlordName").lean();
  const upiId = doc?.upiId ?? "";
  const payeeName = doc?.upiPayeeName ?? "";
  return { upiId, payeeName, payee: payeeName || doc?.landlordName || "Landlord", enabled: upiEnabled({ upiId }) };
}

import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * A WhatsApp reminder the admin opened for a rental. We can't know whether it was actually
 * sent (the admin presses send inside WhatsApp); this records that the reminder was prepared.
 */
const reminderLogSchema = new Schema({
  rental: { type: Schema.Types.ObjectId, ref: "Rental", required: true },
  tenant: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  sentAt: { type: Date, required: true, default: () => new Date() },
  message: { type: String, required: true },
  kind: { type: String, enum: ["overdue", "due_soon"], required: true },
  /** Normalized phone digits the link was addressed to. */
  phone: { type: String, required: true },
  /** Admin who opened the reminder. */
  sentBy: { type: Schema.Types.ObjectId, ref: "User" },
});

reminderLogSchema.index({ rental: 1, sentAt: -1 });

export type ReminderLogDoc = InferSchemaType<typeof reminderLogSchema>;

export const ReminderLog: Model<ReminderLogDoc> =
  (mongoose.models.ReminderLog as Model<ReminderLogDoc>) || mongoose.model<ReminderLogDoc>("ReminderLog", reminderLogSchema);

import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/** A hotspot: clicking it at (yaw, pitch) in this room's panorama opens `toRoom`. */
const tourLinkSchema = new Schema(
  {
    toRoom: { type: Schema.Types.ObjectId, ref: "TourRoom", required: true },
    yaw: { type: Number, required: true },
    pitch: { type: Number, required: true },
  },
  { _id: true },
);

/**
 * One room of a property's 360° virtual tour: an equirectangular (2:1) photo and its small
 * thumbnail, both in the GridFS bucket "tours".
 */
const tourRoomSchema = new Schema(
  {
    property: { type: Schema.Types.ObjectId, ref: "Property", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    order: { type: Number, required: true, default: 0 },
    image: { type: Schema.Types.ObjectId, required: true },
    thumbnail: { type: Schema.Types.ObjectId, required: true },
    contentType: { type: String, required: true, default: "image/jpeg" },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    /** Starting view (radians). */
    initialYaw: { type: Number, default: 0 },
    links: { type: [tourLinkSchema], default: [] },
    /** Created by "Use sample tour" (built-in demo photos). */
    sample: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type TourRoomDoc = InferSchemaType<typeof tourRoomSchema>;

export const TourRoom: Model<TourRoomDoc> =
  (mongoose.models.TourRoom as Model<TourRoomDoc>) || mongoose.model<TourRoomDoc>("TourRoom", tourRoomSchema);

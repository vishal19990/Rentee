import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * Access and refresh tokens (opaque; stored only as SHA-256 hashes). Every token of one consent
 * shares a `family` (the grant): refreshing rotates within the family, and revoking or replaying
 * a rotated refresh token deletes the whole family. Documents expire on their own (TTL).
 */
const oauthTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["access", "refresh"], required: true },
    family: { type: String, required: true, index: true },
    clientId: { type: String, required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    scopes: { type: [String], required: true },
    resource: { type: String, required: true },
    /** When the grant (family) was first approved; copied on rotation. */
    grantedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    /** Refresh tokens: set once used (rotated). Kept until expiry to detect replay. */
    rotatedAt: { type: Date, default: null },
    /** Last MCP call made with this grant (kept on its access tokens). */
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "rentee_oauth_tokens" },
);

export type OAuthTokenDoc = InferSchemaType<typeof oauthTokenSchema>;

export const OAuthToken: Model<OAuthTokenDoc> =
  (mongoose.models.OAuthToken as Model<OAuthTokenDoc>) || mongoose.model<OAuthTokenDoc>("OAuthToken", oauthTokenSchema);

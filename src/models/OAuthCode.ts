import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * A single-use authorization code (stored as a SHA-256 hash), bound to the client, redirect URI,
 * PKCE challenge, scopes, resource and approving admin. Valid for 60 s (`expiresAt`); the
 * document itself is kept a little longer (`purgeAt`, TTL) so a replayed code can be detected
 * and the tokens issued from it revoked.
 */
const oauthCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    clientId: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    redirectUri: { type: String, required: true },
    codeChallenge: { type: String, required: true },
    scopes: { type: [String], required: true },
    resource: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    /** Grant family of the tokens issued from this code (set when exchanged). */
    family: { type: String, default: null },
    purgeAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true, collection: "rentee_oauth_codes" },
);

export type OAuthCodeDoc = InferSchemaType<typeof oauthCodeSchema>;

export const OAuthCode: Model<OAuthCodeDoc> =
  (mongoose.models.OAuthCode as Model<OAuthCodeDoc>) || mongoose.model<OAuthCodeDoc>("OAuthCode", oauthCodeSchema);

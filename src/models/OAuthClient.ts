import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/**
 * An OAuth client registered through Dynamic Client Registration (RFC 7591), e.g. Claude.
 * Confidential clients' secrets are stored only as SHA-256 hashes. See lib/oauth.
 * Collection name is explicit (shared database).
 */
const oauthClientSchema = new Schema(
  {
    clientId: { type: String, required: true, unique: true },
    /** SHA-256 hex of the client secret; null for public clients (token_endpoint_auth_method "none"). */
    secretHash: { type: String, default: null },
    name: { type: String, required: true, trim: true },
    redirectUris: { type: [String], required: true },
    grantTypes: { type: [String], required: true },
    authMethod: { type: String, enum: ["none", "client_secret_post", "client_secret_basic"], required: true },
    /** Last time a token was issued to this client (used to prune unused registrations). */
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "rentee_oauth_clients" },
);

export type OAuthClientDoc = InferSchemaType<typeof oauthClientSchema>;

export const OAuthClient: Model<OAuthClientDoc> =
  (mongoose.models.OAuthClient as Model<OAuthClientDoc>) || mongoose.model<OAuthClientDoc>("OAuthClient", oauthClientSchema);

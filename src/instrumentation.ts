/**
 * Runs once when the Next.js server starts (not during `next build`).
 * In production, fail fast with a clear message if required configuration is missing,
 * instead of erroring on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const missing = ["MONGODB_URI", "AUTH_SECRET"].filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error(
      `\n[rentee] Missing required environment variable(s): ${missing.join(", ")}.\n` +
        "  MONGODB_URI  — MongoDB connection string (e.g. MongoDB Atlas).\n" +
        "  AUTH_SECRET  — long random string used to sign login sessions.\n" +
        "Set them in your host's environment (Render: Service → Environment) and restart.\n",
    );
    process.exit(1);
  }
  if ((process.env.AUTH_SECRET ?? "").length < 32) {
    console.warn("[rentee] AUTH_SECRET is shorter than 32 characters; use a longer random value.");
  }
  // Not fatal (the rest of the app works), but tenant documents, photos and bills can't be
  // uploaded until it is set — they are never stored unencrypted in production.
  const filesKey = process.env.FILES_ENCRYPTION_KEY?.trim() ?? "";
  if (!filesKey) {
    console.warn("[rentee] FILES_ENCRYPTION_KEY is not set: uploads of tenant documents, tenant photos and expense bills are disabled until it is.");
  } else if (filesKey.length < 32) {
    console.warn("[rentee] FILES_ENCRYPTION_KEY is shorter than 32 characters: sensitive uploads will fail. Use `openssl rand -base64 32`.");
  }
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so a production build can be verified without touching a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["mongoose", "bcryptjs"],
  // Old bookmarks: leases were replaced by month-to-month rentals.
  async redirects() {
    return [
      { source: "/leases", destination: "/rentals", permanent: false },
      { source: "/leases/:path*", destination: "/rentals/:path*", permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      // Photos are capped at 5 MB by validation; leave headroom so oversize files
      // reach the action and get a friendly field error instead of a framework error.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;

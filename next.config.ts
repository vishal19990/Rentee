import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so a production build can be verified without touching a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["mongoose", "bcryptjs"],
  // Security headers on every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never let another site show Rentee inside a frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // frame-ancestors is the modern form of the above; the rest blocks plugins, <base>
          // hijacking and forms posting to other sites. (Scripts/styles aren't restricted here:
          // Next.js needs inline scripts, which would require per-request nonces.)
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
          // Browsers that have seen the site over HTTPS refuse plain HTTP for 2 years.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Features Rentee never uses. (Gyroscope/accelerometer stay allowed for the 360° tour.)
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  // Old bookmarks: leases were replaced by month-to-month rentals.
  async redirects() {
    return [
      { source: "/leases", destination: "/rentals", permanent: false },
      { source: "/leases/:path*", destination: "/rentals/:path*", permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      // Photos are capped at 5 MB and expense bills / tenant documents at 10 MB by validation; leave
      // headroom so oversize files reach the action and get a friendly field error instead of a
      // framework error.
      bodySizeLimit: "16mb",
    },
    // Requests pass through middleware (auth), which otherwise truncates bodies at 10 MB.
    middlewareClientMaxBodySize: "16mb",
  },
};

export default nextConfig;

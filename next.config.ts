import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables the `forbidden()` convention, so a page whose permission check
  // fails renders a proper 403 page instead of surfacing as a 500.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;

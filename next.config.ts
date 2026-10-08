import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The app was shipping with none, which left it frameable: an attacker could
 * iframe `/pos` under an invisible overlay positioned over the checkout button
 * and a logged-in cashier's click would be delivered to the POS. The session
 * cookie is `sameSite: "lax"`, which still permits an iframe to send it, and the
 * app's own confirmation dialogs render *inside* the framed page, so the overlay
 * covers those too.
 *
 * `DENY` rather than `SAMEORIGIN`: nothing here embeds itself.
 *
 * The CSP is deliberately permissive about styles. Recharts writes inline styles
 * on SVG elements, and `next-themes` injects a blocking script that sets the
 * theme class before first paint — forbidding either would break the page rather
 * than harden it. The protections that actually matter here (`nosniff`,
 * `DENY` framing, HSTS, referrer) are all strict.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-inline' for styles is required by Recharts and by Tailwind's
      // runtime custom properties; scripts stay strict apart from Next's own
      // bootstrap payload and the theme script that prevents a light-mode flash.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Enables the `forbidden()` convention, so a page whose permission check
  // fails renders a proper 403 page instead of surfacing as a 500.
  experimental: {
    authInterrupts: true,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
import type { NextConfig } from "next";

// Content-Security-Policy tuned to NOT break the app: Next injects inline
// hydration scripts and the UI uses inline styles, so script/style need
// 'unsafe-inline' (no nonce infrastructure yet); connect-src allows the
// same-origin Socket.IO WebSocket. If a future change trips a violation, switch
// the header key below to "Content-Security-Policy-Report-Only" to observe
// without breaking, tighten, then flip back.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  // 'self' covers the same-origin Socket.IO ws/wss endpoint in CSP3 browsers;
  // do NOT broaden to `ws: wss:` (that would allow exfiltration to any host).
  "connect-src 'self'",
].join("; ");

// Applied to every route as defense-in-depth. HSTS is ignored over plain HTTP,
// so it is safe to send unconditionally.
const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // The manifest is public but changes with releases: cache briefly and
        // revalidate rather than pinning it for a year like hashed assets.
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, must-revalidate" }],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;

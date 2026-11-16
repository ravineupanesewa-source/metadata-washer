import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Strict browser policy. Images are previewed only from blob: URLs created
 * locally; nothing is loaded from third parties.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets three.js's meshopt decoder compile its WebAssembly (not JS eval).
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  // blob: lets three.js's GLTFLoader fetch the washer model's embedded textures, which it
  // unpacks into page-created blob: URLs. No other origin is reachable.
  "connect-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  output: "standalone",
  // Spawns Perl/ExifTool and native libvips; must run as plain Node modules.
  serverExternalPackages: ["exiftool-vendored", "exiftool-vendored.pl", "sharp"],
  outputFileTracingIncludes: {
    // vendor/perl exists only after `npm run vercel-build` (portable Perl for serverless hosts).
    "/api/**": ["./node_modules/exiftool-vendored.pl/**/*", "./vendor/perl/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HTTPS-only once deployed; never sent by `next dev` so localhost isn't pinned.
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
      {
        // The washer model is ~3 MB and its URL isn't content-hashed: cache it for a week and
        // revalidate in the background, so repeat visits skip the download without pinning a stale copy.
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;

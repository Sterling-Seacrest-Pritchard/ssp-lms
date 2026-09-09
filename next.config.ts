import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" bundles a self-contained server for the Docker/Cloud Run
  // build - Vercel's own build pipeline expects normal Next.js output and
  // conflicts with it (fails looking for next-server.js.nft.json in a path
  // standalone mode doesn't produce). Vercel sets VERCEL=1 during its build.
  output: process.env.VERCEL ? undefined : "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // The SCORM content proxy is loaded INTO an iframe by our own launch page,
      // so the blanket X-Frame-Options: DENY above would block it. Per
      // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md
      // ("Header Overriding Behavior"), when two entries match the same path and
      // set the same key the LAST one wins - precedence is source ORDER, not
      // pattern specificity - so this entry must stay after the catch-all.
      {
        source: "/api/scorm/content/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;

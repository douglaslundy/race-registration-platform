import type { NextConfig } from "next";

// Build remote patterns from configured SUPABASE_URL so uploads from
// self-hosted Supabase (custom domain or bare IP) are allowed by <Image>.
function buildSupabasePattern() {
  const raw = process.env.SUPABASE_URL ?? "";
  if (!raw) return [];
  try {
    const u = new URL(raw);
    return [
      {
        protocol: u.protocol.replace(":", "") as "https" | "http",
        hostname: u.hostname,
        ...(u.port ? { port: u.port } : {}),
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "supabase.circuitodascorridas.com.br" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.amazonaws.com" },
      ...buildSupabasePattern(),
    ],
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;

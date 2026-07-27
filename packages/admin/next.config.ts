import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@flyff/core", "@flyff/database", "@flyff/resources"],
  serverExternalPackages: ["better-sqlite3"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

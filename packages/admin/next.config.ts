import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Load .env from monorepo root so AUTH_SECRET, DB_FILENAME etc. are available
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvConfig(resolve(__dirname, "..", ".."));

const nextConfig: NextConfig = {
  transpilePackages: ["@flyff/core", "@flyff/database", "@flyff/resources", "@flyff/entities"],
  serverExternalPackages: ["better-sqlite3"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

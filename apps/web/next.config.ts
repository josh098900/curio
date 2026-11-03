import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@curio/contracts"],
};

export default nextConfig;

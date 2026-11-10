import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@openstudio/shared"],
};
export default config;

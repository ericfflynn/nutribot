import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the local network load dev assets and hot reload
  // (npm run dev, then open http://<this Mac's LAN IP>:3000).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"]
};

export default nextConfig;

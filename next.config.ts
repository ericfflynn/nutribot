import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the local network load dev assets and hot reload
  // (npm run dev, then open http://<this Mac's LAN IP>:3000).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // The Agent SDK spawns the Claude Code binary, which it finds with a dynamic
  // require.resolve. Keep the SDK unbundled and ship the Linux binary explicitly.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  outputFileTracingIncludes: {
    "/api/workouts/parse": ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**"]
  }
};

export default nextConfig;

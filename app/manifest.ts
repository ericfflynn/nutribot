import type { MetadataRoute } from "next";

// Needed for web push on iPhone: notifications only reach the Home Screen app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NutriBot",
    short_name: "NutriBot",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f2f7",
    theme_color: "#f2f2f7",
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" }
    ]
  };
}

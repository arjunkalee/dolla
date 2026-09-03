import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dolla",
    short_name: "Dolla",
    description: "Arjun's personal budget, paycheck plan, and savings",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#101610",
    theme_color: "#101610",
    orientation: "portrait",
    icons: [
      {
        src: "/icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

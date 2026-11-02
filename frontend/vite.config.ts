import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@firebase/")) return "firebase";
          if (id.includes("/node_modules/i18next/") || id.includes("/node_modules/react-i18next/")) return "localization";
          if (id.includes("/node_modules/katex/")) return "katex";
          if (id.includes("/node_modules/@tiptap/pm/") || id.includes("/node_modules/prosemirror-")) return "prosemirror";
          if (id.includes("/node_modules/@tiptap/")) return "tiptap";
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Notez",
        short_name: "Notez",
        description: "A private, thoughtful home for your notes.",
        theme_color: "#fbf8f2",
        background_color: "#fbf8f2",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        navigateFallback: "index.html",
        runtimeCaching: [],
      },
    }),
  ],
});

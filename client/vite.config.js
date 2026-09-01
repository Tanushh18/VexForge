import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Testing through a tunnel (cloudflared/ngrok) presents a Host header
    // Vite doesn't recognize by default; this is scoped to local dev use.
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});

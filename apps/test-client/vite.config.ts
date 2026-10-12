import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The proxy keeps the API on the same origin, so the session cookie just works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3000" },
  },
});

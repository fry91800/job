import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The proxy keeps the API on the same origin, so the session cookie just works. It targets
// the API's port: PORT in the repository's .env (as the API reads it), 3000 by default.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, "../.."), "");
  const apiPort = process.env.PORT ?? env.PORT ?? "3000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { "/api": `http://localhost:${apiPort}` },
    },
  };
});

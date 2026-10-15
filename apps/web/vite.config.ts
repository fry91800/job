import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The proxy keeps the API on the same origin (session cookie). It targets the API's port:
// PORT in the repository's .env (as the API reads it), 3000 by default.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, "../.."), "");
  const apiPort = process.env.PORT ?? env.PORT ?? "3000";
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174, // the test client uses 5173
      strictPort: true,
      proxy: { "/api": `http://localhost:${apiPort}` },
    },
    // `vite preview`: the production build, to measure real speed.
    preview: {
      port: 5175,
      strictPort: true,
      proxy: { "/api": `http://localhost:${apiPort}` },
    },
  };
});

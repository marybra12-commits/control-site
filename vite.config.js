import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { bitrixApiPlugin } from "./server/api-plugin.js";

export default defineConfig({
  plugins: [bitrixApiPlugin(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  base: "/aurora-webgl-landing/",
  plugins: [glsl()],
  build: {
    chunkSizeWarningLimit: 650
  },
  server: { host: true, port: 5173 }
});

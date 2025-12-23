import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  base: "/aurora-webgl-landing/",
  plugins: [glsl()],
  server: { host: true, port: 5173 }
});

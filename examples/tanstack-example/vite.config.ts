import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, esmExternalRequirePlugin } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  optimizeDeps: {
    include: ["tsdkarc", "tsdkarc-x", "typescript"],
  },
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    esmExternalRequirePlugin({
      external: ["typescript"],
    }),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
    nitro(),
  ],
});

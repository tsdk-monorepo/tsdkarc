import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ["tsdkarc-x", "tsdkarc"],
  },
  plugins: [react(), vue(), tailwindcss()],
  resolve: {
    // Forces Vite to always resolve these libraries to the root node_modules version
    dedupe: ["react", "react-dom", "vue"],
  },
});

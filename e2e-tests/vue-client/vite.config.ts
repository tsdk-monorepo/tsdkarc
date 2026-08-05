import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import vueJsx from "@vitejs/plugin-vue-jsx";

// https://vite.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: ["tsdkarc-x", "tsdkarc"],
  },
  plugins: [vue(), vueJsx(), tailwindcss()],
  resolve: {
    // Forces Vite to always resolve these libraries to the root node_modules version
    dedupe: ["react", "react-dom", "vue"],
  },
  server: {
    port: 5174
  }
});

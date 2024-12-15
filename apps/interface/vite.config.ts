import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { kitRoutes } from "vite-plugin-kit-routes";
import resolve from "vite-plugin-resolve";

export default defineConfig({
  plugins: [
    kitRoutes(),
    sveltekit(),
    resolve({
      util: "export const inspect = {}",
    }),
  ],
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["@noir-lang/noirc_abi", "@noir-lang/acvm_js"],
    esbuildOptions: {
      target: "esnext",
    },
  },
});

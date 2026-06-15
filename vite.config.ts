import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es", "cjs", "umd"],
      name: "JsonLogicToSql",
      fileName: (fmt) => (fmt === "es" ? "index.mjs" : fmt === "cjs" ? "index.cjs" : "index.umd.js"),
    },
    rollupOptions: {
      external: [],
    },
    sourcemap: true,
    minify: false,
  },
  plugins: [
    dts({
      bundleTypes: true,
      insertTypesEntry: true,
    }),
  ],
})

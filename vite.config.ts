import { defineConfig } from "vitest/config";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Never watch Rust's build output: cargo actively locks/rewrites these
    // files while compiling, which races Vite's watcher into an EBUSY crash
    // on Windows (the file gets picked up mid-write, then vanishes/relocks).
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

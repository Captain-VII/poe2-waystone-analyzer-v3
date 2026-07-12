// Flat config (ESLint 10). tsconfig.json already runs in strict mode with
// noUnusedLocals/noUnusedParameters — this stays lean rather than
// duplicating what tsc already catches, and skips the type-checked rule
// sets (no `project` wiring) to keep lint fast and dependency-free.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "scripts/.adapter-bundle.mjs", "scripts/.meta-bundle.mjs"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // The adapter/mock modules intentionally use `any` in a few narrow
      // spots (meta.json's user-editable JSON shape) — downgrade to a
      // warning instead of banning it outright.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // scripts/verify-adapter.mjs: a plain Node script (npm run
    // verify-adapter), not part of the Vite/browser build — needs Node's
    // globals instead of the browser ones the rest of the config assumes.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
);

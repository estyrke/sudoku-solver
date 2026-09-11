import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

// The components under test live in web/ui/ and import each other by relative
// path; root stays here and the tests reach up, so nothing about the app's own
// build has to know these exist.
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: "jsdom",
    include: ["*.test.tsx"],
  },
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // logic modules import { Graphics } from "pixi.js"; stub it for Node tests
      "pixi.js": fileURLToPath(new URL("./test/pixi-stub.ts", import.meta.url)),
    },
  },
});

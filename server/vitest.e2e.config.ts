import { defineConfig } from "vitest/config";

// Separate config for the LSP E2E suite — runs only `*.e2e.test.ts` files
// against real LSP binaries. Required: a PHP LSP on PATH or
// SHIPPABLE_PHP_LSP set. The suite fails loudly with install instructions
// when no binary is found; there is no silent skip.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.e2e.test.ts"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Testes de auth usam node:crypto e nao precisam de DOM.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.mts"],
    // scrypt com N=2^16 leva ~130ms por derivacao; alguns testes fazem varias.
    testTimeout: 20_000,
  },
});

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    // Os testes de API dividem um banco: um arquivo por vez.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})

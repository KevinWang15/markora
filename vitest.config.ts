import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/core/test/**/*.test.ts'],
  },
});

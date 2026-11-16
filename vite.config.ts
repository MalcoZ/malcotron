import { defineConfig } from 'vitest/config';

// Served from https://malcoz.github.io/malcotron/ (spec section 9).
export default defineConfig({
  base: '/malcotron/',
  build: { target: 'es2022' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

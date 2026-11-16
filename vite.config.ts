import { defineConfig } from 'vitest/config';

// Served from https://malcoz.github.io/malcotron/ (spec section 9).
export default defineConfig({
  base: '/malcotron/',
  build: {
    target: 'es2022',
    // VexFlow (with its embedded music fonts) and Tone.js make one chunk of about 1 MB.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

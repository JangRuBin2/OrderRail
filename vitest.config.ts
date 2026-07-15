import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
    },
    setupFiles: [],
  },
  resolve: {
    alias: {
      // URL is a global in lib.dom + esnext; import.meta.url is available
      // with "module": "esnext" — no __dirname or @types/node needed
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['__tests__/**/*.test.{ts,tsx}'],
          exclude: ['__tests__/**/*.integration.test.ts', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['__tests__/**/*.integration.test.ts'],
          setupFiles: [],
          testTimeout: 600_000,
        },
      },
    ],
  },
});

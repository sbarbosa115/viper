import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'contracts',
          root: 'packages/contracts',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api-unit',
          root: 'apps/api',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api-int',
          root: 'apps/api',
          include: ['src/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          root: 'apps/web',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
    coverage: { provider: 'v8', include: ['apps/*/src/**', 'packages/*/src/**'] },
  },
});

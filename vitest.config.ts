import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * T008. Three projects, because the constitution's gates distinguish them:
 *
 *   unit    — node environment. `src/core` must run with no DOM at all; that is
 *             the concrete form of Principle IV.
 *   parity  — node environment, gate 5. The engine suite against every fake.
 *   component — jsdom, gates 6. React Testing Library plus vitest-axe.
 *
 * `tests/smoke` is deliberately absent: it is Playwright against a built app
 * (gate 8) and runs from `npm run smoke`.
 */

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@providers': fileURLToPath(new URL('./src/providers', import.meta.url)),
  '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
  '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'parity',
          globals: true,
          environment: 'node',
          include: ['tests/parity/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        plugins: [react()],
        test: {
          name: 'component',
          globals: true,
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: [fileURLToPath(new URL('./tests/component/setup.ts', import.meta.url))],
        },
      },
    ],
  },
});

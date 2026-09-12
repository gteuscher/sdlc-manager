import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * The preload script, built **alone**.
 *
 * It gets its own config rather than sharing one with the main process because a
 * single rollup build over both entries hoists their common modules into a shared
 * chunk, and the preload then emits `require("./chunk.cjs")`. Under
 * `sandbox: true` that fails at load: Electron gives a sandboxed preload a
 * limited `require` for a few built-ins and nothing else, so the bridge would
 * never install — while the build and the type check both stayed green.
 *
 * One entry means no shared chunk, and `electron` is the only external.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: false,
    target: 'node20',
    // As in the main config: without this, Vite inlines `process.env` as `{}`
    // because it assumes a browser target. See electron.vite.config.ts.
    ssr: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)),
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.cjs',
        // Belt and braces: even with one entry, never split this file.
        inlineDynamicImports: true,
      },
    },
  },
});

import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Main process build (T004).
 *
 * Emits CommonJS: Electron's main entry cannot be an ES module, so the extension
 * is `.cjs` while the package itself is `"type": "module"`.
 *
 * The preload is built separately by `preload.vite.config.ts`. Building the two
 * together produced a shared chunk that the preload tried to `require`, which a
 * sandboxed preload cannot do — see that file for the full reasoning.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@providers': fileURLToPath(new URL('./src/providers', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: false,
    target: 'node20',
    /**
     * This is not optional, and the failure it prevents is silent.
     *
     * Without `ssr`, Vite treats this as a browser build and statically replaces
     * every `process.env` with an inlined object — which for a Node target comes
     * out as `{}`. The main process then reads an empty environment: no
     * `SDLC_PACKAGE_PATHS`, no `SDLC_RENDERER_URL`, no anything. Nothing fails
     * loudly; discovery simply finds nothing and dev mode quietly serves the
     * last built renderer instead of the dev server.
     *
     * `ssr: true` tells Vite this is a server build, so `process.env` is left
     * alone and Node built-ins are externalised properly.
     */
    ssr: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/main/entry.ts', import.meta.url)),
      },
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name]-[hash].cjs',
      },
    },
  },
});

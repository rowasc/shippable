import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // The @php-wasm/web-* packages import their .wasm binaries as default
  // imports rather than ?url. Treat .wasm as a static asset so Vite emits a
  // file and resolves the import to its URL — Emscripten's loader fetches it
  // at runtime.
  assetsInclude: ['**/*.wasm', '**/*.dat'],
  optimizeDeps: {
    // Only exclude the version-specific package that imports raw .wasm —
    // pre-bundling it breaks Vite's wasm-fallback. `@php-wasm/universal`
    // must stay in optimizeDeps so its CJS deps (e.g. `ini`) get the proper
    // ESM interop shim.
    exclude: ['@php-wasm/web-8-3'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
      },
    },
  },
})

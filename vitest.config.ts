import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mirrors tsconfig.json's "@/*" path alias so engine tests can import
// production modules (e.g. lib/toolsSession.ts) the same way the app does,
// without rewriting their imports to relative paths.
export default defineConfig({
  // Next compiles TSX with the automatic JSX runtime; match it so component render tests don't need `import React`.
  esbuild: { jsx: 'automatic' },
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})

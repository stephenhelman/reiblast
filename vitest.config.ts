import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mirrors tsconfig.json's "@/*" path alias so engine tests can import
// production modules (e.g. lib/toolsSession.ts) the same way the app does,
// without rewriting their imports to relative paths.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})

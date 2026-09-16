/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Shell scripts are imported as text.
 *
 * They live in real .sh/.zsh files so a shell can syntax-check them, rather
 * than as template literals where three levels of quoting once ate an escape
 * and shipped an integration that emitted nothing. esbuild handles this for
 * the Electron bundle; Vite needs telling, so the tests can import them too.
 */
function shellText(): Plugin {
  return {
    name: 'atrium-shell-text',
    enforce: 'pre',
    load(id) {
      if (!/\.(sh|zsh)$/.test(id)) return null
      return `export default ${JSON.stringify(readFileSync(id.split('?')[0], 'utf8'))}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths. A packaged Electron app loads the renderer over
  // file://, where Vite's default absolute "/assets/..." resolves to the
  // filesystem root — the module never loads, and the window is blank with
  // nothing in the console to say why.
  base: './',
  plugins: [shellText(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})

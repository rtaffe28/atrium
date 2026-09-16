/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths. A packaged Electron app loads the renderer over
  // file://, where Vite's default absolute "/assets/..." resolves to the
  // filesystem root — the module never loads, and the window is blank with
  // nothing in the console to say why.
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})

import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Tauri expects a fixed port (devUrl in tauri.conf.json; 1420 and 1430 are taken by other Tauri projects) and must see Rust-side errors in the terminal.
  clearScreen: false,
  server: { port: 1440, strictPort: true },
  build: { target: 'es2022' },
})

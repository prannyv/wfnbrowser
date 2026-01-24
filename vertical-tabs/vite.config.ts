import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    hmr: {
      port: 5173,
    },
    cors: true,
  },
  build: {
    rollupOptions: {
      input: {
        sidepanel: 'src/sidepanel/index.html',
        newtab: 'src/newtab/index.html',
      },
    },
  },
})

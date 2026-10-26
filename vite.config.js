import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    open: false
  },
  preview: {
    port: 3000,
    open: false
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/leaflet')) return 'leaflet'
          if (id.includes('node_modules/three/build/')) return 'three'
        }
      }
    }
  }
})

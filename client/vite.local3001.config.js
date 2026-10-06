import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.js'

export default mergeConfig(base, defineConfig({
  server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } }
}))

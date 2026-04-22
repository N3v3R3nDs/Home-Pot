import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,webp,woff2}'],
        navigateFallback: '/index.html',
      },
      manifest: {
        name: 'Home Pot',
        short_name: 'Home Pot',
        description: 'Pro poker tournament & cash game manager for your home games.',
        theme_color: '#06190d',
        background_color: '#06190d',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When deployed to GitHub Pages the app is served from
// https://<user>.github.io/AmyMorrisTearSheets/, so assets must resolve under
// that sub-path. Locally (dev/preview) we keep the root base.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/AmyMorrisTearSheets/' : '/',
  plugins: [react()],
})

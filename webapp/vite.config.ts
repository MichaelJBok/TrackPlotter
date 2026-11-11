import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://<user>.github.io/TrackPlotter/ (a GitHub Pages
  // project site, not a user/org site), so asset URLs need this prefix.
  base: "/TrackPlotter/",
  plugins: [react()],
})

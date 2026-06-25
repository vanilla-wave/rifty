import { defineConfig } from 'vite';

// Static marketing site for rifty.dev. No COOP/COEP (separate origin from
// play.rifty.dev; loads Google Fonts; needs no SharedArrayBuffer).
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});

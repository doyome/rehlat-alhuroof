import { defineConfig } from 'vite';

// GitHub Pages serves the game from /<repo>/; the deploy workflow passes that path in.
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
});

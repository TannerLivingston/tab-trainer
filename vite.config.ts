import { defineConfig, type Plugin } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';

// Your own songs in /samples are for local use only (they may be copyrighted): a build swaps
// src/localSamples.ts for an empty list, so none of them can end up in the output.
const noSamplesInBuild = (): Plugin => ({
  name: 'no-samples-in-build',
  apply: 'build',
  enforce: 'pre',
  load: (id) => (id.replace(/\\/g, '/').endsWith('/src/localSamples.ts') ? 'export default {};' : null),
});

export default defineConfig({
  // Served from the site root by default; GitHub Pages project sites live under /<repo>/, so the
  // deploy workflow sets BASE_PATH=/<repo>/.
  base: process.env.BASE_PATH ?? '/',
  plugins: [noSamplesInBuild(), alphaTab()],
  server: { port: 5173 },
  build: { target: 'es2022' },
});

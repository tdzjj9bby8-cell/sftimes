import { defineConfig } from 'astro/config';
// import sitemap from '@astrojs/sitemap';
// Sitemap temporarily disabled — @astrojs/sitemap 3.x crashes on Vercel
// with "Cannot read properties of undefined (reading 'reduce')".
// Re-enable after upgrading to a compatible version.

export default defineConfig({
  site: 'https://www.sftimes.com',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    inlineStylesheets: 'auto',
    assets: 'assets',
  },
  integrations: [],
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  experimental: {
    clientPrerender: false,
  },
  vite: {
    build: {
      cssCodeSplit: true,
    },
  },
});

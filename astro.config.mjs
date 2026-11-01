import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { rehypeDiagrams } from './src/lib/markdown/diagrams.mjs';
import { rehypeRelatedLinks } from './src/lib/markdown/related-links.mjs';
import { rehypeSections } from './src/lib/markdown/sections.mjs';
import { rehypeTables } from './src/lib/markdown/tables.mjs';

/* The same code builds for two hosts:
 *   home server   defaults: served from /
 *   GitHub Pages  SITE_URL + SITE_BASE=/PWP (set in .github/workflows/pages.yml)
 * OUT_DIR lets the home-server build write beside the live site, then swap. */
const site = process.env.SITE_URL;

export default defineConfig({
    site,
    base: process.env.SITE_BASE || '/',
    outDir: process.env.OUT_DIR || 'dist',
    output: 'static',
    build: { format: 'directory' },
    devToolbar: { enabled: false },
    integrations: site ? [sitemap()] : [],
    markdown: {
        shikiConfig: {
            themes: { light: 'github-light', dark: 'github-dark' },
            defaultColor: false,
        },
        rehypePlugins: [rehypeDiagrams, rehypeTables, rehypeRelatedLinks, rehypeSections],
    },
});

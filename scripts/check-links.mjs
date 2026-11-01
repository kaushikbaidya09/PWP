#!/usr/bin/env node
/* check-links.mjs — fails if any built page links to a page or anchor that does not exist.
 * Run after a build: node scripts/check-links.mjs [outDir] */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || process.env.OUT_DIR || 'dist';
const BASE = (process.env.SITE_BASE || '').replace(/\/$/, '');

function pages(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? pages(p) : e.name.endsWith('.html') ? [p] : [];
    });
}

const html = pages(OUT);
const text = new Map(html.map((p) => [p, fs.readFileSync(p, 'utf8')]));
const idsIn = (s) => new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const bad = [];
let checked = 0;

for (const [file, s] of text) {
    for (const [, href] of s.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
        if (/^(https?:|mailto:|tel:)/.test(href)) continue;
        checked++;
        const [rawPath, hash] = href.split('#');
        let target = file;
        if (rawPath) {
            if (BASE && !rawPath.startsWith(`${BASE}/`)) {
                bad.push(`${file}: ${href} is missing the ${BASE} base path`);
                continue;
            }
            const local = rawPath.slice(BASE.length);
            target = path.join(OUT, local, local.endsWith('/') ? 'index.html' : '');
            if (!text.has(target) && !fs.existsSync(target)) {
                bad.push(`${file}: ${href} not found`);
                continue;
            }
        }
        if (hash && text.has(target) && !idsIn(text.get(target)).has(hash))
            bad.push(`${file}: ${href} anchor not found`);
    }
}

for (const p of bad) console.error(p);
console.log(`${html.length} pages, ${checked} internal links, ${bad.length} broken`);
process.exit(bad.length ? 1 : 0);

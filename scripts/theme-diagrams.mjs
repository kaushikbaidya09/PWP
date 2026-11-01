#!/usr/bin/env node
/* theme-diagrams.mjs — make diagram SVGs theme-aware and transparent.
 *
 * Rewrites every SVG in diagrams/generated/ in place:
 *   - drops the XML prolog, PlantUML metadata, background rects and font @imports
 *   - replaces the fixed palette with CSS custom properties (--dg-*), defined for
 *     both themes in src/styles/main.css; the light palette stays as fallback
 * Idempotent: running it again changes nothing. Run after rendering diagrams/*.puml.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'diagrams', 'generated');

/* hex → token. Roles: bg (box fill), line (outline), ink (text on the box) */
const ROLES = {
    hw: ['#dbeafe', '#1d4ed8', '#1e3a8a'],
    sw: ['#d1fae5', '#065f46', '#064e3b'],
    kern: ['#ede9fe', '#5b21b6', '#4c1d95'],
    isr: ['#fee2e2', '#991b1b', '#7f1d1d'],
    queue: ['#cffafe', '#0e7490', '#164e63'],
    gray: ['#f9fafb', '#374151', '#111827'],
    warn: ['#fef3c7', '#92400e', '#78350f'],
    app: ['#dcfce7', '#166534', '#14532d'],
};
const TOKENS = {
    '#6b7280': ['--dg-arrow', '#6b7280'],
    '#9ca3af': ['--dg-muted', '#6b7280'],
    /* PlantUML defaults: title text, footer text, table borders */
    '#000000': ['--dg-gray-ink', '#111827'],
    '#888888': ['--dg-muted', '#6b7280'],
    '#eef0f4': ['--dg-note-bg', '#eef0f4'],
    '#181818': ['--dg-gray-line', '#374151'],
};
for (const [role, hexes] of Object.entries(ROLES)) {
    ['bg', 'line', 'ink'].forEach((kind, i) => (TOKENS[hexes[i]] = [`--dg-${role}-${kind}`, hexes[i]]));
}

const token = (hex) => TOKENS[hex.toLowerCase()];

function themeTag(tag) {
    const styles = [];
    let out = tag.replace(/\s(fill|stroke)="(#[0-9a-fA-F]{6})"/g, (m, prop, hex) => {
        const t = token(hex);
        if (!t) return m;
        styles.push(`${prop}:var(${t[0]},${t[1]})`);
        return '';
    });
    /* PlantUML puts stroke colours inside style="" */
    out = out.replace(/\b(fill|stroke):(#[0-9a-fA-F]{6})/g, (m, prop, hex) => {
        const t = token(hex);
        return t ? `${prop}:var(${t[0]},${t[1]})` : m;
    });
    if (!styles.length) return out;
    if (/\sstyle="/.test(out))
        return out.replace(
            /\sstyle="([^"]*)"/,
            (_, s) => ` style="${s.replace(/;?$/, ';')}${styles.join(';')}"`
        );
    return out.replace(/\s*(\/?>)$/, ` style="${styles.join(';')}"$1`);
}

let changed = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.svg'))) {
    const p = path.join(DIR, file);
    const before = fs.readFileSync(p, 'utf8');
    let s = before
        .replace(/<\?[^>]*\?>\s*/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\sdata-[a-z-]+="[^"]*"/g, '')
        .replace(/font-family="sans-serif"/g, `font-family="'DM Sans',sans-serif"`)
        .replace(/@import url\([^)]*\);?/g, '')
        .replace(/\.bg\s*\{[^}]*\}\s*/g, '')
        .replace(/<rect class="bg"[^>]*\/>\s*/g, '')
        /* full-canvas white background: a rect with only width/height/fill */
        .replace(/<rect width="\d+" height="\d+" fill="#ffffff"\/>\s*/gi, '');
    s = s.replace(/<[a-zA-Z][^<>]*>/g, themeTag);
    if (s !== before) {
        fs.writeFileSync(p, s);
        changed++;
    }
    const left = s.match(/="#[0-9a-fA-F]{6}"/g);
    if (left) console.warn(`${file}: unmapped colours ${[...new Set(left)].join(' ')}`);
}
console.log(`themed ${changed} diagram(s) in ${path.relative(process.cwd(), DIR)}`);

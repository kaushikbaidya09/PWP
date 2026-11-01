/* rehypeDiagrams — replaces `![alt](/diagrams/name.svg)` with the SVG itself.
 *
 * An <img> SVG cannot see the page's CSS, so it could not follow the theme toggle.
 * Inlined, its tokens resolve against the current theme. IDs and <style> rules are
 * prefixed per diagram so several can share a page. A missing diagram fails the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { el, isEl } from './hast.mjs';

const SRC = /^\/diagrams\/([a-z0-9_]+)\.svg$/;
const cache = new Map();

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function scopeCss(css, scope) {
    return css.replace(/([^{}]+)\{/g, (_, sel) =>
        sel.trim().startsWith('@')
            ? `${sel}{`
            : sel
                  .split(',')
                  .map((s) => `.${scope} ${s.trim()}`)
                  .join(', ') + ' {'
    );
}

function load(name) {
    if (cache.has(name)) return cache.get(name);
    let svg = fs.readFileSync(path.join(process.cwd(), 'diagrams/generated', `${name}.svg`), 'utf8');
    const scope = `dg-${name.replace(/_/g, '-')}`;
    for (const [, id] of svg.matchAll(/\sid="([^"]+)"/g)) {
        svg = svg
            .replaceAll(`id="${id}"`, `id="${scope}-${id}"`)
            .replaceAll(`url(#${id})`, `url(#${scope}-${id})`)
            .replaceAll(`href="#${id}"`, `href="#${scope}-${id}"`);
    }
    svg = svg.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${scopeCss(css, scope)}</style>`);
    /* size by CSS (width:100%) and never scale past natural size */
    svg = svg.replace(/<svg\b([^>]*)>/, (_, attrs) => {
        const kept = attrs.replace(
            /\s(width|height|class|aria-label|role|style|preserveAspectRatio|zoomAndPan|contentStyleType)="[^"]*"/g,
            ''
        );
        const natural = /viewBox="0 0 ([\d.]+)/.exec(attrs)?.[1];
        const cap = natural ? ` style="max-width:${natural}px"` : '';
        return `<svg${kept} class="diagram ${scope}"${cap} role="img" aria-label="__ALT__">`;
    });
    cache.set(name, svg.trim());
    return cache.get(name);
}

export function rehypeDiagrams() {
    const walk = (node) => {
        (node.children || []).forEach((child, i) => {
            const img = isEl(child, 'p') && child.children.length === 1 && child.children[0];
            const m = isEl(img, 'img') && SRC.exec(String(img.properties.src));
            if (m) {
                const svg = load(m[1]).replace('__ALT__', esc(String(img.properties.alt || '')));
                node.children[i] = el('figure', { className: ['diagram-figure'] }, [
                    { type: 'raw', value: svg },
                ]);
            } else if (isEl(child)) {
                walk(child);
            }
        });
    };
    return walk;
}

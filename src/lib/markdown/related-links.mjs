/* rehypeRelatedLinks — turns Related Topics list items that name an article into links. */
import fs from 'node:fs';
import path from 'node:path';
import { el, isEl, text, textOf } from './hast.mjs';

const BASE = (process.env.SITE_BASE || '').replace(/\/$/, '');
const normal = (s) => s.toLowerCase().replace(/-/g, ' ');

/* Short article names ("Bare-Metal Architecture") -> URL, longest first */
function articleIndex() {
    const dir = path.join(process.cwd(), 'src/content/knowledge');
    const out = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
        const head = fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 600);
        const title = /^title:\s*"?(.+?)"?$/m.exec(head)?.[1];
        if (!title) continue;
        const href = `${BASE}/knowledge/${file.slice(0, -3)}/`;
        const name = title.split(':')[0].trim();
        out.push({ name, href });
        /* some titles end "... in Embedded Firmware"; match the short form too */
        const short = name.replace(/ in Embedded .*$/, '');
        if (short !== name) out.push({ name: short, href });
    }
    return out.sort((a, b) => b.name.length - a.name.length);
}
let articles;

function firstText(node) {
    for (let i = 0; i < (node.children || []).length; i++) {
        const c = node.children[i];
        if (c.type === 'text' && c.value.trim()) return { parent: node, index: i, node: c };
        const found = isEl(c) ? firstText(c) : null;
        if (found) return found;
    }
    return null;
}

function linkItem(li) {
    const hit = firstText(li);
    if (!hit) return;
    const value = hit.node.value.trimStart();
    const lower = normal(value);
    const match = articles.find((a) => {
        const name = normal(a.name);
        return lower.startsWith(name) && !/[a-z0-9]/.test(lower[name.length] || ' ');
    });
    if (!match) throw new Error(`Related Topics: "${value}" does not name an article`);
    const n = match.name.length;
    hit.parent.children.splice(
        hit.index,
        1,
        el('a', { href: match.href }, [text(value.slice(0, n))]),
        text(value.slice(n))
    );
}

export function rehypeRelatedLinks() {
    return (tree) => {
        articles ??= articleIndex();
        let inside = false;
        for (const node of tree.children) {
            if (isEl(node, 'h2')) inside = textOf(node).trim().toLowerCase() === 'related topics';
            else if (inside && isEl(node, 'ul')) node.children.filter((c) => isEl(c, 'li')).forEach(linkItem);
        }
    };
}

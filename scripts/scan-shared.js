/* scan-shared.js — helpers shared by all scan-*.js scripts */
'use strict';

const FILE_RE = /^(\d+)_(.+)\.md$/;

function slugify(str) {
    return str
        .toLowerCase()
        .replaceAll(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
}

/* Parses optional YAML frontmatter (--- ... ---).
 * extraScalars: additional scalar field names beyond id/title/brief.
 * extraArrays:  additional array field names beyond tags. */
function parseFrontmatter(content, extraScalars, extraArrays) {
    const fm = { id: '', title: '', brief: '', tags: [] };
    (extraScalars || []).forEach((k) => {
        fm[k] = '';
    });
    (extraArrays || []).forEach((k) => {
        fm[k] = [];
    });

    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!m) return { fm, body: content };
    const block = m[1];
    const body = content.slice(m[0].length);

    const get = (k) => {
        const r = block.match(new RegExp(String.raw`^${k}:\s*(.+)`, 'm'));
        return r ? r[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    const getArray = (k) => {
        const inlineM = block.match(new RegExp(String.raw`^${k}:\s*\[([^\]]*)\]`, 'm'));
        if (inlineM)
            return inlineM[1]
                .split(',')
                .map((s) => s.trim().replace(/^["']|["']$/g, ''))
                .filter(Boolean);
        const blockM = block.match(new RegExp(String.raw`^${k}:\s*\n((?:\s*-\s*.+\n?)+)`, 'm'));
        if (blockM)
            return (blockM[1].match(/\s*-\s*(.+)/g) || []).map((s) =>
                s.replace(/^\s*-\s*/, '').trim()
            );
        return [];
    };

    fm.id = get('id');
    fm.title = get('title');
    fm.brief = get('brief');
    fm.tags = getArray('tags');
    (extraScalars || []).forEach((k) => {
        fm[k] = get(k);
    });
    (extraArrays || []).forEach((k) => {
        fm[k] = getArray(k);
    });

    return { fm, body };
}

function extractTitle(lines) {
    for (let i = 0; i < lines.length; i++) {
        const atx = lines[i].match(/^#{1,2}\s+(.+)/);
        if (atx) return atx[1].trim();
        if (i + 1 < lines.length && /^=+$/.test(lines[i + 1].trim()) && lines[i].trim())
            return lines[i].trim();
    }
    return '';
}

function extractBrief(lines) {
    const para = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^#{1,6}\s/.test(line)) continue;
        if (i + 1 < lines.length && /^[=-]{2,}$/.test(lines[i + 1].trim()) && lines[i].trim()) {
            i++;
            continue;
        }
        if (!line.trim()) {
            if (para.length) break;
            continue;
        }
        if (/^(```|>|[-*+]\s|\d+\.\s|---+)/.test(line.trim())) continue;
        para.push(line.trim());
    }
    const text = para
        .join(' ')
        .replace(/[*_`~[\]]/g, '')
        .trim();
    return text.length > 220 ? text.slice(0, 217) + '...' : text;
}

function sortByIndex(files) {
    return files.sort(
        (a, b) =>
            Number.parseInt(a.match(FILE_RE)[1], 10) - Number.parseInt(b.match(FILE_RE)[1], 10)
    );
}

module.exports = { FILE_RE, slugify, parseFrontmatter, extractTitle, extractBrief, sortByIndex };

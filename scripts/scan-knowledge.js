#!/usr/bin/env node
/**
 * scan-knowledge.js
 *
 * Scans Knowledge/ for files matching the naming convention:
 *   <index>_<Title_Name>.md   e.g.  01_MCU_Boot_Sequence.md
 *
 * For each matching file, reads optional YAML frontmatter for metadata,
 * then falls back to extracting the title from the first heading and the
 * brief from the first paragraph.
 *
 * Writes Knowledge/manifest.json and Knowledge/manifest.js.
 * manifest.js sets globalThis.KNOWLEDGE_MANIFEST so the page works when
 * opened via file:// (no server); fetch() of manifest.json is the fallback.
 *
 * Usage:
 *   node scripts/scan-knowledge.js
 *
 * Run this script after adding or removing any .md file in Knowledge/.
 *
 * Supported frontmatter fields (all optional):
 *   id:    custom card id (defaults to slugified filename title)
 *   title: card heading (defaults to first # heading or setext heading)
 *   brief: card subtitle (defaults to first paragraph text, max 220 chars)
 *   tags:  [tag1, tag2]  or YAML list
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { slugify } = require('./scan-shared');

const ROOT = path.join(__dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'data', 'Knowledge');
const OUT_FILE = path.join(KNOWLEDGE_DIR, 'manifest.json');
const FILE_RE = /^(\d+)_(.+)\.md$/;

/**
 * Parses optional YAML frontmatter (--- ... ---) from the top of a file.
 * Supports: id, title, brief, tags (inline array or block list).
 * Returns { fm, body } where body is the content after the frontmatter block.
 */
function parseFrontmatter(content) {
    const fm = { id: '', title: '', brief: '', tags: [] };
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!m) return { fm, body: content };

    const block = m[1];
    const body = content.slice(m[0].length);

    const get = (key) => {
        const r = block.match(new RegExp(String.raw`^${key}:\s*(.+)`, 'm'));
        return r ? r[1].trim() : '';
    };
    fm.id = get('id');
    fm.title = get('title');
    fm.brief = get('brief');

    const tagsI = block.match(/^tags:\s*\[([^\]]*)\]/m);
    if (tagsI) {
        fm.tags = tagsI[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    } else {
        const tagsB = block.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
        if (tagsB) {
            fm.tags = (tagsB[1].match(/\s*-\s*(.+)/g) || []).map((s) =>
                s.replace(/^\s*-\s*/, '').trim()
            );
        }
    }

    return { fm, body };
}

/* Returns the first non-blank line at or after index `start`. */
function firstNonBlank(lines, start) {
    for (let i = start; i < lines.length; i++) {
        if (lines[i].trim()) return lines[i].trim();
    }
    return '';
}

/* Returns true when a line looks like a setext underline (=== or ---). */
function isSetextUnderline(line) {
    return /^[=-]{2,}$/.test(line.trim());
}

/**
 * Extracts the article title from the first heading in the body.
 * Handles ATX headings (# Title) and setext headings (Title\n====).
 * Special case: if the setext label is "TITLE", the actual title is the
 * next non-blank line after the underline.
 */
function extractTitle(lines) {
    for (let i = 0; i < lines.length; i++) {
        const atx = lines[i].match(/^#{1,2}\s+(.+)/);
        if (atx) return atx[1].trim();

        if (i + 1 < lines.length && isSetextUnderline(lines[i + 1]) && lines[i].trim()) {
            if (lines[i].trim().toUpperCase() === 'TITLE') {
                return firstNonBlank(lines, i + 2);
            }
            return lines[i].trim();
        }
    }
    return '';
}

/* Returns true for lines that should be skipped when collecting a brief. */
function isBriefSkippable(line) {
    return /^(```|>|[-*+]\s|\d+\.\s|---+|\*{3,})/.test(line.trim());
}

/* Classify a line for extractBrief: 'blank' | 'setext' | 'skip' | 'collect' */
function classifyBriefLine(lines, i, skipNext) {
    const trimmed = lines[i].trim();
    if (!trimmed) return 'blank';
    if (i + 1 < lines.length && isSetextUnderline(lines[i + 1])) return 'setext';
    if (/^#{1,6}\s/.test(lines[i]) || isBriefSkippable(lines[i]) || skipNext) return 'skip';
    return 'collect';
}

/**
 * Extracts a short brief from the first non-heading paragraph.
 * Strips basic Markdown syntax before truncating to 220 characters.
 */
function extractBrief(lines) {
    const para = [];
    let skipNext = false;
    let i = 0;

    while (i < lines.length) {
        const kind = classifyBriefLine(lines, i, skipNext);
        if (kind === 'blank' && para.length) break;
        if (kind === 'setext') {
            if (lines[i].trim().toUpperCase() === 'TITLE') skipNext = true;
            i += 2;
            continue;
        }
        if (kind === 'collect') para.push(lines[i].trim());
        if (kind === 'skip') skipNext = false;
        i++;
    }

    const text = para
        .join(' ')
        .replace(/[*_`~[\]]/g, '')
        .trim();
    return text.length > 220 ? text.slice(0, 217) + '...' : text;
}

/* ── Scan ─────────────────────────────────────────────────────────────────── */

const files = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => FILE_RE.test(f))
    .sort((a, b) => {
        const na = Number.parseInt(a.match(FILE_RE)[1], 10);
        const nb = Number.parseInt(b.match(FILE_RE)[1], 10);
        return na - nb;
    });

if (!files.length) {
    console.log('No files matching <index>_<Title>.md found in Knowledge/.');
    process.exit(0);
}

const entries = files.map((file) => {
    const [, num, rawTitle] = file.match(FILE_RE);
    const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    const lines = body.split(/\r?\n/);

    return {
        id: fm.id || slugify(rawTitle),
        num,
        file,
        title: fm.title || extractTitle(lines) || rawTitle.replaceAll('_', ' '),
        brief: fm.brief || extractBrief(lines),
        tags: fm.tags,
    };
});

fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2) + '\n');

console.log(`Wrote manifest.json — ${entries.length} topic(s):`);
entries.forEach((e) => console.log(`  [${e.num}] ${e.id}  "${e.title}"`));

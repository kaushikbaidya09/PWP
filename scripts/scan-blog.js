#!/usr/bin/env node
/**
 * scan-blog.js
 * Scans Blog/ for NN_Title.md files and writes Blog/manifest.json.
 * Run: node scripts/scan-blog.js
 *
 * Frontmatter: id, title, brief, date, tags (all optional).
 * The date is appended as the last tag in the card.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    FILE_RE,
    slugify,
    parseFrontmatter,
    extractTitle,
    extractBrief,
    sortByIndex,
} = require('./scan-shared');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'Blog');
const OUT_FILE = path.join(DIR, 'manifest.json');

if (!fs.existsSync(DIR)) {
    console.log('Blog/ folder not found.');
    process.exit(1);
}

const files = sortByIndex(fs.readdirSync(DIR).filter((f) => FILE_RE.test(f)));
if (!files.length) {
    console.log('No files matching <index>_<Title>.md found in Blog/.');
    process.exit(0);
}

const entries = files.map((file) => {
    const [, num, rawTitle] = file.match(FILE_RE);
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
    const { fm, body } = parseFrontmatter(raw, ['date']);
    const lines = body.split(/\r?\n/);
    const tags = fm.date ? [...fm.tags, fm.date] : fm.tags;
    return {
        id: fm.id || slugify(rawTitle),
        num,
        file,
        title: fm.title || extractTitle(lines) || rawTitle.replaceAll('_', ' '),
        brief: fm.brief || extractBrief(lines),
        tags,
    };
});

fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2) + '\n');
console.log(`Blog/manifest.json: ${entries.length} post(s)`);
entries.forEach((e) => console.log(`  [${e.num}] ${e.id}  "${e.title}"`));

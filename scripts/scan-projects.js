#!/usr/bin/env node
/**
 * scan-projects.js
 * Scans Projects/ for NN_Title.md files and writes Projects/manifest.json.
 * Run: node scripts/scan-projects.js
 *
 * Frontmatter fields: id, title, brief, tags (all optional).
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
const DIR = path.join(ROOT, 'data', 'Projects');
const OUT_FILE = path.join(DIR, 'manifest.json');

if (!fs.existsSync(DIR)) {
    console.log('Projects/ folder not found.');
    process.exit(1);
}

const files = sortByIndex(fs.readdirSync(DIR).filter((f) => FILE_RE.test(f)));
if (!files.length) {
    console.log('No files matching <index>_<Title>.md found in Projects/.');
    process.exit(0);
}

const entries = files.map((file) => {
    const [, num, rawTitle] = file.match(FILE_RE);
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
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
console.log(`Projects/manifest.json: ${entries.length} project(s)`);
entries.forEach((e) => console.log(`  [${e.num}] ${e.id}  "${e.title}"`));

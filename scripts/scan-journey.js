#!/usr/bin/env node
/**
 * scan-journey.js
 * Scans Journey/ for NN_Title.md files and writes Journey/manifest.json.
 * Run: node scripts/scan-journey.js
 *
 * Frontmatter fields (all optional):
 *   title  — overrides the extracted # heading
 *   brief  — overrides the extracted first paragraph
 *   tags   — tag list  e.g. ["2019 — 2021", "FreeRTOS"]
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
const DIR = path.join(ROOT, 'data', 'Journey');
const OUT_FILE = path.join(DIR, 'manifest.json');

if (!fs.existsSync(DIR)) {
    console.log('Journey/ folder not found.');
    process.exit(1);
}

const files = sortByIndex(fs.readdirSync(DIR).filter((f) => FILE_RE.test(f)));
if (!files.length) {
    console.log('No NN_Title.md files found in Journey/.');
    process.exit(0);
}

const entries = files.map((file) => {
    const [, num, rawTitle] = file.match(FILE_RE);
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    const lines = body.split(/\r?\n/);
    return {
        num,
        file,
        title: fm.title || extractTitle(lines) || rawTitle.replaceAll('_', ' '),
        brief: fm.brief || extractBrief(lines),
        tags: fm.tags,
    };
});

fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2) + '\n');
console.log(`Journey/manifest.json: ${entries.length} milestone(s)`);
entries.forEach((e) => console.log(`  [${e.num}] "${e.title}"`));

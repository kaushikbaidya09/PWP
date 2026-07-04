#!/usr/bin/env node
/**
 * convert-drafts.js
 *
 * Converts every Draft/<NN>_<Title>.txt to Knowledge/<NN>_<Title>.md
 * using actual ATX Markdown headings (#, ##, ###).
 *
 * Skips files where the Knowledge/ counterpart already exists.
 *
 * Usage:  node scripts/convert-drafts.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DRAFT_DIR = path.join(__dirname, '..', 'Draft');
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'Knowledge');
const FILE_RE = /^(\d+)_(.+)\.txt$/;

/* ── Per-topic metadata ───────────────────────────────────────────────────── */
const TOPIC_META = {
    '01': { tags: ['Startup', 'Cortex-M', 'Linker', 'Reset'] },
    '02': { tags: ['Flash', 'SRAM', 'Memory Map', 'Stack'] },
    '03': { tags: ['Pipeline', 'Cortex-M', 'Registers', 'ABI'] },
    '04': { tags: ['NVIC', 'ISR', 'Priority', 'Latency'] },
    '05': { tags: ['PLL', 'Prescaler', 'Oscillator', 'HSI'] },
    '06': { tags: ['Events', 'Callbacks', 'Non-blocking'] },
    '07': { tags: ['FSM', 'State Machine', 'UML', 'Transitions'] },
    '08': { tags: ['HAL', 'Architecture', 'Bare-metal'] },
    '09': { tags: ['RTOS', 'FreeRTOS', 'Scheduler', 'Tasks'] },
    10: { tags: ['Mutex', 'Semaphore', 'Race Condition', 'Critical Section'] },
    11: { tags: ['GPIO', 'Registers', 'Pull-Up', 'Open-Drain'] },
    12: { tags: ['Timers', 'PWM', 'Capture', 'Overflow'] },
    13: { tags: ['ADC', 'DAC', 'Sampling', 'Signal'] },
    14: { tags: ['DMA', 'Transfer', 'Circular Buffer'] },
    15: { tags: ['UART', 'SPI', 'I2C', 'Protocols'] },
    16: { tags: ['UART', 'Baud Rate', 'Framing', 'RS-232'] },
    17: { tags: ['SPI', 'MOSI', 'MISO', 'Clock Polarity'] },
    18: { tags: ['I2C', 'ACK', 'Address', 'Pull-Up'] },
    19: { tags: ['CAN', 'Arbitration', 'Frame', 'Differential'] },
    20: { tags: ['Watchdog', 'IWDG', 'WWDG', 'Reset'] },
    21: { tags: ['HardFault', 'CFSR', 'Cortex-M', 'Debug'] },
    22: { tags: ['JTAG', 'SWD', 'GDB', 'Breakpoints'] },
    23: { tags: ['Corruption', 'Overflow', 'Heap', 'Stability'] },
    24: { tags: ['Linker', '.text', '.data', '.bss'] },
    25: { tags: ['Bootloader', 'OTA', 'Flash', 'Firmware'] },
    26: { tags: ['Sleep', 'Clock Gating', 'Power', 'LPM'] },
    27: { tags: ['Security', 'TrustZone', 'Crypto', 'Secure Boot'] },
    28: { tags: ['HAL', 'Driver', 'BSP', 'Architecture'] },
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const MINOR_WORDS = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'for',
    'in',
    'on',
    'at',
    'to',
    'of',
    'with',
    'by',
    'vs',
    'via',
]);

function toTitleCase(str) {
    return str
        .toLowerCase()
        .split(/\s+/)
        .map((w, i) => {
            if (w.includes('-')) {
                return w
                    .split('-')
                    .map((p, j) =>
                        j === 0 || !MINOR_WORDS.has(p) ? p.charAt(0).toUpperCase() + p.slice(1) : p
                    )
                    .join('-');
            }
            return i === 0 || !MINOR_WORDS.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w;
        })
        .join(' ');
}

function isAllCaps(str) {
    return /^[A-Z][A-Z0-9\s\-\/\(\)\.]+$/.test(str) && !/[a-z]/.test(str);
}

/** Parse setext-style sections: HEADING\n=====\nbody */
function parseSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trimEnd();
        // next line is purely = chars
        if (i + 1 < lines.length && /^=+\s*$/.test(lines[i + 1]) && trimmed.trim()) {
            if (current) sections.push(current);
            current = { heading: trimmed.trim(), body: [] };
            i++; // skip ====
        } else if (current) {
            current.body.push(raw.replace(/^ {0,4}/, '').trimEnd());
        }
    }
    if (current) sections.push(current);
    return sections;
}

const DIAG_LABELS = [
    'Symptom',
    'Possible Cause',
    'Root Cause',
    'Investigation Method',
    'Resolution',
    'Cause',
    'Effect',
    'Fix',
    'Note',
    'Problem',
    'Solution',
];
const DIAG_RE = new RegExp('\\b(' + DIAG_LABELS.join('|') + ')\\s*:', 'g');

/** Convert one blank-line-delimited body block to Markdown */
function convertBlock(block) {
    const stripped = block.split('\n').map((l) => l.replace(/^ {0,4}/, '').trimEnd());
    // Reflow into a single line
    const reflowed = stripped.join(' ').replace(/\s+/g, ' ').trim();
    if (!reflowed) return '';

    // Single ALL CAPS label → ### sub-heading
    if (isAllCaps(reflowed) && reflowed.split(/\s+/).length <= 8) {
        return '### ' + toTitleCase(reflowed);
    }

    // STEP N - DESCRIPTION
    const stepM = reflowed.match(/^(STEP\s+\d+)\s*-+\s*(.+)/i);
    if (stepM) {
        return '### ' + toTitleCase(stepM[1]) + ': ' + toTitleCase(stepM[2]);
    }

    // N. ALL CAPS HEADING. body
    const numCapsM = reflowed.match(/^(\d+)\.\s+([A-Z][A-Z0-9\s\-\/\(\)\.]*?)\.\s+(.*)/);
    if (numCapsM && isAllCaps(numCapsM[2].trim())) {
        return numCapsM[1] + '. **' + toTitleCase(numCapsM[2].trim()) + '.** ' + numCapsM[3];
    }

    // ALL CAPS TERM - definition (term must be 2+ chars, all caps)
    const capsM = reflowed.match(/^([A-Z][A-Z0-9\/\s\(\)\-\.]{1,}?)\s+-{1,2}\s+(.+)/);
    if (capsM && isAllCaps(capsM[1].trim()) && capsM[1].trim().length >= 2) {
        return '**' + toTitleCase(capsM[1].trim()) + '** — ' + capsM[2];
    }

    // Diagnostic block (Symptom:, Possible Cause:, etc.)
    if (DIAG_RE.test(reflowed)) {
        DIAG_RE.lastIndex = 0;
        const out = reflowed.replace(DIAG_RE, '\n\n**$1:**');
        return out.replace(/^\n\n/, '');
    }

    return reflowed;
}

function convertBody(bodyLines) {
    const raw = bodyLines
        .map((l) => l.replace(/^ {0,4}/, '').trimEnd())
        .join('\n')
        .trim();
    const blocks = raw.split(/\n{2,}/);
    return blocks.map(convertBlock).filter(Boolean).join('\n\n');
}

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const files = fs
    .readdirSync(DRAFT_DIR)
    .filter((f) => FILE_RE.test(f))
    .sort();

for (const file of files) {
    const [, num, rawTitle] = file.match(FILE_RE);
    const outPath = path.join(KNOWLEDGE_DIR, `${num}_${rawTitle}.md`);

    if (fs.existsSync(outPath)) {
        console.log(`SKIP (exists): Knowledge/${num}_${rawTitle}.md`);
        continue;
    }

    const content = fs.readFileSync(path.join(DRAFT_DIR, file), 'utf8');
    const sections = parseSections(content);
    if (!sections.length) {
        console.log(`SKIP (no sections): ${file}`);
        continue;
    }

    /* Determine title and body sections */
    let title = '';
    let bodySections = [];

    if (isAllCaps(sections[0].heading) && sections[0].heading === 'TITLE') {
        // Format B: TITLE section
        title =
            sections[0].body.filter((l) => l.trim()).map((l) => l.trim())[0] ||
            rawTitle.replace(/_/g, ' ');
        bodySections = sections.slice(1);
    } else if (isAllCaps(sections[0].heading)) {
        // All-caps first section but not TITLE — treat as section heading, extract title differently
        // Try to find a TITLE section anywhere
        const ts = sections.find((s) => s.heading === 'TITLE');
        if (ts) {
            title =
                ts.body.filter((l) => l.trim()).map((l) => l.trim())[0] ||
                rawTitle.replace(/_/g, ' ');
            bodySections = sections.filter((s) => s.heading !== 'TITLE');
        } else {
            title = rawTitle.replace(/_/g, ' ');
            bodySections = sections;
        }
    } else {
        // Format A: first heading IS the article title (mixed case)
        title = sections[0].heading;
        bodySections = sections.slice(1);
    }

    const meta = TOPIC_META[num] || { tags: [] };
    const id = slugify(rawTitle);
    const tags = meta.tags;

    /* Build Markdown */
    const out = [];
    out.push('---');
    out.push(`id: ${id}`);
    out.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`);
    out.push('---');
    out.push('');
    out.push(`# ${title}`);
    out.push('');

    for (const sec of bodySections) {
        if (sec.heading === 'TITLE') continue;
        out.push(`## ${toTitleCase(sec.heading)}`);
        out.push('');
        const body = convertBody(sec.body);
        if (body) {
            out.push(body);
            out.push('');
        }
    }

    const md = out.join('\n').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(outPath, md);
    console.log(`Created: Knowledge/${num}_${rawTitle}.md`);
}

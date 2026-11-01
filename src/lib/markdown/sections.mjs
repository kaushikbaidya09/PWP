/* rehypeSections — shapes long articles for reading.
 *
 * - drops the leading `# Title` (the page renders the title itself)
 * - moves `## Summary` / `## Key Takeaways` to the top as an "In short" box,
 *   showing one paragraph with the rest expandable
 * - folds reference sections (mistakes, debugging, expert notes…) into <details>
 * - records core and full reading time in the entry's frontmatter
 */
import { el, isEl, text, textOf } from './hast.mjs';

const SUMMARY = new Set(['summary', 'key takeaways']);
const DEEP = new Set([
    'under the hood',
    'real-world applications',
    'common mistakes',
    'debugging and troubleshooting',
    'design considerations and best practices',
    'expert notes',
    'further reading',
]);
const WPM = 220;

const words = (nodes) => nodes.map(textOf).join(' ').split(/\s+/).filter(Boolean).length;
const minutes = (n) => Math.max(1, Math.round(n / WPM));

function inShort(body) {
    const paras = body.filter((b) => b.type === 'element');
    const more = paras.slice(1);
    return el('aside', { className: ['tldr'] }, [
        el('p', { className: ['tldr__label'] }, [text('In short')]),
        ...paras.slice(0, 1),
        ...(more.length
            ? [
                  el('details', { className: ['tldr__more'] }, [
                      el('summary', {}, [text('Read the full summary')]),
                      ...more,
                  ]),
              ]
            : []),
    ]);
}

const fold = (heading, body, n) =>
    el('details', { className: ['deep'] }, [
        el('summary', {}, [heading, el('span', { className: ['deep__time'] }, [text(`${minutes(n)} min`)])]),
        el('div', { className: ['deep__body'] }, body),
    ]);

const deepHeader = () =>
    el('div', { className: ['deep-tools'] }, [
        el('p', {}, [text('Deep dives')]),
        el('button', { type: 'button', id: 'deep-toggle', hidden: true }, [text('Expand all')]),
    ]);

export function rehypeSections() {
    return (tree, file) => {
        const intro = [];
        const sections = [];
        for (const node of tree.children) {
            if (isEl(node, 'h1')) continue;
            if (isEl(node, 'h2')) sections.push({ heading: node, body: [] });
            else if (sections.length) sections[sections.length - 1].body.push(node);
            else intro.push(node);
        }

        let summary = null;
        let hasDeep = false;
        let coreWords = words(intro);
        let allWords = coreWords;
        const out = [];
        for (const s of sections) {
            const name = textOf(s.heading).trim().toLowerCase();
            const n = words([s.heading, ...s.body]);
            allWords += n;
            if (SUMMARY.has(name) && !summary) {
                summary = inShort(s.body);
                coreWords += n;
            } else if (DEEP.has(name)) {
                if (!hasDeep) out.push(deepHeader());
                hasDeep = true;
                out.push(fold(s.heading, s.body, n));
            } else {
                out.push(s.heading, ...s.body);
                coreWords += n;
            }
        }
        tree.children = [...(summary ? [summary] : []), ...intro, ...out];

        const fm = file.data.astro?.frontmatter;
        if (fm) {
            fm.coreMinutes = minutes(coreWords);
            fm.fullMinutes = minutes(allWords);
        }
    };
}

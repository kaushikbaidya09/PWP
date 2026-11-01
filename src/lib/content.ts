import { getCollection, type CollectionEntry, type CollectionKey } from 'astro:content';

export const PHASES = [
    'Core Foundations',
    'How Embedded Systems Are Structured',
    'Hardware Interaction',
    'Communication',
    'Reliability and Debugging',
    'Advanced Foundations',
    'Embedded Cybersecurity',
    'Embedded Linux',
    'Connectivity and Protocols',
    'Writing Reliable Firmware',
    'Shipping Real Products',
];

/* Title from frontmatter, falling back to the first `# Heading` in the body. */
export function titleOf(entry: { data: { title?: string }; body?: string }): string {
    if (entry.data.title) return entry.data.title;
    const m = (entry.body || '').match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : 'Untitled';
}

/* Prose words, ignoring the title line and raw HTML (diagrams). */
export function proseWords(body = ''): number {
    return body
        .replace(/^#\s+.*$/m, '')
        .replace(/<[^>]+>/g, ' ')
        .split(/\s+/)
        .filter((w) => /[A-Za-z]/.test(w)).length;
}

/* Published entries in order. A published entry with no real text fails the
 * build instead of shipping an empty page — set `draft: true` until it is written. */
export async function published<C extends CollectionKey>(
    name: C,
    { needsBody = true } = {}
): Promise<CollectionEntry<C>[]> {
    const all = (await getCollection(name)) as CollectionEntry<C>[];
    const live = all.filter((e) => !(e.data as { draft?: boolean }).draft);
    if (needsBody) {
        for (const e of live) {
            if (proseWords(e.body) < 80) {
                throw new Error(
                    `${name}/${e.id} has almost no text (${proseWords(e.body)} words). ` +
                        'Write it or mark it `draft: true`.'
                );
            }
        }
    }
    return live.sort((a, b) => (a.data as { order: number }).order - (b.data as { order: number }).order);
}

/* Card number from list position, so inserting an article never means renumbering. */
export const pad = (n: number) => String(n).padStart(2, '0');

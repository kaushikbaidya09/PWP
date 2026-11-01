import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/* An entry's URL comes from its file name. `draft: true` keeps it off the site. */
const base = z.object({
    title: z.string().optional(),
    brief: z.string().min(20, 'brief is the card text — write one sentence'),
    tags: z.array(z.string()).default([]),
    /* position in the list; only the relative order matters */
    order: z.number(),
    draft: z.boolean().default(false),
});

export const collections = {
    knowledge: defineCollection({
        loader: glob({ pattern: '*.md', base: './src/content/knowledge' }),
        schema: base.extend({ title: z.string(), phase: z.number().int().min(1).max(11) }),
    }),
    projects: defineCollection({
        loader: glob({ pattern: '*.md', base: './src/content/projects' }),
        schema: base,
    }),
    blog: defineCollection({
        loader: glob({ pattern: '*.md', base: './src/content/blog' }),
        schema: base.extend({ date: z.coerce.date() }),
    }),
    journey: defineCollection({
        loader: glob({ pattern: '*.md', base: './src/content/journey' }),
        schema: base,
    }),
};

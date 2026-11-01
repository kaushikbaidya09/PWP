# PWP — Personal Website / Portfolio

Kaushik Baidya's embedded-systems portfolio and knowledge base. Built with [Astro](https://astro.build) into plain static HTML. Content is Markdown with frontmatter, and page copy is JSON.

The same code deploys to two places:

| Host | Address | Contact form |
| --- | --- | --- |
| Home server (nginx) | `/` | Works, through `contact-api` |
| GitHub Pages | `https://kaushikbaidya09.github.io/PWP/` | Hidden, because Pages has no backend |

## Build

**Home server**, from the home-server repo root. No Node install is needed on the host:

```bash
docker compose run --rm pwp-build
```

This renders diagrams, builds into `dist.new`, checks every internal link, then swaps it in as `dist`. A failed build leaves the live site untouched.

**GitHub Pages** deploys through `.github/workflows/pages.yml` on every push to `main`. Pull requests are built and checked but not deployed. In the repository settings, set Pages → Source to **GitHub Actions**.

**Locally**, with Node 22 or newer:

```bash
npm ci
npm run dev       # live preview
npm run build     # build into dist/
npm run check     # type check, then check links in dist/
npm run format    # format code with Prettier
```

The build **fails on purpose** when content is broken: a missing `brief`, a wrong `phase`, a missing diagram, or a published post with almost no text.

### Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `SITE_URL` | none | Public URL. Turns on canonical links and the sitemap. |
| `SITE_BASE` | `/` | Sub-path the site is served from, such as `/PWP`. |
| `PUBLIC_CONTACT_FORM` | on | `off` hides the form without contacting a backend. |
| `OUT_DIR` | `dist` | Build output folder. |

Internal links must go through `url()` from `src/lib/url.ts`, or they will break on GitHub Pages. `npm run check` catches any that do not, when run with `SITE_BASE` set.

## Layout

```
PWP/
├── src/
│   ├── content/                Markdown; the file name is the URL
│   │   ├── knowledge/          /knowledge/<file>/
│   │   ├── projects/           /projects/<file>/
│   │   ├── blog/               /blog/<file>/
│   │   └── journey/            experience timeline on the About page
│   ├── content.config.ts       frontmatter schema for each collection
│   ├── data/*.json             page copy: about, contact, nav, section intros
│   ├── pages/                  routes
│   ├── layouts/Base.astro      nav, footer, theme bootstrap
│   ├── components/             Article, Card, Icon, LayoutToggle
│   ├── lib/content.ts          published entries, phase names
│   ├── lib/url.ts              base-path aware links
│   ├── lib/markdown/           rehype plugins: diagrams, tables, links, sections
│   ├── scripts/                site.ts on every page, plus one file per page type
│   └── styles/                 main.css imports the others, in order
├── diagrams/*.puml             PlantUML sources; _theme.iuml is the shared style
├── diagrams/generated/         rendered SVGs (committed, so Pages needs no PlantUML)
├── scripts/                    theme-diagrams.mjs, check-links.mjs
└── doc/                        roadmap and article template
```

## Writing content

### Knowledge article: `src/content/knowledge/my-topic.md`

Follow `doc/Knowledge_Base_Article_Template.txt`.

```markdown
---
title: "DMA: Moving Data Without CPU Intervention"
brief: "One sentence for the card and the page intro."
order: 14
phase: 3
tags: ["DMA", "Circular Buffer"]
---

Intro paragraph…

## The Fundamental Problem
```

- `order` sets the position, and only relative order matters. To insert between 14 and 15, use `14.5`. Card numbers are worked out automatically.
- `phase` is 1–11. Phase names are in `src/lib/content.ts`.
- The `## Summary` becomes the **In short** box, and reference sections fold away. The full list is in `src/lib/markdown/sections.mjs`.
- Standard Markdown tables work and scroll sideways on phones.
- Items under `## Related Topics` that start with an article's name become links.

### Blog post: `src/content/blog/my-post.md`

Same idea, with `title`, `date` (such as `2024-03-14`), `brief`, `tags` and `order`. Use `draft: true` until it is written. The Blog link appears in the nav once a post is published.

### Project: `src/content/projects/my-project.md`

`brief`, `tags`, `order`, a `# Title` and a diagram. Each project gets a card and its own page.

### About page

Edit `src/data/about.json` and `src/content/journey/*.md`.

## Diagrams

Add `diagrams/my_diagram.puml`:

```plantuml
@startuml
!include _theme.iuml
left to right direction
rectangle "<b>Device</b>" as d <<sw>>
rectangle "<b>Server</b>" as s <<kern>>
d --> s
@enduml
```

Use it in Markdown with:

```markdown
![What the diagram shows](/diagrams/my_diagram.svg)
```

The next home-server build renders it. Commit the generated SVG too, as GitHub Pages does not run PlantUML.

- Roles are the stereotypes `hw`, `sw`, `kern`, `isr`, `queue`, `warn` and `app`. With no stereotype, a box is neutral.
- Keep diagrams to one idea and a few words.
- For stacked layouts such as memory maps, use a `rectangle` block with `$HW`, `$SW`… table rows, so that all rows are equally wide.
- Link nested boxes directly, with `left to right direction`, to keep their order.
- SVGs are inlined at build time, so they follow the theme. `scripts/theme-diagrams.mjs` swaps palette colours for theme tokens, so use only the colours in `_theme.iuml`.

## Contact form

The form posts to `/api/contact`, which nginx proxies to the `contact-api` container in the home-server repo. It stays hidden if that service does not answer. Read messages with:

```bash
docker exec contact-api python app.py list
```

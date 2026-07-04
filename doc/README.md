# PWP — Personal Website / Portfolio

A static embedded-systems engineer portfolio site. No framework, no build step — plain HTML, CSS, and vanilla JS. All page copy lives in JSON files under `data/`; long-form content (articles, projects, blog posts) lives in Markdown files, and small Node.js scripts generate the JSON manifests those pages consume at runtime.

Every page renders `Loading...` placeholders in its static HTML; the `*-db.js` loader for that page fetches the matching JSON and replaces them once the data arrives, so nothing but the fallback text is ever hardcoded in markup.

---

## Project structure

```
PWP/
├── index.html                  # Landing / about page
├── pages/
│   ├── list.html                # Shared template for Projects / Knowledge / Blog (?section=)
│   ├── contact.html             # Contact page
│   └── error.html               # 404 / error page (static, no JSON source)
├── assets/
│   ├── css/main.css            # Single stylesheet
│   ├── js/
│   │   ├── app.js               # Nav burger/theme toggle, reveal-on-scroll, skills tabs,
│   │   │                        #   layout toggle, dashboard stat-count animation, contact form
│   │   ├── nav-db.js            # Resolves nav links, brand, CTA, footer from data/nav.json
│   │   │                        #   (runs on every page)
│   │   ├── about-db.js          # Landing page — populates from data/about.json
│   │   ├── contact-db.js        # Contact page — populates from data/contact.json
│   │   ├── list-db.js           # Unified loader for list.html — reads section= query
│   │   │                        #   param and fetches data/{knowledge,projects,blog}.json
│   │   ├── card-loader.js       # Shared manifest-fetch + card-render, used by list-db.js
│   │   │                        #   and journey-db.js
│   │   ├── journey-db.js        # About/Journey section card loader (static cards, no overlay)
│   │   └── details.js           # Detail overlay engine + Markdown renderer (list.html)
│   └── svg/
│       ├── diagrams/            # Architecture / technical diagram SVGs
│       └── icons.svg            # Icon sprite
├── data/                       # All page data — JSON configs and Markdown content
│   ├── nav.json                 # Nav links, brand, CTA, footer (all pages)
│   ├── about.json               # Landing page: hero, status cards, skills, stats, arch
│   ├── contact.json             # Contact page copy, links, form text
│   ├── knowledge.json           # Knowledge list.html page copy (hero/section/detail text)
│   ├── projects.json             # Projects list.html page copy
│   ├── blog.json                # Blog list.html page copy
│   ├── Knowledge/               # Knowledge articles (.md) + manifest.json
│   ├── Projects/                # Project articles (.md) + manifest.json
│   ├── Blog/                    # Blog posts (.md) + manifest.json
│   └── Journey/                 # Journey milestones (.md) + manifest.json
├── scripts/                     # Node.js content utilities
└── doc/                         # README, roadmap, and article-template reference docs
```

---

## Local development

The pages fetch JSON manifests and Markdown files at runtime, so they must be served over HTTP — opening HTML files directly via `file://` will cause fetch errors.

Serve the project root with any static server:

```bash
# Node.js (npx, no install required)
npx serve .

# Python
python3 -m http.server 8080

# VS Code: use the Live Server extension and open index.html
```

Then open `http://localhost:3000` (or whichever port the server reports).

---

## Content sections

### Knowledge base (`data/Knowledge/`)

In-depth technical articles on embedded systems fundamentals (boot sequence, RTOS, DMA, protocols, security, etc.).

Each article is a Markdown file named `NN_Title.md` with optional YAML frontmatter:

```markdown
---
id: my-article # URL-safe card ID (auto-generated if omitted)
tags: ['RTOS', 'ARM'] # Shown as tag chips on the card
brief: 'One-line summary shown on the card.'
---

# Article Title

Article body in standard Markdown...
```

To add an article:

1. Create `data/Knowledge/NN_Title.md` (increment the number prefix).
2. Run the scanner to update the manifest:
    ```bash
    node scripts/scan-knowledge.js
    ```
3. The new card appears automatically on `pages/list.html?section=knowledge`.

To embed a diagram inside an article, place an SVG in `assets/svg/diagrams/` and add an HTML block anywhere in the Markdown body:

```html
<div class="detail-diagram">
    <img src="../assets/svg/diagrams/my-diagram.svg" alt="Diagram description" loading="lazy" />
</div>
```

### Projects (`data/Projects/`)

Showcase projects. Each file is `NN_Title.md` with frontmatter:

```markdown
---
id: my-project
tags: ['STM32', 'FreeRTOS']
brief: 'One-line project summary.'
---

# Project Title

Project description...
```

Run after adding or editing:

```bash
node scripts/scan-projects.js
```

### Blog (`data/Blog/`)

Technical blog posts. Frontmatter supports an additional `date` field:

```markdown
---
id: my-post
date: 2025-06-01
tags: ['CAN FD', 'STM32H7']
brief: 'What this post covers.'
---
```

Run after changes:

```bash
node scripts/scan-blog.js
```

### Journey (`data/Journey/`)

Chronological learning milestones, rendered on the landing page. Same file convention (`NN_Title.md`).

```bash
node scripts/scan-journey.js
```

---

## Scripts

| Script                | Purpose                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scan-knowledge.js`   | Scans `data/Knowledge/*.md`, writes `manifest.json`                                                                                                    |
| `scan-projects.js`    | Scans `data/Projects/*.md`, writes `manifest.json`                                                                                                     |
| `scan-blog.js`        | Scans `data/Blog/*.md`, writes `manifest.json`                                                                                                         |
| `scan-journey.js`     | Scans `data/Journey/*.md`, writes `manifest.json`                                                                                                      |
| `scan-shared.js`      | Shared helpers (`slugify`, `parseFrontmatter`, `extractTitle`, `extractBrief`) used by all scan scripts — not run directly                             |
| `convert-drafts.js`   | Converts raw `Draft/*.txt` files to `Knowledge/*.md` with frontmatter (expects root-level `Draft/` and writes to root-level `Knowledge/`, not `data/`) |
| `gen_svg_diagrams.js` | Generates architecture diagram SVGs into `assets/svg/diagrams/` and rewrites `img` src refs in `data/**/*.md` to match                                 |

All scripts require Node.js (v18+) and have no npm dependencies. Run them from the project root:

```bash
node scripts/scan-knowledge.js
```

### Re-generate all manifests at once

```bash
node scripts/scan-knowledge.js && \
node scripts/scan-projects.js && \
node scripts/scan-blog.js && \
node scripts/scan-journey.js
```

---

## Static data files

`data/` holds all content consumed by the JS modules — page-copy JSON, section JSON, and Markdown articles:

| Path                  | Used by                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `data/nav.json`       | Nav links, brand, CTA, footer — every page (`nav-db.js`)               |
| `data/about.json`     | Landing page — hero, status cards, skills, stats, arch (`about-db.js`) |
| `data/contact.json`   | Contact page copy, links, form text (`contact-db.js`)                  |
| `data/knowledge.json` | Knowledge list page copy (`list-db.js`)                                |
| `data/projects.json`  | Projects list page copy (`list-db.js`)                                 |
| `data/blog.json`      | Blog list page copy (`list-db.js`)                                     |
| `data/Knowledge/*.md` | Knowledge base articles + manifest.json                                |
| `data/Projects/*.md`  | Project case studies + manifest.json                                   |
| `data/Blog/*.md`      | Blog posts + manifest.json                                             |
| `data/Journey/*.md`   | Learning journey milestones + manifest.json                            |

JSON files can be edited directly — the corresponding page shows `Loading...` until the fetch resolves, then replaces it with the new copy. Markdown content requires re-running the relevant scan script after changes.

---

## SVG diagrams

Architecture and technical diagrams live in `assets/svg/diagrams/`. They are standard SVG files that use CSS custom properties (`var(--surface-2)`, `var(--border-2)`, etc.) to inherit the page theme.

To add a new diagram, place the SVG file in `assets/svg/diagrams/` and reference it from the relevant Markdown article using the `detail-diagram` block shown above, or generate one from `data/**/*.md` diagram blocks with `node scripts/gen_svg_diagrams.js`.

---

## Frontmatter reference

All frontmatter fields are optional. The scanner falls back to the filename and first paragraph when fields are missing.

| Field   | Type   | Description                                                                    |
| ------- | ------ | ------------------------------------------------------------------------------ |
| `id`    | string | Unique card identifier used in the URL hash. Defaults to a slugified filename. |
| `title` | string | Card heading. Defaults to the first `#` heading in the article.                |
| `brief` | string | Card subtitle (max ~220 chars). Defaults to the first paragraph.               |
| `tags`  | array  | Tag chips shown on the card: `["Tag1", "Tag2"]`.                               |
| `date`  | string | Blog only. ISO 8601 date (`2025-06-01`). Displayed as the last tag.            |

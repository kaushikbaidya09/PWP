/* list-db.js — unified data loader for knowledge, projects, and blog pages */
'use strict';

(function () {
    const params = new URLSearchParams(location.search);
    const section = (params.get('section') || '').toLowerCase();

    const PAGES = {
        knowledge: {
            jsonPath: '../data/knowledge.json',
            manifestPath: '../data/Knowledge/manifest.json',
            folderPath: '../data/Knowledge/',
            type: 'knowledge',
            headingTag: 'h3',
            name: 'Knowledge',
            scanScript: 'knowledge',
        },
        projects: {
            jsonPath: '../data/projects.json',
            manifestPath: '../data/Projects/manifest.json',
            folderPath: '../data/Projects/',
            type: 'project',
            headingTag: 'h2',
            name: 'Projects',
            scanScript: 'projects',
        },
        blog: {
            jsonPath: '../data/blog.json',
            manifestPath: '../data/Blog/manifest.json',
            folderPath: '../data/Blog/',
            type: 'blog',
            headingTag: 'h2',
            name: 'Blog',
            scanScript: 'blog',
        },
    };

    const cfg = PAGES[section];
    if (!cfg) {
        location.replace('error.html?code=' + (section ? 'unknown_section' : 'missing_section'));
        return;
    }

    function setText(sel, val) {
        const el = document.querySelector(sel);
        if (el && val != null) el.textContent = val;
    }

    /* Fetch page-level copy and populate DOM */
    fetch(cfg.jsonPath)
        .then(function (r) {
            return r.ok ? r.json() : Promise.reject(new Error(r.status));
        })
        .then(function (d) {
            if (d.meta) {
                if (d.meta.title) document.title = d.meta.title;
                const metaDesc = document.querySelector('meta[name="description"]');
                if (metaDesc && d.meta.description)
                    metaDesc.setAttribute('content', d.meta.description);
            }
            if (d.pageLeft) {
                const lt = document.querySelector('.page-left__title');
                if (lt && d.pageLeft.titleParts) lt.innerHTML = d.pageLeft.titleParts.join('<br>');
                setText('.page-left__sub', d.pageLeft.sub);
            }
            if (d.hero) {
                setText('.page-hero__eyebrow', d.hero.eyebrow);
                setText('.page-hero__title', d.hero.title);
                setText('.page-hero__desc', d.hero.desc);
            }
            if (d.section) setText('.section__label', d.section.label);
            if (d.detail) {
                setText('.detail-breadcrumb', d.detail.breadcrumb);
                setText('#detail-title', d.detail.initialTitle);
            }
        })
        .catch(function () {
            location.replace('error.html?code=load_failed');
        });

    /* Load and render cards from the section manifest */
    loadCards({
        listId: 'page-card-list',
        manifestPath: cfg.manifestPath,
        type: cfg.type,
        headingTag: cfg.headingTag,
        folderPath: cfg.folderPath,
        name: cfg.name,
        scanScript: cfg.scanScript,
    });
})();

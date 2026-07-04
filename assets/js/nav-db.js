/* nav-db.js — resolves all nav hrefs from data/nav.json
 *
 * All links are stored as root-relative paths in nav.json.
 * Each page declares its own fixed distance back to the site root via
 * data-root (e.g. "" for index.html, "../" for pages/*.html) — the same
 * convention as data-svg-base — so resolution never depends on the URL's
 * pathname, which breaks when the site is served from a subpath.
 * Mark nav anchors with data-nav="<key>" and the CTA with data-nav-cta.
 */
(function () {
    'use strict';

    var prefix = document.documentElement.dataset.root || '';
    var currentFile = location.pathname.split('/').pop() || 'index.html';
    /* For list.html, disambiguate by section query param */
    if (currentFile === 'list.html') {
        var sp = new URLSearchParams(location.search).get('section');
        if (sp) currentFile = 'list.html?section=' + sp;
    }

    fetch(prefix + 'data/nav.json')
        .then(function (r) {
            return r.ok ? r.json() : Promise.reject(r.status);
        })
        .then(function (config) {
            /* ── Brand name + logo aria-label ──────────────────────── */
            if (config.brand) {
                var logoEl = document.querySelector('.nav__logo');
                var logoName = document.querySelector('.nav__logo-name');
                if (logoEl && config.brand.ariaLabel)
                    logoEl.setAttribute('aria-label', config.brand.ariaLabel);
                if (logoName && config.brand.name) logoName.textContent = config.brand.name;
            }

            /* ── Nav links (desktop + mobile) ──────────────────────── */
            (config.links || []).forEach(function (link) {
                var resolved = prefix + link.href;
                var isActive = link.file === currentFile;
                document.querySelectorAll('[data-nav="' + link.key + '"]').forEach(function (el) {
                    el.href = resolved;
                    if (el.classList.contains('nav__link')) {
                        el.textContent = link.label;
                        el.classList.toggle('active', isActive);
                        el.setAttribute('aria-current', isActive ? 'page' : 'false');
                    }
                });
            });

            /* ── CTA button ────────────────────────────────────────── */
            if (config.cta) {
                document.querySelectorAll('[data-nav-cta]').forEach(function (el) {
                    el.href = prefix + config.cta.href;
                    if (config.cta.label) el.textContent = config.cta.label;
                });
            }

            /* ── Footer ─────────────────────────────────────────────── */
            if (config.footer) {
                var footerCopy = document.querySelector('.footer__copy');
                var footerSig = document.querySelector('.footer__sig');
                if (footerCopy && config.footer.copy) footerCopy.textContent = config.footer.copy;
                if (footerSig && config.footer.sig) footerSig.textContent = config.footer.sig;
            }
        })
        .catch(function (e) {
            console.warn('data/nav.json load failed:', e);
        });
})();

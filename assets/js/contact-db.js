/* contact-db.js — populates contact.html from data/contact.json */
(function () {
    'use strict';

    function setText(sel, val) {
        var el = document.querySelector(sel);
        if (el && val != null) el.textContent = val;
    }

    fetch('../data/contact.json')
        .then(function (r) {
            return r.ok ? r.json() : Promise.reject(r.status);
        })
        .then(function (d) {
            /* ── meta ───────────────────────────────────────────────────── */
            if (d.meta) {
                if (d.meta.title) document.title = d.meta.title;
                var metaDesc = document.querySelector('meta[name="description"]');
                if (metaDesc && d.meta.description)
                    metaDesc.setAttribute('content', d.meta.description);
            }

            /* ── left panel ─────────────────────────────────────────────── */
            if (d.pageLeft) {
                var lt = document.querySelector('.page-left__title');
                if (lt && d.pageLeft.titleParts) lt.innerHTML = d.pageLeft.titleParts.join('<br>');
                setText('.page-left__sub', d.pageLeft.sub);
            }

            /* ── hero / heading ─────────────────────────────────────────── */
            if (d.hero) {
                setText('.page-hero__eyebrow', d.hero.eyebrow);
                if (d.hero.headingParts && d.hero.headingParts.length === 2) {
                    var h1 = document.querySelector('.contact__heading');
                    if (h1)
                        h1.innerHTML =
                            d.hero.headingParts[0] +
                            '<br><span class="text-accent">' +
                            d.hero.headingParts[1] +
                            '</span>';
                }
            }

            /* ── intro ──────────────────────────────────────────────────── */
            setText('.contact__intro', d.intro);

            /* ── availability ───────────────────────────────────────────── */
            if (d.availability) {
                var dot = document.querySelector('.status-dot');
                if (dot) {
                    dot.classList.toggle('status-dot--green', d.availability.open);
                    dot.classList.toggle('status-dot--grey', !d.availability.open);
                }
                setText('.contact__avail-indicator span:last-child', d.availability.statusText);

                var avItems = document.querySelectorAll('.contact__avail-item');
                if (avItems[0] && d.availability.location)
                    avItems[0].lastChild.textContent = ' ' + d.availability.location;
                if (avItems[1] && d.availability.timezone)
                    avItems[1].lastChild.textContent = ' ' + d.availability.timezone;
            }

            /* ── contact links ──────────────────────────────────────────── */
            if (d.links) {
                var linkEls = document.querySelectorAll('.contact-link');
                d.links.forEach(function (link, i) {
                    var el = linkEls[i];
                    if (!el) return;

                    el.setAttribute('href', link.href);

                    if (link.download) {
                        el.setAttribute('download', '');
                        el.removeAttribute('target');
                        el.removeAttribute('rel');
                        el.removeAttribute('aria-label');
                    } else if (link.external) {
                        el.setAttribute('target', '_blank');
                        el.setAttribute('rel', 'noopener noreferrer');
                        el.setAttribute('aria-label', link.label + ' profile (opens in new tab)');
                    } else {
                        el.removeAttribute('target');
                        el.removeAttribute('rel');
                    }

                    var lbl = el.querySelector('.contact-link__label');
                    var val = el.querySelector('.contact-link__value');
                    if (lbl) lbl.textContent = link.label;
                    if (val) val.textContent = link.value;
                });
            }

            /* ── form texts ─────────────────────────────────────────────── */
            if (d.form) {
                setText('.contact-form__title', d.form.title);
                setText('.newsletter-label', d.form.checkboxLabel);
                var submitBtn = document.querySelector('#contact-submit .btn-text');
                if (submitBtn && d.form.submitLabel) submitBtn.textContent = d.form.submitLabel;
                setText('.form-success__text', d.form.successMsg);
                setText('.form-error-global__text', d.form.errorMsg);
            }
        })
        .catch(function (e) {
            console.warn('data/contact.json load failed:', e);
        });
})();

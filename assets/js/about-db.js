/* about-db.js — populates index.html from data/about.json */
(function () {
    'use strict';

    function setText(sel, val) {
        var el = document.querySelector(sel);
        if (el && val != null) el.textContent = val;
    }

    fetch('data/about.json')
        .then(function (r) {
            return r.ok ? r.json() : Promise.reject(r.status);
        })
        .then(function (d) {
            /* ── meta ──────────────────────────────────────────────────────── */
            if (d.meta) {
                if (d.meta.title) document.title = d.meta.title;
                var metaDesc = document.querySelector('meta[name="description"]');
                if (metaDesc && d.meta.description)
                    metaDesc.setAttribute('content', d.meta.description);
            }

            /* ── hero ──────────────────────────────────────────────────────── */
            setText('.hero__discipline', d.discipline);

            if (d.name) {
                var nameEl = document.querySelector('.hero__name');
                if (nameEl)
                    nameEl.innerHTML =
                        d.name.first + '<br><span class="text-accent">' + d.name.last + '</span>';
            }

            setText('.hero__bio', d.bio);

            var tagsEl = document.querySelector('.hero__tags');
            if (tagsEl && d.tags)
                tagsEl.innerHTML = d.tags
                    .map(function (t) {
                        return '<li class="tag">' + t + '</li>';
                    })
                    .join('');

            /* ── status cards (SVG icons stay in HTML) ─────────────────────── */
            var statusCards = document.querySelectorAll('.hero__status-bar .status-card');
            (d.status || []).forEach(function (s, i) {
                if (!statusCards[i]) return;
                var lbl = statusCards[i].querySelector('.status-card__label');
                var val = statusCards[i].querySelector('.status-card__value');
                if (lbl) lbl.textContent = s.label;
                if (val) val.textContent = s.value;
            });

            /* ── section headings ──────────────────────────────────────────── */
            var sections = d.sections || {};
            ['journey', 'skills', 'stats'].forEach(function (key) {
                var s = sections[key];
                if (!s) return;
                var sec = document.getElementById(key === 'stats' ? 'dashboard' : key);
                if (!sec) return;
                var eyebrow = sec.querySelector('.about-eyebrow');
                var title = sec.querySelector('.about-title');
                var desc = sec.querySelector('.about-desc');
                if (eyebrow) eyebrow.textContent = s.eyebrow;
                if (title) title.textContent = s.title;
                if (desc) desc.textContent = s.desc;
            });

            /* ── skill tab labels ──────────────────────────────────────────── */
            (d.skillTabs || []).forEach(function (tab) {
                var btn = document.querySelector('.skills-tab[data-cat="' + tab.key + '"]');
                if (btn) btn.textContent = tab.label;
            });

            /* ── stat cards ────────────────────────────────────────────────── */
            var statCards = document.querySelectorAll('.dashboard__grid .stat-card');
            (d.stats || []).forEach(function (s, i) {
                if (!statCards[i]) return;
                var val = statCards[i].querySelector('.stat-card__value');
                var lbl = statCards[i].querySelector('.stat-card__label');
                var sub = statCards[i].querySelector('.stat-card__sub');
                if (val) val.setAttribute('data-count', String(s.count));
                if (lbl) lbl.textContent = s.label;
                if (sub) sub.textContent = s.sub;
            });
            /* re-run count animation with fetched values */
            var dashGrid = document.querySelector('.dashboard__grid');
            if (dashGrid) {
                dashGrid.querySelectorAll('[data-count]').forEach(function (el) {
                    var target = parseInt(el.getAttribute('data-count'), 10);
                    var start = performance.now();
                    function step(now) {
                        var p = Math.min((now - start) / 1200, 1);
                        el.textContent = Math.round(p * target);
                        if (p < 1) requestAnimationFrame(step);
                        else el.textContent = target;
                    }
                    requestAnimationFrame(step);
                });
            }
        })
        .catch(function (e) {
            console.warn('data/about.json load failed:', e);
        });
})();

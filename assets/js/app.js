/* Main application — nav, theme, reveal, skills, dashboard, arch, modal */
(function () {
    'use strict';

    /* ── SVG sprite (inlined — works on file:// and any server) ─────────── */
    window._svgBase = document.documentElement.dataset.svgBase || 'assets/svg/';
    (function () {
        var div = document.createElement('div');
        div.setAttribute('aria-hidden', 'true');
        div.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        div.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' +
            '<symbol id="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></symbol>' +
            '<symbol id="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"/></symbol>' +
            '<symbol id="icon-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></symbol>' +
            '<symbol id="icon-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></symbol>' +
            '<symbol id="icon-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"/></symbol>' +
            '</svg>';
        document.body.insertBefore(div, document.body.firstChild);
    })();

    /* ── Theme toggle ─────────────────────────────────────────────── */
    const html = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const stored = localStorage.getItem('theme') || 'dark';
    html.setAttribute('data-theme', stored);

    toggle &&
        toggle.addEventListener('click', () => {
            const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            /* Notify canvas-based components */
            window.dispatchEvent(new CustomEvent('themechange'));
        });

    /* ── Nav: scroll shadow + active page link ───────────────────── */
    const nav = document.getElementById('nav');
    const pageRight = document.querySelector('.page-right');
    const scrollRoot = pageRight || window;
    const getScrollY = () => (pageRight ? pageRight.scrollTop : window.scrollY);

    scrollRoot.addEventListener(
        'scroll',
        () => {
            nav && nav.classList.toggle('nav--scrolled', getScrollY() > 20);
        },
        { passive: true }
    );

    /* ── Active nav link (synchronous — works without nav-db.js fetch) ── */
    const currentPage = location.pathname.split('/').pop() || 'index.html';
    const currentFile =
        currentPage === 'list.html' ? 'list.html' + location.search : currentPage || 'index.html';

    document.querySelectorAll('.nav__link[href]').forEach((link) => {
        const tail = link.getAttribute('href').split('/').pop();
        const isActive = tail === currentFile;
        link.classList.toggle('active', isActive);
        link.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    /* Show brand name only on About page */
    const logo = document.querySelector('.nav__logo');
    const isAbout = currentPage === 'index.html' || currentPage === '';
    if (logo) logo.style.display = isAbout ? '' : 'none';

    /* ── Mobile burger ────────────────────────────────────────────── */
    const burger = document.getElementById('nav-burger');
    burger &&
        burger.addEventListener('click', () => {
            const open = nav.classList.toggle('nav--open');
            burger.setAttribute('aria-expanded', open.toString());
        });

    document.querySelectorAll('.nav__link').forEach((a) => {
        a.addEventListener('click', () => {
            nav.classList.remove('nav--open');
            burger && burger.setAttribute('aria-expanded', 'false');
        });
    });

    /* ── Intersection observer — reveal ──────────────────────────── */
    const revealObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    revealObserver.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    document.querySelectorAll('[data-reveal]').forEach((el) => revealObserver.observe(el));

    /* ── Layout toggle (grid / list) ─────────────────────────────── */
    const layoutBtns = document.querySelectorAll('.layout-btn');
    if (layoutBtns.length) {
        const savedLayout = localStorage.getItem('card-layout') || 'list';

        function applyLayout(mode) {
            document.querySelectorAll('.card-list').forEach((list) => {
                list.classList.toggle('is-grid', mode === 'grid');
            });
            layoutBtns.forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.layout === mode);
            });
            localStorage.setItem('card-layout', mode);
        }

        applyLayout(savedLayout);
        layoutBtns.forEach((btn) => {
            btn.addEventListener('click', () => applyLayout(btn.dataset.layout));
        });
    }

    /* ── Tab utility — deactivate all, activate clicked, call onSelect ── */
    function activateTab(tabs, activeClass, onSelect) {
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                tabs.forEach((t) => {
                    t.classList.remove(activeClass);
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add(activeClass);
                tab.setAttribute('aria-selected', 'true');
                onSelect(tab);
            });
        });
    }

    /* ── Skills (data from data/about.json) ───────────────────────── */
    const skillsPanel = document.getElementById('skills-panel');
    const skillsTabs = document.querySelectorAll('.skills-tab');
    if (skillsPanel || skillsTabs.length) {
        fetch('data/about.json')
            .then(function (r) {
                return r.ok ? r.json() : Promise.reject(r.status);
            })
            .then(function (data) {
                const SKILLS = data.skills || {};

                function renderSkills(cat) {
                    if (!skillsPanel) return;
                    skillsPanel.innerHTML = (SKILLS[cat] || [])
                        .map(
                            (s) => `
      <div class="skill-item">
        <div class="skill-item__header">
          <span class="skill-item__name">${s.name}</span>
          <div class="skill-item__meta">
            <span class="skill-level skill-level--${s.label}">${s.label.charAt(0).toUpperCase() + s.label.slice(1)}</span>
            <span class="skill-item__years">${s.years}</span>
          </div>
        </div>
        <div class="skill-bar">
          <div class="skill-bar__fill" data-target="${s.level}" style="width:0%"></div>
        </div>
      </div>`
                        )
                        .join('');

                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            skillsPanel.querySelectorAll('.skill-bar__fill').forEach((fill) => {
                                fill.style.width = fill.getAttribute('data-target') + '%';
                            });
                        });
                    });
                }

                activateTab(skillsTabs, 'skills-tab--active', (tab) =>
                    renderSkills(tab.getAttribute('data-cat'))
                );

                renderSkills('languages');
            })
            .catch(function (e) {
                console.warn('data/about.json load failed:', e);
            });
    }

    /* ── Dashboard — stat count animation ────────────────────────── */
    const dashObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.querySelectorAll('[data-count]').forEach((el) => {
                    const target = parseInt(el.getAttribute('data-count'), 10);
                    const start = performance.now();
                    function step(now) {
                        const p = Math.min((now - start) / 1200, 1);
                        el.textContent = Math.round(p * target);
                        if (p < 1) requestAnimationFrame(step);
                        else el.textContent = target;
                    }
                    requestAnimationFrame(step);
                });
                dashObserver.unobserve(entry.target);
            });
        },
        { threshold: 0.3 }
    );

    const dashGrid = document.querySelector('.dashboard__grid');
    if (dashGrid) dashObserver.observe(dashGrid);

    /* ── Contact form ─────────────────────────────────────────────── */
    const contactForm = document.getElementById('contact-form');
    const formSuccess = document.getElementById('form-success');
    const formErrorGlobal = document.getElementById('form-error-global');
    const submitBtn = document.getElementById('contact-submit');

    function setFieldError(inputId, errorId, msg) {
        const input = document.getElementById(inputId);
        const err = document.getElementById(errorId);
        if (input) input.classList.toggle('form-input--error', !!msg);
        if (err) err.textContent = msg || '';
    }

    contactForm &&
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const data = new FormData(contactForm);
            let valid = true;

            if (!data.get('name') || !data.get('name').trim()) {
                setFieldError('contact-name', 'name-error', 'Name is required.');
                valid = false;
            } else {
                setFieldError('contact-name', 'name-error', '');
            }

            const emailVal = (data.get('email') || '').trim();
            if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
                setFieldError(
                    'contact-email',
                    'email-error',
                    'Please enter a valid email address.'
                );
                valid = false;
            } else {
                setFieldError('contact-email', 'email-error', '');
            }

            if (!data.get('message') || !data.get('message').trim()) {
                setFieldError('contact-message', 'message-error', 'Message is required.');
                valid = false;
            } else {
                setFieldError('contact-message', 'message-error', '');
            }

            if (!valid) return;

            if (submitBtn) {
                submitBtn.querySelector('.btn-text').hidden = true;
                submitBtn.querySelector('.btn-loading').hidden = false;
                submitBtn.disabled = true;
            }

            /* Simulate async send — replace with real fetch() endpoint when ready */
            setTimeout(() => {
                if (submitBtn) {
                    submitBtn.querySelector('.btn-text').hidden = false;
                    submitBtn.querySelector('.btn-loading').hidden = true;
                    submitBtn.disabled = false;
                }
                if (formSuccess) formSuccess.hidden = false;
                contactForm.reset();
            }, 800);
        });

    /* ── Smooth scroll for same-page anchor links ─────────────────── */
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
        a.addEventListener('click', (e) => {
            const target = document.querySelector(a.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
})();

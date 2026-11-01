/* site.ts — behaviour on every page: theme, nav, reveal on scroll.
 * Pages render without it; page-specific code lives beside it. */
import { store } from './store';

/* ── Theme ─────────────────────────────────────────────────────────────── */
const root = document.documentElement;
document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('theme', next);
});

/* ── Nav: scroll shadow, burger menu ──────────────────────────────────── */
const nav = document.getElementById('nav');
const scroller = document.getElementById('page-main');
scroller?.addEventListener('scroll', () => nav?.classList.toggle('nav--scrolled', scroller.scrollTop > 20), {
    passive: true,
});

const burger = document.getElementById('nav-burger');
function closeMenu() {
    if (!nav?.classList.contains('nav--open')) return;
    nav.classList.remove('nav--open');
    burger?.setAttribute('aria-expanded', 'false');
}
burger?.addEventListener('click', () => {
    const open = nav?.classList.toggle('nav--open') ?? false;
    burger.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
    if (nav && !nav.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
});
window.matchMedia('(min-width: 769px)').addEventListener('change', (mq) => {
    if (mq.matches) closeMenu();
});

/* ── Reveal on scroll ─────────────────────────────────────────────────── */
const revealObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
        }
    },
    { threshold: 0, rootMargin: '0px 0px -40px 0px' }
);
document.querySelectorAll('[data-reveal]').forEach((el) => revealObserver.observe(el));
/* Failsafe: never leave on-screen content hidden if the observer lags */
scroller?.addEventListener(
    'scroll',
    () => {
        document.querySelectorAll('[data-reveal]:not(.is-visible)').forEach((el) => {
            if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('is-visible');
        });
    },
    { passive: true }
);

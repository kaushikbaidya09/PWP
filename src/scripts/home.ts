/* home.ts — About page: skills tabs and stat counters. */

/* ── Skills tabs ──────────────────────────────────────────────────────── */
const tabs = document.querySelectorAll<HTMLButtonElement>('.skills-tab');
tabs.forEach((tab) =>
    tab.addEventListener('click', () =>
        tabs.forEach((t) => {
            const on = t === tab;
            t.classList.toggle('skills-tab--active', on);
            t.setAttribute('aria-selected', String(on));
            const panel = document.getElementById(t.getAttribute('aria-controls') || '');
            if (panel) panel.hidden = !on;
        })
    )
);

/* ── Stat counters (the real numbers are already in the HTML) ─────────── */
const dash = document.querySelector('.dashboard__grid');
if (dash && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const obs = new IntersectionObserver(
        (entries) => {
            if (!entries[0].isIntersecting) return;
            obs.disconnect();
            dash.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
                const target = Number(el.dataset.count);
                const start = performance.now();
                const step = (now: number) => {
                    const p = Math.min((now - start) / 1200, 1);
                    el.textContent = String(Math.round(p * target));
                    if (p < 1) requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            });
        },
        { threshold: 0.3 }
    );
    obs.observe(dash);
}

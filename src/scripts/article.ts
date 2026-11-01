/* article.ts — deep links into folds, reading progress, current section, expand all. */

/* ── Links into folded sections open them ─────────────────────────────── */
function revealHash() {
    if (!location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const fold = target?.closest('details');
    if (fold && !fold.open) fold.open = true;
    target?.scrollIntoView();
}
window.addEventListener('hashchange', revealHash);
revealHash();

/* ── Article: reading progress, current section, expand all ────────────── */
const progress = document.getElementById('read-progress');
if (progress) {
    const page = document.getElementById('page-main') as HTMLElement;
    const spy = [...document.querySelectorAll<HTMLAnchorElement>('[data-spy]')].map((link) => ({
        link,
        target: document.getElementById(link.dataset.spy || ''),
    }));
    const bar = document.getElementById('article-bar');
    const heading = document.getElementById('article-title');
    let queued = false;
    const update = () => {
        queued = false;
        const range = page.scrollHeight - page.clientHeight;
        progress.style.transform = `scaleX(${range > 0 ? page.scrollTop / range : 0})`;
        const limit = page.getBoundingClientRect().top + 120;
        let current: HTMLAnchorElement | null = null;
        for (const { link, target } of spy) {
            if (target && target.getBoundingClientRect().top <= limit) current = link;
        }
        spy.forEach(({ link }) => link.classList.toggle('is-current', link === current));
        /* pin the one-line title once the big heading has scrolled away */
        bar?.classList.toggle(
            'is-pinned',
            !!heading && heading.getBoundingClientRect().bottom < page.getBoundingClientRect().top
        );
    };
    page.addEventListener(
        'scroll',
        () => {
            if (!queued) requestAnimationFrame(update);
            queued = true;
        },
        { passive: true }
    );
    update();

    const toggle = document.getElementById('deep-toggle');
    const folds = [...document.querySelectorAll<HTMLDetailsElement>('details.deep')];
    if (toggle && folds.length) {
        toggle.hidden = false;
        const label = () => {
            toggle.textContent = folds.every((f) => f.open) ? 'Collapse all' : 'Expand all';
        };
        toggle.addEventListener('click', () => {
            const open = !folds.every((f) => f.open);
            folds.forEach((f) => (f.open = open));
            label();
        });
        folds.forEach((f) => f.addEventListener('toggle', label));
    }
}

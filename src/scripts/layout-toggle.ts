/* layout-toggle.ts — list / grid switch for card lists. */
import { store } from './store';

const layoutBtns = document.querySelectorAll<HTMLButtonElement>('.layout-btn');
function applyLayout(mode: string) {
    document.querySelectorAll('.card-list').forEach((l) => l.classList.toggle('is-grid', mode === 'grid'));
    layoutBtns.forEach((b) => {
        const on = b.dataset.layout === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
    });
}
if (layoutBtns.length) {
    applyLayout(store.get('card-layout') || 'list');
    layoutBtns.forEach((b) =>
        b.addEventListener('click', () => {
            applyLayout(b.dataset.layout || 'list');
            store.set('card-layout', b.dataset.layout || 'list');
        })
    );
}

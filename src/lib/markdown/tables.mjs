/* rehypeTables — wraps tables so they scroll sideways on narrow screens. */
import { el, isEl } from './hast.mjs';

export function rehypeTables() {
    const walk = (node) => {
        (node.children || []).forEach((child, i) => {
            if (isEl(child, 'table')) node.children[i] = el('div', { className: ['table-wrap'] }, [child]);
            else if (isEl(child)) walk(child);
        });
    };
    return walk;
}

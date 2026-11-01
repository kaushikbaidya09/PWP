/* Small helpers for working with rehype's HTML tree. */
export const el = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });
export const text = (value) => ({ type: 'text', value });
export const isEl = (node, tag) => node?.type === 'element' && (!tag || node.tagName === tag);

export function textOf(node) {
    if (node.type === 'text') return node.value;
    return (node.children || []).map(textOf).join('');
}

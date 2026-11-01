/* Site-relative URL that also works when hosted under a sub-path (GitHub Pages). */
export const url = (path: string) => import.meta.env.BASE_URL.replace(/\/$/, '') + path;

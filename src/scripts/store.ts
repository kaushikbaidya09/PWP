/* localStorage that tolerates being blocked (private modes). */
export const store = {
    get(key: string) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key: string, val: string) {
        try {
            localStorage.setItem(key, val);
        } catch {
            /* storage blocked — ignore */
        }
    },
};

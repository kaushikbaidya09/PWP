/* contact.ts — contact form: shown only when the backend answers. */

const form = document.getElementById('contact-form') as HTMLFormElement | null;
/* GitHub Pages has no backend: PUBLIC_CONTACT_FORM=off skips the check entirely */
if (form && import.meta.env.PUBLIC_CONTACT_FORM !== 'off') {
    /* Only offer the form when the contact service is reachable */
    fetch(form.dataset.health || '', { cache: 'no-store' })
        .then((r) => {
            if (r.ok) form.hidden = false;
        })
        .catch(() => {
            /* service down — the "offline" note stays visible */
        });

    const ok = document.getElementById('form-success')!;
    const fail = document.getElementById('form-error-global')!;
    const submit = document.getElementById('contact-submit') as HTMLButtonElement;

    const setError = (field: string, msg: string) => {
        document.getElementById(`contact-${field}`)?.classList.toggle('form-input--error', !!msg);
        const err = document.getElementById(`${field}-error`);
        if (err) err.textContent = msg;
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        ok.hidden = true;
        fail.hidden = true;
        const data = Object.fromEntries(new FormData(form)) as Record<string, string>;

        let valid = true;
        const check = (field: string, bad: boolean, msg: string) => {
            setError(field, bad ? msg : '');
            if (bad) valid = false;
        };
        check('name', !data.name?.trim(), 'Name is required.');
        check(
            'email',
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email?.trim() || ''),
            'Please enter a valid email address.'
        );
        check('message', !data.message?.trim(), 'Message is required.');
        if (!valid) return;

        submit.disabled = true;
        submit.querySelector<HTMLElement>('.btn-text')!.hidden = true;
        submit.querySelector<HTMLElement>('.btn-loading')!.hidden = false;
        try {
            const r = await fetch(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!r.ok) throw new Error(String(r.status));
            ok.hidden = false;
            form.reset();
        } catch {
            fail.hidden = false;
        } finally {
            submit.disabled = false;
            submit.querySelector<HTMLElement>('.btn-text')!.hidden = false;
            submit.querySelector<HTMLElement>('.btn-loading')!.hidden = true;
        }
    });
}

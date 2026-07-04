/* details.js — overlay engine + markdown renderer */
'use strict';

/* ── Markdown async loader ───────────────────────────────────────────────── */

function _esc(t) {
    return t
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
function _inline(t) {
    t = t.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + _esc(c) + '</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, (_, b) => '<strong>' + _esc(b) + '</strong>');
    return t;
}

/* ── Markdown renderer (for .md files with # headings) ────────────────────── */
function _mdInline(raw) {
    var tokens = [];
    function tok(html) {
        var idx = tokens.length;
        tokens.push(html);
        return '\x00' + idx + '\x00';
    }
    var t = raw;
    t = t.replace(/`([^`\n]+)`/g, function (_, c) {
        return tok('<code>' + _esc(c) + '</code>');
    });
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, src) {
        return tok(
            '<img class="md-img" src="' +
                _esc(src.trim()) +
                '" alt="' +
                _esc(alt) +
                '" loading="lazy">'
        );
    });
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, href) {
        return tok(
            '<a href="' +
                _esc(href.trim()) +
                '" target="_blank" rel="noopener">' +
                _esc(text) +
                '</a>'
        );
    });
    t = _esc(t);
    t = t.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/___([^_\n]+?)___/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    t = t.replace(/_([^_\n]+?)_/g, '<em>$1</em>');
    t = t.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    t = t.replace(/\\([*_`~\[\]()#+\-.!\\])/g, '$1');
    t = t.replace(/\x00(\d+)\x00/g, function (_, i) {
        return tokens[+i];
    });
    return t;
}

function _mdList(lines) {
    function indOf(l) {
        return l.match(/^(\s*)/)[1].length;
    }
    function isItem(l) {
        return /^\s*(?:[-*+]|\d+[.)])\s/.test(l);
    }
    function items(arr, base) {
        var html = '',
            j = 0;
        while (j < arr.length) {
            if (!isItem(arr[j]) || indOf(arr[j]) !== base) {
                j++;
                continue;
            }
            var raw = arr[j].replace(/^\s*(?:[-*+]|\d+[.)]\s?)/, '').replace(/^\s/, '');
            var taskM = raw.match(/^\[(x|X| )\]\s+(.*)/);
            j++;
            var sub = [];
            while (j < arr.length && (!isItem(arr[j]) || indOf(arr[j]) > base)) {
                sub.push(arr[j]);
                j++;
            }
            var content = taskM ? taskM[2] : raw;
            var li = taskM
                ? '<li class="md-task"><input type="checkbox"' +
                  (taskM[1].toLowerCase() === 'x' ? ' checked' : '') +
                  ' disabled> ' +
                  _mdInline(content)
                : '<li>' + _mdInline(content);
            var subItems = sub.filter(isItem);
            if (subItems.length) {
                var sb = indOf(subItems[0]);
                var stag = /^\s*\d+[.)]\s/.test(subItems[0]) ? 'ol' : 'ul';
                li += '<' + stag + ' class="md-list">' + items(sub, sb) + '</' + stag + '>';
            }
            html += li + '</li>';
        }
        return html;
    }
    var base = indOf(lines[0]);
    var tag = /^\s*\d+[.)]\s/.test(lines[0]) ? 'ol' : 'ul';
    return '<' + tag + ' class="md-list">' + items(lines, base) + '</' + tag + '>';
}

function renderMarkdown(text) {
    var lines = text.split('\n'),
        out = [],
        i = 0,
        n = lines.length;
    while (i < n) {
        var line = lines[i],
            tr = line.trim();
        if (!tr) {
            i++;
            continue;
        }
        // Fenced code block
        if (/^```/.test(tr)) {
            var lang = tr.slice(3).trim(),
                codeLines = [];
            i++;
            while (i < n && !/^```\s*$/.test(lines[i].trim())) {
                codeLines.push(lines[i]);
                i++;
            }
            i++;
            out.push(
                '<pre class="detail-ascii md-code">' +
                    (lang ? '<span class="md-code-lang">' + _esc(lang) + '</span>' : '') +
                    '<code>' +
                    _esc(codeLines.join('\n')) +
                    '</code></pre>'
            );
            continue;
        }
        // ATX heading
        var hm = tr.match(/^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
        if (hm) {
            var lv = hm[1].length;
            out.push(
                '<h' + lv + ' class="md-h md-h' + lv + '">' + _mdInline(hm[2]) + '</h' + lv + '>'
            );
            i++;
            continue;
        }
        // Horizontal rule
        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(tr)) {
            out.push('<hr class="md-hr">');
            i++;
            continue;
        }
        // Blockquote
        if (/^\s*>/.test(line)) {
            var bqLines = [];
            while (i < n && /^\s*>/.test(lines[i])) {
                bqLines.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            out.push(
                '<blockquote class="md-blockquote">' +
                    renderMarkdown(bqLines.join('\n')) +
                    '</blockquote>'
            );
            continue;
        }
        // Table
        if (/^\|/.test(tr) && i + 1 < n && /^\|?[\s\-:|]+\|/.test(lines[i + 1].trim())) {
            var heads = tr
                .split('|')
                .slice(1, -1)
                .map(function (c) {
                    return c.trim();
                });
            i += 2;
            var tRows = [];
            while (i < n && /^\s*\|/.test(lines[i])) {
                tRows.push(
                    lines[i]
                        .trim()
                        .split('|')
                        .slice(1, -1)
                        .map(function (c) {
                            return c.trim();
                        })
                );
                i++;
            }
            out.push(
                '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
                    heads
                        .map(function (c) {
                            return '<th>' + _mdInline(c) + '</th>';
                        })
                        .join('') +
                    '</tr></thead><tbody>' +
                    tRows
                        .map(function (row) {
                            return (
                                '<tr>' +
                                row
                                    .map(function (c) {
                                        return '<td>' + _mdInline(c) + '</td>';
                                    })
                                    .join('') +
                                '</tr>'
                            );
                        })
                        .join('') +
                    '</tbody></table></div>'
            );
            continue;
        }
        // List block
        if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
            var listLines = [];
            while (i < n) {
                var ll = lines[i];
                if (!ll.trim()) break;
                if (
                    /^\s*(?:[-*+]|\d+[.)])\s/.test(ll) ||
                    (ll.match(/^(\s*)/)[1].length > 0 && listLines.length > 0)
                ) {
                    listLines.push(ll);
                    i++;
                } else {
                    break;
                }
            }
            out.push(_mdList(listLines));
            continue;
        }
        // HTML block passthrough
        if (/^<[a-zA-Z][a-zA-Z0-9]*[\s>/]/.test(tr)) {
            var htmlBlock = [];
            while (i < n && lines[i].trim()) {
                htmlBlock.push(lines[i]);
                i++;
            }
            out.push(htmlBlock.join('\n'));
            continue;
        }
        // Footnote definition
        if (/^\[\^[^\]]+\]:/.test(tr)) {
            out.push(
                '<p class="md-footnote">' + _mdInline(tr.replace(/^\[\^[^\]]+\]:\s*/, '')) + '</p>'
            );
            i++;
            continue;
        }
        // Definition list (term followed by `: definition` on next line)
        if (i + 1 < n && /^\s*:\s/.test(lines[i + 1]) && tr && !/^[*\-+#>|`\[]/.test(tr)) {
            out.push(
                '<dl class="md-deflist"><dt>' +
                    _mdInline(tr) +
                    '</dt><dd>' +
                    _mdInline(lines[i + 1].replace(/^\s*:\s*/, '')) +
                    '</dd></dl>'
            );
            i += 2;
            continue;
        }
        // Paragraph
        var pLines = [];
        while (i < n) {
            var pl = lines[i],
                ptr = pl.trim();
            if (!ptr) break;
            if (/^#{1,6}\s/.test(ptr) || /^```/.test(ptr) || /^\s*>/.test(pl)) break;
            if (/^\s*(?:[-*+]|\d+[.)])\s/.test(pl)) break;
            if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(ptr) || /^\|/.test(ptr)) break;
            if (/^<[a-zA-Z]/.test(ptr) || /^\[\^/.test(ptr)) break;
            pLines.push(pl);
            i++;
        }
        if (pLines.length) {
            out.push('<p>' + _mdInline(pLines.join(' ').trim()) + '</p>');
        } else {
            i++;
        }
    }
    return out.join('\n');
}

function fetchAndRenderDraft(draftFile, contentEl, tags) {
    fetch(draftFile)
        .then(function (r) {
            return r.ok ? r.text() : Promise.reject(r.status);
        })
        .then(function (text) {
            var body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
            var tagsHtml =
                '<div class="detail-tags">' +
                tags
                    .map(function (t) {
                        return '<span class="tag">' + t + '</span>';
                    })
                    .join('') +
                '</div>';
            contentEl.innerHTML =
                '<div class="md-body">' + renderMarkdown(body) + '</div>' + tagsHtml;
        })
        .catch(function (err) {
            contentEl.innerHTML =
                '<p class="detail-error">Could not load article (' + err + ').</p>';
        });
}

/* ── Overlay Engine ───────────────────────────────────────────────────────── */
(function () {
    const BREADCRUMB = { project: 'Projects', knowledge: 'Knowledge', blog: 'Blog' };

    window.openDetail = function (id) {
        const db = window.DETAIL_DB;
        if (!db || !db[id]) return;
        const d = db[id];

        const overlay = document.getElementById('detail-overlay');
        if (!overlay) return;

        /* breadcrumb */
        const bc = overlay.querySelector('.detail-breadcrumb');
        if (bc) bc.textContent = BREADCRUMB[d.type] || '';

        /* title is in the MD file itself */
        const titleEl = overlay.querySelector('.detail-title');
        if (titleEl) titleEl.hidden = true;

        /* no animation area */
        const animEl = document.getElementById('detail-anim');
        if (animEl) animEl.innerHTML = '';

        /* content from markdown file */
        const contentEl = document.getElementById('detail-content');
        if (contentEl) {
            contentEl.innerHTML = '<p class="detail-loading">Loading…</p>';
            fetchAndRenderDraft(d.draftFile, contentEl, d.tags || []);
        }

        /* open as non-modal so z-index stacking keeps nav above the overlay */
        overlay.scrollTop = 0;
        overlay.setAttribute('open', '');
        requestAnimationFrame(() => overlay.classList.add('is-open'));
        const backdrop = document.getElementById('detail-backdrop');
        if (backdrop) backdrop.classList.add('is-visible');

        /* take over the nav status bar */
        const nav = document.getElementById('nav');
        if (nav) {
            nav.classList.add('nav--detail');
            const navTitle = document.getElementById('nav-detail-title');
            if (navTitle) navTitle.textContent = d.title;
        }

        try {
            history.pushState({ detail: id }, '', '#' + id);
        } catch (_) {
            /* ignore */
        }
    };

    window.closeDetail = function () {
        const overlay = document.getElementById('detail-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-open');
        const backdrop = document.getElementById('detail-backdrop');
        if (backdrop) backdrop.classList.remove('is-visible');
        setTimeout(function () {
            overlay.removeAttribute('open');
        }, 220);

        /* restore the nav */
        const nav = document.getElementById('nav');
        if (nav) nav.classList.remove('nav--detail');

        if (history.state && history.state.detail) {
            try {
                history.back();
            } catch (_) {
                /* ignore */
            }
        }
    };

    document.addEventListener('DOMContentLoaded', function () {
        /* wire cards — buttons already handle click/keyboard natively */
        document.querySelectorAll('button.card[data-detail]').forEach(function (card) {
            card.addEventListener('click', function () {
                window.openDetail(card.getAttribute('data-detail'));
            });
        });

        /* back buttons — dialog header and nav takeover */
        const backBtn = document.getElementById('detail-back');
        if (backBtn) backBtn.addEventListener('click', window.closeDetail);

        const navBackBtn = document.getElementById('nav-detail-back');
        if (navBackBtn) navBackBtn.addEventListener('click', window.closeDetail);

        /* native dialog cancel event (ESC key) */
        const overlay = document.getElementById('detail-overlay');
        if (overlay) {
            overlay.addEventListener('cancel', function (e) {
                e.preventDefault();
                window.closeDetail();
            });
            /* click on ::backdrop area */
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) window.closeDetail();
            });
        }

        /* browser back button */
        window.addEventListener('popstate', function () {
            const overlay = document.getElementById('detail-overlay');
            if (overlay && overlay.classList.contains('is-open')) {
                overlay.classList.remove('is-open');
                const bd = document.getElementById('detail-backdrop');
                if (bd) bd.classList.remove('is-visible');
                setTimeout(function () {
                    overlay.removeAttribute('open');
                }, 220);
            }
        });
    });
})();

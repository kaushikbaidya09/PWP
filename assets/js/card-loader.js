/* card-loader.js — shared manifest-fetch + card-render for Knowledge, Blog, Projects */
'use strict';

function loadCards(config) {
    document.addEventListener('DOMContentLoaded', function () {
        var list = document.getElementById(config.listId);
        if (!list) return;

        fetch(config.manifestPath)
            .then(function (r) {
                return r.ok ? r.json() : Promise.reject(r.status);
            })
            .then(function (topics) {
                var db = window.DETAIL_DB || {};
                topics.forEach(function (t) {
                    if (!db[t.id]) {
                        db[t.id] = {
                            type: config.type,
                            title: t.title,
                            tags: t.tags || [],
                            draftFile: config.folderPath + t.file,
                        };
                    }
                });
                window.DETAIL_DB = db;

                var tag = config.headingTag || 'h2';
                list.innerHTML = topics
                    .map(function (t) {
                        var tagsHtml = (t.tags || [])
                            .map(function (tag) {
                                return '<li class="tag">' + tag + '</li>';
                            })
                            .join('');
                        return (
                            '<li>' +
                            '<button class="card" data-detail="' +
                            t.id +
                            '">' +
                            '<span class="card__num">' +
                            t.num +
                            '</span>' +
                            '<div class="card__body">' +
                            '<' +
                            tag +
                            ' class="card__title">' +
                            t.title +
                            '</' +
                            tag +
                            '>' +
                            '<p class="card__brief">' +
                            t.brief +
                            '</p>' +
                            '<ul class="card__tags">' +
                            tagsHtml +
                            '</ul>' +
                            '</div>' +
                            '</button>' +
                            '</li>'
                        );
                    })
                    .join('');

                list.querySelectorAll('button.card[data-detail]').forEach(function (card) {
                    card.addEventListener('click', function () {
                        if (window.openDetail) window.openDetail(card.dataset.detail);
                    });
                });
                requestAnimationFrame(function () {
                    list.classList.add('is-visible');
                });
            })
            .catch(function (err) {
                list.innerHTML =
                    '<li style="padding:20px;color:var(--text-3)">' +
                    config.name +
                    ' manifest could not be loaded (' +
                    err +
                    '). ' +
                    'Run <code>node scripts/scan-' +
                    config.scanScript +
                    '.js</code>.' +
                    '</li>';
                requestAnimationFrame(function () {
                    list.classList.add('is-visible');
                });
            });
    });
}

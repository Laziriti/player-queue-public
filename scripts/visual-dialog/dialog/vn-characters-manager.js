// Characters tab: card rendering, drag/drop, favorites and per-instance appearance.
import { VNSceneState } from '../scene/vn-scene-state.js';
import { stripDupSuffix, parseActorId, FALLBACK_AVATAR } from '../scene/vn-id-utils.js';
import { escapeHtml } from '../../utils/text.js';
import { CHAR_FX, CHAR_FX_GROUPS, CHAR_FX_ICONS, CHAR_FX_VARIANTS, charFxBase, charFxLabelKey, VNCharFx } from '../visual-effects/character-fx/vn-character-fx.js';

const VIS_ICON  = { visible: 'fa-eye', hidden: 'fa-eye-slash', 'name-hidden': 'fa-user-secret' };
const VIS_TITLE = { visible: 'vn.dialog.vis.visible', hidden: 'vn.dialog.vis.hidden', 'name-hidden': 'vn.dialog.vis.nameHidden' };

const CHAR_FX_GROUP_ICONS = { stylization: 'fa-palette', signal: 'fa-wave-square' };

function charFxButton() {
    return `<button type="button" class="vn-token-fx-btn" title="${game.i18n.format('vn.dialog.charFxTitle', { name: game.i18n.localize('vn.charFx.none') })}" draggable="false"><i class="fas ${CHAR_FX_ICONS.none}"></i></button>`;
}

export class VNCharactersManager {
    static _TOKEN_SIZE_KEY = 'player-queue:tokenCardSize';
    static _PARTICIPANTS_COLLAPSED_KEY = 'player-queue:vn-participants-collapsed';

    constructor(favorites) {
        this._favorites = favorites;
        this.reset();
    }

    reset(signal) {
        this._signal = signal;
        this._root = null;
        this._dropZones = new WeakSet();
        this._dragEls = new WeakSet();
        this._draggedEl = null;
        this._tokenSearchQuery = '';
    }

    attachListeners(root) {
        this._root = root;
        this._setupDragAndDrop(root);
        this._setupFavoriteHandlers(root);
        this._setupActorsDragAndDrop(root);
        this._setupPoolTabs(root);
        this._setupHideButtons(root);
        this._setupCharFxMenu(root);
        this._attachCharacterControlListeners(root);
    }

    applyPreset(root, preset) {
        const allIds = [...(preset.leftIds || []), ...(preset.centerIds || []), ...(preset.rightIds || [])];
        const available = root.querySelector('#available-tokens');

        const needed = new Set();
        for (const id of allIds) {
            const baseId = stripDupSuffix(id);
            if (parseActorId(baseId)) needed.add(baseId);
        }
        for (const baseId of needed) {
            const aid = parseActorId(baseId);
            const existing = root.querySelectorAll(`.vn-token-option[data-actor-id="${aid}"]`);
            const needCount = allIds.filter(id => stripDupSuffix(id) === baseId).length;
            for (let i = existing.length; i < needCount; i++) {
                const actor = game.actors.get(aid);
                if (actor && available) {
                    const temp = document.createElement('div');
                    temp.innerHTML = VNCharactersManager.generateActorToken(actor);
                    available.append(temp.firstElementChild);
                }
            }
        }
        // Ensure participant actors have DOM elements
        const presetActorIds = preset.presetActors || [];
        for (const id of presetActorIds) {
            const aid = parseActorId(stripDupSuffix(id));
            if (!aid) continue;
            if (!root.querySelector(`.vn-token-option[data-actor-id="${aid}"]`)) {
                const actor = game.actors.get(aid);
                if (actor && available) {
                    const temp = document.createElement('div');
                    temp.innerHTML = VNCharactersManager.generateActorToken(actor);
                    available.append(temp.firstElementChild);
                }
            }
        }
        if (needed.size || presetActorIds.length) this._setupDragAndDrop(root);
        this.moveTokensToPositions(root, preset);

        // Populate #scene-participants from preset.presetActors.
        // Only pick from #available-tokens — actors already placed in position slots must not be moved out.
        const participantsEl = root.querySelector('#scene-participants');
        const availableEl = root.querySelector('#available-tokens');
        if (participantsEl) {
            participantsEl.innerHTML = '';
            const usedInParticipants = new Set();
            for (const id of presetActorIds) {
                const aid = parseActorId(stripDupSuffix(id));
                if (!aid) continue;
                const el = availableEl?.querySelector(`.vn-token-option[data-actor-id="${aid}"]`);
                if (el && !usedInParticipants.has(el)) {
                    usedInParticipants.add(el);
                    participantsEl.append(el);
                }
            }
            const badge = root.querySelector('.vn-participants-badge');
            if (badge) badge.textContent = participantsEl.querySelectorAll('.vn-token-option').length;
        }

        root.querySelectorAll('.vn-token-option').forEach(el => this._applyVisIcon(el, 'visible'));
        // Support both new `visibility` and legacy `hidden` preset formats
        const visMap = preset.visibility ?? (preset.hidden
            ? Object.fromEntries(Object.entries(preset.hidden).filter(([, v]) => v).map(([id]) => [id, 'hidden']))
            : {});
        const visUsed = new Set();
        for (const [tokenId, vis] of Object.entries(visMap)) {
            if (!vis || vis === 'visible') continue;
            const el = this._findTokenElement(root, tokenId, visUsed, true);
            if (!el) continue;
            visUsed.add(el);
            this._applyVisIcon(el, vis);
        }
        root.querySelectorAll('.vn-token-option').forEach(el => this._applyCharFxIcon(el, 'none'));
        this._restoreCharFx(root, preset.charFx);
    }

    applyDefaults(root, state) {
        const used = new Set();
        for (const [tokenId, vis] of Object.entries(state.visibility ?? {})) {
            if (!vis || vis === 'visible') continue;
            const el = this._findTokenElement(root, tokenId, used, true);
            if (!el) continue;
            used.add(el);
            this._applyVisIcon(el, vis);
        }
        this._restoreCharFx(root, state.charFx);
    }

    generateTab(tokens, sceneState, entrancesHTML) {
        let participantsOpen = true;
        try { participantsOpen = localStorage.getItem(VNCharactersManager._PARTICIPANTS_COLLAPSED_KEY) !== '1'; } catch {}
        const favActors = this._favorites.list().map(id => game.actors.get(id)).filter(Boolean);
        const favCount = favActors.length;
        const favHTML = favActors.map(a => VNCharactersManager.generateActorToken(a)).join('');
        const tokensHTML = tokens.map(t => `<div class="vn-token-option" draggable="true" title="${escapeHtml(t.name)}" data-token-id="${escapeHtml(t.id)}" data-actor-id="${escapeHtml(t.actor.id)}" data-type="token" data-visibility="visible" data-name="${escapeHtml(t.name.toLowerCase())}">
            <button type="button" class="vn-token-hide-btn" title="${game.i18n.localize(VIS_TITLE.visible)}" draggable="false"><i class="fas fa-eye"></i></button>
            ${charFxButton()}
            <div class="vn-token-preview"><img src="${escapeHtml(t.actor.img || t.document.texture.src)}" alt="${escapeHtml(t.name)}" loading="lazy"><div class="vn-token-name">${escapeHtml(t.name)}</div></div></div>`).join('');

        const participantTokensHtml = (sceneState?.presetActors || []).map(id => {
            const aid = parseActorId(id);
            if (!aid) return '';
            const actor = game.actors.get(aid);
            return actor ? VNCharactersManager.generateActorToken(actor) : '';
        }).filter(Boolean).join('');
        const participantCount = (sceneState?.presetActors || []).filter(id => {
            const aid = parseActorId(id);
            return aid && game.actors.get(aid);
        }).length;

        return `
                ${entrancesHTML}
                <div class="vn-positions-grid">
                    ${this._positionSection('left', game.i18n.localize('vn.dialog.positionLeft'), 'fa-arrow-left', game.i18n.localize('vn.dialog.positionLeftOrder'))}
                    ${this._positionSection('center', game.i18n.localize('vn.dialog.positionCenter'), 'fa-bullseye')}
                    ${this._positionSection('right', game.i18n.localize('vn.dialog.positionRight'), 'fa-arrow-right', game.i18n.localize('vn.dialog.positionRightOrder'))}
                </div>
                <details class="vn-participants-strip"${participantsOpen ? ' open' : ''}>
                    <summary class="vn-participants-header">
                        <i class="fas fa-users-gear"></i> ${game.i18n.localize('vn.dialog.participantsLabel')} <span class="vn-badge vn-participants-badge">${participantCount}</span>
                        <span class="vn-participants-hint">${game.i18n.localize('vn.dialog.participantsHint')}</span>
                        <i class="fas fa-chevron-down vn-chevron"></i>
                    </summary>
                    <div class="vn-scene-participants" id="scene-participants" data-empty="${escapeHtml(game.i18n.localize('vn.dialog.participantsEmpty'))}">${participantTokensHtml}</div>
                </details>
                <section class="vn-pool">
                    <div class="vn-pool-bar">
                        <div class="vn-pool-tabs" role="tablist">
                            <button type="button" class="vn-pool-tab active" role="tab" aria-selected="true" data-pool="tokens" title="${game.i18n.localize('vn.dialog.tokensOnScene')}"><i class="fas fa-map-marker-alt"></i> ${game.i18n.localize('vn.dialog.poolTabTokens')} <span class="vn-badge">${tokens.length}</span></button>
                            <button type="button" class="vn-pool-tab" role="tab" aria-selected="false" data-pool="favorites" title="${game.i18n.localize('vn.dialog.favoritesHeader')}"><i class="fas fa-star"></i> ${game.i18n.localize('vn.dialog.poolTabFavorites')} <span class="vn-badge vn-favorites-badge">${favCount}</span></button>
                        </div>
                        <div class="vn-characters-controls">
                            <input type="text" class="vn-token-search" placeholder="${game.i18n.localize('vn.dialog.tokenSearchPlaceholder')}">
                            <div class="vn-token-size-control">
                                <i class="fas fa-expand-arrows-alt"></i>
                                <input type="range" class="vn-token-size-slider" min="40" max="96" step="4" value="64">
                            </div>
                        </div>
                    </div>
                    <div class="vn-pool-panel active" data-pool="tokens">
                        <div class="vn-available-tokens" id="available-tokens">${tokensHTML || `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noTokensOnScene')}</div>`}</div>
                    </div>
                    <div class="vn-pool-panel" data-pool="favorites">
                        <div class="vn-favorites-hint"><i class="fas fa-mouse-pointer"></i> ${game.i18n.localize('vn.dialog.favoritesHint')}</div>
                        <div class="vn-favorites-section">${favHTML || `<div class="vn-favorites-empty"><i class="fas fa-arrow-down"></i> ${game.i18n.localize('vn.dialog.dragActorsFromJournal')}</div>`}</div>
                    </div>
                </section>`;
    }

    _attachCharacterControlListeners(root) {
        const signal = this._signal;

        // Restore persisted card size and apply immediately
        const savedSize = parseInt(localStorage.getItem(VNCharactersManager._TOKEN_SIZE_KEY) || '64');
        this._applyTokenCardSize(root, savedSize);
        const slider = root.querySelector('.vn-token-size-slider');
        if (slider) slider.value = savedSize;

        root.querySelector('.vn-token-search')?.addEventListener('input', (e) => {
            this._tokenSearchQuery = e.target.value.trim().toLowerCase();
            this._applyTokenSearch(root);
        }, { signal });

        slider?.addEventListener('input', (e) => {
            const size = parseInt(e.target.value);
            this._applyTokenCardSize(root, size);
            localStorage.setItem(VNCharactersManager._TOKEN_SIZE_KEY, size);
        }, { signal });
    }

    _applyTokenCardSize(root, size) {
        root.querySelector('.vn-scene-dialog')?.style.setProperty('--vn-tok-size', size + 'px');
    }

    _applyTokenSearch(root) {
        const q = this._tokenSearchQuery;
        root.querySelectorAll('#available-tokens .vn-token-option, #scene-participants .vn-token-option, .vn-favorites-section .vn-token-option').forEach(item => {
            item.style.display = !q || (item.dataset.name || '').includes(q) ? '' : 'none';
        });
    }

    // Appearance belongs to the card instance, including repeated copies of an actor.
    _applyVisIcon(tokenOpt, vis) {
        tokenOpt.dataset.visibility = vis;
        const i = tokenOpt.querySelector('.vn-token-hide-btn i');
        if (i) i.className = `fas ${VIS_ICON[vis]}`;
        const btn = tokenOpt.querySelector('.vn-token-hide-btn');
        if (btn) btn.title = game.i18n.localize(VIS_TITLE[vis]);
    }

    _setupHideButtons(root) {
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('.vn-token-hide-btn');
            if (!btn) return;
            e.stopPropagation();
            e.preventDefault();
            const tokenOpt = btn.closest('.vn-token-option');
            if (!tokenOpt || !tokenOpt.closest('.vn-token-selector')) return;
            const vis = tokenOpt.dataset.visibility ?? 'visible';
            const next = VNSceneState.VISIBILITY_CYCLE[(VNSceneState.VISIBILITY_CYCLE.indexOf(vis) + 1) % VNSceneState.VISIBILITY_CYCLE.length];
            this._applyVisIcon(tokenOpt, next);
        });
    }

    _applyCharFxIcon(tokenOpt, fx) {
        const id = CHAR_FX.includes(fx) ? fx : 'none';
        if (id === 'none') delete tokenOpt.dataset.charFx;
        else tokenOpt.dataset.charFx = id;
        const btn = tokenOpt.querySelector('.vn-token-fx-btn');
        if (!btn) return;
        btn.querySelector('i').className = `fas ${CHAR_FX_ICONS[id] ?? CHAR_FX_ICONS[charFxBase(id)]}`;
        btn.title = game.i18n.format('vn.dialog.charFxTitle', { name: game.i18n.localize(charFxLabelKey(id)) });
    }

    // One top-layer popover serves every card without being clipped by the dialog's scroll containers.
    _setupCharFxMenu(root) {
        const host = root.querySelector('.vn-scene-dialog');
        if (!host) return;
        const menu = document.createElement('div');
        menu.className = 'vn-fx-menu';
        menu.popover = 'auto';
        // Группы с липкими заголовками: видно, что выбираешь — лёгкие CSS-эффекты или тяжёлые SVG-фильтры.
        // Тип с подвариантами (CHAR_FX_VARIANTS) — пункт со стрелкой: клик раскрывает под ним список вариантов
        // на всю ширину меню (как у подтем частиц), выбор — по варианту
        const item = id => {
            const variants = CHAR_FX_VARIANTS[id];
            const btn = `<button type="button" class="vn-fx-menu-item${variants ? ' vn-fx-menu-expandable' : ''}" data-fx="${id}">
            <i class="fas ${CHAR_FX_ICONS[id]}"></i><span>${game.i18n.localize(`vn.charFx.${id}`)}</span>`
                + (variants ? '<small class="vn-atmo-item-variant-tag"></small><i class="fas fa-chevron-down vn-atmo-item-caret"></i>' : '')
                + '</button>';
            if (!variants) return btn;
            return btn + `<div class="vn-variant-list vn-fx-menu-variants" data-variant-base="${id}" hidden>`
                + variants.map(v => `<button type="button" class="vn-variant-option" data-fx="${v.id}"><i class="fas fa-check"></i><span>${game.i18n.localize(v.label)}</span></button>`).join('')
                + '</div>';
        };
        menu.innerHTML = CHAR_FX_GROUPS.map(group => `<div class="vn-fx-menu-group" data-group="${group.id}">
            <i class="fas ${CHAR_FX_GROUP_ICONS[group.id]}"></i><span>${game.i18n.localize(`vn.charFx.groups.${group.id}`)}</span></div>`
            + group.fx.map(item).join('')).join('');
        host.append(menu);

        const setVariantsOpen = (list, open) => {
            list.hidden = !open;
            list.previousElementSibling?.classList.toggle('vn-variant-open', open);
        };

        let target = null;
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('.vn-token-fx-btn');
            if (!btn) return;
            e.stopPropagation();
            e.preventDefault();
            const tokenOpt = btn.closest('.vn-token-option');
            if (!tokenOpt || !tokenOpt.closest('.vn-token-selector')) return;
            target = tokenOpt;
            const current = tokenOpt.dataset.charFx ?? 'none';
            const currentBase = charFxBase(current);
            menu.querySelectorAll('.vn-fx-menu-item').forEach(item => item.classList.toggle('current', item.dataset.fx === currentBase));
            // Списки вариантов свёрнуты; у типа выбранного варианта — подсвечен вариант и бейдж на пункте (кроме базового)
            menu.querySelectorAll('.vn-fx-menu-variants').forEach(list => {
                setVariantsOpen(list, false);
                const own = list.dataset.variantBase === currentBase;
                list.querySelectorAll('.vn-variant-option').forEach(o => o.classList.toggle('active', own && o.dataset.fx === current));
                const tag = list.previousElementSibling?.querySelector('.vn-atmo-item-variant-tag');
                const v = own && current !== currentBase ? CHAR_FX_VARIANTS[currentBase].find(x => x.id === current) : null;
                if (tag) tag.textContent = v ? game.i18n.localize(v.label) : '';
            });

            const r = btn.getBoundingClientRect();
            menu.showPopover();
            const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
            const below = r.bottom + 4;
            const top = below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 4) : below;
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        });

        menu.addEventListener('click', (e) => {
            const expandable = e.target.closest('.vn-fx-menu-expandable');
            if (expandable) {
                const list = expandable.nextElementSibling;
                const open = list.hidden;
                menu.querySelectorAll('.vn-fx-menu-variants').forEach(l => setVariantsOpen(l, false));
                setVariantsOpen(list, open);
                return;
            }
            const item = e.target.closest('.vn-fx-menu-item, .vn-fx-menu-variants .vn-variant-option');
            if (!item || !target) return;
            this._applyCharFxIcon(target, item.dataset.fx);
            target = null;
            menu.hidePopover();
        });
    }

    _showPool(root, name) {
        root.querySelectorAll('.vn-pool-tab').forEach(t => {
            const on = t.dataset.pool === name;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', String(on));
        });
        root.querySelectorAll('.vn-pool-panel').forEach(p => p.classList.toggle('active', p.dataset.pool === name));
    }

    // Hovering a hidden pool tab or the collapsed participants strip while dragging opens it.
    _setupPoolTabs(root) {
        const signal = this._signal;
        const strip = root.querySelector('.vn-participants-strip');
        if (strip) {
            strip.addEventListener('toggle', () => {
                try { localStorage.setItem(VNCharactersManager._PARTICIPANTS_COLLAPSED_KEY, strip.open ? '0' : '1'); } catch {}
            }, { signal });
            const header = strip.querySelector('summary');
            let timer = null;
            header.addEventListener('dragenter', () => {
                if (strip.open) return;
                clearTimeout(timer);
                timer = setTimeout(() => { strip.open = true; }, 350);
            }, { signal });
            header.addEventListener('dragleave', () => clearTimeout(timer), { signal });
            header.addEventListener('drop', () => clearTimeout(timer), { signal });
        }
        root.querySelectorAll('.vn-pool-tab').forEach(btn => {
            let timer = null;
            const cancel = () => { clearTimeout(timer); timer = null; btn.classList.remove('drag-hover'); };
            btn.addEventListener('click', (e) => { e.preventDefault(); this._showPool(root, btn.dataset.pool); }, { signal });
            btn.addEventListener('dragenter', () => {
                if (btn.classList.contains('active')) return;
                btn.classList.add('drag-hover');
                clearTimeout(timer);
                timer = setTimeout(() => { cancel(); this._showPool(root, btn.dataset.pool); }, 350);
            }, { signal });
            btn.addEventListener('dragleave', (e) => { if (!btn.contains(e.relatedTarget)) cancel(); }, { signal });
            btn.addEventListener('drop', cancel, { signal });
            document.addEventListener('dragend', cancel, { signal });
        });
    }

    _setupDragAndDrop(root) {
        root.querySelectorAll('.vn-token-option').forEach(el => this._makeDraggable(el));

        const getAfter = (container, x) => {
            const els = [...container.querySelectorAll('.vn-token-option:not(.dragging)')];
            // Batch-read all rects before any comparison to avoid interleaved read/write reflows
            const mids = els.map(el => el.getBoundingClientRect().left + el.offsetWidth * 0.5);
            let bestOffset = -Infinity, bestEl;
            for (let i = 0; i < els.length; i++) {
                const offset = x - mids[i];
                if (offset < 0 && offset > bestOffset) { bestOffset = offset; bestEl = els[i]; }
            }
            return bestEl;
        };

        const signal = this._signal;
        root.querySelectorAll('.vn-token-selector, .vn-available-tokens, .vn-favorites-section, .vn-scene-participants').forEach(zone => {
            if (this._dropZones?.has(zone)) return;
            this._dropZones?.add(zone);

            let rafId = null;
            let pendingX = 0;

            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                zone.classList.add('drag-over');
                if (this._draggedEl?.classList.contains('vn-token-option')) {
                    pendingX = e.clientX;
                    if (rafId === null) {
                        rafId = requestAnimationFrame(() => {
                            rafId = null;
                            if (!this._draggedEl) return;
                            const after = getAfter(zone, pendingX);
                            after ? zone.insertBefore(this._draggedEl, after) : zone.appendChild(this._draggedEl);
                        });
                    }
                }
            }, { signal });
            zone.addEventListener('dragleave', (e) => {
                if (!zone.contains(e.relatedTarget)) {
                    zone.classList.remove('drag-over');
                    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
                }
            }, { signal });
            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
                zone.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (!data.internal) return;
                    root.querySelectorAll('.vn-token-option').forEach(el => el.classList.remove('selected'));
                    root.querySelectorAll('.vn-token-selector .vn-token-option').forEach(el => el.classList.add('selected'));
                    if (zone.classList.contains('vn-favorites-section') && data.actorId) {
                        await this._favorites.add(data.actorId);
                    }
                } catch { /* handled elsewhere */ }
            }, { signal });
        });
    }

    _makeDraggable(el) {
        if (this._dragEls?.has(el)) return;
        this._dragEls?.add(el);
        const signal = this._signal;
        el.addEventListener('dragstart', (e) => {
            this._draggedEl = el;
            el.classList.add('dragging');
            document.body.classList.add('vn-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({ internal: true, actorId: el.dataset.actorId, tokenId: el.dataset.tokenId }));
        }, { signal });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            document.body.classList.remove('vn-dragging');
            this._draggedEl = null;
            this._syncParticipantsBadge(el.closest('.vn-scene-dialog') ?? this._root);
        }, { signal });
    }

    _syncParticipantsBadge(root) {
        for (const [badgeSel, listSel] of [['.vn-participants-badge', '#scene-participants'], ['.vn-favorites-badge', '.vn-favorites-section']]) {
            const badge = root?.querySelector(badgeSel);
            const list = root?.querySelector(listSel);
            if (badge && list) badge.textContent = list.querySelectorAll('.vn-token-option').length;
        }
    }

    _setupActorsDragAndDrop(root) {
        root.querySelectorAll('.vn-token-selector, .vn-favorites-section, .vn-scene-participants').forEach(zone => {
            zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
            zone.addEventListener('drop', async (e) => {
                e.preventDefault(); e.stopPropagation();
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.type !== 'Actor') return;
                    const actor = await fromUuid(data.uuid) || game.actors.get(data.id);
                    if (!actor) return;

                    if (zone.classList.contains('vn-favorites-section')) {
                        const existing = zone.querySelector(`.vn-token-option[data-actor-id="${actor.id}"]`);
                        if (!existing) {
                            const temp = document.createElement('div');
                            temp.innerHTML = VNCharactersManager.generateActorToken(actor);
                            const newEl = temp.firstElementChild;
                            zone.append(newEl);
                            this._makeDraggable(newEl);
                        }
                        await this._favorites.add(actor.id);
                        this._updateFavoritesDisplay(root);
                    } else if (zone.classList.contains('vn-scene-participants')) {
                        const existing = zone.querySelector(`.vn-token-option[data-actor-id="${actor.id}"]`);
                        if (!existing) {
                            const temp = document.createElement('div');
                            temp.innerHTML = VNCharactersManager.generateActorToken(actor);
                            const newEl = temp.firstElementChild;
                            zone.append(newEl);
                            this._makeDraggable(newEl);
                            const badge = root.querySelector('.vn-participants-badge');
                            if (badge) badge.textContent = zone.querySelectorAll('.vn-token-option').length;
                        }
                    } else {
                        const temp = document.createElement('div');
                        temp.innerHTML = VNCharactersManager.generateActorToken(actor);
                        const newEl = temp.firstElementChild;
                        zone.append(newEl);
                        this._makeDraggable(newEl);
                    }

                    root.querySelectorAll('.vn-token-option').forEach(el => el.classList.remove('selected'));
                    root.querySelectorAll('.vn-token-selector .vn-token-option').forEach(el => el.classList.add('selected'));
                } catch { /* not a Foundry drop */ }
            });
        });
    }

    _setupFavoriteHandlers(root) {
        root.addEventListener('contextmenu', async (e) => {
            const tokenOpt = e.target.closest('.vn-favorites-section .vn-token-option');
            if (!tokenOpt) return;
            e.preventDefault();
            await this._favorites.remove(tokenOpt.dataset.actorId);
            this._updateFavoritesDisplay(root);
        });
    }

    _updateFavoritesDisplay(root) {
        const favSection = root.querySelector('.vn-favorites-section');
        if (!favSection) return;
        favSection.innerHTML = this._favorites.list().length === 0
            ? `<div class="vn-favorites-empty"><i class="fas fa-arrow-down"></i> ${game.i18n.localize('vn.dialog.dragActorsFromJournal')}</div>`
            : this._favorites.list().map(id => game.actors.get(id)).filter(Boolean).map(a => VNCharactersManager.generateActorToken(a)).join('');
        this._setupDragAndDrop(root);
        this._syncParticipantsBadge(root);
    }

    _findTokenElement(root, tokenId, exclude = null, preferSelected = false) {
        const pick = (candidates) => {
            const arr = Array.from(candidates).filter(c => !exclude?.has(c));
            return (preferSelected ? arr.find(c => c.classList.contains('selected')) : null) ?? arr[0] ?? null;
        };
        const baseId = stripDupSuffix(tokenId);
        if (preferSelected) {
            // Appearance maps use the same occurrence suffixes as the form collector. Match the exact
            // on-stage copy before the legacy token/actor fallback, even when only #1 has an override.
            const actorId = parseActorId(baseId);
            const selected = [...root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option')]
                .filter(el => actorId ? el.dataset.actorId === actorId : el.dataset.tokenId === baseId);
            const occurrence = tokenId === baseId ? 0 : Number(tokenId.slice(baseId.length + 1));
            const exact = selected[occurrence];
            if (exact && !exclude?.has(exact)) return exact;
        }
        let el = root.querySelector(`.vn-token-option[data-token-id="${baseId}"]`);
        if (el && exclude?.has(el)) el = null;
        const aid = parseActorId(baseId);
        if (!el && aid) el = pick(root.querySelectorAll(`.vn-token-option[data-actor-id="${aid}"]`));
        if (!el) {
            const t = canvas?.tokens?.get(baseId);
            if (t?.actor) el = pick(root.querySelectorAll(`.vn-token-option[data-actor-id="${t.actor.id}"]`));
        }
        return el;
    }

    moveTokensToPositions(root, { leftIds = [], centerIds = [], rightIds = [] }) {
        const available = root.querySelector('#available-tokens');
        root.querySelectorAll('.vn-token-selector .vn-token-option, .vn-token-option.selected').forEach(el => {
            el.classList.remove('selected');
            available?.append(el);
        });

        const allIds = [...leftIds, ...centerIds, ...rightIds];
        let addedNew = false;
        const used = new Set();
        for (const id of allIds) {
            const baseId = stripDupSuffix(id);
            const aid = parseActorId(baseId);
            if (!this._findTokenElement(root, id, used) && aid) {
                const actor = game.actors.get(aid);
                if (actor && available) {
                    const temp = document.createElement('div');
                    temp.innerHTML = VNCharactersManager.generateActorToken(actor);
                    available.append(temp.firstElementChild);
                    addedNew = true;
                }
            }
        }
        if (addedNew) this._setupDragAndDrop(root);

        for (const [ids, sel] of [[leftIds, '#left-tokens'], [centerIds, '#center-tokens'], [rightIds, '#right-tokens']]) {
            const container = root.querySelector(sel);
            if (!container) continue;
            for (const id of ids) {
                const el = this._findTokenElement(root, id, used);
                if (el) { used.add(el); el.classList.add('selected'); container.append(el); }
            }
        }
    }

    _restoreCharFx(root, charFx) {
        const used = new Set();
        for (const [tokenId, fx] of Object.entries(VNCharFx.normalize(charFx))) {
            const el = this._findTokenElement(root, tokenId, used, true);
            if (!el) continue;
            used.add(el);
            this._applyCharFxIcon(el, fx);
        }
    }

    _positionSection(position, title, icon, orderInfo = '') {
        return `<div class="vn-position-slot">
            <div class="vn-position-header"><i class="fas ${icon}"></i><span>${title}</span>${orderInfo ? `<span class="vn-order-info">${orderInfo}</span>` : ''}</div>
            <div class="vn-token-selector" id="${position}-tokens" data-position="${position}"><div class="vn-drop-hint"><i class="fas fa-hand-pointer"></i></div></div>
        </div>`;
    }

    static generateActorToken(actor) {
        const id = actor.id || actor._id;
        const img = actor.img || actor.prototypeToken?.texture?.src || FALLBACK_AVATAR;
        return `<div class="vn-token-option" draggable="true" title="${escapeHtml(actor.name)}" data-actor-id="${escapeHtml(id)}" data-token-id="" data-type="actor" data-visibility="visible" data-name="${escapeHtml(actor.name.toLowerCase())}">
            <button type="button" class="vn-token-hide-btn" title="${game.i18n.localize(VIS_TITLE.visible)}" draggable="false"><i class="fas fa-eye"></i></button>
            ${charFxButton()}
            <div class="vn-token-preview"><img src="${escapeHtml(img)}" alt="${escapeHtml(actor.name)}" loading="lazy"><div class="vn-token-name">${escapeHtml(actor.name)}</div></div></div>`;
    }
}

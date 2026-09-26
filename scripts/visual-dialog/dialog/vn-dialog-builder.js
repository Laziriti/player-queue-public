// ============================================================
// vn-dialog-builder.js — UI диалога настроек сцены
// ============================================================

import { VNSceneState, VNPresets } from '../vn-state.js';
import { VNAtmosphere } from '../visual-effects/atmosphere/index.js';
import { stripDupSuffix, parseActorId, toActorTokenId, FALLBACK_AVATAR } from '../vn-id-utils.js';

const VIS_ICON  = { visible: 'fa-eye', hidden: 'fa-eye-slash', 'name-hidden': 'fa-user-secret' };
const VIS_TITLE = { visible: 'vn.dialog.vis.visible', hidden: 'vn.dialog.vis.hidden', 'name-hidden': 'vn.dialog.vis.nameHidden' };

export class VNDialogBuilder {
    constructor(scene) {
        /** @type {import('../visual-novel-scene.js').VisualNovelScene} */
        this._scene = scene;
        this._dialog = null;
        this._scaleDialog = null;
        this._dialogAbortCtrl = null;
        this._dropZones = null;
        this._dragEls = null;
        this._pendingFlipped = null;
        this._pendingScales = null;
        this._tokenSearchQuery = '';
    }

    get dialog() { return this._dialog; }

    // ══════════════════════════════════════════════════════════
    // Main Scene Dialog
    // ══════════════════════════════════════════════════════════

    openSceneDialog() { return this._show(false); }
    editSceneDialog() { return this._scene.state.isActive ? this._show(true) : undefined; }

    static _DIALOG_SIZE_KEY = 'player-queue.vn-dialog-size';

    async _show(isEdit) {
        if (this._dialog) { try { this._dialog.close(); } catch {} }
        this._pendingFlipped = null;
        this._pendingScales = null;
        this._tokenSearchQuery = '';
        this._dialogAbortCtrl?.abort();
        this._dialogAbortCtrl = new AbortController();
        this._dropZones = new WeakSet();
        this._dragEls = new WeakSet();

        const scene = this._scene;
        const tokens = canvas.tokens.placeables.filter(t => t.actor);

        scene._bgManager.resetPath();
        await scene._bgManager.load();
        await scene.loadFavoriteActors();

        const sorted = await VNPresets.getSorted();
        const presetsHTML = scene._presetsManager.generateTab(sorted);
        const ioHTML = scene._ioManager.generateTab(sorted);
        const dialogContent = this._generateContent(tokens, isEdit ? scene.state : null, presetsHTML, ioHTML);

        let savedSize;
        try { savedSize = JSON.parse(localStorage.getItem(VNDialogBuilder._DIALOG_SIZE_KEY) || 'null'); } catch {}
        const dialogPosition = (savedSize?.width >= 600 && savedSize?.height >= 400)
            ? { width: savedSize.width, height: savedSize.height }
            : { width: 1050, height: 840 };

        const dialog = new foundry.applications.api.DialogV2({
            window: { title: isEdit ? game.i18n.localize('vn.dialog.editTitle') : game.i18n.localize('vn.dialog.createTitle'), icon: isEdit ? 'fas fa-edit' : 'fas fa-theater-masks', resizable: true },
            position: dialogPosition,
            content: dialogContent,
            buttons: [
                { action: 'create', label: isEdit ? game.i18n.localize('vn.dialog.btnUpdate') : game.i18n.localize('vn.dialog.btnCreate'), icon: isEdit ? 'fas fa-sync' : 'fas fa-play', default: true,
                    callback: (_, __, dlg) => this._handleSubmit(dlg.element, isEdit, false) },
                { action: 'background-only', label: isEdit ? game.i18n.localize('vn.dialog.btnRemoveCharacters') : game.i18n.localize('vn.dialog.btnBackgroundOnly'), icon: 'fas fa-image',
                    callback: (_, __, dlg) => this._handleSubmit(dlg.element, isEdit, true) },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' }
            ]
        });

        dialog.addEventListener('render', () => this._setupInteractions(dialog.element, isEdit));
        dialog.addEventListener('close', () => {
            try {
                const { width, height } = dialog.position || {};
                if (width >= 600 && height >= 400)
                    localStorage.setItem(VNDialogBuilder._DIALOG_SIZE_KEY, JSON.stringify({ width, height }));
            } catch {}
            this._dialog = null;
            this._dialogAbortCtrl?.abort();
            this._dialogAbortCtrl = null;
        });
        this._dialog = dialog;
        dialog.render({ force: true });
    }

    close() {
        try { this._dialog?.close(); } catch {}
        this._dialog = null;
    }

    // ══════════════════════════════════════════════════════════
    // Submit
    // ══════════════════════════════════════════════════════════

    static _deduplicateIds(ids) {
        const counts = new Map();
        return ids.map(id => {
            const n = counts.get(id) || 0;
            counts.set(id, n + 1);
            return n === 0 ? id : `${id}#${n}`;
        });
    }

    // Remap portraitScales keys: canvas token IDs → positional actor IDs.
    // Shared by _handleSubmit (preset launch) and _gatherDialogState (preset save).
    static _remapScalesToActorIds(root, scales) {
        if (!scales || !Object.keys(scales).length) return scales;
        const allPositionEls = [...root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option')];
        const actorRaw = allPositionEls.map(el => el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || '');
        const actorDeduped = VNDialogBuilder._deduplicateIds(actorRaw);
        const canvasToActorId = new Map();
        allPositionEls.forEach((el, i) => {
            const tid = el.dataset.tokenId;
            if (tid && !parseActorId(tid)) canvasToActorId.set(tid, actorDeduped[i]);
        });
        const remapped = {};
        for (const [key, val] of Object.entries(scales)) {
            const mappedKey = canvasToActorId.get(key) ?? key;
            if (canvasToActorId.has(key) || remapped[mappedKey] === undefined) remapped[mappedKey] = val;
        }
        return remapped;
    }

    _handleSubmit(root, isEdit, backgroundOnly = false) {
        const getRawIds = (sel) => Array.from(root.querySelectorAll(`${sel} .vn-token-option`))
            .map(el => el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || null).filter(Boolean);

        const presetActors = getRawIds('#scene-participants');
        const allRaw = backgroundOnly ? [] : [...getRawIds('#left-tokens'), ...getRawIds('#center-tokens'), ...getRawIds('#right-tokens')];
        const allDeduped = VNDialogBuilder._deduplicateIds(allRaw);
        const leftCount = backgroundOnly ? 0 : root.querySelectorAll('#left-tokens .vn-token-option').length;
        const centerCount = backgroundOnly ? 0 : root.querySelectorAll('#center-tokens .vn-token-option').length;
        const left = allDeduped.slice(0, leftCount);
        const center = allDeduped.slice(leftCount, leftCount + centerCount);
        const right = allDeduped.slice(leftCount + centerCount);

        const bg = root.querySelector('input[name="background"]:checked')?.value;
        const overlay = root.querySelector('#background-overlay')?.checked ?? true;
        const particleEffect = root.querySelector('#particle-effect')?.value || 'particles';
        const visualEffect = root.querySelector('#visual-effect')?.value || 'none';
        const particlesForeground = root.querySelector('#particles-foreground')?.checked ?? false;
        const particleIntensity = parseInt(root.querySelector('#particle-intensity')?.value) || 1;
        const musicUuid = root.querySelector('#vn-music-uuid')?.value || null;
        const soundCues = this._scene._musicManager.gatherCues(root);

        const visibilityData = this._collectVisibilityData(root, allRaw, allDeduped);

        const { portraitImages, portraitNames } = backgroundOnly
            ? { portraitImages: {}, portraitNames: {} }
            : this._gatherPortraitData(root, allRaw, allDeduped);

        const pendingFlipped = this._pendingFlipped;
        const pendingScales = this._pendingScales
            ? VNDialogBuilder._remapScalesToActorIds(root, this._pendingScales)
            : null;
        this._pendingFlipped = null;
        this._pendingScales = null;

        const gmOnly = root.querySelector('#vn-gm-only-toggle')?.checked ?? false;

        if (isEdit) this._scene.updateSceneLayout({
            leftIds: left, centerIds: center, rightIds: right,
            background: bg, backgroundOverlay: overlay,
            flipped: pendingFlipped ?? null, particleEffect, visualEffect, particlesForeground, particleIntensity,
            visibility: visibilityData, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales ?? null, gmOnly, presetActors,
        });
        else this._scene.createScene({
            leftIds: left, centerIds: center, rightIds: right,
            background: bg, backgroundOverlay: overlay,
            flipped: pendingFlipped || {}, particleEffect, visualEffect, particlesForeground, particleIntensity,
            visibility: visibilityData, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales || {}, gmOnly, presetActors,
        });
    }

    // ══════════════════════════════════════════════════════════
    // Dialog Interactions Setup
    // ══════════════════════════════════════════════════════════

    _setupInteractions(root, isEdit) {
        this._setupDragAndDrop(root);
        this._scene._bgManager.attachListeners(root, (name) => this._scene._bgManager.refreshGallery(root, name));
        this._scene._effectsManager.attachListeners(root);
        this._scene._musicManager.attachListeners(root);
        this._setupFavoriteHandlers(root);
        this._setupActorsDragAndDrop(root);
        this._scene._presetsManager.attachListeners(root, {
            gatherState: (root) => this._gatherDialogState(root),
            applyPreset: (root, preset) => this.applyPreset(root, preset),
            launchScene: (preset) => { this._scene.createScene(preset); this._dialog?.close(); },
            syncPresetActors: (presetActors) => { if (this._scene.state.isActive) this._scene.state.presetActors = [...presetActors]; },
            onChanged: (root) => this._scene._ioManager.refreshExportList(root),
        });
        this._scene._ioManager.attachListeners(root, {
            onImported: (root) => this._scene._presetsManager.refresh(root),
        });
        this._setupTabs(root);
        this._setupHideButtons(root);
        this._attachCharacterControlListeners(root);

        if (isEdit && this._scene.state.isActive) {
            requestAnimationFrame(() => {
                this._moveTokensToPositions(root, this._scene.state);
                this._setDefaults(root);
            });
        }
    }

    static _TOKEN_SIZE_KEY = 'player-queue:tokenCardSize';

    _attachCharacterControlListeners(root) {
        const signal = this._dialogAbortCtrl?.signal;

        // Restore persisted card size and apply immediately
        const savedSize = parseInt(localStorage.getItem(VNDialogBuilder._TOKEN_SIZE_KEY) || '48');
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
            localStorage.setItem(VNDialogBuilder._TOKEN_SIZE_KEY, size);
        }, { signal });
    }

    _applyTokenCardSize(root, size) {
        root.querySelector('.vn-scene-dialog')?.style.setProperty('--vn-tok-size', size + 'px');
    }

    _applyTokenSearch(root) {
        const q = this._tokenSearchQuery;
        root.querySelectorAll('#available-tokens .vn-token-option, #scene-participants .vn-token-option').forEach(item => {
            item.style.display = !q || (item.dataset.name || '').includes(q) ? '' : 'none';
        });
    }

    // Writes a token option's visibility state to its dataset plus the matching hide-button icon/title.
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

    _setupTabs(root) {
        root.querySelectorAll('.vn-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = btn.dataset.tab;
                root.querySelectorAll('.vn-tab-btn').forEach(b => b.classList.remove('active'));
                root.querySelectorAll('.vn-tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                root.querySelector(`.vn-tab-panel[data-tab="${tab}"]`)?.classList.add('active');
            });
        });
    }

    // ══════════════════════════════════════════════════════════
    // Drag & Drop
    // ══════════════════════════════════════════════════════════

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

        const signal = this._dialogAbortCtrl?.signal;
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
                        await this._scene.addToFavorites(data.actorId);
                    }
                } catch { /* handled elsewhere */ }
            }, { signal });
        });
    }

    _makeDraggable(el) {
        if (this._dragEls?.has(el)) return;
        this._dragEls?.add(el);
        const signal = this._dialogAbortCtrl?.signal;
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
        }, { signal });
    }

    _setupActorsDragAndDrop(root) {
        const scene = this._scene;
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
                            temp.innerHTML = VNDialogBuilder.generateActorToken(actor);
                            const newEl = temp.firstElementChild;
                            zone.append(newEl);
                            this._makeDraggable(newEl);
                        }
                        await scene.addToFavorites(actor.id);
                        this._updateFavoritesDisplay(root);
                    } else if (zone.classList.contains('vn-scene-participants')) {
                        const existing = zone.querySelector(`.vn-token-option[data-actor-id="${actor.id}"]`);
                        if (!existing) {
                            const temp = document.createElement('div');
                            temp.innerHTML = VNDialogBuilder.generateActorToken(actor);
                            const newEl = temp.firstElementChild;
                            zone.append(newEl);
                            this._makeDraggable(newEl);
                            const badge = root.querySelector('.vn-participants-badge');
                            if (badge) badge.textContent = zone.querySelectorAll('.vn-token-option').length;
                        }
                    } else {
                        const temp = document.createElement('div');
                        temp.innerHTML = VNDialogBuilder.generateActorToken(actor);
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

    // ══════════════════════════════════════════════════════════
    // Favorites
    // ══════════════════════════════════════════════════════════

    _setupFavoriteHandlers(root) {
        const scene = this._scene;
        root.addEventListener('contextmenu', async (e) => {
            const tokenOpt = e.target.closest('.vn-favorites-section .vn-token-option');
            if (!tokenOpt) return;
            e.preventDefault();
            await scene.removeFromFavorites(tokenOpt.dataset.actorId);
            this._updateFavoritesDisplay(root);
        });
    }

    _updateFavoritesDisplay(root) {
        const favSection = root.querySelector('.vn-favorites-section');
        if (!favSection) return;
        const scene = this._scene;
        favSection.innerHTML = scene.favoriteActors.length === 0
            ? `<div class="vn-favorites-empty"><i class="fas fa-arrow-down"></i> ${game.i18n.localize('vn.dialog.dragActorsFromJournal')}</div>`
            : scene.favoriteActors.map(id => game.actors.get(id)).filter(Boolean).map(a => VNDialogBuilder.generateActorToken(a)).join('');
        this._setupDragAndDrop(root);
    }

    // ══════════════════════════════════════════════════════════
    // Token Helpers
    // ══════════════════════════════════════════════════════════

    _findTokenElement(root, tokenId, exclude = null, preferSelected = false) {
        const pick = (candidates) => {
            const arr = Array.from(candidates).filter(c => !exclude?.has(c));
            return (preferSelected ? arr.find(c => c.classList.contains('selected')) : null) ?? arr[0] ?? null;
        };
        const baseId = stripDupSuffix(tokenId);
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

    _moveTokensToPositions(root, { leftIds = [], centerIds = [], rightIds = [] }) {
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
                    temp.innerHTML = VNDialogBuilder.generateActorToken(actor);
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

    _selectBackground(root, bg) {
        if (!bg || bg === 'none') return;
        const radio = root.querySelector(`input[name="background"][value="${bg}"]`);
        if (radio) {
            root.querySelectorAll('.vn-bg-option').forEach(o => o.classList.remove('selected'));
            radio.checked = true;
            radio.closest('.vn-bg-option')?.classList.add('selected');
        } else {
            const label = decodeURIComponent(bg.split('/').pop().split('.')[0]).replace(/[-_]/g, ' ');
            this._scene._bgManager.addDynamicOption(root, bg, label);
        }
    }

    _setEffectAxis(root, axis, value) {
        this._scene._effectsManager._applyAxisValue(root, axis, value);
        this._scene._effectsManager._syncPresetHighlight?.(root);
    }

    _setDefaults(root) {
        const state = this._scene.state;

        this._selectBackground(root, state.background);
        const oc = root.querySelector('#background-overlay');
        if (oc) oc.checked = state.backgroundOverlay;
        this._setEffectAxis(root, 'particle', state.particleEffect || 'particles');
        this._setEffectAxis(root, 'visual', state.visualEffect || 'none');
        const pfg = root.querySelector('#particles-foreground');
        if (pfg) pfg.checked = state.particlesForeground ?? false;
        const pi = root.querySelector('#particle-intensity');
        if (pi) { pi.value = state.particleIntensity ?? 1; const piVal = pi.closest('.vn-particle-intensity-ctrl')?.querySelector('.vn-particle-intensity-val'); if (piVal) piVal.textContent = pi.value; }

        const defaultsUsed = new Set();
        for (const [tokenId, vis] of Object.entries(state.visibility ?? {})) {
            if (!vis || vis === 'visible') continue;
            const el = this._findTokenElement(root, tokenId, defaultsUsed, true);
            if (!el) continue;
            defaultsUsed.add(el);
            this._applyVisIcon(el, vis);
        }

        if (state.musicUuid) this._scene._musicManager.setMusic(root, state.musicUuid);
        this._scene._musicManager.applyCues(root, state.soundCues || []);
    }

    applyPreset(root, preset) {
        this._pendingFlipped = preset.flipped || {};
        this._pendingScales = preset.portraitScales || {};

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
                    temp.innerHTML = VNDialogBuilder.generateActorToken(actor);
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
                    temp.innerHTML = VNDialogBuilder.generateActorToken(actor);
                    available.append(temp.firstElementChild);
                }
            }
        }
        if (needed.size || presetActorIds.length) this._setupDragAndDrop(root);
        this._moveTokensToPositions(root, preset);

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

        this._selectBackground(root, preset.background);
        const overlayCheck = root.querySelector('#background-overlay');
        if (overlayCheck) overlayCheck.checked = preset.backgroundOverlay ?? true;
        if (preset.particleEffect != null || preset.visualEffect != null) {
            this._setEffectAxis(root, 'particle', preset.particleEffect || 'particles');
            this._setEffectAxis(root, 'visual', preset.visualEffect || 'none');
        } else {
            const legacy = VNAtmosphere.PRESETS[preset.atmosphereEffect] ?? VNAtmosphere.PRESETS.particles;
            this._setEffectAxis(root, 'particle', legacy.particles);
            this._setEffectAxis(root, 'visual', legacy.visual);
        }
        const pfgCheck = root.querySelector('#particles-foreground');
        if (pfgCheck) pfgCheck.checked = preset.particlesForeground ?? false;
        const piCheck = root.querySelector('#particle-intensity');
        if (piCheck) { piCheck.value = preset.particleIntensity ?? 1; const piVal = piCheck.closest('.vn-particle-intensity-ctrl')?.querySelector('.vn-particle-intensity-val'); if (piVal) piVal.textContent = piCheck.value; }

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

        this._scene._musicManager.setMusic(root, preset.musicUuid || null);
        this._scene._musicManager.applyCues(root, preset.soundCues || []);
    }

    _gatherPortraitData(root, allRaw = null, allDeduped = null) {
        const portraitImages = {}, portraitNames = {};
        const elements = Array.from(root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option'));
        elements.forEach((el, i) => {
            const id = (allDeduped && allRaw) ? allDeduped[i]
                : (el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || null);
            if (!id) return;
            const src = el.querySelector('.vn-token-preview img')?.getAttribute('src');
            const name = el.querySelector('.vn-token-name')?.textContent?.trim();
            if (src) portraitImages[id] = src;
            if (name) portraitNames[id] = name;
        });
        return { portraitImages, portraitNames };
    }

    _collectVisibilityData(root, allRaw = null, allDeduped = null) {
        const visibilityData = {};
        const elements = Array.from(root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option'));
        elements.forEach((el, i) => {
            const vis = el.dataset.visibility ?? 'visible';
            if (vis === 'visible') return;
            const id = (allDeduped && allRaw) ? allDeduped[i]
                : (el.dataset.tokenId || (el.dataset.actorId ? `actor-${el.dataset.actorId}` : null));
            if (id) visibilityData[id] = vis;
        });
        return visibilityData;
    }

    _gatherDialogState(root) {
        const scene = this._scene;
        const getRawIds = (sel) => Array.from(root.querySelectorAll(`${sel} .vn-token-option`))
            .map(el => el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || null).filter(Boolean);
        const allRaw = [...getRawIds('#left-tokens'), ...getRawIds('#center-tokens'), ...getRawIds('#right-tokens')];
        const allDeduped = VNDialogBuilder._deduplicateIds(allRaw);
        const leftCount = root.querySelectorAll('#left-tokens .vn-token-option').length;
        const centerCount = root.querySelectorAll('#center-tokens .vn-token-option').length;

        const visibilityData = this._collectVisibilityData(root, allRaw, allDeduped);
        const { portraitImages, portraitNames } = this._gatherPortraitData(root, allRaw, allDeduped);

        // Build positional canvas-token-ID → deduped-actor-ID mapping.
        // This is the only point where we know both the canvas token ID (data-token-id on the element)
        // and the exact deduped position ID (allDeduped[i], e.g. "actor-xyz#2").
        // Without this, scales stored under canvas IDs can't be matched to #N-suffixed actor IDs at load time.
        const allPositionEls = [...root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option')];
        const canvasToActorId = new Map();
        allPositionEls.forEach((el, i) => {
            const tid = el.dataset.tokenId;
            if (tid && !parseActorId(tid)) canvasToActorId.set(tid, allDeduped[i]);
        });

        // Remap portraitScales: canvas token ID keys → positional actor IDs.
        // Canvas-mapped values win over stale actor-key values (e.g. from old setCharacterScale behaviour).
        const rawScales = scene.state.isActive ? { ...scene.state.portraitScales } : { ...(this._pendingScales ?? {}) };
        const remappedScales = {};
        for (const [key, val] of Object.entries(rawScales)) {
            const mappedKey = canvasToActorId.get(key) ?? key;
            if (canvasToActorId.has(key) || remappedScales[mappedKey] === undefined) {
                remappedScales[mappedKey] = val;
            }
        }

        const state = new VNSceneState();
        state.fromPayload({
            leftIds: allDeduped.slice(0, leftCount),
            centerIds: allDeduped.slice(leftCount, leftCount + centerCount),
            rightIds: allDeduped.slice(leftCount + centerCount),
            background: root.querySelector('input[name="background"]:checked')?.value || null,
            backgroundOverlay: root.querySelector('#background-overlay')?.checked ?? true,
            particleEffect: root.querySelector('#particle-effect')?.value || 'particles',
            visualEffect: root.querySelector('#visual-effect')?.value || 'none',
            particlesForeground: root.querySelector('#particles-foreground')?.checked ?? false,
            particleIntensity: parseInt(root.querySelector('#particle-intensity')?.value) || 1,
            portraitScale: scene.state.portraitScale,
            portraitScales: remappedScales,
            visibility: visibilityData,
            musicUuid: root.querySelector('#vn-music-uuid')?.value || null,
            soundCues: this._scene._musicManager.gatherCues(root),
            flipped: Object.fromEntries(
                Object.entries(scene.state.flipped).filter(([, v]) => v)
                    .map(([tid, v]) => {
                        if (parseActorId(tid)) return [tid, v];
                        const a = canvas.tokens.get(tid)?.actor;
                        return [a ? toActorTokenId(a.id) : tid, v];
                    })
            ),
            portraitImages,
            portraitNames,
            presetActors: getRawIds('#scene-participants'),
        });
        return state;
    }

    // ══════════════════════════════════════════════════════════
    // Portrait Scale Dialog
    // ══════════════════════════════════════════════════════════

    openScaleDialog() {
        if (!game.user.isGM) return;
        if (this._scaleDialog) { try { this._scaleDialog.close(); } catch {} }

        const scene = this._scene;
        const currentPercent = Math.round(scene.state.portraitScale * 100);
        const presets = [50, 75, 100, 125, 150, 200];
        const clamp = scene.constructor.clamp;
        const debounce = scene.constructor.debounce;
        const debouncedScale = debounce(val => scene.setPortraitScale(val / 100, false), 30);

        const dialog = new foundry.applications.api.DialogV2({
            window: { title: game.i18n.localize('vn.dialog.portraitSizeTitle'), icon: 'fas fa-expand-arrows-alt' },
            position: { width: 380, height: 'auto' },
            content: `<div class="vn-scale-dialog">
                <div class="vn-scale-header"><label>${game.i18n.localize('vn.dialog.scaleLabel')}</label><span class="vn-scale-value" id="scale-value">${currentPercent}%</span></div>
                <input type="range" id="portrait-scale-slider" name="scaleSlider" min="50" max="200" step="5" value="${currentPercent}">
                <div class="vn-scale-presets">${presets.map(v => `<button type="button" class="vn-btn vn-scale-preset ${v === currentPercent ? 'active' : ''}" data-scale="${v}">${v}%</button>`).join('')}</div>
            </div>`,
            buttons: [
                { action: 'apply', label: game.i18n.localize('vn.dialog.btnApplyForAll'), icon: 'fas fa-check', default: true,
                    callback: (_, button) => scene.setPortraitScale(parseInt(button.form.elements.scaleSlider.value) / 100, true) },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' }
            ]
        });

        dialog.addEventListener('render', () => {
            const root = dialog.element;
            const slider = root.querySelector('#portrait-scale-slider');
            const display = root.querySelector('#scale-value');

            slider?.addEventListener('input', () => {
                display.textContent = slider.value + '%';
                debouncedScale(parseInt(slider.value));
                root.querySelectorAll('.vn-scale-preset').forEach(btn =>
                    btn.classList.toggle('active', btn.dataset.scale === slider.value));
            });

            root.querySelectorAll('.vn-scale-preset').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const s = parseInt(btn.dataset.scale);
                    slider.value = s;
                    display.textContent = s + '%';
                    scene.setPortraitScale(s / 100, false);
                    root.querySelectorAll('.vn-scale-preset').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        });

        dialog.addEventListener('close', () => { this._scaleDialog = null; });
        this._scaleDialog = dialog;
        dialog.render({ force: true });
    }

    // ══════════════════════════════════════════════════════════
    // HTML Generation
    // ══════════════════════════════════════════════════════════

    _generateContent(tokens, sceneState, presetsHTML = '', ioHTML = '') {
        const scene = this._scene;
        const currentOverlay = sceneState ? sceneState.backgroundOverlay !== false : true;
        const currentBg = sceneState?.background || null;
        const currentParticle = sceneState?.particleEffect || 'none';
        const currentVisual = sceneState?.visualEffect || 'none';
        const currentParticlesFg = sceneState?.particlesForeground ?? false;
        const currentParticleIntensity = sceneState?.particleIntensity ?? 1;
        const currentMusicUuid = sceneState?.musicUuid || null;
        const currentSoundCues = sceneState?.soundCues || [];

        const favHTML = scene.favoriteActors.map(id => game.actors.get(id)).filter(Boolean).map(a => VNDialogBuilder.generateActorToken(a)).join('');
        const tokensHTML = tokens.map(t => `<div class="vn-token-option" draggable="true" data-token-id="${t.id}" data-actor-id="${t.actor.id}" data-type="token" data-visibility="visible" data-name="${t.name.toLowerCase()}">
            <button type="button" class="vn-token-hide-btn" title="${game.i18n.localize(VIS_TITLE.visible)}" draggable="false"><i class="fas fa-eye"></i></button>
            <div class="vn-token-preview"><img src="${t.actor.img || t.document.texture.src}" alt="${t.name}" loading="lazy"><div class="vn-token-name">${t.name}</div></div></div>`).join('');

        const participantTokensHtml = (sceneState?.presetActors || []).map(id => {
            const aid = parseActorId(id);
            if (!aid) return '';
            const actor = game.actors.get(aid);
            return actor ? VNDialogBuilder.generateActorToken(actor) : '';
        }).filter(Boolean).join('');
        const participantCount = (sceneState?.presetActors || []).filter(id => {
            const aid = parseActorId(id);
            return aid && game.actors.get(aid);
        }).length;

        return `<div class="vn-scene-dialog">
            <div class="vn-tabs">
                <button type="button" class="vn-tab-btn active" data-tab="characters"><i class="fas fa-users"></i> ${game.i18n.localize('vn.dialog.tabCharacters')}</button>
                <button type="button" class="vn-tab-btn" data-tab="background"><i class="fas fa-image"></i> ${game.i18n.localize('vn.dialog.tabBackground')}</button>
                <button type="button" class="vn-tab-btn" data-tab="effects"><i class="fas fa-wand-magic-sparkles"></i> ${game.i18n.localize('vn.dialog.tabEffects')}</button>
                <button type="button" class="vn-tab-btn" data-tab="music"><i class="fas fa-music"></i> ${game.i18n.localize('vn.dialog.tabMusic')}</button>
                <button type="button" class="vn-tab-btn" data-tab="presets"><i class="fas fa-bookmark"></i> ${game.i18n.localize('vn.dialog.tabPresets')}</button>
                <button type="button" class="vn-tab-btn" data-tab="adventure-io"><i class="fas fa-boxes-stacked"></i> ${game.i18n.localize('vn.dialog.tabAdventures')}</button>
                <label class="vn-gm-only-toggle" title="${game.i18n.localize('vn.dialog.gmOnlyToggleTitle')}">
                    <input type="checkbox" id="vn-gm-only-toggle"><span class="vn-toggle-track"></span>
                    <i class="fas fa-eye-slash"></i> ${game.i18n.localize('vn.dialog.gmOnlyLabel')}
                </label>
            </div>
            <div class="vn-tab-panel active" data-tab="characters">
                <div class="vn-dialog-layout">
                    <div class="vn-dialog-main">
                        <div class="vn-characters-controls">
                            <input type="text" class="vn-token-search" placeholder="${game.i18n.localize('vn.dialog.tokenSearchPlaceholder')}">
                            <div class="vn-token-size-control">
                                <i class="fas fa-expand-arrows-alt"></i>
                                <input type="range" class="vn-token-size-slider" min="32" max="80" step="4" value="48">
                            </div>
                        </div>
                        <details class="vn-collapsible" open>
                            <summary class="vn-collapsible-header"><i class="fas fa-map-marker-alt"></i> ${game.i18n.localize('vn.dialog.tokensOnScene')} <span class="vn-badge">${tokens.length}</span><i class="fas fa-chevron-down vn-chevron"></i></summary>
                            <div class="vn-collapsible-body"><div class="vn-available-tokens" id="available-tokens">${tokensHTML || `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noTokensOnScene')}</div>`}</div></div>
                        </details>
                        <details class="vn-collapsible vn-participants-collapsible" open>
                            <summary class="vn-collapsible-header"><i class="fas fa-users-gear"></i> ${game.i18n.localize('vn.dialog.participantsLabel')} <span class="vn-badge vn-participants-badge">${participantCount}</span><i class="fas fa-chevron-down vn-chevron"></i></summary>
                            <div class="vn-collapsible-body">
                                <p class="vn-participants-hint">${game.i18n.localize('vn.dialog.participantsHint')}</p>
                                <div class="vn-scene-participants" id="scene-participants">${participantTokensHtml}</div>
                            </div>
                        </details>
                        <div class="vn-positions-grid">
                            ${this._positionSection('left', game.i18n.localize('vn.dialog.positionLeft'), 'fa-arrow-left', game.i18n.localize('vn.dialog.positionLeftOrder'))}
                            ${this._positionSection('center', game.i18n.localize('vn.dialog.positionCenter'), 'fa-bullseye')}
                            ${this._positionSection('right', game.i18n.localize('vn.dialog.positionRight'), 'fa-arrow-right', game.i18n.localize('vn.dialog.positionRightOrder'))}
                        </div>
                    </div>
                    <div class="vn-dialog-sidebar">
                        <div class="vn-favorites-panel">
                            <div class="vn-panel-header"><i class="fas fa-star"></i> ${game.i18n.localize('vn.dialog.favoritesHeader')}</div>
                            <div class="vn-favorites-section">${favHTML || `<div class="vn-favorites-empty"><i class="fas fa-arrow-down"></i> ${game.i18n.localize('vn.dialog.dragActorsFromJournal')}</div>`}</div>
                            <div class="vn-favorites-hint"><i class="fas fa-mouse-pointer"></i> ${game.i18n.localize('vn.dialog.favoritesHint')}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="vn-tab-panel" data-tab="background">
                ${scene._bgManager.generateSelector(currentBg, currentOverlay)}
            </div>
            <div class="vn-tab-panel" data-tab="effects">
                ${scene._effectsManager.generateTab(currentParticle, currentVisual, currentParticlesFg, currentParticleIntensity)}
            </div>
            <div class="vn-tab-panel" data-tab="music">
                ${scene._musicManager.generateTab(currentMusicUuid, currentSoundCues)}
            </div>
            <div class="vn-tab-panel" data-tab="presets">${presetsHTML}</div>
            <div class="vn-tab-panel" data-tab="adventure-io">${ioHTML}</div>
        </div>`;
    }

    _positionSection(position, title, icon, orderInfo = '') {
        return `<div class="vn-position-slot">
            <div class="vn-position-header"><i class="fas ${icon}"></i><span>${title}</span>${orderInfo ? `<span class="vn-order-info">${orderInfo}</span>` : ''}</div>
            <div class="vn-token-selector" id="${position}-tokens" data-position="${position}"><div class="vn-drop-hint"><i class="fas fa-hand-pointer"></i></div></div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    // Static Helpers
    // ══════════════════════════════════════════════════════════

    static generateActorToken(actor) {
        const id = actor.id || actor._id;
        const img = actor.img || actor.prototypeToken?.texture?.src || FALLBACK_AVATAR;
        return `<div class="vn-token-option" draggable="true" data-actor-id="${id}" data-token-id="" data-type="actor" data-visibility="visible" data-name="${actor.name.toLowerCase()}">
            <button type="button" class="vn-token-hide-btn" title="${game.i18n.localize(VIS_TITLE.visible)}" draggable="false"><i class="fas fa-eye"></i></button>
            <div class="vn-token-preview"><img src="${img}" alt="${actor.name}" loading="lazy"><div class="vn-token-name">${actor.name}</div></div></div>`;
    }
}

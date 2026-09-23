// ============================================================
// vn-dialog-builder.js — UI диалога настроек сцены
// ============================================================

import { VNSceneState, VNPresets, VNFolders, MODULE_ID } from './vn-state.js';
import { VNAdventureIO } from './vn-adventure-io.js';
import { stripDupSuffix, parseActorId, toActorTokenId, parsePlaylistUuid, FALLBACK_AVATAR } from './vn-id-utils.js';
import { NAMEPLATE_CONFIGS, applyNameplateImage } from '../settings.js';
import { countPendingMigrations } from './vn-migrations.js';

const VIS_ICON  = { visible: 'fa-eye', hidden: 'fa-eye-slash', 'name-hidden': 'fa-user-secret' };
const VIS_TITLE = { visible: 'vn.dialog.vis.visible', hidden: 'vn.dialog.vis.hidden', 'name-hidden': 'vn.dialog.vis.nameHidden' };

export class VNDialogBuilder {
    constructor(scene) {
        /** @type {import('./visual-novel-scene.js').VisualNovelScene} */
        this._scene = scene;
        this._dialog = null;
        this._scaleDialog = null;
        this._presetSearchQuery = '';
        this._presetSceneFilter = false;
        this._presetTagFilter = null;
        this._presetViewMode = 'list';
        this._presetSortMode = 'newest';
        this._ioViewMode = 'detailed';
        this._ioFoundModules = [];
        this._ioSelectedModuleId = null;
        this._ioModulePresets = [];
        this._dialogAbortCtrl = null;
        this._dropZones = null;
        this._dragEls = null;
        this._pendingFlipped = null;
        this._pendingScales = null;
        this._selectedPresetId = null;
        this._presetsGroupMode = 'scenes';
        this._currentFolderId = null;
        this._ioModuleFolders = [];
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
        this._selectedPresetId = null;
        this._currentFolderId = null;
        this._tokenSearchQuery = '';
        this._dialogAbortCtrl?.abort();
        this._dialogAbortCtrl = new AbortController();
        this._dropZones = new WeakSet();
        this._dragEls = new WeakSet();
        try { this._presetsGroupMode = game.settings.get(MODULE_ID, 'vnPresetsGroupMode') || 'scenes'; } catch {}
        try { this._presetViewMode = game.settings.get(MODULE_ID, 'vnPresetsViewMode') || 'list'; } catch {}

        const scene = this._scene;
        const tokens = canvas.tokens.placeables.filter(t => t.actor);

        scene._bgManager.resetPath();
        await scene._bgManager.load();
        await scene.loadFavoriteActors();

        const sorted = await VNPresets.getSorted();
        const presetsHTML = this._generatePresetsSection(sorted);
        const ioHTML = this._generateIOSection(sorted);
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
        const effect = root.querySelector('#atmosphere-effect')?.value || 'particles';
        const particlesForeground = root.querySelector('#particles-foreground')?.checked ?? false;
        const particleIntensity = parseInt(root.querySelector('#particle-intensity')?.value) || 1;
        const musicUuid = root.querySelector('#vn-music-uuid')?.value || null;
        const soundCues = this._gatherSoundCues(root);

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
            flipped: pendingFlipped ?? null, atmosphereEffect: effect, particlesForeground, particleIntensity,
            visibility: visibilityData, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales ?? null, gmOnly, presetActors,
        });
        else this._scene.createScene({
            leftIds: left, centerIds: center, rightIds: right,
            background: bg, backgroundOverlay: overlay,
            flipped: pendingFlipped || {}, atmosphereEffect: effect, particlesForeground, particleIntensity,
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
        this._setupFavoriteHandlers(root);
        this._setupActorsDragAndDrop(root);
        this._attachPresetListeners(root);
        this._attachIOListeners(root);
        this._setupTabs(root);
        this._setupHideButtons(root);
        this._setupMusicDrop(root);
        this._setupCueDrop(root);
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
            tokenOpt.dataset.visibility = next;
            btn.querySelector('i').className = `fas ${VIS_ICON[next]}`;
            btn.title = game.i18n.localize(VIS_TITLE[next]);
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

    _setDefaults(root) {
        const state = this._scene.state;

        this._selectBackground(root, state.background);
        const oc = root.querySelector('#background-overlay');
        if (oc) oc.checked = state.backgroundOverlay;
        const es = root.querySelector('#atmosphere-effect');
        if (es) es.value = state.atmosphereEffect || 'particles';
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
            el.dataset.visibility = vis;
            const i = el.querySelector('.vn-token-hide-btn i');
            if (i) i.className = `fas ${VIS_ICON[vis]}`;
            const btn = el.querySelector('.vn-token-hide-btn');
            if (btn) btn.title = game.i18n.localize(VIS_TITLE[vis]);
        }

        if (state.musicUuid) this._setMusicInDialog(root, state.musicUuid);
        this._applySoundCues(root, state.soundCues || []);
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
        const effectSelect = root.querySelector('#atmosphere-effect');
        if (effectSelect) effectSelect.value = preset.atmosphereEffect || 'particles';
        const pfgCheck = root.querySelector('#particles-foreground');
        if (pfgCheck) pfgCheck.checked = preset.particlesForeground ?? false;
        const piCheck = root.querySelector('#particle-intensity');
        if (piCheck) { piCheck.value = preset.particleIntensity ?? 1; const piVal = piCheck.closest('.vn-particle-intensity-ctrl')?.querySelector('.vn-particle-intensity-val'); if (piVal) piVal.textContent = piCheck.value; }

        root.querySelectorAll('.vn-token-option').forEach(el => {
            el.dataset.visibility = 'visible';
            const i = el.querySelector('.vn-token-hide-btn i');
            if (i) i.className = `fas ${VIS_ICON.visible}`;
            const btn = el.querySelector('.vn-token-hide-btn');
            if (btn) btn.title = game.i18n.localize(VIS_TITLE.visible);
        });
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
            el.dataset.visibility = vis;
            const i = el.querySelector('.vn-token-hide-btn i');
            if (i) i.className = `fas ${VIS_ICON[vis]}`;
            const btn = el.querySelector('.vn-token-hide-btn');
            if (btn) btn.title = game.i18n.localize(VIS_TITLE[vis]);
        }

        this._setMusicInDialog(root, preset.musicUuid || null);
        this._applySoundCues(root, preset.soundCues || []);
    }

    // ══════════════════════════════════════════════════════════
    // Presets
    // ══════════════════════════════════════════════════════════

    _generatePresetsSection(sorted) {
        const currentSceneName = canvas?.scene?.name ?? null;
        const currentSceneId = canvas?.scene?.id ?? null;
        const hasCurrent = !!currentSceneId;
        const isFolder = this._presetsGroupMode === 'folders';
        const itemsHtml = isFolder
            ? this._buildFolderViewHtml(sorted)
            : (this._buildPresetItemsHtml(sorted) || `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noSavedPresets')}</div>`);

        return `<div class="vn-presets-content">
            <div class="vn-presets-split">
                <div class="vn-presets-list-pane">
                    <div class="vn-preset-save-row">
                        <input type="text" id="vn-preset-name" placeholder="${game.i18n.localize('vn.dialog.presetNamePlaceholder')}">
                        <button type="button" class="vn-btn vn-btn-xs vn-preset-scene-pin${hasCurrent ? ' active' : ''}" id="vn-preset-scene-pin"
                            title="${hasCurrent ? game.i18n.format('vn.dialog.pinToScene', {sceneName: currentSceneName}) : game.i18n.localize('vn.dialog.noActiveScenePin')}"
                            data-scene-name="${currentSceneName || ''}"${!hasCurrent ? ' disabled' : ''}>
                            <i class="fas fa-map-pin"></i>
                        </button>
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-accent vn-preset-save-btn"><i class="fas fa-save"></i> ${game.i18n.localize('vn.dialog.btnSavePreset')}</button>
                    </div>
                    <div class="vn-preset-controls">
                        <div class="vn-presets-mode-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-presets-groupmode-btn${!isFolder ? ' active' : ''}" data-groupmode="scenes" title="${game.i18n.localize('vn.folders.modeScenes')}"><i class="fas fa-map-pin"></i></button>
                            <button type="button" class="vn-btn vn-btn-xs vn-presets-groupmode-btn${isFolder ? ' active' : ''}" data-groupmode="folders" title="${game.i18n.localize('vn.folders.modeFolders')}"><i class="fas fa-folder"></i></button>
                        </div>
                        <input type="text" class="vn-preset-search" placeholder="${game.i18n.localize('vn.dialog.searchPresetsPlaceholder')}">
                        <div class="vn-preset-view-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this._presetViewMode === 'list' ? 'active' : ''}" data-view="list" title="${game.i18n.localize('vn.dialog.viewList')}"><i class="fas fa-list"></i></button>
                            <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this._presetViewMode === 'cards' ? 'active' : ''}" data-view="cards" title="${game.i18n.localize('vn.dialog.viewCards')}"><i class="fas fa-th-large"></i></button>
                        </div>
                        <button type="button" class="vn-btn vn-btn-sm vn-preset-scene-filter${this._presetSceneFilter ? ' active' : ''}" title="${game.i18n.format('vn.dialog.filterBySceneTitle', {sceneName: currentSceneName || game.i18n.localize('vn.dialog.thisSceneDefault')})}" data-scene-id="${currentSceneId || ''}">
                            <i class="fas fa-map"></i> ${game.i18n.localize('vn.dialog.thisScene')}
                        </button>
                        <select class="vn-preset-sort" title="${game.i18n.localize('vn.dialog.sortingTitle')}">
                            <option value="newest"${this._presetSortMode === 'newest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortNewest')}</option>
                            <option value="oldest"${this._presetSortMode === 'oldest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortOldest')}</option>
                            <option value="az"${this._presetSortMode === 'az' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortAZ')}</option>
                            <option value="za"${this._presetSortMode === 'za' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortZA')}</option>
                        </select>
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-danger vn-preset-clear-all" title="${game.i18n.localize('vn.dialog.deleteAllPresetsTitle')}">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                    <div class="vn-preset-tag-bar" hidden>
                        <input type="text" class="vn-tag-bar-search" placeholder="${game.i18n.localize('vn.dialog.tagBarSearch') || '…'}" autocomplete="off" spellcheck="false">
                        <div class="vn-tag-bar-chips"></div>
                    </div>
                    <div class="vn-preset-list-header">
                        <i class="fas fa-list"></i> ${game.i18n.localize('vn.dialog.savedPresetsHeader')} <span class="vn-badge">${sorted.length}</span>
                        <button type="button" class="vn-btn vn-btn-xs vn-preset-regen-all" title="${game.i18n.localize('vn.dialog.regenAllTitle')}"><i class="fas fa-camera"></i> ${game.i18n.localize('vn.dialog.btnRegenAll')}</button>
                    </div>
                    <div class="vn-preset-list${this._presetViewMode === 'cards' ? ' vn-preset-list--cards' : ''}${isFolder ? ' vn-preset-list--folder-mode' : ''}">${itemsHtml}</div>
                </div>
                <div class="vn-preset-detail-panel">
                    <div class="vn-panel-empty-hint"><i class="fas fa-hand-point-left"></i><span>${game.i18n.localize('vn.dialog.panelSelectHint')}</span></div>
                </div>
            </div>
        </div>`;
    }

    _sortPresets(presets) {
        const copy = [...presets];
        switch (this._presetSortMode) {
            case 'oldest': return copy.sort((a, b) => (a.createdAt || a.savedAt || 0) - (b.createdAt || b.savedAt || 0));
            case 'az':     return copy.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
            case 'za':     return copy.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ru'));
            default:       return copy.sort((a, b) => (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
        }
    }

    _buildFolderViewHtml(allPresets) {
        const favorites = VNFolders.getFavorites();
        const currentId = this._currentFolderId || null;
        const isCards = this._presetViewMode === 'cards';

        // Breadcrumb
        const path = VNFolders.getPath(currentId);
        const breadcrumbSegs = [
            `<span class="vn-folder-breadcrumb-seg${!currentId ? ' --active' : ''}" data-folder-id="">${game.i18n.localize('vn.folders.breadcrumbRoot')}</span>`
        ];
        for (const seg of path) {
            const isLast = seg.id === currentId;
            breadcrumbSegs.push(`<span class="vn-folder-breadcrumb-sep">/</span>`);
            breadcrumbSegs.push(`<span class="vn-folder-breadcrumb-seg${isLast ? ' --active' : ''}" data-folder-id="${seg.id}">${seg.name}</span>`);
        }

        // Favorites quick-access strip
        const favFolders = favorites.map(id => VNFolders.get(id)).filter(Boolean);
        const favStrip = favFolders.length
            ? `<div class="vn-folder-favorites-strip">${
                favFolders.map(f => `<button type="button" class="vn-btn vn-btn-xs vn-folder-fav-shortcut${f.id === currentId ? ' --active' : ''}" data-folder-id="${f.id}"><i class="fas fa-star"></i> ${f.name}</button>`).join('')
              }</div>`
            : '';

        const toolbar = `<div class="vn-folder-toolbar">
            <button type="button" class="vn-btn vn-btn-xs vn-folder-new-btn"><i class="fas fa-folder-plus"></i> ${game.i18n.localize('vn.folders.btnNewFolder')}</button>
        </div>`;

        // When search is active — show flat list of all matching presets across all folders
        if (this._presetSearchQuery) {
            const q = this._presetSearchQuery.toLowerCase();
            const matched = allPresets.filter(p =>
                (p.name || '').toLowerCase().includes(q) || (p.tags || []).some(t => t.toLowerCase().includes(q))
            );
            const presetsHtml = matched.length
                ? (isCards
                    ? `<div class="vn-preset-cards">${matched.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                    : matched.map(p => this._buildPresetListItemHtml(p, false, true)).join(''))
                : `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.nothingFound')}</div>`;
            return `<div class="vn-folder-breadcrumb">${breadcrumbSegs.join('')}</div>
                ${favStrip}
                ${toolbar}
                ${presetsHtml}`;
        }

        // Child folders of current folder (favorites first, then alphabetical)
        const children = VNFolders.getChildren(currentId);
        children.sort((a, b) => {
            const aFav = favorites.includes(a.id), bFav = favorites.includes(b.id);
            if (aFav !== bFav) return aFav ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        // Count direct children (presets + subfolders) per folder
        const childCountByFolder = {};
        for (const p of allPresets) {
            const fid = p.folderId || null;
            if (fid) childCountByFolder[fid] = (childCountByFolder[fid] || 0) + 1;
        }
        for (const f of Object.values(VNFolders.getAll())) {
            const pid = f.parentId || null;
            if (pid) childCountByFolder[pid] = (childCountByFolder[pid] || 0) + 1;
        }

        const folderItems = children.map(f => {
            const isFav = favorites.includes(f.id);
            const cnt = childCountByFolder[f.id] || 0;
            const badge = cnt > 0 ? `<span class="vn-folder-child-count">${cnt}</span>` : '';
            return `<div class="vn-folder-item${isFav ? ' --favorite' : ''}${isCards ? ' --card' : ''}" data-folder-id="${f.id}" draggable="true">
                <i class="fas fa-folder${isFav ? '-open' : ''}"></i>
                <span class="vn-folder-item-name">${f.name}</span>
                ${badge}
                <button type="button" class="vn-btn vn-btn-xs vn-folder-fav-btn${isFav ? ' --active' : ''}" data-folder-id="${f.id}" title="${game.i18n.localize('vn.folders.toggleFavorite')}"><i class="fas fa-star"></i></button>
                <button type="button" class="vn-btn vn-btn-xs vn-folder-rename-btn" data-folder-id="${f.id}" title="${game.i18n.localize('vn.folders.renameFolder')}"><i class="fas fa-pencil"></i></button>
                <button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-folder-delete-btn" data-folder-id="${f.id}" title="${game.i18n.localize('vn.folders.deleteFolder')}"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');

        const folderItemsHtml = isCards && children.length
            ? `<div class="vn-folder-items-grid">${folderItems}</div>`
            : folderItems;

        // Preset items in current folder (cards are draggable for drop-to-folder)
        const folderPresets = allPresets.filter(p => (p.folderId ?? null) === currentId);
        const presetsHtml = folderPresets.length
            ? (isCards
                ? `<div class="vn-preset-cards">${folderPresets.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                : folderPresets.map(p => this._buildPresetListItemHtml(p, false, true)).join(''))
            : '';

        const emptyHint = !children.length && !folderPresets.length
            ? `<div class="vn-empty-hint">${game.i18n.localize('vn.folders.emptyFolder')}</div>`
            : '';

        return `<div class="vn-folder-breadcrumb">${breadcrumbSegs.join('')}</div>
            ${favStrip}
            ${toolbar}
            ${folderItemsHtml}
            ${presetsHtml}
            ${emptyHint}`;
    }

    _buildPresetItemsHtml(sortedPresets) {
        if (!sortedPresets.length) return '';
        sortedPresets = this._sortPresets(sortedPresets);
        const isCards = this._presetViewMode === 'cards';
        const hasAnyScene = sortedPresets.some(p => p.sceneName);

        if (!hasAnyScene) {
            return isCards
                ? `<div class="vn-preset-cards">${sortedPresets.map(p => this._buildPresetCardHtml(p)).join('')}</div>`
                : sortedPresets.map(p => this._buildPresetListItemHtml(p, false)).join('');
        }

        const groups = new Map();
        for (const p of sortedPresets) {
            const key = p.sceneName || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
        }
        const sortedKeys = [...groups.keys()].sort((a, b) => {
            if (!a) return 1; if (!b) return -1; return a.localeCompare(b);
        });
        return sortedKeys.map(key => {
            const group = groups.get(key);
            const label = key || game.i18n.localize('vn.dialog.noScene');
            const items = isCards
                ? `<div class="vn-preset-cards">${group.map(p => this._buildPresetCardHtml(p)).join('')}</div>`
                : `<div class="vn-preset-group-items">${group.map(p => this._buildPresetListItemHtml(p, true)).join('')}</div>`;
            return `<div class="vn-preset-scene-group" data-group-key="${key}">
                <div class="vn-preset-scene-hdr">
                    <i class="fas fa-map-pin"></i> ${label}
                    <span class="vn-badge">${group.length}</span>
                    <div class="vn-preset-group-actions">
                        <button type="button" class="vn-btn vn-btn-xs vn-preset-group-regen" data-group-key="${key}" title="${game.i18n.format('vn.dialog.regenGroupTitle', {label})}"><i class="fas fa-camera"></i></button>
                        <button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-preset-group-delete" data-group-key="${key}" title="${game.i18n.format('vn.dialog.deleteGroupTitle', {label})}"><i class="fas fa-trash-can"></i></button>
                    </div>
                </div>
                ${items}
            </div>`;
        }).join('');
    }

    _buildPresetListItemHtml(p, grouped = false, draggable = false) {
        const sceneTag = (!grouped && p.sceneName)
            ? `<span class="vn-preset-scene-tag"><i class="fas fa-map-pin"></i>${p.sceneName}</span>`
            : '';
        const createdStr = this._formatDate(p.createdAt || p.savedAt);
        const updatedStr = (p.updatedAt && p.updatedAt !== p.createdAt) ? this._formatDate(p.updatedAt) : null;
        const dateText = updatedStr
            ? game.i18n.format('vn.dialog.presetCreatedUpdated', {created: createdStr, updated: updatedStr})
            : createdStr ? game.i18n.format('vn.dialog.presetCreated', {date: createdStr}) : '';
        const versionHtml = p.version ? `<span class="vn-preset-version">v${p.version}</span>` : '';
        const pendingMigrations = countPendingMigrations(p);
        const migrationHtml = pendingMigrations
            ? `<span class="vn-preset-migration-badge" title="${game.i18n.format('vn.dialog.presetMigrationHint', { count: pendingMigrations })}"><i class="fas fa-wrench"></i> ${pendingMigrations}</span>`
            : '';
        const metaHtml = (sceneTag || dateText || versionHtml || migrationHtml)
            ? `<div class="vn-preset-meta">${sceneTag}<span class="vn-preset-dates">${dateText}</span>${versionHtml}${migrationHtml}</div>`
            : '';
        const tagsHtml = p.tags?.length
            ? `<div class="vn-preset-tags">${p.tags.map(t => `<span class="vn-tag-chip" data-tag="${t}">${t}</span>`).join('')}</div>`
            : '';
        return `<div class="vn-preset-item" data-preset="${p.id}" data-preset-name="${p.name}" data-scene-id="${p.sceneId || ''}" data-tags="${(p.tags || []).join(',')}"${draggable ? ' draggable="true"' : ''}>
            <div class="vn-preset-info">
                <span class="vn-preset-name" title="${p.name}">${p.name}</span>
                ${metaHtml}${tagsHtml}
            </div>
            <div class="vn-preset-actions">${this._presetActionButtons(p.id)}</div>
        </div>`;
    }

    _buildPresetCardHtml(p, draggable = false) {
        const bgSrc = p.thumbnailData || (p.background && p.background !== 'none' ? p.background : null);
        const imgHtml = bgSrc
            ? `<img class="vn-preset-card-img" src="${bgSrc}" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-preset-card-placeholder"><i class="fas fa-film"></i></div>`;

        const allIds = [...(p.leftIds || []), ...(p.centerIds || []), ...(p.rightIds || [])];
        const maxPips = 4;
        const pipsHtml = allIds.length
            ? `<div class="vn-preset-card-pips">${
                allIds.slice(0, maxPips).map(id => {
                    const src = this._resolveActorImg(id, p.portraitImages || {});
                    const name = (p.portraitNames || {})[id] || '';
                    return `<img class="vn-preset-card-pip" src="${src}" loading="lazy" decoding="async" alt="${name}" title="${name}">`;
                }).join('')
              }${allIds.length > maxPips ? `<span class="vn-preset-card-pip vn-preset-card-pip--more">+${allIds.length - maxPips}</span>` : ''}</div>`
            : '';

        const pendingMigrations = countPendingMigrations(p);
        const migrationIcon = pendingMigrations
            ? `<i class="fas fa-wrench" title="${game.i18n.format('vn.dialog.presetMigrationHint', { count: pendingMigrations })}"></i>`
            : '';
        const verHtml = (p.version || pendingMigrations)
            ? `<div class="vn-preset-card-ver${pendingMigrations ? ' --migration' : ''}">${migrationIcon}${p.version ? `v${p.version}` : ''}</div>`
            : '';

        const MAX_CARD_TAGS = 3;
        const visibleTags = (p.tags || []).slice(0, MAX_CARD_TAGS);
        const hiddenCount = (p.tags?.length || 0) - visibleTags.length;
        const tagsHtml = visibleTags.length
            ? `<div class="vn-preset-tags">${visibleTags.map(t => `<span class="vn-tag-chip" data-tag="${t}">${t}</span>`).join('')}${hiddenCount > 0 ? `<span class="vn-preset-tags-more">+${hiddenCount}</span>` : ''}</div>`
            : '';

        return `<div class="vn-preset-card" data-preset="${p.id}" data-preset-name="${p.name}" data-scene-id="${p.sceneId || ''}" data-tags="${(p.tags || []).join(',')}"${draggable ? ' draggable="true"' : ''}>
            <div class="vn-preset-card-poster">
                ${imgHtml}
                ${pipsHtml}
                ${verHtml}
                <div class="vn-preset-card-footer">
                    <div class="vn-preset-card-name" title="${p.name}">${p.name}</div>
                </div>
                <div class="vn-preset-card-overlay">
                    <button type="button" class="vn-preset-card-launch vn-preset-action" data-action="launch" data-preset="${p.id}" title="${game.i18n.localize('vn.dialog.presetActionLaunch')}"><i class="fas fa-play"></i></button>
                </div>
            </div>
            ${tagsHtml}
        </div>`;
    }

    _formatDate(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${dd}.${mm}.${yy} ${hh}:${min}`;
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
            atmosphereEffect: root.querySelector('#atmosphere-effect')?.value || 'particles',
            particlesForeground: root.querySelector('#particles-foreground')?.checked ?? false,
            particleIntensity: parseInt(root.querySelector('#particle-intensity')?.value) || 1,
            portraitScale: scene.state.portraitScale,
            portraitScales: remappedScales,
            visibility: visibilityData,
            musicUuid: root.querySelector('#vn-music-uuid')?.value || null,
            soundCues: this._gatherSoundCues(root),
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

    _applyPresetFilters(root) {
        const q = this._presetSearchQuery.toLowerCase();
        const filterScene = this._presetSceneFilter;
        const activeTag = this._presetTagFilter;
        const currentSceneId = root.querySelector('.vn-preset-scene-filter')?.dataset.sceneId || null;
        let anyVisible = false;

        root.querySelectorAll('.vn-preset-item, .vn-preset-card').forEach(item => {
            const name = (item.dataset.presetName || '').toLowerCase();
            const itemTags = (item.dataset.tags || '').split(',').filter(Boolean);
            const matchSearch = !q || name.includes(q) || itemTags.some(t => t.includes(q));
            const matchScene = !filterScene || item.dataset.sceneId === currentSceneId;
            const matchTag = !activeTag || itemTags.includes(activeTag);
            const visible = matchSearch && matchScene && matchTag;
            item.style.display = visible ? '' : 'none';
            if (visible) anyVisible = true;
        });

        // Hide scene groups where all items are filtered out (both list and card mode)
        root.querySelectorAll('.vn-preset-scene-group').forEach(group => {
            const hasVisible = [...group.querySelectorAll('.vn-preset-item, .vn-preset-card')].some(c => c.style.display !== 'none');
            group.style.display = hasVisible ? '' : 'none';
        });

        const list = root.querySelector('.vn-preset-list');
        if (!list) return;
        let hint = list.querySelector('.vn-filter-empty-hint');
        if (!anyVisible && list.querySelector('.vn-preset-item, .vn-preset-card')) {
            if (!hint) {
                hint = document.createElement('div');
                hint.className = 'vn-empty-hint vn-filter-empty-hint';
                list.appendChild(hint);
            }
            hint.textContent = filterScene ? game.i18n.localize('vn.dialog.noPresetsForScene') : game.i18n.localize('vn.dialog.nothingFound');
        } else {
            hint?.remove();
        }
    }

    static PRESET_ACTIONS = [
        { action: 'launch', icon: 'fa-play',  extra: 'vn-btn-accent', title: 'vn.dialog.presetActionLaunch' },
        { action: 'delete', icon: 'fa-trash', extra: 'vn-btn-danger',  title: 'vn.dialog.presetActionDelete' },
    ];

    _presetBtn(action, presetId, icon, extraClass = '', title = '') {
        return `<button type="button" class="vn-btn vn-btn-xs ${extraClass} vn-preset-action" data-action="${action}" data-preset="${presetId}" title="${title}"><i class="fas ${icon}"></i></button>`;
    }

    _presetActionButtons(presetId) {
        return VNDialogBuilder.PRESET_ACTIONS.map(a => this._presetBtn(a.action, presetId, a.icon, a.extra, game.i18n.localize(a.title))).join('');
    }

    _attachPresetListeners(root) {
        this._attachPresetControlListeners(root);
        this._attachPresetItemListeners(root);
        this._attachPanelListeners(root);
    }

    _attachPresetControlListeners(root) {
        if (root._presetControlsAttached) return;
        root._presetControlsAttached = true;
        const signal = this._dialogAbortCtrl?.signal;

        root.querySelector('.vn-preset-search')?.addEventListener('input', (e) => {
            this._presetSearchQuery = e.target.value.trim();
            if (this._presetsGroupMode === 'folders') {
                this._refreshPresetList(root);
            } else {
                this._applyPresetFilters(root);
            }
        }, { signal });

        const filterBtn = root.querySelector('.vn-preset-scene-filter');
        filterBtn?.addEventListener('click', () => {
            this._presetSceneFilter = !this._presetSceneFilter;
            filterBtn.classList.toggle('active', this._presetSceneFilter);
            this._applyPresetFilters(root);
        }, { signal });

        root.querySelector('.vn-preset-tag-bar')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.vn-tag-filter-chip');
            if (!chip) return;
            const tag = chip.dataset.tag;
            this._presetTagFilter = this._presetTagFilter === tag ? null : tag;
            this._refreshTagFilterBar(root);
            this._applyPresetFilters(root);
        }, { signal });

        root.querySelector('.vn-preset-tag-bar')?.addEventListener('input', (e) => {
            if (!e.target.classList.contains('vn-tag-bar-search')) return;
            this._refreshTagFilterBar(root);
        }, { signal });

        root.querySelector('.vn-preset-tag-bar')?.addEventListener('contextmenu', async (e) => {
            const chip = e.target.closest('.vn-tag-filter-chip');
            if (!chip) return;
            e.preventDefault();
            const tag = chip.dataset.tag;
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize('vn.dialog.deleteTagGlobalTitle') },
                classes: ['vn-confirm-dialog'],
                content: `<p>${game.i18n.format('vn.dialog.deleteTagGlobalConfirm', { tag })}</p>`,
                yes: { label: game.i18n.localize('vn.dialog.btnDelete'), icon: 'fas fa-trash' },
                no: { label: game.i18n.localize('vn.dialog.btnCancel') },
            });
            if (!confirmed) return;
            const presets = await VNPresets.getAll();
            const affected = Object.values(presets).filter(p => (p.tags || []).includes(tag));
            for (const p of affected) {
                await VNPresets.setTags(p.id, (p.tags || []).filter(t => t !== tag));
            }
            if (this._presetTagFilter === tag) this._presetTagFilter = null;
            this._refreshPresetList(root);
        }, { signal });

        this._refreshTagFilterBar(root);

        root.querySelectorAll('.vn-presets-groupmode-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                this._presetsGroupMode = btn.dataset.groupmode;
                this._currentFolderId = null;
                root.querySelectorAll('.vn-presets-groupmode-btn').forEach(b => b.classList.toggle('active', b.dataset.groupmode === this._presetsGroupMode));
                try { await game.settings.set(MODULE_ID, 'vnPresetsGroupMode', this._presetsGroupMode); } catch {}
                this._refreshPresetList(root);
            }, { signal });
        });

        root.querySelectorAll('.vn-preset-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._presetViewMode = btn.dataset.view;
                root.querySelectorAll('.vn-preset-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === this._presetViewMode));
                try { game.settings.set(MODULE_ID, 'vnPresetsViewMode', this._presetViewMode); } catch {}
                this._refreshPresetList(root);
            }, { signal });
        });

        root.querySelector('.vn-preset-sort')?.addEventListener('change', (e) => {
            this._presetSortMode = e.target.value;
            this._refreshPresetList(root);
        }, { signal });

        root.querySelector('.vn-preset-clear-all')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const count = root.querySelectorAll('.vn-preset-item, .vn-preset-card').length;
            if (!count) return;
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize('vn.dialog.deleteAllPresetsTitle') },
                classes: ['vn-confirm-dialog'],
                content: `<p>${game.i18n.format('vn.dialog.deleteAllPresetsConfirm', {count})}</p>`,
                yes: { label: game.i18n.localize('vn.dialog.btnDeleteAll'), icon: 'fas fa-trash-can' },
                no: { label: game.i18n.localize('vn.dialog.btnCancel') },
            });
            if (!confirmed) return;
            await game.settings.set(MODULE_ID, VNPresets.SETTING_KEY, {});
            VNPresets.invalidateCache();
            this._refreshPresetList(root);
            this._rebuildExportList(root);
        }, { signal });

        const pinBtn = root.querySelector('#vn-preset-scene-pin');
        pinBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            pinBtn.classList.toggle('active');
            const isActive = pinBtn.classList.contains('active');
            const sceneName = pinBtn.dataset.sceneName;
            pinBtn.title = isActive ? game.i18n.format('vn.dialog.pinToScene', {sceneName}) : game.i18n.localize('vn.dialog.savePinWithoutScene');
        }, { signal });

        root.querySelector('.vn-preset-save-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const nameInput = root.querySelector('#vn-preset-name');
            const name = nameInput?.value?.trim();
            if (!name) return;
            const attachScene = root.querySelector('#vn-preset-scene-pin')?.classList.contains('active') ?? true;
            const gatheredState = this._gatherDialogState(root);
            const saveOpts = this._presetsGroupMode === 'folders' ? { folderId: this._currentFolderId } : {};
            await VNPresets.save(name, gatheredState, attachScene, saveOpts);
            if (this._scene.state.isActive) this._scene.state.presetActors = [...gatheredState.presetActors];
            nameInput.value = '';
            this._refreshPresetList(root);
        }, { signal });

        const regenAllBtn = root.querySelector('.vn-preset-regen-all');
        regenAllBtn?.addEventListener('click', async (e) => {
            e.preventDefault();
            regenAllBtn.disabled = true;
            const count = await VNPresets.regenerate();
            ui.notifications.info(game.i18n.format('vn.dialog.presetRegenerated', {count}));
            this._refreshPresetList(root);
            this._rebuildExportList(root);
            regenAllBtn.disabled = false;
        }, { signal });
    }

    _attachPresetItemListeners(root) {
        const listEl = root.querySelector('.vn-preset-list');
        if (!listEl || listEl._presetItemListenerAttached) return;
        listEl._presetItemListenerAttached = true;

        listEl.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Folder breadcrumb nav
            const breadcrumbSeg = e.target.closest('.vn-folder-breadcrumb-seg');
            if (breadcrumbSeg) {
                this._currentFolderId = breadcrumbSeg.dataset.folderId || null;
                this._refreshPresetList(root);
                return;
            }

            // Folder action buttons (check before folder item nav)
            const folderNewBtn = e.target.closest('.vn-folder-new-btn');
            if (folderNewBtn) {
                const name = await this._promptFolderName(root, game.i18n.localize('vn.folders.createFolderTitle'));
                if (name) {
                    await VNFolders.create(name, this._currentFolderId);
                    this._refreshPresetList(root);
                }
                return;
            }

            const folderFavBtn = e.target.closest('.vn-folder-fav-btn');
            if (folderFavBtn) {
                await VNFolders.toggleFavorite(folderFavBtn.dataset.folderId);
                this._refreshPresetList(root);
                return;
            }

            const folderRenameBtn = e.target.closest('.vn-folder-rename-btn');
            if (folderRenameBtn) {
                const folderId = folderRenameBtn.dataset.folderId;
                const folder = VNFolders.get(folderId);
                if (!folder) return;
                const itemEl = folderRenameBtn.closest('.vn-folder-item');
                const nameSpan = itemEl?.querySelector('.vn-folder-item-name');
                if (!nameSpan || nameSpan.querySelector('input')) return;
                const currentName = folder.name;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentName;
                input.className = 'vn-folder-rename-input';
                nameSpan.textContent = '';
                nameSpan.appendChild(input);
                input.focus();
                input.select();
                let done = false;
                const commit = async () => {
                    if (done) return;
                    done = true;
                    const newName = input.value.trim() || currentName;
                    if (newName !== currentName) await VNFolders.rename(folderId, newName);
                    this._refreshPresetList(root);
                };
                input.addEventListener('blur', commit, { once: true });
                input.addEventListener('keydown', async (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                    if (ev.key === 'Escape') { done = true; nameSpan.textContent = currentName; }
                });
                return;
            }

            const folderDeleteBtn = e.target.closest('.vn-folder-delete-btn');
            if (folderDeleteBtn) {
                const folderId = folderDeleteBtn.dataset.folderId;
                const folder = VNFolders.get(folderId);
                if (!folder) return;
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize('vn.folders.deleteFolderTitle') },
                    classes: ['vn-confirm-dialog'],
                    content: `<p>${game.i18n.format('vn.folders.deleteFolderConfirm', { name: folder.name })}</p>`,
                    yes: { label: game.i18n.localize('vn.dialog.btnDelete'), icon: 'fas fa-trash' },
                    no: { label: game.i18n.localize('vn.dialog.btnCancel') },
                });
                if (!confirmed) return;
                await VNFolders.delete(folderId);
                if (this._currentFolderId === folderId) this._currentFolderId = folder.parentId || null;
                this._refreshPresetList(root);
                return;
            }

            // Favorites shortcut navigation
            const favShortcut = e.target.closest('.vn-folder-fav-shortcut');
            if (favShortcut) {
                this._currentFolderId = favShortcut.dataset.folderId || null;
                this._refreshPresetList(root);
                return;
            }

            // Folder navigation — click on folder item (not on a button)
            const folderItem = e.target.closest('.vn-folder-item');
            if (folderItem && !e.target.closest('button')) {
                this._currentFolderId = folderItem.dataset.folderId || null;
                this._refreshPresetList(root);
                return;
            }

            const tagChip = e.target.closest('.vn-tag-chip[data-tag]');
            if (tagChip && !tagChip.closest('.vn-tag-popover')) {
                const tag = tagChip.dataset.tag;
                this._presetTagFilter = this._presetTagFilter === tag ? null : tag;
                this._refreshTagFilterBar(root);
                this._applyPresetFilters(root);
                return;
            }

            const actionBtn = e.target.closest('.vn-preset-action[data-action]');
            if (actionBtn) {
                await this._handlePresetAction(actionBtn.dataset.action, actionBtn.dataset.preset, actionBtn, root);
                return;
            }
            const groupDeleteBtn = e.target.closest('.vn-preset-group-delete');
            if (groupDeleteBtn) { await this._handleGroupDelete(groupDeleteBtn, root); return; }
            const groupRegenBtn = e.target.closest('.vn-preset-group-regen');
            if (groupRegenBtn) { await this._handleGroupRegen(groupRegenBtn, root); return; }

            const item = e.target.closest('.vn-preset-item, .vn-preset-card');
            if (item?.dataset.preset) this._selectPreset(root, item.dataset.preset);
        }, { signal: this._dialogAbortCtrl?.signal });

        // Folder drag-and-drop
        listEl.addEventListener('dragstart', (e) => {
            const folderItem = e.target.closest('.vn-folder-item');
            if (folderItem) {
                e.dataTransfer.setData('text/plain', 'folder:' + folderItem.dataset.folderId);
                e.dataTransfer.effectAllowed = 'move';
                return;
            }
            const presetItem = e.target.closest('.vn-preset-item[draggable], .vn-preset-card[draggable]');
            if (presetItem) {
                e.dataTransfer.setData('text/plain', 'preset:' + presetItem.dataset.preset);
                e.dataTransfer.effectAllowed = 'move';
            }
        }, { signal: this._dialogAbortCtrl?.signal });

        listEl.addEventListener('dragover', (e) => {
            const target = e.target.closest('.vn-folder-item, .vn-folder-breadcrumb-seg');
            if (target) { e.preventDefault(); target.classList.add('--drag-over'); }
        }, { signal: this._dialogAbortCtrl?.signal });

        listEl.addEventListener('dragleave', (e) => {
            e.target.closest('.vn-folder-item, .vn-folder-breadcrumb-seg')?.classList.remove('--drag-over');
        }, { signal: this._dialogAbortCtrl?.signal });

        listEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            const targetFolder = e.target.closest('.vn-folder-item');
            const targetBreadcrumb = e.target.closest('.vn-folder-breadcrumb-seg');
            const targetId = targetFolder?.dataset.folderId || targetBreadcrumb?.dataset.folderId || null;
            targetFolder?.classList.remove('--drag-over');
            targetBreadcrumb?.classList.remove('--drag-over');

            const raw = e.dataTransfer.getData('text/plain');
            if (!raw) return;
            if (raw.startsWith('folder:')) {
                const folderId = raw.slice(7);
                if (folderId === targetId) return;
                await VNFolders.move(folderId, targetId);
            } else if (raw.startsWith('preset:')) {
                const presetId = raw.slice(7);
                await VNPresets.setFolder(presetId, targetId);
            }
            this._refreshPresetList(root);
        }, { signal: this._dialogAbortCtrl?.signal });
    }

    async _handlePresetAction(action, presetId, btn, root) {
        const scene = this._scene;
        switch (action) {
            case 'launch': {
                const preset = await VNPresets.load(presetId);
                if (preset) { scene.createScene(preset); this._dialog?.close(); }
                break;
            }
            case 'load': {
                const preset = await VNPresets.load(presetId);
                if (preset) this.applyPreset(root, preset);
                break;
            }
            case 'update': {
                const presetName = btn.closest('[data-preset-name]')?.dataset.presetName || '';
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize('vn.dialog.updatePresetTitle') },
                    classes: ['vn-confirm-dialog'],
                    content: `<p>${game.i18n.format('vn.dialog.updatePresetConfirm', {name: presetName})}</p>`,
                    yes: { label: game.i18n.localize('vn.dialog.btnUpdate'), icon: 'fas fa-arrows-rotate' },
                    no: { label: game.i18n.localize('vn.dialog.btnCancel') },
                });
                if (!confirmed) return;
                const updatedState = this._gatherDialogState(root);
                const sorted = await VNPresets.update(presetId, updatedState);
                if (this._scene.state.isActive) this._scene.state.presetActors = [...updatedState.presetActors];
                this._refreshPresetList(root, sorted);
                break;
            }
            case 'tags':
                await this._handlePresetTags(btn, presetId, root);
                break;
            case 'rename':
                this._handlePresetRename(btn, presetId, root);
                break;
            case 'delete': {
                const presetName = btn.closest('[data-preset-name]')?.dataset.presetName || '';
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize('vn.dialog.deletePresetTitle') },
                    classes: ['vn-confirm-dialog'],
                    content: `<p>${game.i18n.format('vn.dialog.deletePresetConfirm', {name: presetName})}</p>`,
                    yes: { label: game.i18n.localize('vn.dialog.btnDelete'), icon: 'fas fa-trash' },
                    no: { label: game.i18n.localize('vn.dialog.btnCancel') },
                });
                if (!confirmed) return;
                await VNPresets.delete(presetId);
                this._refreshPresetList(root);
                break;
            }
            case 'macro': {
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const code = `// ${preset.name}\nawait window.launchVNPreset("${preset.id}");`;
                const hasBg = preset.background && preset.background !== 'none';
                const dlg = new foundry.applications.api.DialogV2({
                    window: { title: game.i18n.format('vn.dialog.macroDialogTitle', { name: preset.name }) },
                    classes: ['vn-confirm-dialog'],
                    content: `<div class="vn-macro-export">
                        <p class="vn-macro-hint">${game.i18n.localize('vn.dialog.macroDialogHint')}</p>
                        <div class="vn-macro-code-row">
                            <textarea readonly class="vn-macro-code" rows="2" spellcheck="false">${code}</textarea>
                            <button type="button" class="vn-btn vn-btn-accent vn-macro-copy-btn" title="${game.i18n.localize('vn.dialog.macroCopyBtn')}"><i class="fas fa-copy"></i></button>
                        </div>
                        ${hasBg ? `<button type="button" class="vn-btn vn-btn-accent vn-macro-icon-btn"><i class="fas fa-image"></i> ${game.i18n.localize('vn.dialog.macroCreateWithIcon')}</button>` : ''}
                    </div>`,
                    buttons: [{ action: 'close', label: game.i18n.localize('vn.dialog.btnClose'), default: true }],
                    rejectClose: false,
                });
                dlg.render({ force: true }).then(() => {
                    const copyBtn = dlg.element?.querySelector('.vn-macro-copy-btn');
                    const textarea = dlg.element?.querySelector('.vn-macro-code');
                    copyBtn?.addEventListener('click', async () => {
                        await navigator.clipboard.writeText(code);
                        ui.notifications.info(game.i18n.localize('vn.dialog.macroCopied'));
                    });
                    textarea?.addEventListener('click', () => textarea.select());
                    const iconBtn = dlg.element?.querySelector('.vn-macro-icon-btn');
                    iconBtn?.addEventListener('click', async () => {
                        iconBtn.disabled = true;
                        iconBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize('vn.dialog.macroIconGenerating')}`;
                        try {
                            const iconPath = await VNPresets._makeIcon(preset.background);
                            await Macro.create({ name: preset.name, type: 'script', command: code, img: iconPath });
                            ui.notifications.info(game.i18n.format('vn.dialog.macroCreated', { name: preset.name }));
                            dlg.close();
                        } catch (e) {
                            console.error('VN: Failed to create macro with icon:', e);
                            ui.notifications.error(game.i18n.localize('vn.dialog.macroCreateFailed'));
                            iconBtn.disabled = false;
                            iconBtn.innerHTML = `<i class="fas fa-image"></i> ${game.i18n.localize('vn.dialog.macroCreateWithIcon')}`;
                        }
                    });
                });
                break;
            }
            case 'assign': {
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const curId = canvas?.scene?.id ?? null;
                const curName = canvas?.scene?.name ?? null;
                const alreadyOnCurrent = curId && curId === preset.sceneId;

                const buttons = [];
                if (curId && !alreadyOnCurrent)
                    buttons.push({ action: 'assign', label: game.i18n.format('vn.dialog.assignToSceneLabel', {sceneName: curName}), icon: 'fas fa-map-pin', default: true });
                if (preset.sceneId)
                    buttons.push({ action: 'unlink', label: game.i18n.localize('vn.dialog.unlinkFromScene'), icon: 'fas fa-link-slash', default: !curId || !!alreadyOnCurrent });
                buttons.push({ action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' });

                if (!curId && !preset.sceneId) { ui.notifications.warn(game.i18n.localize('vn.dialog.noActiveSceneForPin')); return; }

                const presetSceneHtml = preset.sceneName ? `<p style="margin:4px 0">${game.i18n.format('vn.dialog.presetSceneLabel', {sceneName: preset.sceneName})}</p>` : '';
                const curSceneHtml = curName ? `<p style="margin:4px 0">${game.i18n.format('vn.dialog.currentSceneLabel', {sceneName: curName})}</p>` : '';

                const choice = await new Promise(resolve => {
                    const dlg = new foundry.applications.api.DialogV2({
                        window: { title: game.i18n.format('vn.dialog.changeSceneDialogTitle', {presetName: preset.name}) },
                        classes: ['vn-confirm-dialog'],
                        content: `<div style="padding:6px 0">${presetSceneHtml}${curSceneHtml}</div>`,
                        buttons,
                        rejectClose: false,
                        submit: result => resolve(result),
                    });
                    dlg.addEventListener('close', () => resolve('cancel'), { once: true });
                    dlg.render({ force: true });
                });

                if (!choice || choice === 'cancel') return;
                const sorted = choice === 'assign'
                    ? await VNPresets.setScene(presetId, curId, curName)
                    : await VNPresets.setScene(presetId, null, null);
                this._refreshPresetList(root, sorted);
                this._rebuildExportList(root);
                break;
            }
            case 'regen': {
                btn.disabled = true;
                await VNPresets.regenerate([presetId]);
                ui.notifications.info(game.i18n.localize('vn.dialog.presetRegeneratedOne'));
                this._refreshPresetList(root);
                this._rebuildExportList(root);
                break;
            }
        }
    }

    _handlePresetRename(btn, presetId, root) {
        const item = btn.closest('.vn-preset-item, .vn-preset-card');
        const nameSpan = item?.querySelector('.vn-preset-name, .vn-preset-card-name');
        if (!nameSpan || nameSpan.querySelector('input')) return;

        const currentName = item.dataset.presetName;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'vn-preset-rename-input';
        nameSpan.textContent = '';
        nameSpan.appendChild(input);
        input.focus();
        input.select();

        let done = false;
        const commit = async () => {
            if (done) return;
            done = true;
            const newName = input.value.trim() || currentName;
            if (newName !== currentName) {
                const sorted = await VNPresets.rename(presetId, newName);
                this._refreshPresetList(root, sorted);
            } else {
                nameSpan.textContent = currentName;
            }
        };
        const cancel = () => { if (done) return; done = true; nameSpan.textContent = currentName; };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit);
    }

    async _handlePresetTags(btn, presetId, root) {
        root.querySelector('.vn-tag-popover')?.remove();

        const preset = await VNPresets.load(presetId);
        if (!preset) return;
        const tags = [...(preset.tags || [])];

        const popover = document.createElement('div');
        popover.className = 'vn-tag-popover';

        const render = () => {
            popover.innerHTML = `
                <div class="vn-tag-popover-chips">
                    ${tags.map((t, i) => `<span class="vn-tag-chip vn-tag-chip--rm"><span>${t}</span><button type="button" class="vn-tag-rm-btn" data-index="${i}" title="Remove">×</button></span>`).join('')}
                </div>
                <div class="vn-tag-popover-input">
                    <input type="text" class="vn-tag-input" placeholder="New tag…" autocomplete="off" spellcheck="false">
                    <button type="button" class="vn-btn vn-btn-xs vn-tag-add-btn" title="Add"><i class="fas fa-plus"></i></button>
                </div>`;
            popover.querySelector('.vn-tag-input')?.focus();
        };

        const addTag = () => {
            const input = popover.querySelector('.vn-tag-input');
            const val = input.value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
            if (val && !tags.includes(val)) { tags.push(val); render(); }
            else input.value = '';
        };

        const commit = async () => {
            document.removeEventListener('mousedown', onOutside, true);
            const sorted = await VNPresets.setTags(presetId, tags);
            popover.remove();
            if (sorted) this._refreshPresetList(root, sorted);
        };

        const onOutside = (e) => {
            if (!popover.contains(e.target) && e.target !== btn) commit();
        };

        popover.addEventListener('click', (e) => {
            const rmBtn = e.target.closest('.vn-tag-rm-btn');
            if (rmBtn) { tags.splice(Number(rmBtn.dataset.index), 1); render(); return; }
            if (e.target.closest('.vn-tag-add-btn')) addTag();
        });
        popover.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('vn-tag-input')) return;
            if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            else if (e.key === 'Escape') { e.preventDefault(); commit(); }
        });

        render();
        btn.closest('.vn-preset-item, .vn-preset-card')?.appendChild(popover);
        setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
    }

    _refreshTagFilterBar(root) {
        const bar = root.querySelector('.vn-preset-tag-bar');
        if (!bar) return;
        const chipsEl = bar.querySelector('.vn-tag-bar-chips');
        const allTags = new Set();
        root.querySelectorAll('.vn-preset-item[data-tags], .vn-preset-card[data-tags]').forEach(item => {
            (item.dataset.tags || '').split(',').filter(Boolean).forEach(t => allTags.add(t));
        });
        if (!allTags.size) {
            if (chipsEl) chipsEl.innerHTML = '';
            bar.hidden = true;
            if (this._presetTagFilter) this._presetTagFilter = null;
            return;
        }
        bar.hidden = false;
        if (this._presetTagFilter && !allTags.has(this._presetTagFilter)) this._presetTagFilter = null;
        const query = (bar.querySelector('.vn-tag-bar-search')?.value || '').trim().toLowerCase();
        const visible = [...allTags].sort().filter(t => !query || t.includes(query));
        if (chipsEl) {
            chipsEl.innerHTML = visible.map(tag =>
                `<button type="button" class="vn-tag-filter-chip${this._presetTagFilter === tag ? ' active' : ''}" data-tag="${tag}">${tag}</button>`
            ).join('');
        }
    }

    // ══════════════════════════════════════════════════════════
    // Preset Detail Panel
    // ══════════════════════════════════════════════════════════

    _getAllExistingTags(root) {
        const tags = new Set();
        root.querySelectorAll('.vn-preset-item[data-tags], .vn-preset-card[data-tags]').forEach(el => {
            (el.dataset.tags || '').split(',').filter(Boolean).forEach(t => tags.add(t));
        });
        return [...tags].sort();
    }

    _markSelectedItem(root, presetId) {
        root.querySelectorAll('.vn-preset-item, .vn-preset-card').forEach(el => {
            el.classList.toggle('vn-preset-selected', el.dataset.preset === presetId);
        });
    }

    async _selectPreset(root, presetId) {
        this._selectedPresetId = presetId;
        this._markSelectedItem(root, presetId);
        const preset = await VNPresets.load(presetId);
        this._renderPresetPanel(root, preset);
        this._attachPanelListeners(root);
    }

    _renderPresetPanel(root, preset) {
        const panel = root.querySelector('.vn-preset-detail-panel');
        if (!panel) return;

        if (!preset) {
            panel.removeAttribute('data-preset-id');
            panel.removeAttribute('data-preset-name');
            panel.innerHTML = `<div class="vn-panel-empty-hint"><i class="fas fa-hand-point-left"></i><span>${game.i18n.localize('vn.dialog.panelSelectHint')}</span></div>`;
            return;
        }

        panel.dataset.presetId = preset.id;
        panel.dataset.presetName = preset.name;

        const tags = [...(preset.tags || [])];
        const allTags = this._getAllExistingTags(root);
        const suggestions = allTags.filter(t => !tags.includes(t));
        const dateCreated = this._formatDate(preset.createdAt || preset.savedAt);
        const dateUpdated = (preset.updatedAt && preset.updatedAt !== preset.createdAt) ? this._formatDate(preset.updatedAt) : null;

        const tagsChipsHtml = tags.map((t, i) =>
            `<span class="vn-tag-chip vn-tag-chip--rm" data-tag="${t}"><span>${t}</span><button type="button" class="vn-tag-rm-btn" data-index="${i}">×</button></span>`
        ).join('');
        const suggestHtml = suggestions.map(t =>
            `<button type="button" class="vn-panel-tag-suggest" data-tag="${t}">${t}</button>`
        ).join('');

        panel.innerHTML = `
            <div class="vn-panel-header">
                <span class="vn-panel-title"><i class="fas fa-pen-to-square"></i> ${preset.name}</span>
                <button type="button" class="vn-btn vn-btn-xs vn-panel-close-btn" title="${game.i18n.localize('vn.dialog.btnClose')}"><i class="fas fa-times"></i></button>
            </div>
            <div class="vn-panel-body">
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelName')}</label>
                    <input type="text" class="vn-panel-name-input" value="${preset.name.replace(/"/g, '&quot;')}" autocomplete="off" spellcheck="false">
                </div>
                <div class="vn-panel-section">
                    <div class="vn-panel-actions">
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="load" data-preset="${preset.id}"><i class="fas fa-upload"></i> ${game.i18n.localize('vn.dialog.presetActionLoad')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="update" data-preset="${preset.id}"><i class="fas fa-arrows-rotate"></i> ${game.i18n.localize('vn.dialog.presetActionUpdate')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="regen" data-preset="${preset.id}"><i class="fas fa-camera"></i> ${game.i18n.localize('vn.dialog.presetActionRegen')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="macro" data-preset="${preset.id}"><i class="fas fa-code"></i> ${game.i18n.localize('vn.dialog.presetActionMacro')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="assign" data-preset="${preset.id}"><i class="fas fa-location-dot"></i> ${game.i18n.localize('vn.dialog.presetActionAssign')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-danger vn-panel-action vn-panel-action--delete" data-action="delete" data-preset="${preset.id}"><i class="fas fa-trash"></i> ${game.i18n.localize('vn.dialog.presetActionDelete')}</button>
                    </div>
                </div>
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <div class="vn-panel-info">
                        ${preset.version ? `<span class="vn-panel-info-row"><i class="fas fa-code-branch"></i><span>v${preset.version}</span></span>` : ''}
                        ${dateCreated ? `<span class="vn-panel-info-row"><i class="fas fa-calendar-plus"></i><span>${dateCreated}</span></span>` : ''}
                        ${dateUpdated ? `<span class="vn-panel-info-row"><i class="fas fa-calendar-check"></i><span>${dateUpdated}</span></span>` : ''}
                        ${preset.sceneName ? `<span class="vn-panel-info-row"><i class="fas fa-map-pin"></i><span>${preset.sceneName}</span></span>` : ''}
                    </div>
                </div>
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelTags')}</label>
                    <div class="vn-panel-tags-chips">${tagsChipsHtml}</div>
                    <div class="vn-panel-tag-input-wrap">
                        <i class="fas fa-magnifying-glass"></i>
                        <input type="text" class="vn-panel-tag-input" placeholder="${game.i18n.localize('vn.dialog.tagAddPlaceholder')}" autocomplete="off" spellcheck="false" maxlength="32">
                    </div>
                    <div class="vn-panel-tag-dropdown">${suggestHtml}</div>
                </div>
            </div>`;
    }

    _attachPanelListeners(root) {
        const panel = root.querySelector('.vn-preset-detail-panel');
        if (!panel || panel._panelListenerAttached) return;
        panel._panelListenerAttached = true;
        const signal = this._dialogAbortCtrl?.signal;

        panel.addEventListener('click', async (e) => {
            if (e.target.closest('.vn-panel-close-btn')) {
                this._selectedPresetId = null;
                this._markSelectedItem(root, null);
                this._renderPresetPanel(root, null);
                return;
            }

            const rmBtn = e.target.closest('.vn-tag-rm-btn');
            if (rmBtn) {
                const presetId = this._selectedPresetId;
                if (!presetId) return;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                tags.splice(Number(rmBtn.dataset.index), 1);
                const sorted = await VNPresets.setTags(presetId, tags);
                if (sorted) this._refreshPresetList(root, sorted);
                return;
            }

            const suggest = e.target.closest('.vn-panel-tag-suggest');
            if (suggest) {
                const presetId = this._selectedPresetId;
                if (!presetId) return;
                const tag = suggest.dataset.tag;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                if (!tags.includes(tag)) {
                    tags.push(tag);
                    const sorted = await VNPresets.setTags(presetId, tags);
                    if (sorted) this._refreshPresetList(root, sorted);
                }
                return;
            }

            const actionBtn = e.target.closest('.vn-panel-action[data-action]');
            if (actionBtn) {
                await this._handlePresetAction(actionBtn.dataset.action, actionBtn.dataset.preset, actionBtn, root);
            }
        }, { signal });

        panel.addEventListener('input', (e) => {
            if (!e.target.classList.contains('vn-panel-tag-input')) return;
            const query = e.target.value.trim().toLowerCase();
            const currentTags = new Set(
                [...panel.querySelectorAll('.vn-panel-tags-chips .vn-tag-chip span')].map(el => el.textContent.trim())
            );
            const allTags = this._getAllExistingTags(root);
            const available = allTags.filter(t => !currentTags.has(t));
            const filtered = query ? available.filter(t => t.includes(query)) : available;
            const dropdown = panel.querySelector('.vn-panel-tag-dropdown');
            if (dropdown) {
                dropdown.innerHTML = filtered.map(t =>
                    `<button type="button" class="vn-panel-tag-suggest" data-tag="${t}">${t}</button>`
                ).join('');
            }
        }, { signal });

        panel.addEventListener('keydown', async (e) => {
            if (e.target.classList.contains('vn-panel-tag-input')) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const presetId = this._selectedPresetId;
                if (!presetId) return;
                const val = e.target.value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
                if (!val) return;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                if (!tags.includes(val)) { tags.push(val); }
                e.target.value = '';
                const sorted = await VNPresets.setTags(presetId, tags);
                if (sorted) this._refreshPresetList(root, sorted);
                root.querySelector('.vn-preset-detail-panel')?.querySelector('.vn-panel-tag-input')?.focus();
            } else if (e.target.classList.contains('vn-panel-name-input')) {
                if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    const preset = await VNPresets.load(this._selectedPresetId);
                    if (preset) e.target.value = preset.name;
                    e.target.blur();
                }
            }
        }, { signal });

        panel.addEventListener('blur', async (e) => {
            if (!e.target.classList.contains('vn-panel-name-input')) return;
            const presetId = this._selectedPresetId;
            if (!presetId) return;
            const preset = await VNPresets.load(presetId);
            if (!preset) return;
            const newName = e.target.value.trim();
            if (newName && newName !== preset.name) {
                const sorted = await VNPresets.rename(presetId, newName);
                if (sorted) this._refreshPresetList(root, sorted);
            }
        }, { capture: true, signal });

        panel.addEventListener('contextmenu', async (e) => {
            if (!e.target.closest('.vn-panel-tags-chips')) return;
            const chip = e.target.closest('.vn-tag-chip');
            if (!chip) return;
            e.preventDefault();
            const presetId = this._selectedPresetId;
            if (!presetId) return;
            const tag = chip.dataset.tag;
            const preset = await VNPresets.load(presetId);
            if (!preset) return;
            const sorted = await VNPresets.setTags(presetId, (preset.tags || []).filter(t => t !== tag));
            if (sorted) this._refreshPresetList(root, sorted);
        }, { signal });
    }

    async _handleGroupDelete(btn, root) {
        const groupKey = btn.dataset.groupKey;
        const label = groupKey || game.i18n.localize('vn.dialog.noScene');
        const count = btn.closest('.vn-preset-scene-group')?.querySelectorAll('.vn-preset-item, .vn-preset-card').length || 0;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize('vn.dialog.deleteGroupDialogTitle') },
            classes: ['vn-confirm-dialog'],
            content: `<p>${game.i18n.format('vn.dialog.deleteGroupConfirm', {count, label})}</p>`,
            yes: { label: game.i18n.localize('vn.dialog.btnDeleteGroup'), icon: 'fas fa-trash-can' },
            no: { label: game.i18n.localize('vn.dialog.btnCancel') },
        });
        if (!confirmed) return;
        await VNPresets.deleteGroup(groupKey);
        this._refreshPresetList(root);
        this._rebuildExportList(root);
    }

    async _handleGroupRegen(btn, root) {
        btn.disabled = true;
        const ids = [...(btn.closest('.vn-preset-scene-group')?.querySelectorAll('.vn-preset-item, .vn-preset-card') || [])]
            .map(el => el.dataset.preset).filter(Boolean);
        const count = await VNPresets.regenerate(ids);
        ui.notifications.info(game.i18n.format('vn.dialog.presetRegenerated', {count}));
        this._refreshPresetList(root);
        this._rebuildExportList(root);
    }

    async _promptFolderName(root, title) {
        return new Promise(resolve => {
            let value = '', submitted = false;
            const dlg = new foundry.applications.api.DialogV2({
                window: { title },
                classes: ['vn-confirm-dialog'],
                content: `<div style="padding:6px 0"><input type="text" class="vn-folder-name-input" placeholder="${game.i18n.localize('vn.folders.folderNamePlaceholder')}" style="width:100%;box-sizing:border-box" autofocus></div>`,
                buttons: [
                    { action: 'create', label: game.i18n.localize('vn.folders.btnCreate'), icon: 'fas fa-folder-plus', default: true },
                    { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel') },
                ],
                rejectClose: false,
                submit: (action) => {
                    submitted = true;
                    resolve(action === 'create' ? value : '');
                },
            });
            dlg.addEventListener('close', () => { if (!submitted) resolve(''); }, { once: true });
            dlg.render({ force: true }).then(() => {
                const inp = dlg.element?.querySelector('.vn-folder-name-input');
                if (inp) {
                    inp.focus();
                    inp.addEventListener('input', e => { value = e.target.value.trim(); });
                }
            });
        });
    }

    async _promptFolderImportChoice(importedFolders) {
        if (!importedFolders.length) return { importFolders: false };
        const choice = await new Promise(resolve => {
            const dlg = new foundry.applications.api.DialogV2({
                window: { title: game.i18n.localize('vn.folders.importChoiceTitle') },
                classes: ['vn-confirm-dialog'],
                content: `<p>${game.i18n.format('vn.folders.importChoiceMsg', { count: importedFolders.length })}</p>`,
                buttons: [
                    { action: 'recreate', label: game.i18n.localize('vn.folders.btnImportRecreateFolders'), icon: 'fas fa-folder-tree', default: true },
                    { action: 'drop', label: game.i18n.localize('vn.folders.btnImportDropToRoot'), icon: 'fas fa-list' },
                    { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel') },
                ],
                rejectClose: false,
                submit: result => resolve(result),
            });
            dlg.addEventListener('close', () => resolve('cancel'), { once: true });
            dlg.render({ force: true });
        });
        if (!choice || choice === 'cancel') return null;
        return choice === 'recreate'
            ? { importFolders: true, folders: importedFolders }
            : { importFolders: false };
    }

    async _refreshPresetList(root, sorted = null) {
        if (!sorted) sorted = await VNPresets.getSorted();
        const listEl = root.querySelector('.vn-preset-list');
        if (!listEl) return;

        const badge = root.querySelector('.vn-preset-list-header .vn-badge');
        if (badge) badge.textContent = sorted.length;

        const isFolder = this._presetsGroupMode === 'folders';
        listEl.classList.toggle('vn-preset-list--cards', this._presetViewMode === 'cards');
        listEl.classList.toggle('vn-preset-list--folder-mode', isFolder);
        if (isFolder) {
            listEl.innerHTML = this._buildFolderViewHtml(sorted);
        } else {
            listEl.innerHTML = sorted.length === 0
                ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noSavedPresets')}</div>`
                : this._buildPresetItemsHtml(sorted);
        }

        this._attachPresetListeners(root);
        this._refreshTagFilterBar(root);
        this._applyPresetFilters(root);

        if (this._selectedPresetId) {
            const still = sorted.find(p => p.id === this._selectedPresetId);
            if (still) {
                this._markSelectedItem(root, this._selectedPresetId);
                this._renderPresetPanel(root, still);
            } else {
                this._selectedPresetId = null;
                this._renderPresetPanel(root, null);
            }
        }
        this._attachPanelListeners(root);
    }

    // ══════════════════════════════════════════════════════════
    // Music
    // ══════════════════════════════════════════════════════════

    _resolveSoundFromUuid(uuid) {
        return parsePlaylistUuid(uuid)?.sound ?? null;
    }

    _generateMusicTab(musicUuid, soundCues = []) {
        const cuesHtml = soundCues.map(c => this._buildCueItemHtml(c)).join('');
        return `<div class="vn-music-tab">
            ${this._generateMusicSection(musicUuid)}
            <div class="vn-cues-section">
                <div class="vn-music-label"><i class="fas fa-play-circle"></i> ${game.i18n.localize('vn.dialog.soundCuesLabel')}</div>
                <p class="vn-cues-hint">${game.i18n.localize('vn.dialog.soundCuesHint')}</p>
                <div class="vn-cue-drop-zone" id="vn-cue-drop">
                    <i class="fas fa-plus-circle"></i>
                    <span>${game.i18n.localize('vn.dialog.dragTracksFromPlaylist')}</span>
                </div>
                <div class="vn-cue-list" id="vn-cue-list">${cuesHtml}</div>
            </div>
        </div>`;
    }

    _buildCueItemHtml(cue) {
        return `<div class="vn-cue-item" data-cue-id="${cue.id}" data-cue-uuid="${cue.uuid}">
            <i class="fas fa-music vn-cue-icon"></i>
            <input type="text" class="vn-cue-label-input" value="${cue.label || ''}" placeholder="${game.i18n.localize('vn.dialog.cueLabelPlaceholder')}">
            <button type="button" class="vn-btn vn-btn-xs vn-cue-delete" title="${game.i18n.localize('vn.dialog.btnDelete')}"><i class="fas fa-times"></i></button>
        </div>`;
    }

    _gatherSoundCues(root) {
        return Array.from(root.querySelectorAll('#vn-cue-list .vn-cue-item')).map(el => ({
            id: el.dataset.cueId || foundry.utils.randomID(),
            uuid: el.dataset.cueUuid,
            label: el.querySelector('.vn-cue-label-input')?.value?.trim() || '',
        })).filter(c => c.uuid);
    }

    _applySoundCues(root, cues) {
        const list = root.querySelector('#vn-cue-list');
        if (!list) return;
        list.innerHTML = cues.map(c => this._buildCueItemHtml(c)).join('');
    }

    _setupCueDrop(root) {
        const dropZone = root.querySelector('#vn-cue-drop');
        if (!dropZone) return;
        const signal = this._dialogAbortCtrl?.signal;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('drag-over');
        }, { signal });
        dropZone.addEventListener('dragleave', (e) => {
            if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
        }, { signal });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.type !== 'PlaylistSound' || !data.uuid) return;
                const sound = this._resolveSoundFromUuid(data.uuid);
                if (!sound) return;
                const cueId = foundry.utils.randomID();
                const label = `${sound.parent.name} — ${sound.name}`;
                const cueList = root.querySelector('#vn-cue-list');
                if (cueList) {
                    const temp = document.createElement('div');
                    temp.innerHTML = this._buildCueItemHtml({ id: cueId, uuid: data.uuid, label });
                    cueList.append(temp.firstElementChild);
                }
            } catch {}
        }, { signal });

        root.querySelector('#vn-cue-list')?.addEventListener('click', (e) => {
            if (e.target.closest('.vn-cue-delete')) e.target.closest('.vn-cue-item')?.remove();
        }, { signal });
    }

    _generateMusicSection(musicUuid) {
        let nameText = '';
        let hasMusic = false;
        if (musicUuid) {
            const sound = this._resolveSoundFromUuid(musicUuid);
            if (sound) { nameText = `${sound.parent.name} — ${sound.name}`; hasMusic = true; }
        }
        return `<div class="vn-music-section">
            <div class="vn-music-label"><i class="fas fa-music"></i> ${game.i18n.localize('vn.dialog.musicLabel')}</div>
            <div class="vn-music-drop-zone" id="vn-music-drop"${hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span>${game.i18n.localize('vn.dialog.dragTrackFromPlaylist')}</span>
            </div>
            <div class="vn-music-selected" id="vn-music-selected"${!hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span class="vn-music-name" id="vn-music-name">${nameText}</span>
                <button type="button" class="vn-music-clear" id="vn-music-clear" title="${game.i18n.localize('vn.dialog.clearMusic')}"><i class="fas fa-times"></i></button>
            </div>
            <input type="hidden" id="vn-music-uuid" value="${musicUuid || ''}">
        </div>`;
    }

    _setupMusicDrop(root) {
        const dropZone = root.querySelector('#vn-music-drop');
        const uuidInput = root.querySelector('#vn-music-uuid');
        const selectedDiv = root.querySelector('#vn-music-selected');
        const nameSpan = root.querySelector('#vn-music-name');
        const clearBtn = root.querySelector('#vn-music-clear');
        if (!dropZone || !uuidInput) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', (e) => {
            if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.type !== 'PlaylistSound' || !data.uuid) return;
                const sound = this._resolveSoundFromUuid(data.uuid);
                if (!sound) return;
                uuidInput.value = data.uuid;
                if (nameSpan) nameSpan.textContent = `${sound.parent.name} — ${sound.name}`;
                dropZone.hidden = true;
                if (selectedDiv) selectedDiv.hidden = false;
            } catch {}
        });

        clearBtn?.addEventListener('click', () => {
            uuidInput.value = '';
            dropZone.hidden = false;
            if (selectedDiv) selectedDiv.hidden = true;
        });
    }

    _setMusicInDialog(root, musicUuid) {
        const uuidInput = root.querySelector('#vn-music-uuid');
        const dropZone = root.querySelector('#vn-music-drop');
        const selectedDiv = root.querySelector('#vn-music-selected');
        const nameSpan = root.querySelector('#vn-music-name');
        if (!uuidInput) return;
        if (musicUuid) {
            const sound = this._resolveSoundFromUuid(musicUuid);
            if (sound) {
                uuidInput.value = musicUuid;
                if (nameSpan) nameSpan.textContent = `${sound.parent.name} — ${sound.name}`;
                if (dropZone) dropZone.hidden = true;
                if (selectedDiv) selectedDiv.hidden = false;
                return;
            }
        }
        uuidInput.value = '';
        if (dropZone) dropZone.hidden = false;
        if (selectedDiv) selectedDiv.hidden = true;
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
        const currentEffect = sceneState?.atmosphereEffect || 'particles';
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
                ${scene._bgManager.generateSelector(currentBg, currentOverlay, currentEffect, currentParticlesFg, currentParticleIntensity)}
            </div>
            <div class="vn-tab-panel" data-tab="music">
                ${this._generateMusicTab(currentMusicUuid, currentSoundCues)}
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
    // Adventure IO Tab
    // ══════════════════════════════════════════════════════════

    _generateIOSection(sorted) {
        const exportList = this._buildIOPresetGroups(sorted, 'exp', true);
        const exportEmpty = sorted.length === 0
            ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsToExport')}</div>`
            : '';

        return `<div class="vn-io-tab">
            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-file-export"></i> ${game.i18n.localize('vn.dialog.exportPresetsTitle')}</div>
                <div class="vn-io-controls">
                    <div class="vn-io-view-toggle">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this._ioViewMode === 'detailed' ? 'active' : ''}" data-view="detailed">${game.i18n.localize('vn.dialog.viewDetailed')}</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this._ioViewMode === 'compact' ? 'active' : ''}" data-view="compact">${game.i18n.localize('vn.dialog.viewCompact')}</button>
                    </div>
                    <div class="vn-io-bulk-btns">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-check-all" data-section="export">${game.i18n.localize('vn.dialog.checkAll')}</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-uncheck-all" data-section="export">${game.i18n.localize('vn.dialog.uncheckAll')}</button>
                    </div>
                </div>
                <div class="vn-io-preset-list" id="vn-io-export-list">${exportEmpty || exportList}</div>
                <div class="vn-io-export-footer">
                    <div class="vn-io-module-input-row">
                        <label class="vn-io-label"><i class="fas fa-cube"></i> ${game.i18n.localize('vn.dialog.moduleLabel')}</label>
                        ${this._buildModuleSelect()}
                    </div>
                    <div class="vn-io-module-input-row">
                        <label class="vn-io-label"><i class="fas fa-id-badge"></i> ${game.i18n.localize('vn.dialog.nameplateLabel')}</label>
                        ${this._buildNameplateSelect()}
                    </div>
                    <div class="vn-io-module-input-row">
                        <label class="vn-io-label"><i class="fas fa-folder-open"></i> ${game.i18n.localize('vn.dialog.bgFolderLabel')}</label>
                        <div class="vn-io-folder-row">
                            <input type="text" id="vn-io-export-folder" class="vn-io-select" placeholder="${game.i18n.localize('vn.dialog.bgFolderPlaceholder')}"
                                   value="${this._scene?._bgManager?.constructor?.getCustomFolder?.() || ''}">
                            <button type="button" class="vn-btn vn-btn-xs" id="vn-io-pick-folder-btn" title="${game.i18n.localize('vn.dialog.pickFolderBtnTitle')}"><i class="fas fa-search"></i></button>
                        </div>
                    </div>
                    <div class="vn-io-export-btns">
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" id="vn-io-export-btn">
                            <i class="fas fa-file-export"></i> <span id="vn-io-export-label">${game.i18n.localize('vn.dialog.btnExportToModule')}</span>
                        </button>
                        <button type="button" class="vn-btn vn-btn-sm" id="vn-io-export-file-btn">
                            <i class="fas fa-download"></i> ${game.i18n.localize('vn.dialog.btnDownloadJson')}
                        </button>
                    </div>
                </div>
            </div>

            <div class="vn-io-divider"></div>

            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-file-import"></i> ${game.i18n.localize('vn.dialog.importFromModuleTitle')}</div>
                <div class="vn-io-scan-row">
                    <button type="button" class="vn-btn vn-btn-sm" id="vn-io-scan-btn">
                        <i class="fas fa-magnifying-glass"></i> ${game.i18n.localize('vn.dialog.btnFindAdventureModules')}
                    </button>
                    <span class="vn-io-scan-hint">${game.i18n.localize('vn.dialog.scanModulesHint')}</span>
                </div>
                <div id="vn-io-modules-list" class="vn-io-modules-list"></div>
                <div id="vn-io-import-presets" class="vn-io-preset-list"></div>
                <div class="vn-io-import-footer" id="vn-io-import-footer" hidden>
                    <div class="vn-io-bulk-btns">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-check-all" data-section="import">${game.i18n.localize('vn.dialog.checkAll')}</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-uncheck-all" data-section="import">${game.i18n.localize('vn.dialog.uncheckAll')}</button>
                    </div>
                    <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" id="vn-io-import-btn">
                        <i class="fas fa-file-import"></i> <span id="vn-io-import-label">${game.i18n.localize('vn.dialog.btnImportSelected')}</span>
                    </button>
                </div>
            </div>

            <div class="vn-io-divider"></div>

            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-upload"></i> ${game.i18n.localize('vn.dialog.importFromFileTitle')}</div>
                <div class="vn-io-scan-row">
                    <button type="button" class="vn-btn vn-btn-sm" id="vn-io-import-file-btn">
                        <i class="fas fa-folder-open"></i> ${game.i18n.localize('vn.dialog.btnSelectJsonFile')}
                    </button>
                    <input type="file" id="vn-io-file-input" accept=".json" style="display:none">
                    <span class="vn-io-scan-hint">${game.i18n.localize('vn.dialog.loadFromFileHint')}</span>
                </div>
            </div>
        </div>`;
    }

    _buildModuleSelect() {
        const options = [...game.modules.values()]
            .filter(m => m.id !== 'player-queue')
            .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id))
            .map(m => {
                const label = m.active
                    ? `${m.title || m.id} (${m.id})`
                    : `${m.title || m.id} (${m.id}) ${game.i18n.localize('vn.dialog.moduleInactive')}`;
                return `<option value="${m.id}">${label}</option>`;
            })
            .join('');
        return `<select id="vn-io-module-id" class="vn-io-select">
            <option value="">${game.i18n.localize('vn.dialog.selectModule')}</option>
            ${options || `<option disabled>${game.i18n.localize('vn.dialog.noActiveModules')}</option>`}
        </select>`;
    }

    _buildNameplateSelect() {
        const current = (() => { try { return game.settings.get(MODULE_ID, 'nameplateImage') || ''; } catch { return ''; } })();
        const opts = Object.entries(NAMEPLATE_CONFIGS).map(([path, cfg]) =>
            `<option value="${path}" ${path === current ? 'selected' : ''}>${cfg.label || path.split('/').pop().replace(/\.[^.]+$/, '')}</option>`
        ).join('');
        return `<select id="vn-io-nameplate" class="vn-io-select">
            <option value="" ${!current ? 'selected' : ''}>${game.i18n.localize('vn.dialog.selectNameplate')}</option>
            ${opts}
        </select>`;
    }

    _buildIOPresetGroups(presets, idPrefix, allChecked = false) {
        if (!presets.length) return '';
        const groups = new Map();
        for (const p of presets) {
            const key = p.sceneName || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
        }
        const sortedKeys = [...groups.keys()].sort((a, b) => {
            if (!a) return 1;
            if (!b) return -1;
            return a.localeCompare(b);
        });

        return sortedKeys.map(key => {
            const group = groups.get(key);
            const label = key || game.i18n.localize('vn.dialog.noScene');
            const items = this._ioViewMode === 'compact'
                ? group.map(p => this._buildIORowCompact(p, idPrefix, allChecked)).join('')
                : group.map(p => this._buildIOCardDetailed(p, idPrefix, allChecked)).join('');
            return `<div class="vn-io-scene-group">
                <div class="vn-io-scene-header">
                    <label class="vn-io-group-check-label" title="${game.i18n.localize('vn.dialog.selectGroup')}">
                        <input type="checkbox" class="vn-io-group-cb"${allChecked ? ' checked' : ''}>
                    </label>
                    <i class="fas fa-map-pin"></i> ${label}
                    <span class="vn-badge">${group.length}</span>
                </div>
                <div class="vn-io-scene-presets ${this._ioViewMode === 'compact' ? 'vn-io-compact' : 'vn-io-detailed'}">${items}</div>
            </div>`;
        }).join('');
    }

    _buildIOCardDetailed(preset, idPrefix, checked) {
        const cbId = `${idPrefix}-cb-${preset.id}`;
        const bgSrc = preset.thumbnailData || (preset.background && preset.background !== 'none' ? preset.background : null);
        const imgHtml = bgSrc
            ? `<img class="vn-io-card-bg-img" src="${bgSrc}" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-io-card-bg-placeholder"><i class="fas fa-film"></i></div>`;

        const allIds = [...(preset.leftIds || []), ...(preset.centerIds || []), ...(preset.rightIds || [])];
        const MAX_PIPS = 4;
        const pipsHtml = allIds.length
            ? `<div class="vn-io-card-pips">${
                allIds.slice(0, MAX_PIPS).map(id => {
                    const src = this._resolveActorImg(id, preset.portraitImages || {});
                    const name = (preset.portraitNames || {})[id] || '';
                    return `<img class="vn-io-actor-pip" src="${src}" loading="lazy" decoding="async" alt="${name}" title="${name}">`;
                }).join('')
              }${allIds.length > MAX_PIPS ? `<span class="vn-io-actor-more">+${allIds.length - MAX_PIPS}</span>` : ''}</div>`
            : '';

        return `<label class="vn-io-card" data-preset-id="${preset.id}">
            <div class="vn-io-card-poster">
                ${imgHtml}
                ${pipsHtml}
                <div class="vn-io-card-footer">
                    <div class="vn-io-card-name" title="${preset.name}">${preset.name}</div>
                </div>
                <div class="vn-io-card-check-corner">
                    <input type="checkbox" class="vn-io-preset-cb" id="${cbId}" value="${preset.id}"${checked ? ' checked' : ''}>
                </div>
            </div>
        </label>`;
    }

    _buildIORowCompact(preset, idPrefix, checked) {
        const cbId = `${idPrefix}-cb-${preset.id}`;
        const sceneTag = preset.sceneName
            ? `<span class="vn-io-row-scene"><i class="fas fa-map-pin"></i>${preset.sceneName}</span>` : '';
        return `<label class="vn-io-row" data-preset-id="${preset.id}">
            <input type="checkbox" class="vn-io-preset-cb" id="${cbId}" value="${preset.id}"${checked ? ' checked' : ''}>
            <span class="vn-io-row-name" title="${preset.name}">${preset.name}</span>
            ${sceneTag}
        </label>`;
    }

    _buildActorPips(ids, maxVisible, portraitImages = {}) {
        const imgs = ids.slice(0, maxVisible).map(id => {
            const src = this._resolveActorImg(id, portraitImages);
            return `<img class="vn-io-actor-pip" src="${src}" width="24" height="24" loading="lazy" decoding="async" alt="">`;
        }).join('');
        const extra = ids.length > maxVisible
            ? `<span class="vn-io-actor-more">+${ids.length - maxVisible}</span>` : '';
        return imgs + extra;
    }

    _resolveActorImg(id, portraitImages = {}) {
        try {
            const aid = parseActorId(id);
            if (aid) {
                const a = game.actors.get(aid);
                if (a) return a.img || a.prototypeToken?.texture?.src || FALLBACK_AVATAR;
                return portraitImages[id] || FALLBACK_AVATAR;
            }
            const t = canvas.tokens?.get(id);
            return t?.actor?.img || portraitImages[id] || FALLBACK_AVATAR;
        } catch { return portraitImages[id] || FALLBACK_AVATAR; }
    }

    _updateIOExportCounter(root) {
        const checked = root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked').length;
        const label = root.querySelector('#vn-io-export-label');
        if (label) label.textContent = checked > 0 ? game.i18n.format('vn.dialog.exportSelectedCount', {count: checked}) : game.i18n.localize('vn.dialog.exportSelected');
    }

    _updateIOImportCounter(root) {
        const checked = root.querySelectorAll('#vn-io-import-presets .vn-io-preset-cb:checked').length;
        const label = root.querySelector('#vn-io-import-label');
        if (label) label.textContent = checked > 0 ? game.i18n.format('vn.dialog.importSelectedCount', {count: checked}) : game.i18n.localize('vn.dialog.importSelected');
    }

    _renderModulesList(root) {
        const listEl = root.querySelector('#vn-io-modules-list');
        if (!listEl) return;
        if (!this._ioFoundModules.length) {
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noModulesFound')}</div>`;
            return;
        }
        listEl.innerHTML = this._ioFoundModules.map(m => {
            const nameplateLabel = m.nameplate
                ? (NAMEPLATE_CONFIGS[m.nameplate]?.label ?? m.nameplate.split('/').pop().replace(/\.[^.]+$/, ''))
                : null;
            const folderLabel = m.backgroundFolder
                ? (m.backgroundFolder.split('/').pop() || m.backgroundFolder)
                : null;
            const applyBtns = [
                nameplateLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-nameplate" data-module-id="${m.id}" title="${game.i18n.format('vn.dialog.setNameplateTitle', {label: nameplateLabel})}"><i class="fas fa-id-badge"></i> ${nameplateLabel}</button>` : '',
                folderLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-folder" data-module-id="${m.id}" title="${game.i18n.format('vn.dialog.setFolderTitle', {folder: m.backgroundFolder})}"><i class="fas fa-folder-open"></i> ${folderLabel}</button>` : '',
            ].filter(Boolean).join('');
            return `<div class="vn-io-module-item ${this._ioSelectedModuleId === m.id ? 'active' : ''}" data-module-id="${m.id}">
                <div class="vn-io-module-info">
                    <span class="vn-io-module-title">${m.title}</span>
                    <span class="vn-io-module-id">${m.id}</span>
                    ${applyBtns ? `<div class="vn-io-module-apply-row">${applyBtns}</div>` : ''}
                </div>
                <button type="button" class="vn-btn vn-btn-xs vn-io-load-module" data-module-id="${m.id}">
                    <i class="fas fa-download"></i> ${game.i18n.localize('vn.dialog.btnLoadModule')}
                </button>
            </div>`;
        }).join('');
        this._attachModuleLoadListeners(root);
    }

    _renderImportPresets(root) {
        const listEl = root.querySelector('#vn-io-import-presets');
        const footer = root.querySelector('#vn-io-import-footer');
        if (!listEl) return;
        if (!this._ioModulePresets.length) {
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsInModule')}</div>`;
            if (footer) footer.hidden = true;
            return;
        }
        listEl.innerHTML = this._buildIOPresetGroups(this._ioModulePresets, 'imp', false);
        if (footer) footer.hidden = false;
        this._updateIOImportCounter(root);
    }

    _attachModuleLoadListeners(root) {
        root.querySelectorAll('.vn-io-load-module').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this._ioFoundModules.find(m => m.id === moduleId);
                if (!mod) return;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                this._ioSelectedModuleId = moduleId;
                const fetchedData = await VNAdventureIO.fetchPresets(moduleId, mod.presetsFile);
                this._ioModulePresets = fetchedData.presets;
                this._ioModuleFolders = fetchedData.folders;
                this._renderModulesList(root);
                this._renderImportPresets(root);
            });
        });

        root.querySelectorAll('.vn-io-apply-nameplate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this._ioFoundModules.find(m => m.id === moduleId);
                if (!mod?.nameplate) return;
                await game.settings.set(MODULE_ID, 'nameplateImage', mod.nameplate);
                applyNameplateImage(mod.nameplate);
                ui.notifications.info(game.i18n.localize('vn.dialog.nameplateInstalled'));
            });
        });

        root.querySelectorAll('.vn-io-apply-folder').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this._ioFoundModules.find(m => m.id === moduleId);
                if (!mod?.backgroundFolder) return;
                await game.settings.set(MODULE_ID, 'backgroundFolder', mod.backgroundFolder);
                ui.notifications.info(game.i18n.format('vn.dialog.folderInstalled', {folder: mod.backgroundFolder}));
            });
        });
    }

    _syncGroupCb(groupEl) {
        if (!groupEl) return;
        const cbs = [...groupEl.querySelectorAll('.vn-io-preset-cb')];
        const groupCb = groupEl.querySelector('.vn-io-group-cb');
        if (!groupCb || !cbs.length) return;
        const n = cbs.filter(cb => cb.checked).length;
        groupCb.checked = n === cbs.length;
        groupCb.indeterminate = n > 0 && n < cbs.length;
    }

    _syncAllGroupCbs(listEl) {
        listEl?.querySelectorAll('.vn-io-scene-group').forEach(g => this._syncGroupCb(g));
    }

    _rebuildExportList(root) {
        const listEl = root.querySelector('#vn-io-export-list');
        if (!listEl) return;
        VNPresets.getSorted().then(sorted => {
            if (!listEl.isConnected) return;
            listEl.innerHTML = sorted.length
                ? this._buildIOPresetGroups(sorted, 'exp', true)
                : `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsToExport')}</div>`;
            this._updateIOExportCounter(root);
        });
    }

    _attachIOListeners(root) {
        // View mode toggle
        root.querySelectorAll('.vn-io-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._ioViewMode = btn.dataset.view;
                root.querySelectorAll('.vn-io-view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._rebuildExportList(root);
                if (this._ioModulePresets.length) this._renderImportPresets(root);
            });
        });

        // Select/deselect all
        root.querySelectorAll('.vn-io-check-all').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const section = btn.dataset.section;
                const listId = section === 'export' ? '#vn-io-export-list' : '#vn-io-import-presets';
                const listEl = root.querySelector(listId);
                listEl?.querySelectorAll('.vn-io-preset-cb').forEach(cb => { cb.checked = true; });
                this._syncAllGroupCbs(listEl);
                section === 'export' ? this._updateIOExportCounter(root) : this._updateIOImportCounter(root);
            });
        });
        root.querySelectorAll('.vn-io-uncheck-all').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const section = btn.dataset.section;
                const listId = section === 'export' ? '#vn-io-export-list' : '#vn-io-import-presets';
                const listEl = root.querySelector(listId);
                listEl?.querySelectorAll('.vn-io-preset-cb').forEach(cb => { cb.checked = false; });
                this._syncAllGroupCbs(listEl);
                section === 'export' ? this._updateIOExportCounter(root) : this._updateIOImportCounter(root);
            });
        });

        // Delegated change listener — export list (survives innerHTML rebuilds)
        const exportListEl = root.querySelector('#vn-io-export-list');
        if (exportListEl && !exportListEl._ioListenerSet) {
            exportListEl._ioListenerSet = true;
            exportListEl.addEventListener('change', e => {
                if (e.target.classList.contains('vn-io-group-cb')) {
                    e.target.closest('.vn-io-scene-group')
                        ?.querySelectorAll('.vn-io-preset-cb')
                        .forEach(cb => { cb.checked = e.target.checked; });
                } else if (e.target.classList.contains('vn-io-preset-cb')) {
                    this._syncGroupCb(e.target.closest('.vn-io-scene-group'));
                }
                this._updateIOExportCounter(root);
            });
        }

        // Delegated change listener — import list
        const importListEl = root.querySelector('#vn-io-import-presets');
        if (importListEl && !importListEl._ioListenerSet) {
            importListEl._ioListenerSet = true;
            importListEl.addEventListener('change', e => {
                if (e.target.classList.contains('vn-io-group-cb')) {
                    e.target.closest('.vn-io-scene-group')
                        ?.querySelectorAll('.vn-io-preset-cb')
                        .forEach(cb => { cb.checked = e.target.checked; });
                } else if (e.target.classList.contains('vn-io-preset-cb')) {
                    this._syncGroupCb(e.target.closest('.vn-io-scene-group'));
                }
                this._updateIOImportCounter(root);
            });
        }

        this._updateIOExportCounter(root);

        // Folder picker for export section
        root.querySelector('#vn-io-pick-folder-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            const input = root.querySelector('#vn-io-export-folder');
            const startPath = input?.value?.trim() || 'modules/player-queue/assets/scenes';
            const fp = new FilePicker({
                type: 'folder',
                current: startPath,
                callback: (folderPath) => { if (input) input.value = folderPath; }
            });
            fp.browse(startPath);
        });

        // Export button
        root.querySelector('#vn-io-export-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const moduleId = root.querySelector('#vn-io-module-id')?.value?.trim();
            if (!moduleId) { ui.notifications.warn(game.i18n.localize('vn.dialog.specifyModuleId')); return; }
            const ids = [...root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked')].map(cb => cb.value);
            if (!ids.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.selectAtLeastOnePreset')); return; }
            const all = await VNPresets.getAll();
            const toExport = ids.map(id => all[id]).filter(Boolean);
            const nameplate = root.querySelector('#vn-io-nameplate')?.value || '';
            const backgroundFolder = root.querySelector('#vn-io-export-folder')?.value?.trim() || '';
            try {
                await VNAdventureIO.exportToModule(toExport, moduleId);
                ui.notifications.info(game.i18n.format('vn.dialog.exportSuccess', {count: toExport.length, moduleId}));
                this._showExportInstructions(moduleId, { nameplate, backgroundFolder });
            } catch (err) {
                ui.notifications.error(game.i18n.format('vn.dialog.exportError', {msg: err.message}));
            }
        });

        // Scan modules
        root.querySelector('#vn-io-scan-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._ioFoundModules = VNAdventureIO.scanModules();
            this._ioSelectedModuleId = null;
            this._ioModulePresets = [];
            this._ioModuleFolders = [];
            this._renderModulesList(root);
            const importPresets = root.querySelector('#vn-io-import-presets');
            if (importPresets) importPresets.innerHTML = '';
            const footer = root.querySelector('#vn-io-import-footer');
            if (footer) footer.hidden = true;
        });

        // Export to file (browser download)
        root.querySelector('#vn-io-export-file-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const ids = [...root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked')].map(cb => cb.value);
            const all = await VNPresets.getAll();
            const sorted = await VNPresets.getSorted();
            const toExport = ids.length > 0 ? ids.map(id => all[id]).filter(Boolean) : sorted;
            if (!toExport.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.noPresetsToDownload')); return; }
            VNAdventureIO.exportToFile(toExport);
            ui.notifications.info(game.i18n.format('vn.dialog.downloadingPresets', {count: toExport.length}));
        });

        // Import from JSON file
        root.querySelector('#vn-io-import-file-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            root.querySelector('#vn-io-file-input')?.click();
        });

        root.querySelector('#vn-io-file-input')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = '';
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                let presets = [];
                if (Array.isArray(data.presets)) presets = data.presets;
                else if (data.presets && typeof data.presets === 'object') presets = Object.values(data.presets);
                else if (Array.isArray(data)) presets = data;
                if (!presets.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.noPresetsInFile')); return; }

                const { fresh, dupes } = await VNAdventureIO.classifyImport(presets);
                const hasDupes = dupes.length > 0;
                const msg = hasDupes
                    ? game.i18n.format('vn.dialog.fileImportWithDupes', {total: presets.length, fresh: fresh.length, dupes: dupes.length})
                    : game.i18n.format('vn.dialog.fileImportNoDupes', {total: presets.length});

                const choice = await new Promise(resolve => {
                    const buttons = [
                        { action: 'fresh', label: game.i18n.localize('vn.dialog.btnImportFreshOnly'), icon: 'fas fa-plus', default: true },
                        ...(hasDupes ? [{ action: 'overwrite', label: game.i18n.localize('vn.dialog.btnOverwriteDupes'), icon: 'fas fa-sync' }] : []),
                        { action: 'replace', label: game.i18n.localize('vn.dialog.btnReplaceAll'), icon: 'fas fa-trash' },
                    ];
                    const dlg = new foundry.applications.api.DialogV2({
                        window: { title: game.i18n.localize('vn.dialog.importFromFileTitle') },
                        classes: ['vn-confirm-dialog'],
                        content: `<div style="padding:6px 0"><p style="margin:0 0 8px">${msg}</p></div>`,
                        buttons,
                        rejectClose: false,
                        submit: result => resolve(result),
                    });
                    dlg.addEventListener('close', () => resolve('cancel'), { once: true });
                    dlg.render({ force: true });
                });

                if (!choice || choice === 'cancel') return;

                const importedFolders = Array.isArray(data.folders) ? data.folders : [];
                const folderOpts = await this._promptFolderImportChoice(importedFolders);
                if (folderOpts === null) return;

                let added = 0;
                if (choice === 'replace') {
                    await game.settings.set(MODULE_ID, VNPresets.SETTING_KEY, {});
                    VNPresets.invalidateCache();
                    added = await VNAdventureIO.mergeImport(presets, true, folderOpts);
                } else if (choice === 'overwrite') {
                    added = await VNAdventureIO.mergeImport(fresh, false, folderOpts);
                    added += await VNAdventureIO.mergeImport(dupes, true, folderOpts);
                } else {
                    added = await VNAdventureIO.mergeImport(fresh, false, folderOpts);
                }
                ui.notifications.info(game.i18n.format('vn.dialog.importedPresets', {count: added}));
                this._refreshPresetList(root);
                this._rebuildExportList(root);
            } catch (err) {
                ui.notifications.error(game.i18n.format('vn.dialog.fileReadError', {msg: err.message}));
            }
        });

        // Import button
        root.querySelector('#vn-io-import-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const ids = [...root.querySelectorAll('#vn-io-import-presets .vn-io-preset-cb:checked')].map(cb => cb.value);
            if (!ids.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.selectAtLeastOnePreset')); return; }
            const toImport = this._ioModulePresets.filter(p => ids.includes(p.id));

            const { fresh, dupes } = await VNAdventureIO.classifyImport(toImport);

            let choice = 'new-only';
            if (dupes.length) {
                const bodyLines = [
                    fresh.length ? game.i18n.format('vn.dialog.freshPresetsAdded', {count: fresh.length}) : null,
                    game.i18n.format('vn.dialog.dupesExist', {count: dupes.length}),
                ].filter(Boolean).map(l => `<p style="margin:4px 0">${l}</p>`).join('');

                const buttons = [
                    ...(fresh.length ? [{ action: 'new-only', label: game.i18n.format('vn.dialog.btnImportFreshCount', {count: fresh.length}), icon: 'fas fa-plus', default: true }] : []),
                    { action: 'overwrite', label: game.i18n.format('vn.dialog.btnOverwriteAllCount', {count: toImport.length}), icon: 'fas fa-sync', default: !fresh.length },
                    { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' },
                ];

                choice = await new Promise(resolve => {
                    const dlg = new foundry.applications.api.DialogV2({
                        window: { title: game.i18n.localize('vn.dialog.importPresetsDialogTitle') },
                        classes: ['vn-confirm-dialog'],
                        content: `<div style="padding:6px 0">${bodyLines}</div>`,
                        buttons,
                        rejectClose: false,
                        submit: result => resolve(result),
                    });
                    dlg.addEventListener('close', () => resolve('cancel'), { once: true });
                    dlg.render({ force: true });
                });
                if (!choice || choice === 'cancel') return;
            }

            const folderOpts = await this._promptFolderImportChoice(this._ioModuleFolders);
            if (folderOpts === null) return;

            const presetsToImport = choice === 'new-only' ? fresh : toImport;
            const added = await VNAdventureIO.mergeImport(presetsToImport, choice === 'overwrite', folderOpts);
            ui.notifications.info(game.i18n.format('vn.dialog.importedPresets', {count: added}));
            this._refreshPresetList(root);
        });
    }

    _showExportInstructions(moduleId, opts = {}) {
        const snippet = VNAdventureIO.moduleJsonSnippet(opts);
        const notesHtml = [
            opts.nameplate ? `<li>${game.i18n.format('vn.dialog.nameplateNote', {filename: opts.nameplate.split('/').pop()})}</li>` : '',
            opts.backgroundFolder ? `<li>${game.i18n.format('vn.dialog.bgFolderNote', {folder: opts.backgroundFolder})}</li>` : '',
        ].filter(Boolean).join('');

        const dialog = new foundry.applications.api.DialogV2({
            window: { title: game.i18n.localize('vn.dialog.exportDoneTitle'), icon: 'fas fa-check-circle' },
            classes: ['vn-instructions-dialog'],
            position: { width: 520 },
            content: `<div class="vn-io-instructions">
                <p><i class="fas fa-check-circle" style="color:var(--vn-success)"></i>
                ${game.i18n.format('vn.dialog.exportFileSaved', {moduleId})}</p>
                ${notesHtml ? `<ul style="margin:4px 0 8px;padding-left:1.4em;font-size:0.85em">${notesHtml}</ul>` : ''}
                <p>${game.i18n.localize('vn.dialog.addToModuleJson')}</p>
                <div class="vn-io-snippet-wrapper">
                    <pre class="vn-io-snippet" id="vn-io-snippet-text">${snippet}</pre>
                    <button type="button" class="vn-btn vn-btn-xs vn-io-copy-btn" id="vn-io-copy-snippet">
                        <i class="fas fa-copy"></i> ${game.i18n.localize('vn.dialog.btnCopySnippet')}
                    </button>
                </div>
                <p class="vn-io-hint"><i class="fas fa-triangle-exclamation"></i>
                ${game.i18n.localize('vn.dialog.moduleJsonRestartNote')}</p>
            </div>`,
            buttons: [{ action: 'ok', label: game.i18n.localize('vn.dialog.btnOk'), icon: 'fas fa-check', default: true }],
        });
        dialog.addEventListener('render', () => {
            dialog.element.querySelector('#vn-io-copy-snippet')?.addEventListener('click', async (e) => {
                e.preventDefault();
                await navigator.clipboard.writeText(snippet);
                const btn = dialog.element.querySelector('#vn-io-copy-snippet');
                if (!btn) return;
                btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize('vn.dialog.btnCopied')}`;
                setTimeout(() => { btn.innerHTML = `<i class="fas fa-copy"></i> ${game.i18n.localize('vn.dialog.btnCopySnippet')}`; }, 2000);
            });
        });
        dialog.render({ force: true });
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

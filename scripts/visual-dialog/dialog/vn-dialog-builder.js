// ============================================================
// vn-dialog-builder.js — UI диалога настроек сцены
// ============================================================

import { VNSceneState, VNPresets, resolveParticlesLayer } from '../vn-state.js';
import { VNAtmosphere } from '../visual-effects/atmosphere/index.js';
import { stripDupSuffix, parseActorId, toActorTokenId, FALLBACK_AVATAR, escapeHtml } from '../vn-id-utils.js';
import { CHAR_FX, CHAR_FX_GROUPS, CHAR_FX_ICONS, CHAR_FX_VARIANTS, charFxBase, VNCharFx } from '../visual-effects/character-fx/vn-character-fx.js';

const VIS_ICON  = { visible: 'fa-eye', hidden: 'fa-eye-slash', 'name-hidden': 'fa-user-secret' };
const VIS_TITLE = { visible: 'vn.dialog.vis.visible', hidden: 'vn.dialog.vis.hidden', 'name-hidden': 'vn.dialog.vis.nameHidden' };

const CHAR_FX_GROUP_ICONS = { css: 'fa-palette', svg: 'fa-wave-square' };

function charFxButton() {
    return `<button type="button" class="vn-token-fx-btn" title="${game.i18n.format('vn.dialog.charFxTitle', { name: game.i18n.localize('vn.charFx.none') })}" draggable="false"><i class="fas ${CHAR_FX_ICONS.none}"></i></button>`;
}

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
        this._stepEdit = null;
        this._tokenSearchQuery = '';
        this._dialogAbortCtrl?.abort();
        this._dialogAbortCtrl = new AbortController();
        this._dropZones = new WeakSet();
        this._dragEls = new WeakSet();

        const scene = this._scene;
        const tokens = canvas.tokens.placeables.filter(t => t.actor);

        await scene._bgManager.restoreLastPath();
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

        this._baseTitle = isEdit ? game.i18n.localize('vn.dialog.editTitle') : game.i18n.localize('vn.dialog.createTitle');
        const dialog = new foundry.applications.api.DialogV2({
            window: { title: this._baseTitle, icon: isEdit ? 'fas fa-edit' : 'fas fa-theater-masks', resizable: true },
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
        const particlesLayer = root.querySelector('#particles-layer')?.value || 'back';
        const particleIntensity = parseInt(root.querySelector('#particle-intensity')?.value) || 1;
        const musicUuid = root.querySelector('#vn-music-uuid')?.value || null;
        const soundCues = this._scene._musicManager.gatherCues(root);

        const visibilityData = this._collectVisibilityData(root, allRaw, allDeduped);
        const charFxData = this._collectCharFxData(root, allRaw, allDeduped);

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
            flipped: pendingFlipped ?? null, particleEffect, visualEffect, particlesLayer, particleIntensity,
            visibility: visibilityData, charFx: charFxData, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales ?? null, gmOnly, presetActors,
        });
        else this._scene.createScene({
            leftIds: left, centerIds: center, rightIds: right,
            background: bg, backgroundOverlay: overlay,
            flipped: pendingFlipped || {}, particleEffect, visualEffect, particlesLayer, particleIntensity,
            visibility: visibilityData, charFx: charFxData, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales || {}, gmOnly, presetActors,
        });
    }

    // ══════════════════════════════════════════════════════════
    // Dialog Interactions Setup
    // ══════════════════════════════════════════════════════════

    _setupInteractions(root, isEdit) {
        this._setupDragAndDrop(root);
        this._scene._bgManager.attachListeners(root);
        this._scene._effectsManager.attachListeners(root);
        this._scene._musicManager.attachListeners(root);
        this._setupFavoriteHandlers(root);
        this._setupActorsDragAndDrop(root);
        this._scene._presetsManager.attachListeners(root, {
            gatherState: (root) => this._gatherDialogState(root),
            applyPreset: (root, preset) => this.applyPreset(root, preset),
            launchScene: async (preset, stepIndex = null) => {
                if (await this._scene.launchPreset(preset, { stepIndex })) this._dialog?.close();
            },
            getLiveState: () => (this._scene.state.isActive ? this._scene.state : null),
            onSequenceChanged: (preset) => this._scene._sequence.syncPreset(preset),
            beginStepEdit: (root, edit) => this.beginStepEdit(root, edit),
            syncPresetActors: (presetActors) => { if (this._scene.state.isActive) this._scene.state.presetActors = [...presetActors]; },
            onChanged: (root) => this._scene._ioManager.refreshExportList(root),
        });
        this._scene._ioManager.attachListeners(root, {
            onImported: (root) => this._scene._presetsManager.refresh(root),
        });
        this._setupTabs(root);
        this._setupStepEditBanner(root);
        this._setupHideButtons(root);
        this._setupCharFxMenu(root);
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

    // Writes a token option's portrait effect to its dataset plus the matching button icon/title ('none' clears it).
    _applyCharFxIcon(tokenOpt, fx) {
        const id = CHAR_FX.includes(fx) ? fx : 'none';
        if (id === 'none') delete tokenOpt.dataset.charFx;
        else tokenOpt.dataset.charFx = id;
        const btn = tokenOpt.querySelector('.vn-token-fx-btn');
        if (!btn) return;
        btn.querySelector('i').className = `fas ${CHAR_FX_ICONS[id]}`;
        btn.title = game.i18n.format('vn.dialog.charFxTitle', { name: game.i18n.localize(`vn.charFx.${id}`) });
    }

    // One shared popover menu: the effect button of a card opens it next to the button, a pick applies to that card.
    // The popover lives in the top layer, so the scroll containers of the dialog cannot clip it.
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

    _setupTabs(root) {
        root.querySelectorAll('.vn-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = btn.dataset.tab;
                root.querySelectorAll('.vn-tab-btn').forEach(b => b.classList.remove('active'));
                root.querySelectorAll('.vn-tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                root.querySelector(`.vn-tab-panel[data-tab="${tab}"]`)?.classList.add('active');
                // The active tab is mirrored on the dialog root so CSS can adapt the footer to it
                const dialogRoot = root.querySelector('.vn-scene-dialog--tabs');
                if (dialogRoot) dialogRoot.dataset.tab = tab;
                this._syncTitle(tab);
            });
        });
    }

    // ── Editing one step of a composite preset in the regular form ──
    // The step is loaded into the form, a banner says what is being edited, and "Save to step" writes the form back
    // and returns to the presets tab — instead of hopping between tabs to find the right button.

    beginStepEdit(root, { preset, step, stepId, index }) {
        this.applyPreset(root, step);
        this._stepEdit = { presetId: preset.id, stepId, index, name: preset.name };
        const banner = root.querySelector('.vn-edit-banner');
        if (banner) {
            banner.querySelector('.vn-edit-banner-text').textContent = game.i18n.format('vn.sequence.editBanner', { n: index + 1, name: preset.name });
            banner.hidden = false;
        }
        const dialogRoot = root.querySelector('.vn-scene-dialog--tabs');
        if (dialogRoot) dialogRoot.dataset.editing = 'step';
        root.querySelector('.vn-tab-btn[data-tab="characters"]')?.click();
    }

    endStepEdit(root) {
        this._stepEdit = null;
        const banner = root.querySelector('.vn-edit-banner');
        if (banner) banner.hidden = true;
        root.querySelector('.vn-scene-dialog--tabs')?.removeAttribute('data-editing');
    }

    _setupStepEditBanner(root) {
        root.querySelector('.vn-edit-banner-save')?.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!this._stepEdit) return;
            const saved = await this._scene._presetsManager._sequenceEditor.saveFormToStep(root, this._stepEdit);
            if (!saved) {
                ui.notifications.warn(game.i18n.localize('vn.sequence.editLost'));
                this.endStepEdit(root);
                return;
            }
            this.endStepEdit(root);
            root.querySelector('.vn-tab-btn[data-tab="presets"]')?.click();
        });
        root.querySelector('.vn-edit-banner-cancel')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.endStepEdit(root);
        });
    }

    /** Presets and import/export are not "creating a scene" — the window title says what the tab is for. */
    _syncTitle(tab) {
        const key = { presets: 'vn.dialog.titlePresets', 'adventure-io': 'vn.dialog.titleIO' }[tab];
        const heading = this._dialog?.window?.title;
        if (heading) heading.textContent = key ? game.i18n.localize(key) : this._baseTitle;
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
            this._syncParticipantsBadge(el.closest('.vn-scene-dialog') ?? this._dialog?.element);
        }, { signal });
    }

    /** The badge counts what is in the list, however the actor got there or left (drag from outside, between zones, preset load). */
    _syncParticipantsBadge(root) {
        const badge = root?.querySelector('.vn-participants-badge');
        const list = root?.querySelector('#scene-participants');
        if (badge && list) badge.textContent = list.querySelectorAll('.vn-token-option').length;
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
        const mgr = this._scene._bgManager;
        mgr.addDynamicOption(root, bg, mgr.constructor._fileLabel(bg));
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
        this._scene._effectsManager.setLayer(root, state.particlesLayer ?? 'back');
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
        this._restoreCharFx(root, state.charFx);

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
            this._setEffectAxis(root, 'particle', preset.particleEffect || 'none');
            this._setEffectAxis(root, 'visual', preset.visualEffect || 'none');
        } else {
            const legacy = VNAtmosphere.PRESETS[preset.atmosphereEffect] ?? VNAtmosphere.PRESETS.none;
            this._setEffectAxis(root, 'particle', legacy.particles);
            this._setEffectAxis(root, 'visual', legacy.visual);
        }
        this._scene._effectsManager.setLayer(root, resolveParticlesLayer(preset));
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
        root.querySelectorAll('.vn-token-option').forEach(el => this._applyCharFxIcon(el, 'none'));
        this._restoreCharFx(root, preset.charFx);

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

    _collectCharFxData(root, allRaw = null, allDeduped = null) {
        const charFxData = {};
        const elements = Array.from(root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option'));
        elements.forEach((el, i) => {
            const fx = el.dataset.charFx;
            if (!fx || fx === 'none') return;
            const id = (allDeduped && allRaw) ? allDeduped[i]
                : (el.dataset.tokenId || (el.dataset.actorId ? `actor-${el.dataset.actorId}` : null));
            if (id) charFxData[id] = fx;
        });
        return charFxData;
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

    _gatherDialogState(root) {
        const scene = this._scene;
        const getRawIds = (sel) => Array.from(root.querySelectorAll(`${sel} .vn-token-option`))
            .map(el => el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || null).filter(Boolean);
        const allRaw = [...getRawIds('#left-tokens'), ...getRawIds('#center-tokens'), ...getRawIds('#right-tokens')];
        const allDeduped = VNDialogBuilder._deduplicateIds(allRaw);
        const leftCount = root.querySelectorAll('#left-tokens .vn-token-option').length;
        const centerCount = root.querySelectorAll('#center-tokens .vn-token-option').length;

        const visibilityData = this._collectVisibilityData(root, allRaw, allDeduped);
        const charFxData = this._collectCharFxData(root, allRaw, allDeduped);
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
            particlesLayer: root.querySelector('#particles-layer')?.value || 'back',
            particleIntensity: parseInt(root.querySelector('#particle-intensity')?.value) || 1,
            portraitScale: scene.state.portraitScale,
            portraitScales: remappedScales,
            visibility: visibilityData,
            charFx: charFxData,
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
        const currentParticlesLayer = sceneState?.particlesLayer ?? 'back';
        const currentParticleIntensity = sceneState?.particleIntensity ?? 1;
        const currentMusicUuid = sceneState?.musicUuid || null;
        const currentSoundCues = sceneState?.soundCues || [];

        const favHTML = scene.favoriteActors.map(id => game.actors.get(id)).filter(Boolean).map(a => VNDialogBuilder.generateActorToken(a)).join('');
        const tokensHTML = tokens.map(t => `<div class="vn-token-option" draggable="true" data-token-id="${escapeHtml(t.id)}" data-actor-id="${escapeHtml(t.actor.id)}" data-type="token" data-visibility="visible" data-name="${escapeHtml(t.name.toLowerCase())}">
            <button type="button" class="vn-token-hide-btn" title="${game.i18n.localize(VIS_TITLE.visible)}" draggable="false"><i class="fas fa-eye"></i></button>
            ${charFxButton()}
            <div class="vn-token-preview"><img src="${escapeHtml(t.actor.img || t.document.texture.src)}" alt="${escapeHtml(t.name)}" loading="lazy"><div class="vn-token-name">${escapeHtml(t.name)}</div></div></div>`).join('');

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

        return `<div class="vn-scene-dialog vn-scene-dialog--tabs" data-tab="characters">
            <div class="vn-edit-banner" hidden>
                <i class="fas fa-pen-to-square"></i>
                <span class="vn-edit-banner-text"></span>
                <button type="button" class="vn-btn vn-btn-sm vn-btn-accent vn-edit-banner-save"><i class="fas fa-floppy-disk"></i> ${game.i18n.localize('vn.sequence.editSave')}</button>
                <button type="button" class="vn-btn vn-btn-sm vn-edit-banner-cancel">${game.i18n.localize('vn.sequence.editCancel')}</button>
            </div>
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
                ${scene._effectsManager.generateTab(currentParticle, currentVisual, currentParticlesLayer, currentParticleIntensity)}
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
        return `<div class="vn-token-option" draggable="true" data-actor-id="${escapeHtml(id)}" data-token-id="" data-type="actor" data-visibility="visible" data-name="${escapeHtml(actor.name.toLowerCase())}">
            <button type="button" class="vn-token-hide-btn" title="${game.i18n.localize(VIS_TITLE.visible)}" draggable="false"><i class="fas fa-eye"></i></button>
            ${charFxButton()}
            <div class="vn-token-preview"><img src="${escapeHtml(img)}" alt="${escapeHtml(actor.name)}" loading="lazy"><div class="vn-token-name">${escapeHtml(actor.name)}</div></div></div>`;
    }
}

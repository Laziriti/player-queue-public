// ============================================================
// vn-dialog-builder.js — UI диалога настроек сцены
// ============================================================

import { VNSceneState, VNPresets, MODULE_ID } from './vn-state.js';
import { VNAdventureIO } from './vn-adventure-io.js';
import { stripDupSuffix, parseActorId, toActorTokenId, parsePlaylistUuid } from './vn-id-utils.js';
import { NAMEPLATE_CONFIGS, applyNameplateImage } from '../settings.js';

export class VNDialogBuilder {
    constructor(scene) {
        /** @type {import('./visual-novel-scene.js').VisualNovelScene} */
        this._scene = scene;
        this._dialog = null;
        this._scaleDialog = null;
        this._presetSearchQuery = '';
        this._presetSceneFilter = false;
        this._presetViewMode = 'list';
        this._presetSortMode = 'newest';
        this._ioViewMode = 'detailed';
        this._ioFoundModules = [];
        this._ioSelectedModuleId = null;
        this._ioModulePresets = [];
        this._dialogAbortCtrl = null;
        this._dropZones = null;
        this._dragEls = null;
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
        const presetsHTML = this._generatePresetsSection(sorted);
        const ioHTML = this._generateIOSection(sorted);
        const dialogContent = this._generateContent(tokens, isEdit ? scene.state : null, presetsHTML, ioHTML);

        let savedSize;
        try { savedSize = JSON.parse(localStorage.getItem(VNDialogBuilder._DIALOG_SIZE_KEY) || 'null'); } catch {}
        const dialogPosition = (savedSize?.width >= 600 && savedSize?.height >= 400)
            ? { width: savedSize.width, height: savedSize.height }
            : { width: 1050, height: 840 };

        const dialog = new foundry.applications.api.DialogV2({
            window: { title: isEdit ? '✏️ Изменить сцену' : '🎭 Создать диалоговую сцену', icon: isEdit ? 'fas fa-edit' : 'fas fa-theater-masks', resizable: true },
            position: dialogPosition,
            content: dialogContent,
            buttons: [
                { action: 'create', label: isEdit ? 'Обновить' : 'Создать', icon: isEdit ? 'fas fa-sync' : 'fas fa-play', default: true,
                    callback: (_, __, dlg) => this._handleSubmit(dlg.element, isEdit, false) },
                { action: 'background-only', label: isEdit ? 'Убрать персонажей' : 'Только фон', icon: 'fas fa-image',
                    callback: (_, __, dlg) => this._handleSubmit(dlg.element, isEdit, true) },
                { action: 'cancel', label: 'Отмена', icon: 'fas fa-times' }
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

    _handleSubmit(root, isEdit, backgroundOnly = false) {
        const getRawIds = (sel) => Array.from(root.querySelectorAll(`${sel} .vn-token-option`))
            .map(el => el.dataset.tokenId || (el.dataset.actorId ? `actor-${el.dataset.actorId}` : null)).filter(Boolean);

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
        const musicUuid = root.querySelector('#vn-music-uuid')?.value || null;
        const soundCues = this._gatherSoundCues(root);

        const hiddenIds = this._collectHiddenIds(root, allRaw, allDeduped);

        const { portraitImages, portraitNames } = backgroundOnly
            ? { portraitImages: {}, portraitNames: {} }
            : this._gatherPortraitData(root, allRaw, allDeduped);

        const pendingFlipped = root._vnPendingFlipped ?? null;
        const pendingScales = root._vnPendingScales ?? null;
        delete root._vnPendingFlipped;
        delete root._vnPendingScales;

        const gmOnly = root.querySelector('#vn-gm-only-toggle')?.checked ?? false;

        if (isEdit) this._scene.updateSceneLayout({
            leftIds: left, centerIds: center, rightIds: right,
            background: bg, backgroundOverlay: overlay,
            flipped: pendingFlipped ?? null, atmosphereEffect: effect,
            hidden: hiddenIds, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales ?? null, gmOnly,
        });
        else this._scene.createScene({
            leftIds: left, centerIds: center, rightIds: right,
            background: bg, backgroundOverlay: overlay,
            flipped: pendingFlipped || {}, atmosphereEffect: effect,
            hidden: hiddenIds, musicUuid, soundCues, portraitImages, portraitNames,
            portraitScales: pendingScales || {}, gmOnly,
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

        if (isEdit && this._scene.state.isActive) {
            requestAnimationFrame(() => {
                this._moveTokensToPositions(root, this._scene.state);
                this._setDefaults(root);
            });
        }
    }

    _setupHideButtons(root) {
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('.vn-token-hide-btn');
            if (!btn) return;
            e.stopPropagation();
            e.preventDefault();
            const tokenOpt = btn.closest('.vn-token-option');
            if (!tokenOpt || !tokenOpt.closest('.vn-token-selector')) return;
            const isHidden = tokenOpt.dataset.hidden === 'true';
            tokenOpt.dataset.hidden = String(!isHidden);
            btn.querySelector('i').className = `fas ${!isHidden ? 'fa-eye-slash' : 'fa-eye'}`;
            btn.title = !isHidden ? 'Показать персонажа' : 'Скрыть персонажа';
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
            return els.reduce((closest, child) => {
                const offset = x - child.getBoundingClientRect().left - child.offsetWidth / 2;
                return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
            }, { offset: -Infinity }).element;
        };

        const signal = this._dialogAbortCtrl?.signal;
        root.querySelectorAll('.vn-token-selector, .vn-available-tokens, .vn-favorites-section').forEach(zone => {
            if (this._dropZones?.has(zone)) return;
            this._dropZones?.add(zone);
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                zone.classList.add('drag-over');
                if (this._draggedEl?.classList.contains('vn-token-option')) {
                    const after = getAfter(zone, e.clientX);
                    after ? zone.insertBefore(this._draggedEl, after) : zone.appendChild(this._draggedEl);
                }
            }, { signal });
            zone.addEventListener('dragleave', (e) => { if (e.target === zone) zone.classList.remove('drag-over'); }, { signal });
            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (!data.internal) return;
                    root.querySelectorAll('.vn-token-option').forEach(el => el.classList.remove('selected'));
                    root.querySelectorAll('.vn-token-selector .vn-token-option').forEach(el => el.classList.add('selected'));
                    if (zone.classList.contains('vn-favorites-section') && data.actorId) {
                        await window.visualNovelScene.addToFavorites(data.actorId);
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
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({ internal: true, actorId: el.dataset.actorId, tokenId: el.dataset.tokenId }));
        }, { signal });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            this._draggedEl = null;
        }, { signal });
    }

    _setupActorsDragAndDrop(root) {
        const scene = this._scene;
        root.querySelectorAll('.vn-token-selector, .vn-favorites-section').forEach(zone => {
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
            ? '<div class="vn-favorites-empty"><i class="fas fa-arrow-down"></i> Перетащите актёров из журнала</div>'
            : scene.favoriteActors.map(id => game.actors.get(id)).filter(Boolean).map(a => VNDialogBuilder.generateActorToken(a)).join('');
        this._setupDragAndDrop(root);
    }

    // ══════════════════════════════════════════════════════════
    // Token Helpers
    // ══════════════════════════════════════════════════════════

    _findTokenElement(root, tokenId, exclude = null) {
        const baseId = stripDupSuffix(tokenId);
        let el = root.querySelector(`.vn-token-option[data-token-id="${baseId}"]`);
        if (el && exclude?.has(el)) el = null;
        const aid = parseActorId(baseId);
        if (!el && aid) {
            const candidates = root.querySelectorAll(`.vn-token-option[data-actor-id="${aid}"]`);
            el = Array.from(candidates).find(c => !exclude?.has(c)) || null;
        }
        if (!el) {
            const t = canvas?.tokens?.get(baseId);
            if (t?.actor) {
                const candidates = root.querySelectorAll(`.vn-token-option[data-actor-id="${t.actor.id}"]`);
                el = Array.from(candidates).find(c => !exclude?.has(c)) || null;
            }
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

        const defaultsUsed = new Set();
        for (const [tokenId, isHidden] of Object.entries(state.hidden ?? {})) {
            if (!isHidden) continue;
            const el = this._findTokenElement(root, tokenId, defaultsUsed);
            if (!el) continue;
            defaultsUsed.add(el);
            el.dataset.hidden = 'true';
            const i = el.querySelector('.vn-token-hide-btn i');
            if (i) i.className = 'fas fa-eye-slash';
            const btn = el.querySelector('.vn-token-hide-btn');
            if (btn) btn.title = 'Показать персонажа';
        }

        if (state.musicUuid) this._setMusicInDialog(root, state.musicUuid);
        this._applySoundCues(root, state.soundCues || []);
    }

    applyPreset(root, preset) {
        root._vnPendingFlipped = preset.flipped || {};
        root._vnPendingScales = preset.portraitScales || {};

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
        if (needed.size) this._setupDragAndDrop(root);
        this._moveTokensToPositions(root, preset);

        this._selectBackground(root, preset.background);
        const overlayCheck = root.querySelector('#background-overlay');
        if (overlayCheck) overlayCheck.checked = preset.backgroundOverlay ?? true;
        const effectSelect = root.querySelector('#atmosphere-effect');
        if (effectSelect) effectSelect.value = preset.atmosphereEffect || 'particles';

        root.querySelectorAll('.vn-token-option').forEach(el => {
            el.dataset.hidden = 'false';
            const i = el.querySelector('.vn-token-hide-btn i');
            if (i) i.className = 'fas fa-eye';
            const btn = el.querySelector('.vn-token-hide-btn');
            if (btn) btn.title = 'Скрыть персонажа';
        });
        const hiddenUsed = new Set();
        for (const [tokenId, isHidden] of Object.entries(preset.hidden ?? {})) {
            if (!isHidden) continue;
            const el = this._findTokenElement(root, tokenId, hiddenUsed);
            if (!el) continue;
            hiddenUsed.add(el);
            el.dataset.hidden = 'true';
            const i = el.querySelector('.vn-token-hide-btn i');
            if (i) i.className = 'fas fa-eye-slash';
            const btn = el.querySelector('.vn-token-hide-btn');
            if (btn) btn.title = 'Показать персонажа';
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
        const itemsHtml = this._buildPresetItemsHtml(sorted)
            || '<div class="vn-empty-hint">Нет сохранённых пресетов</div>';

        return `<div class="vn-presets-content">
            <div class="vn-presets-description"><i class="fas fa-info-circle"></i> Сохраняйте текущую расстановку персонажей и фон как пресет.</div>
            <div class="vn-preset-save-row">
                <input type="text" id="vn-preset-name" placeholder="Название пресета...">
                <button type="button" class="vn-btn vn-btn-xs vn-preset-scene-pin${hasCurrent ? ' active' : ''}" id="vn-preset-scene-pin"
                    title="${hasCurrent ? `Прикрепить к «${currentSceneName}»` : 'Нет активной сцены'}"
                    data-scene-name="${currentSceneName || ''}"${!hasCurrent ? ' disabled' : ''}>
                    <i class="fas fa-map-pin"></i>
                </button>
                <button type="button" class="vn-btn vn-btn-sm vn-btn-accent vn-preset-save-btn"><i class="fas fa-save"></i> Сохранить</button>
            </div>
            <div class="vn-preset-controls">
                <input type="text" class="vn-preset-search" placeholder="Поиск пресетов...">
                <div class="vn-preset-view-toggle">
                    <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this._presetViewMode === 'list' ? 'active' : ''}" data-view="list" title="Список"><i class="fas fa-list"></i></button>
                    <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this._presetViewMode === 'cards' ? 'active' : ''}" data-view="cards" title="Карточки"><i class="fas fa-th-large"></i></button>
                </div>
                <button type="button" class="vn-btn vn-btn-sm vn-preset-scene-filter${this._presetSceneFilter ? ' active' : ''}" title="Только пресеты сцены «${currentSceneName || 'текущую сцену'}»" data-scene-id="${currentSceneId || ''}">
                    <i class="fas fa-map"></i> Эта сцена
                </button>
                <select class="vn-preset-sort" title="Сортировка">
                    <option value="newest"${this._presetSortMode === 'newest' ? ' selected' : ''}>Новые</option>
                    <option value="oldest"${this._presetSortMode === 'oldest' ? ' selected' : ''}>Старые</option>
                    <option value="az"${this._presetSortMode === 'az' ? ' selected' : ''}>А→Я</option>
                    <option value="za"${this._presetSortMode === 'za' ? ' selected' : ''}>Я→А</option>
                </select>
                <button type="button" class="vn-btn vn-btn-sm vn-btn-danger vn-preset-clear-all" title="Удалить все пресеты">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
            <div class="vn-preset-list-header">
                <i class="fas fa-list"></i> Сохранённые пресеты <span class="vn-badge">${sorted.length}</span>
                <button type="button" class="vn-btn vn-btn-xs vn-preset-regen-all" title="Перегенерировать все пресеты (thumbnail, портреты и т.д.)"><i class="fas fa-rotate"></i> Перегенерировать все</button>
            </div>
            <div class="vn-preset-list${this._presetViewMode === 'cards' ? ' vn-preset-list--cards' : ''}">${itemsHtml}</div>
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
            const label = key || 'Без сцены';
            const items = isCards
                ? `<div class="vn-preset-cards">${group.map(p => this._buildPresetCardHtml(p)).join('')}</div>`
                : `<div class="vn-preset-group-items">${group.map(p => this._buildPresetListItemHtml(p, true)).join('')}</div>`;
            return `<div class="vn-preset-scene-group" data-group-key="${key}">
                <div class="vn-preset-scene-hdr">
                    <i class="fas fa-map-pin"></i> ${label}
                    <span class="vn-badge">${group.length}</span>
                    <div class="vn-preset-group-actions">
                        <button type="button" class="vn-btn vn-btn-xs vn-preset-group-regen" data-group-key="${key}" title="Перегенерировать группу «${label}»"><i class="fas fa-rotate"></i></button>
                        <button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-preset-group-delete" data-group-key="${key}" title="Удалить группу «${label}»"><i class="fas fa-trash-can"></i></button>
                    </div>
                </div>
                ${items}
            </div>`;
        }).join('');
    }

    _buildPresetListItemHtml(p, grouped = false) {
        const sceneTag = (!grouped && p.sceneName)
            ? `<span class="vn-preset-scene-tag"><i class="fas fa-map-pin"></i>${p.sceneName}</span>`
            : '';
        const createdStr = this._formatDate(p.createdAt || p.savedAt);
        const updatedStr = (p.updatedAt && p.updatedAt !== p.createdAt) ? this._formatDate(p.updatedAt) : null;
        const dateText = updatedStr
            ? `Создан: ${createdStr} · Обновлён: ${updatedStr}`
            : createdStr ? `Создан: ${createdStr}` : '';
        const metaHtml = (sceneTag || dateText)
            ? `<div class="vn-preset-meta">${sceneTag}<span class="vn-preset-dates">${dateText}</span></div>`
            : '';
        return `<div class="vn-preset-item" data-preset="${p.id}" data-preset-name="${p.name}" data-scene-id="${p.sceneId || ''}">
            <div class="vn-preset-info">
                <span class="vn-preset-name" title="${p.name}">${p.name}</span>
                ${metaHtml}
            </div>
            <div class="vn-preset-actions">${this._presetActionButtons(p.id)}</div>
        </div>`;
    }

    _buildPresetCardHtml(p) {
        const bgSrc = p.thumbnailData || (p.background && p.background !== 'none' ? p.background : null);
        const thumbHtml = bgSrc
            ? `<img class="vn-preset-card-img" src="${bgSrc}" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-preset-card-placeholder"><i class="fas fa-image"></i></div>`;
        const allIds = [...(p.leftIds || []), ...(p.centerIds || []), ...(p.rightIds || [])];
        const actorsHtml = this._buildActorPips(allIds, 5, p.portraitImages || {});
        return `<div class="vn-preset-card" data-preset="${p.id}" data-preset-name="${p.name}" data-scene-id="${p.sceneId || ''}">
            <div class="vn-preset-card-thumb">${thumbHtml}</div>
            <div class="vn-preset-card-body">
                <div class="vn-preset-card-name" title="${p.name}">${p.name}</div>
                ${actorsHtml ? `<div class="vn-preset-card-actors">${actorsHtml}</div>` : ''}
                <div class="vn-preset-card-actions">${this._presetActionButtons(p.id)}</div>
            </div>
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

    _collectHiddenIds(root, allRaw = null, allDeduped = null) {
        const hiddenIds = {};
        const elements = Array.from(root.querySelectorAll('#left-tokens .vn-token-option, #center-tokens .vn-token-option, #right-tokens .vn-token-option'));
        elements.forEach((el, i) => {
            if (el.dataset.hidden !== 'true') return;
            const id = (allDeduped && allRaw) ? allDeduped[i]
                : (el.dataset.tokenId || (el.dataset.actorId ? `actor-${el.dataset.actorId}` : null));
            if (id) hiddenIds[id] = true;
        });
        return hiddenIds;
    }

    _gatherDialogState(root) {
        const scene = this._scene;
        const getRawIds = (sel) => Array.from(root.querySelectorAll(`${sel} .vn-token-option`))
            .map(el => el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || null).filter(Boolean);
        const allRaw = [...getRawIds('#left-tokens'), ...getRawIds('#center-tokens'), ...getRawIds('#right-tokens')];
        const allDeduped = VNDialogBuilder._deduplicateIds(allRaw);
        const leftCount = root.querySelectorAll('#left-tokens .vn-token-option').length;
        const centerCount = root.querySelectorAll('#center-tokens .vn-token-option').length;

        const hiddenIds = this._collectHiddenIds(root, allRaw, allDeduped);
        const { portraitImages, portraitNames } = this._gatherPortraitData(root, allRaw, allDeduped);
        const state = new VNSceneState();
        state.fromPayload({
            leftIds: allDeduped.slice(0, leftCount),
            centerIds: allDeduped.slice(leftCount, leftCount + centerCount),
            rightIds: allDeduped.slice(leftCount + centerCount),
            background: root.querySelector('input[name="background"]:checked')?.value || null,
            backgroundOverlay: root.querySelector('#background-overlay')?.checked ?? true,
            atmosphereEffect: root.querySelector('#atmosphere-effect')?.value || 'particles',
            portraitScale: scene.state.portraitScale,
            portraitScales: scene.state.isActive ? { ...scene.state.portraitScales } : {},
            hidden: hiddenIds,
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
        });
        return state;
    }

    _applyPresetFilters(root) {
        const q = this._presetSearchQuery.toLowerCase();
        const filterScene = this._presetSceneFilter;
        const currentSceneId = root.querySelector('.vn-preset-scene-filter')?.dataset.sceneId || null;
        let anyVisible = false;

        root.querySelectorAll('.vn-preset-item, .vn-preset-card').forEach(item => {
            const name = (item.dataset.presetName || '').toLowerCase();
            const matchSearch = !q || name.includes(q);
            const matchScene = !filterScene || item.dataset.sceneId === currentSceneId;
            const visible = matchSearch && matchScene;
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
            hint.textContent = filterScene ? 'Нет пресетов для текущей сцены' : 'Ничего не найдено';
        } else {
            hint?.remove();
        }
    }

    static PRESET_ACTIONS = [
        { action: 'launch', icon: 'fa-play',           extra: 'vn-btn-accent', title: 'Запустить сцену' },
        { action: 'load',   icon: 'fa-upload',         extra: '',              title: 'Загрузить в диалог' },
        { action: 'update', icon: 'fa-arrows-rotate',  extra: '',              title: 'Обновить из диалога' },
        { action: 'regen',  icon: 'fa-rotate',         extra: '',              title: 'Перегенерировать пресет' },
        { action: 'assign', icon: 'fa-map-pin',        extra: '',              title: 'Изменить сцену' },
        { action: 'rename', icon: 'fa-pen',            extra: '',              title: 'Переименовать' },
        { action: 'delete', icon: 'fa-trash',          extra: 'vn-btn-danger', title: 'Удалить' },
    ];

    _presetBtn(action, presetId, icon, extraClass = '', title = '') {
        return `<button type="button" class="vn-btn vn-btn-xs ${extraClass} vn-preset-action" data-action="${action}" data-preset="${presetId}" title="${title}"><i class="fas ${icon}"></i></button>`;
    }

    _presetActionButtons(presetId) {
        return VNDialogBuilder.PRESET_ACTIONS.map(a => this._presetBtn(a.action, presetId, a.icon, a.extra, a.title)).join('');
    }

    _attachPresetListeners(root) {
        this._attachPresetControlListeners(root);
        this._attachPresetItemListeners(root);
    }

    _attachPresetControlListeners(root) {
        if (root._presetControlsAttached) return;
        root._presetControlsAttached = true;
        const signal = this._dialogAbortCtrl?.signal;

        root.querySelector('.vn-preset-search')?.addEventListener('input', (e) => {
            this._presetSearchQuery = e.target.value.trim();
            this._applyPresetFilters(root);
        }, { signal });

        const filterBtn = root.querySelector('.vn-preset-scene-filter');
        filterBtn?.addEventListener('click', () => {
            this._presetSceneFilter = !this._presetSceneFilter;
            filterBtn.classList.toggle('active', this._presetSceneFilter);
            this._applyPresetFilters(root);
        }, { signal });

        root.querySelectorAll('.vn-preset-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._presetViewMode = btn.dataset.view;
                root.querySelectorAll('.vn-preset-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === this._presetViewMode));
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
                window: { title: 'Удалить все пресеты' },
                classes: ['vn-confirm-dialog'],
                content: `<p>Удалить все <strong>${count}</strong> пресетов? Это действие необратимо.</p>`,
                yes: { label: 'Удалить все', icon: 'fas fa-trash-can' },
                no: { label: 'Отмена' },
            });
            if (!confirmed) return;
            await game.settings.set(MODULE_ID, VNPresets.SETTING_KEY, {});
            this._refreshPresetList(root);
            this._rebuildExportList(root);
        }, { signal });

        const pinBtn = root.querySelector('#vn-preset-scene-pin');
        pinBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            pinBtn.classList.toggle('active');
            const isActive = pinBtn.classList.contains('active');
            const sceneName = pinBtn.dataset.sceneName;
            pinBtn.title = isActive ? `Прикрепить к «${sceneName}»` : 'Сохранить без сцены';
        }, { signal });

        root.querySelector('.vn-preset-save-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const nameInput = root.querySelector('#vn-preset-name');
            const name = nameInput?.value?.trim();
            if (!name) return;
            const attachScene = root.querySelector('#vn-preset-scene-pin')?.classList.contains('active') ?? true;
            await VNPresets.save(name, this._gatherDialogState(root), attachScene);
            nameInput.value = '';
            this._refreshPresetList(root);
        }, { signal });

        const regenAllBtn = root.querySelector('.vn-preset-regen-all');
        regenAllBtn?.addEventListener('click', async (e) => {
            e.preventDefault();
            regenAllBtn.disabled = true;
            const count = await VNPresets.regenerate();
            ui.notifications.info(`Перегенерировано ${count} пресетов`);
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

            const actionBtn = e.target.closest('.vn-preset-action[data-action]');
            if (actionBtn) {
                await this._handlePresetAction(actionBtn.dataset.action, actionBtn.dataset.preset, actionBtn, root);
                return;
            }
            const groupDeleteBtn = e.target.closest('.vn-preset-group-delete');
            if (groupDeleteBtn) { await this._handleGroupDelete(groupDeleteBtn, root); return; }
            const groupRegenBtn = e.target.closest('.vn-preset-group-regen');
            if (groupRegenBtn) { await this._handleGroupRegen(groupRegenBtn, root); }
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
                const presetName = btn.closest('.vn-preset-item, .vn-preset-card')?.dataset.presetName || '';
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: 'Обновить пресет' },
                    classes: ['vn-confirm-dialog'],
                    content: `<p>Перезаписать пресет «<strong>${presetName}</strong>» текущими настройками диалога?</p>`,
                    yes: { label: 'Обновить', icon: 'fas fa-arrows-rotate' },
                    no: { label: 'Отмена' },
                });
                if (!confirmed) return;
                const sorted = await VNPresets.update(presetId, this._gatherDialogState(root));
                this._refreshPresetList(root, sorted);
                break;
            }
            case 'rename':
                this._handlePresetRename(btn, presetId, root);
                break;
            case 'delete': {
                const presetName = btn.closest('.vn-preset-item, .vn-preset-card')?.dataset.presetName || '';
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: 'Удалить пресет' },
                    classes: ['vn-confirm-dialog'],
                    content: `<p>Удалить пресет «<strong>${presetName}</strong>»?</p>`,
                    yes: { label: 'Удалить', icon: 'fas fa-trash' },
                    no: { label: 'Отмена' },
                });
                if (!confirmed) return;
                await VNPresets.delete(presetId);
                this._refreshPresetList(root);
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
                    buttons.push({ action: 'assign', label: `К «${curName}»`, icon: 'fas fa-map-pin', default: true });
                if (preset.sceneId)
                    buttons.push({ action: 'unlink', label: 'Открепить от сцены', icon: 'fas fa-link-slash', default: !curId || !!alreadyOnCurrent });
                buttons.push({ action: 'cancel', label: 'Отмена', icon: 'fas fa-times' });

                if (!curId && !preset.sceneId) { ui.notifications.warn('Нет активной сцены для прикрепления'); return; }

                const presetSceneHtml = preset.sceneName ? `<p style="margin:4px 0">Сцена пресета: <strong>${preset.sceneName}</strong></p>` : '';
                const curSceneHtml = curName ? `<p style="margin:4px 0">Текущая сцена: <strong>${curName}</strong></p>` : '';

                const choice = await new Promise(resolve => {
                    const dlg = new foundry.applications.api.DialogV2({
                        window: { title: `Изменить сцену: «${preset.name}»` },
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
                ui.notifications.info('Пресет перегенерирован');
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

    async _handleGroupDelete(btn, root) {
        const groupKey = btn.dataset.groupKey;
        const label = groupKey || 'Без сцены';
        const count = btn.closest('.vn-preset-scene-group')?.querySelectorAll('.vn-preset-item, .vn-preset-card').length || 0;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: 'Удалить группу' },
            classes: ['vn-confirm-dialog'],
            content: `<p>Удалить все <strong>${count}</strong> пресетов группы «<strong>${label}</strong>»? Это действие необратимо.</p>`,
            yes: { label: 'Удалить группу', icon: 'fas fa-trash-can' },
            no: { label: 'Отмена' },
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
        ui.notifications.info(`Перегенерировано ${count} пресетов`);
        this._refreshPresetList(root);
        this._rebuildExportList(root);
    }

    async _refreshPresetList(root, sorted = null) {
        if (!sorted) sorted = await VNPresets.getSorted();
        const listEl = root.querySelector('.vn-preset-list');
        if (!listEl) return;

        const badge = root.querySelector('.vn-preset-list-header .vn-badge');
        if (badge) badge.textContent = sorted.length;

        listEl.classList.toggle('vn-preset-list--cards', this._presetViewMode === 'cards');
        listEl.innerHTML = sorted.length === 0
            ? '<div class="vn-empty-hint">Нет сохранённых пресетов</div>'
            : this._buildPresetItemsHtml(sorted);

        this._attachPresetListeners(root);
        this._applyPresetFilters(root);
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
                <div class="vn-music-label"><i class="fas fa-play-circle"></i> Звуки сцены</div>
                <p class="vn-cues-hint">Треки, которые ГМ может запускать прямо со сцены (кнопка в тулбаре).</p>
                <div class="vn-cue-drop-zone" id="vn-cue-drop">
                    <i class="fas fa-plus-circle"></i>
                    <span>Перетащите треки из плейлиста</span>
                </div>
                <div class="vn-cue-list" id="vn-cue-list">${cuesHtml}</div>
            </div>
        </div>`;
    }

    _buildCueItemHtml(cue) {
        return `<div class="vn-cue-item" data-cue-id="${cue.id}" data-cue-uuid="${cue.uuid}">
            <i class="fas fa-music vn-cue-icon"></i>
            <input type="text" class="vn-cue-label-input" value="${cue.label || ''}" placeholder="Название...">
            <button type="button" class="vn-btn vn-btn-xs vn-cue-delete" title="Удалить"><i class="fas fa-times"></i></button>
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
            <div class="vn-music-label"><i class="fas fa-music"></i> Музыка сцены</div>
            <div class="vn-music-drop-zone" id="vn-music-drop"${hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span>Перетащите трек из плейлиста</span>
            </div>
            <div class="vn-music-selected" id="vn-music-selected"${!hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span class="vn-music-name" id="vn-music-name">${nameText}</span>
                <button type="button" class="vn-music-clear" id="vn-music-clear" title="Убрать музыку"><i class="fas fa-times"></i></button>
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
            window: { title: 'Размер портретов', icon: 'fas fa-expand-arrows-alt' },
            position: { width: 380, height: 'auto' },
            content: `<div class="vn-scale-dialog">
                <div class="vn-scale-header"><label>Масштаб</label><span class="vn-scale-value" id="scale-value">${currentPercent}%</span></div>
                <input type="range" id="portrait-scale-slider" name="scaleSlider" min="50" max="200" step="5" value="${currentPercent}">
                <div class="vn-scale-presets">${presets.map(v => `<button type="button" class="vn-btn vn-scale-preset ${v === currentPercent ? 'active' : ''}" data-scale="${v}">${v}%</button>`).join('')}</div>
            </div>`,
            buttons: [
                { action: 'apply', label: 'Для всех', icon: 'fas fa-check', default: true,
                    callback: (_, button) => scene.setPortraitScale(parseInt(button.form.elements.scaleSlider.value) / 100, true) },
                { action: 'cancel', label: 'Отмена', icon: 'fas fa-times' }
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
        const currentMusicUuid = sceneState?.musicUuid || null;
        const currentSoundCues = sceneState?.soundCues || [];

        const favHTML = scene.favoriteActors.map(id => game.actors.get(id)).filter(Boolean).map(a => VNDialogBuilder.generateActorToken(a)).join('');
        const tokensHTML = tokens.map(t => `<div class="vn-token-option" draggable="true" data-token-id="${t.id}" data-actor-id="${t.actor.id}" data-type="token" data-hidden="false">
            <button type="button" class="vn-token-hide-btn" title="Скрыть персонажа" draggable="false"><i class="fas fa-eye"></i></button>
            <div class="vn-token-preview"><img src="${t.actor.img || t.document.texture.src}" alt="${t.name}" loading="lazy"><div class="vn-token-name">${t.name}</div></div></div>`).join('');

        return `<div class="vn-scene-dialog">
            <div class="vn-tabs">
                <button type="button" class="vn-tab-btn active" data-tab="characters"><i class="fas fa-users"></i> Персонажи</button>
                <button type="button" class="vn-tab-btn" data-tab="background"><i class="fas fa-image"></i> Фон</button>
                <button type="button" class="vn-tab-btn" data-tab="music"><i class="fas fa-music"></i> Музыка</button>
                <button type="button" class="vn-tab-btn" data-tab="presets"><i class="fas fa-bookmark"></i> Пресеты</button>
                <button type="button" class="vn-tab-btn" data-tab="adventure-io"><i class="fas fa-boxes-stacked"></i> Приключения</button>
                <label class="vn-gm-only-toggle" title="Сцена будет видна только вам. Нажмите «Показать игрокам» на самой сцене, чтобы открыть всем.">
                    <input type="checkbox" id="vn-gm-only-toggle">
                    <i class="fas fa-eye-slash"></i> Только ГМ
                </label>
            </div>
            <div class="vn-tab-panel active" data-tab="characters">
                <div class="vn-dialog-layout">
                    <div class="vn-dialog-main">
                        <details class="vn-collapsible" open>
                            <summary class="vn-collapsible-header"><i class="fas fa-map-marker-alt"></i> Доступные на сцене <span class="vn-badge">${tokens.length}</span><i class="fas fa-chevron-down vn-chevron"></i></summary>
                            <div class="vn-collapsible-body"><div class="vn-available-tokens" id="available-tokens">${tokensHTML || '<div class="vn-empty-hint">Нет токенов на текущей сцене</div>'}</div></div>
                        </details>
                        <div class="vn-positions-grid">
                            ${this._positionSection('left', 'Лево', 'fa-arrow-left', '← дальше | ближе →')}
                            ${this._positionSection('center', 'Центр', 'fa-bullseye')}
                            ${this._positionSection('right', 'Право', 'fa-arrow-right', '← ближе | дальше →')}
                        </div>
                    </div>
                    <div class="vn-dialog-sidebar">
                        <div class="vn-favorites-panel">
                            <div class="vn-panel-header"><i class="fas fa-star"></i> Избранное</div>
                            <div class="vn-favorites-section">${favHTML || '<div class="vn-favorites-empty"><i class="fas fa-arrow-down"></i> Перетащите актёров из журнала</div>'}</div>
                            <div class="vn-favorites-hint"><i class="fas fa-mouse-pointer"></i> ПКМ — удалить</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="vn-tab-panel" data-tab="background">
                ${scene._bgManager.generateSelector(currentBg, currentOverlay, currentEffect)}
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
            ? '<div class="vn-empty-hint">Нет пресетов для экспорта</div>'
            : '';

        return `<div class="vn-io-tab">
            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-file-export"></i> Экспорт пресетов</div>
                <div class="vn-io-controls">
                    <div class="vn-io-view-toggle">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this._ioViewMode === 'detailed' ? 'active' : ''}" data-view="detailed">Подробно</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this._ioViewMode === 'compact' ? 'active' : ''}" data-view="compact">Компактно</button>
                    </div>
                    <div class="vn-io-bulk-btns">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-check-all" data-section="export">Все</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-uncheck-all" data-section="export">Снять</button>
                    </div>
                </div>
                <div class="vn-io-preset-list" id="vn-io-export-list">${exportEmpty || exportList}</div>
                <div class="vn-io-export-footer">
                    <div class="vn-io-module-input-row">
                        <label class="vn-io-label"><i class="fas fa-cube"></i> Модуль</label>
                        ${this._buildModuleSelect()}
                    </div>
                    <div class="vn-io-module-input-row">
                        <label class="vn-io-label"><i class="fas fa-id-badge"></i> Плашка</label>
                        ${this._buildNameplateSelect()}
                    </div>
                    <div class="vn-io-module-input-row">
                        <label class="vn-io-label"><i class="fas fa-folder-open"></i> Папка фонов</label>
                        <div class="vn-io-folder-row">
                            <input type="text" id="vn-io-export-folder" class="vn-io-select" placeholder="Папка с изображениями (необязательно)"
                                   value="${this._scene?._bgManager?.constructor?.getCustomFolder?.() || ''}">
                            <button type="button" class="vn-btn vn-btn-xs" id="vn-io-pick-folder-btn" title="Выбрать папку"><i class="fas fa-search"></i></button>
                        </div>
                    </div>
                    <div class="vn-io-export-btns">
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" id="vn-io-export-btn">
                            <i class="fas fa-file-export"></i> <span id="vn-io-export-label">В модуль</span>
                        </button>
                        <button type="button" class="vn-btn vn-btn-sm" id="vn-io-export-file-btn">
                            <i class="fas fa-download"></i> Скачать JSON
                        </button>
                    </div>
                </div>
            </div>

            <div class="vn-io-divider"></div>

            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-file-import"></i> Импорт из модуля-приключения</div>
                <div class="vn-io-scan-row">
                    <button type="button" class="vn-btn vn-btn-sm" id="vn-io-scan-btn">
                        <i class="fas fa-magnifying-glass"></i> Найти модули приключений
                    </button>
                    <span class="vn-io-scan-hint">Ищет активные модули с флагом player-queue</span>
                </div>
                <div id="vn-io-modules-list" class="vn-io-modules-list"></div>
                <div id="vn-io-import-presets" class="vn-io-preset-list"></div>
                <div class="vn-io-import-footer" id="vn-io-import-footer" hidden>
                    <div class="vn-io-bulk-btns">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-check-all" data-section="import">Все</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-uncheck-all" data-section="import">Снять</button>
                    </div>
                    <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" id="vn-io-import-btn">
                        <i class="fas fa-file-import"></i> <span id="vn-io-import-label">Импортировать выбранные</span>
                    </button>
                </div>
            </div>

            <div class="vn-io-divider"></div>

            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-upload"></i> Импорт из файла JSON</div>
                <div class="vn-io-scan-row">
                    <button type="button" class="vn-btn vn-btn-sm" id="vn-io-import-file-btn">
                        <i class="fas fa-folder-open"></i> Выбрать файл .json
                    </button>
                    <input type="file" id="vn-io-file-input" accept=".json" style="display:none">
                    <span class="vn-io-scan-hint">Загрузить ранее сохранённые пресеты из файла</span>
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
                    : `${m.title || m.id} (${m.id}) — неактивен`;
                return `<option value="${m.id}">${label}</option>`;
            })
            .join('');
        return `<select id="vn-io-module-id" class="vn-io-select">
            <option value="">— выберите модуль —</option>
            ${options || '<option disabled>Нет активных модулей</option>'}
        </select>`;
    }

    _buildNameplateSelect() {
        const current = (() => { try { return game.settings.get(MODULE_ID, 'nameplateImage') || ''; } catch { return ''; } })();
        const opts = Object.entries(NAMEPLATE_CONFIGS).map(([path, cfg]) =>
            `<option value="${path}" ${path === current ? 'selected' : ''}>${cfg.label || path.split('/').pop().replace(/\.[^.]+$/, '')}</option>`
        ).join('');
        return `<select id="vn-io-nameplate" class="vn-io-select">
            <option value="" ${!current ? 'selected' : ''}>— не указывать —</option>
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
            const label = key || 'Без сцены';
            const items = this._ioViewMode === 'compact'
                ? group.map(p => this._buildIORowCompact(p, idPrefix, allChecked)).join('')
                : group.map(p => this._buildIOCardDetailed(p, idPrefix, allChecked)).join('');
            return `<div class="vn-io-scene-group">
                <div class="vn-io-scene-header">
                    <label class="vn-io-group-check-label" title="Выбрать группу">
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
        const allIds = [...(preset.leftIds || []), ...(preset.centerIds || []), ...(preset.rightIds || [])];
        const actorsHtml = this._buildActorPips(allIds, 4);
        const bgSrc = preset.thumbnailData || (preset.background && preset.background !== 'none' ? preset.background : null);
        const thumbHtml = bgSrc
            ? `<img class="vn-io-card-bg-img" src="${bgSrc}" width="160" height="100" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-io-card-bg-placeholder"><i class="fas fa-image"></i></div>`;

        return `<div class="vn-io-card" data-preset-id="${preset.id}">
            <div class="vn-io-card-thumb">${thumbHtml}</div>
            <div class="vn-io-card-body">
                <div class="vn-io-card-name" title="${preset.name}">${preset.name}</div>
                ${actorsHtml ? `<div class="vn-io-card-actors">${actorsHtml}</div>` : ''}
                <label class="vn-io-card-check"><input type="checkbox" class="vn-io-preset-cb" id="${cbId}" value="${preset.id}"${checked ? ' checked' : ''}></label>
            </div>
        </div>`;
    }

    _buildIORowCompact(preset, idPrefix, checked) {
        const cbId = `${idPrefix}-cb-${preset.id}`;
        const sceneTag = preset.sceneName
            ? `<span class="vn-io-row-scene"><i class="fas fa-map-pin"></i>${preset.sceneName}</span>` : '';
        return `<div class="vn-io-row" data-preset-id="${preset.id}">
            <label class="vn-io-row-check"><input type="checkbox" class="vn-io-preset-cb" id="${cbId}" value="${preset.id}"${checked ? ' checked' : ''}></label>
            <span class="vn-io-row-name" title="${preset.name}">${preset.name}</span>
            ${sceneTag}
        </div>`;
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
                if (a) return a.img || a.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg';
                return portraitImages[id] || 'icons/svg/mystery-man.svg';
            }
            const t = canvas.tokens?.get(id);
            return t?.actor?.img || portraitImages[id] || 'icons/svg/mystery-man.svg';
        } catch { return portraitImages[id] || 'icons/svg/mystery-man.svg'; }
    }

    _updateIOExportCounter(root) {
        const checked = root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked').length;
        const label = root.querySelector('#vn-io-export-label');
        if (label) label.textContent = checked > 0 ? `Экспортировать выбранные (${checked})` : 'Экспортировать выбранные';
    }

    _updateIOImportCounter(root) {
        const checked = root.querySelectorAll('#vn-io-import-presets .vn-io-preset-cb:checked').length;
        const label = root.querySelector('#vn-io-import-label');
        if (label) label.textContent = checked > 0 ? `Импортировать выбранные (${checked})` : 'Импортировать выбранные';
    }

    _renderModulesList(root) {
        const listEl = root.querySelector('#vn-io-modules-list');
        if (!listEl) return;
        if (!this._ioFoundModules.length) {
            listEl.innerHTML = '<div class="vn-empty-hint">Модулей с пресетами не найдено</div>';
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
                nameplateLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-nameplate" data-module-id="${m.id}" title="Установить плашку «${nameplateLabel}»"><i class="fas fa-id-badge"></i> ${nameplateLabel}</button>` : '',
                folderLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-folder" data-module-id="${m.id}" title="Установить папку фонов «${m.backgroundFolder}»"><i class="fas fa-folder-open"></i> ${folderLabel}</button>` : '',
            ].filter(Boolean).join('');
            return `<div class="vn-io-module-item ${this._ioSelectedModuleId === m.id ? 'active' : ''}" data-module-id="${m.id}">
                <div class="vn-io-module-info">
                    <span class="vn-io-module-title">${m.title}</span>
                    <span class="vn-io-module-id">${m.id}</span>
                    ${applyBtns ? `<div class="vn-io-module-apply-row">${applyBtns}</div>` : ''}
                </div>
                <button type="button" class="vn-btn vn-btn-xs vn-io-load-module" data-module-id="${m.id}">
                    <i class="fas fa-download"></i> Загрузить
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
            listEl.innerHTML = '<div class="vn-empty-hint">Нет пресетов в этом модуле</div>';
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
                this._ioModulePresets = await VNAdventureIO.fetchPresets(moduleId, mod.presetsFile);
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
                ui.notifications.info('Плашка установлена');
            });
        });

        root.querySelectorAll('.vn-io-apply-folder').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this._ioFoundModules.find(m => m.id === moduleId);
                if (!mod?.backgroundFolder) return;
                await game.settings.set(MODULE_ID, 'backgroundFolder', mod.backgroundFolder);
                ui.notifications.info(`Папка фонов установлена: ${mod.backgroundFolder}`);
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
                : '<div class="vn-empty-hint">Нет пресетов для экспорта</div>';
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
            if (!moduleId) { ui.notifications.warn('Укажите ID модуля'); return; }
            const ids = [...root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked')].map(cb => cb.value);
            if (!ids.length) { ui.notifications.warn('Выберите хотя бы один пресет'); return; }
            const all = await VNPresets.getAll();
            const toExport = ids.map(id => all[id]).filter(Boolean);
            const nameplate = root.querySelector('#vn-io-nameplate')?.value || '';
            const backgroundFolder = root.querySelector('#vn-io-export-folder')?.value?.trim() || '';
            try {
                await VNAdventureIO.exportToModule(toExport, moduleId);
                ui.notifications.info(`Экспортировано ${toExport.length} пресетов в modules/${moduleId}/vn-presets.json`);
                this._showExportInstructions(moduleId, { nameplate, backgroundFolder });
            } catch (err) {
                ui.notifications.error(`Ошибка экспорта: ${err.message}`);
            }
        });

        // Scan modules
        root.querySelector('#vn-io-scan-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._ioFoundModules = VNAdventureIO.scanModules();
            this._ioSelectedModuleId = null;
            this._ioModulePresets = [];
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
            if (!toExport.length) { ui.notifications.warn('Нет пресетов для скачивания'); return; }
            VNAdventureIO.exportToFile(toExport);
            ui.notifications.info(`Скачивание ${toExport.length} пр.…`);
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
                if (!presets.length) { ui.notifications.warn('Файл не содержит пресетов'); return; }

                const { fresh, dupes } = await VNAdventureIO.classifyImport(presets);
                const hasDupes = dupes.length > 0;
                const msg = hasDupes
                    ? `В файле ${presets.length} пр. (${fresh.length} новых, ${dupes.length} совп.).`
                    : `В файле ${presets.length} пр. Все новые.`;

                const choice = await new Promise(resolve => {
                    const buttons = [
                        { action: 'fresh', label: 'Только новые', icon: 'fas fa-plus', default: true },
                        ...(hasDupes ? [{ action: 'overwrite', label: 'Перезаписать дубли', icon: 'fas fa-sync' }] : []),
                        { action: 'replace', label: 'Заменить всё', icon: 'fas fa-trash' },
                    ];
                    const dlg = new foundry.applications.api.DialogV2({
                        window: { title: 'Импорт из файла JSON' },
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

                let added = 0;
                if (choice === 'replace') {
                    await VNPresets.replaceAll(presets);
                    added = presets.length;
                } else if (choice === 'overwrite') {
                    added = await VNAdventureIO.mergeImport(fresh);
                    await VNAdventureIO.mergeImport(dupes, true);
                    added += dupes.length;
                } else {
                    added = await VNAdventureIO.mergeImport(fresh);
                }
                ui.notifications.info(`Импортировано ${added} пресетов`);
                this._refreshPresetList(root);
                this._rebuildExportList(root);
            } catch (err) {
                ui.notifications.error(`Ошибка чтения файла: ${err.message}`);
            }
        });

        // Import button
        root.querySelector('#vn-io-import-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const ids = [...root.querySelectorAll('#vn-io-import-presets .vn-io-preset-cb:checked')].map(cb => cb.value);
            if (!ids.length) { ui.notifications.warn('Выберите хотя бы один пресет'); return; }
            const toImport = this._ioModulePresets.filter(p => ids.includes(p.id));

            const { fresh, dupes } = await VNAdventureIO.classifyImport(toImport);

            if (!dupes.length) {
                const added = await VNAdventureIO.mergeImport(fresh);
                ui.notifications.info(`Импортировано ${added} пресетов`);
                this._refreshPresetList(root);
                return;
            }

            const bodyLines = [
                fresh.length ? `<b>${fresh.length}</b> новых пресетов будет добавлено.` : null,
                `<b>${dupes.length}</b> уже существуют в мире.`,
            ].filter(Boolean).map(l => `<p style="margin:4px 0">${l}</p>`).join('');

            const buttons = [
                ...(fresh.length ? [{ action: 'new-only', label: `Только новые (${fresh.length})`, icon: 'fas fa-plus', default: true }] : []),
                { action: 'overwrite', label: `Перезаписать все (${toImport.length})`, icon: 'fas fa-sync', default: !fresh.length },
                { action: 'cancel', label: 'Отмена', icon: 'fas fa-times' },
            ];

            const choice = await new Promise(resolve => {
                const dlg = new foundry.applications.api.DialogV2({
                    window: { title: 'Импорт пресетов' },
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

            const presetsToImport = choice === 'new-only' ? fresh : toImport;
            const added = await VNAdventureIO.mergeImport(presetsToImport, choice === 'overwrite');
            ui.notifications.info(`Импортировано ${added} пресетов`);
            this._refreshPresetList(root);
        });
    }

    _showExportInstructions(moduleId, opts = {}) {
        const snippet = VNAdventureIO.moduleJsonSnippet(opts);
        const notesHtml = [
            opts.nameplate ? `<li>Плашка: <code>${opts.nameplate.split('/').pop()}</code></li>` : '',
            opts.backgroundFolder ? `<li>Папка фонов: <code>${opts.backgroundFolder}</code></li>` : '',
        ].filter(Boolean).join('');

        const dialog = new foundry.applications.api.DialogV2({
            window: { title: 'Экспорт завершён', icon: 'fas fa-check-circle' },
            classes: ['vn-instructions-dialog'],
            position: { width: 520 },
            content: `<div class="vn-io-instructions">
                <p><i class="fas fa-check-circle" style="color:var(--vn-success)"></i>
                Файл <code>vn-presets.json</code> сохранён в
                <code>modules/${moduleId}/integrations/player-queue/</code>.</p>
                ${notesHtml ? `<ul style="margin:4px 0 8px;padding-left:1.4em;font-size:0.85em">${notesHtml}</ul>` : ''}
                <p>Добавьте в <code>module.json</code> вашего модуля:</p>
                <div class="vn-io-snippet-wrapper">
                    <pre class="vn-io-snippet" id="vn-io-snippet-text">${snippet}</pre>
                    <button type="button" class="vn-btn vn-btn-xs vn-io-copy-btn" id="vn-io-copy-snippet">
                        <i class="fas fa-copy"></i> Скопировать
                    </button>
                </div>
                <p class="vn-io-hint"><i class="fas fa-triangle-exclamation"></i>
                После изменения <code>module.json</code> потребуется перезапуск сервера Foundry.</p>
            </div>`,
            buttons: [{ action: 'ok', label: 'Понятно', icon: 'fas fa-check', default: true }],
        });
        dialog.addEventListener('render', () => {
            dialog.element.querySelector('#vn-io-copy-snippet')?.addEventListener('click', async (e) => {
                e.preventDefault();
                await navigator.clipboard.writeText(snippet);
                const btn = dialog.element.querySelector('#vn-io-copy-snippet');
                if (!btn) return;
                btn.innerHTML = '<i class="fas fa-check"></i> Скопировано!';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Скопировать'; }, 2000);
            });
        });
        dialog.render({ force: true });
    }

    // ══════════════════════════════════════════════════════════
    // Static Helpers
    // ══════════════════════════════════════════════════════════

    static generateActorToken(actor) {
        const id = actor.id || actor._id;
        const img = actor.img || actor.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg';
        return `<div class="vn-token-option" draggable="true" data-actor-id="${id}" data-token-id="" data-type="actor" data-hidden="false">
            <button type="button" class="vn-token-hide-btn" title="Скрыть персонажа" draggable="false"><i class="fas fa-eye"></i></button>
            <div class="vn-token-preview"><img src="${img}" alt="${actor.name}" loading="lazy"><div class="vn-token-name">${actor.name}</div></div></div>`;
    }
}

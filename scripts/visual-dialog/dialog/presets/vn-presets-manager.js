// ============================================================
// vn-presets-manager.js — вкладка "Пресеты": сохранение/загрузка сцен
// ============================================================

import { promptDialog } from '../../../utils/dialog.js';
import { filePickerImplementation } from '../../../utils/file-picker.js';
import { VNPresets } from '../../presets/vn-presets.js';
import { VNFolders } from '../../presets/vn-folders.js';
import { MODULE_ID } from '../../vn-constants.js';
import { escapeHtml } from '../../../utils/text.js';
import { presetSceneNames } from '../../presets/vn-preset-utils.js';
import { VNScenePicker } from '../vn-scene-picker.js';
import { buildEffectTestSteps } from '../../presets/vn-effect-test-steps.js';

import { VNPresetsView } from './vn-presets-view.js';
import { VNPresetsTags } from './vn-presets-tags.js';
import { VNPresetsPanel } from './vn-presets-panel.js';

const esc = escapeHtml;

const FOLDER_STORAGE_KEY = 'player-queue.vn-presets-folder';
// Foundry keeps a client-scope setting in localStorage under "<module>.<key>" (JSON) and only after it was set explicitly
const VIEW_SETTING_STORAGE_KEY = `${MODULE_ID}.vnPresetsViewMode`;

export class VNPresetsManager {
    constructor() {
        this.searchQuery = '';
        this.sceneFilter = false;
        this.viewMode = 'cards';
        this.sortMode = 'newest';
        this.groupMode = 'scenes';
        this._currentFolderId = null;
        this._hooks = null;
        this._tags = new VNPresetsTags({
            onFilter: root => this._view.applyFilters(root),
            onRefresh: (root, sorted) => this.refresh(root, sorted),
            confirm: (...args) => this._confirmDialog(...args),
        });
        this._view = new VNPresetsView(() => ({
            searchQuery: this.searchQuery, sceneFilter: this.sceneFilter,
            groupMode: this.groupMode, viewMode: this.viewMode, sortMode: this.sortMode,
            currentFolderId: this.currentFolderId, tagFilters: this._tags.filters, tagMatch: this._tags.match,
        }));
        this._panel = new VNPresetsPanel({
            getHooks: () => this._hooks ?? {},
            refresh: (root, sorted) => this.refresh(root, sorted),
            onAction: (...args) => this._handlePresetAction(...args),
            confirm: (...args) => this._confirmDialog(...args),
        });
    }

    get currentFolderId() { return this._currentFolderId; }
    set currentFolderId(id) {
        this._currentFolderId = id || null;
        try {
            if (this._currentFolderId) localStorage.setItem(FOLDER_STORAGE_KEY, this._currentFolderId);
            else localStorage.removeItem(FOLDER_STORAGE_KEY);
        } catch {}
    }

    _restoreFolderId() {
        try {
            const id = localStorage.getItem(FOLDER_STORAGE_KEY);
            return id && VNFolders.get(id) ? id : null;
        } catch { return null; }
    }

    /**
     * Cards are the default look. The setting is registered with the default "list", so a stored "list" only counts as
     * the user's own choice when the client storage really holds the entry; otherwise it is just that old default.
     */
    _restoreViewMode() {
        try {
            const raw = localStorage.getItem(VIEW_SETTING_STORAGE_KEY);
            if (raw != null) {
                const stored = JSON.parse(raw);
                if (stored === 'list' || stored === 'cards') return stored;
            }
        } catch {}
        try { if (game.settings.get(MODULE_ID, 'vnPresetsViewMode') === 'cards') return 'cards'; } catch {}
        return 'cards';
    }

    _confirmDialog(title, content, yesLabel, yesIcon) {
        return foundry.applications.api.DialogV2.confirm({
            window: { title },
            classes: ['vn-confirm-dialog'],
            content,
            yes: { label: yesLabel, icon: yesIcon },
            no: { label: game.i18n.localize('vn.dialog.btnCancel') },
        });
    }

    generateTab(sorted) {
        try { this.groupMode = game.settings.get(MODULE_ID, 'vnPresetsGroupMode') || 'scenes'; } catch {}
        this.viewMode = this._restoreViewMode();
        this._panel.selectedPresetId = null;
        this._currentFolderId = this._restoreFolderId();
        return this._view.render(sorted);
    }

    saveFormToStep(root, edit) { return this._panel.sequenceEditor.saveFormToStep(root, edit); }

    dispose(root) {
        this._tags.close(root);
        root?._vnPresetResizeObserver?.disconnect();
        cancelAnimationFrame(root?._vnPresetResizeFrame ?? 0);
        clearTimeout(root?._vnStoreTimer);
        if (root?._vnStoreHook != null) Hooks.off('vnStoreChanged', root._vnStoreHook);
        if (root) root._vnStoreHook = null;
    }

    attachListeners(root, hooks = {}) {
        this._hooks = hooks;
        this._attachControlListeners(root);
        this._attachItemListeners(root);
        this._panel.attachListeners(root);
    }

    _attachControlListeners(root) {
        if (root._presetControlsAttached) return;
        root._presetControlsAttached = true;

        root.querySelector('.vn-preset-search')?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim();
            if (this.groupMode === 'folders') {
                this.refresh(root);
            } else {
                this._view.applyFilters(root);
            }
        });

        const filterBtn = root.querySelector('.vn-preset-scene-filter');
        filterBtn?.addEventListener('click', () => {
            this.sceneFilter = !this.sceneFilter;
            filterBtn.classList.toggle('active', this.sceneFilter);
            this._view.applyFilters(root);
        });

        this._tags.attachListeners(root);
        this._tags.refresh(root);

        // The tag rows depend on the list width (window resize, panel open/close, switching to the tab, list <-> cards)
        const listEl = root.querySelector('.vn-preset-list');
        if (listEl && typeof ResizeObserver !== 'undefined') {
            root._vnPresetResizeObserver = new ResizeObserver(() => {
                cancelAnimationFrame(root._vnPresetResizeFrame ?? 0);
                root._vnPresetResizeFrame = requestAnimationFrame(() => this._view.fitTags(root));
            });
            root._vnPresetResizeObserver.observe(listEl);
        }

        // "⋯" menu: closes after choosing an item and when clicking anywhere else
        root.addEventListener('click', (e) => {
            const menu = root.querySelector('.vn-preset-menu[open]');
            if (menu && (e.target.closest('.vn-menu-item') || !menu.contains(e.target))) menu.removeAttribute('open');
        });

        root.querySelectorAll('.vn-presets-groupmode-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                this.groupMode = btn.dataset.groupmode;
                root.querySelectorAll('.vn-presets-groupmode-btn').forEach(b => b.classList.toggle('active', b.dataset.groupmode === this.groupMode));
                try { await game.settings.set(MODULE_ID, 'vnPresetsGroupMode', this.groupMode); } catch {}
                this.refresh(root);
            });
        });

        root.querySelectorAll('.vn-preset-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.viewMode = btn.dataset.view;
                root.querySelectorAll('.vn-preset-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === this.viewMode));
                try { game.settings.set(MODULE_ID, 'vnPresetsViewMode', this.viewMode); } catch {}
                this.refresh(root);
            });
        });

        root.querySelector('.vn-preset-sort')?.addEventListener('change', (e) => {
            this.sortMode = e.target.value;
            this.refresh(root);
        });

        root.querySelector('.vn-preset-clear-all')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const count = root.querySelectorAll('.vn-preset-item, .vn-preset-card').length;
            if (!count) return;
            const confirmed = await this._confirmDialog(
                game.i18n.localize('vn.dialog.deleteAllPresetsTitle'),
                `<p>${game.i18n.format('vn.dialog.deleteAllPresetsConfirm', {count})}</p>`,
                game.i18n.localize('vn.dialog.btnDeleteAll'), 'fas fa-trash-can'
            );
            if (!confirmed) return;
            await VNPresets.clearAll();
            this.refresh(root);
            this._hooks.onChanged?.(root);
        });

        root.querySelector('.vn-preset-thumb-folder')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._pickThumbnailFolder(root);
        });

        root.querySelector('.vn-preset-thumb-folder-reset')?.addEventListener('click', async (e) => {
            e.preventDefault();
            await game.settings.set(MODULE_ID, 'thumbnailFolder', '');
            ui.notifications.info(game.i18n.format('vn.dialog.thumbFolderSet', { folder: esc(VNPresets.thumbnailDir()) }));
        });

        // Changes made by another GM (or another window) while this tab is open
        if (!root._vnStoreHook) {
            root._vnStoreHook = Hooks.on('vnStoreChanged', ({ remote }) => {
                if (!root.isConnected) { Hooks.off('vnStoreChanged', root._vnStoreHook); root._vnStoreHook = null; return; }
                if (!remote) return;
                clearTimeout(root._vnStoreTimer);
                root._vnStoreTimer = setTimeout(() => {
                    // never rebuild the list under someone who is typing in it
                    if (root.querySelector('.vn-preset-list input:focus, .vn-preset-detail-panel input:focus, .vn-preset-detail-panel textarea:focus, .vn-preset-detail-panel select:focus')) return;
                    this.refresh(root);
                }, 400);
            });
        }

        const pinBtn = root.querySelector('#vn-preset-scene-pin');
        pinBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            pinBtn.classList.toggle('active');
            const isActive = pinBtn.classList.contains('active');
            const sceneName = pinBtn.dataset.sceneName;
            pinBtn.title = isActive ? game.i18n.format('vn.dialog.pinToScene', {sceneName}) : game.i18n.localize('vn.dialog.savePinWithoutScene');
        });

        root.querySelector('.vn-preset-save-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const nameInput = root.querySelector('#vn-preset-name');
            const name = nameInput?.value?.trim();
            if (!name) return;
            const attachScene = root.querySelector('#vn-preset-scene-pin')?.classList.contains('active') ?? true;
            const gatheredState = this._hooks.gatherState(root);
            const saveOpts = this.groupMode === 'folders' ? { folderId: this.currentFolderId } : {};
            const created = await VNPresets.save(name, gatheredState, attachScene, saveOpts);
            this._hooks.syncPresetActors?.(gatheredState.presetActors);
            this._hooks.onPresetCreated?.(created);
            nameInput.value = '';
            this.refresh(root);
        });

        root.querySelector('.vn-preset-new-seq-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._createSequence(root);
        });

        const effectTestBtn = root.querySelector('.vn-preset-effect-test-btn');
        effectTestBtn?.addEventListener('click', async e => {
            e.preventDefault();
            effectTestBtn.disabled = true;
            try {
                await this._createSequence(root, { effectTest: true });
            } catch (error) {
                console.error('Player Queue | Effect test preset creation failed', error);
                ui.notifications.error(game.i18n.localize('vn.sequence.effectTestFailed'));
            } finally {
                effectTestBtn.disabled = false;
            }
        });

        const regenAllBtn = root.querySelector('.vn-preset-regen-all');
        regenAllBtn?.addEventListener('click', async (e) => {
            e.preventDefault();
            regenAllBtn.disabled = true;
            const count = await VNPresets.regenerate();
            ui.notifications.info(game.i18n.format('vn.dialog.presetRegenerated', {count}));
            this.refresh(root);
            this._hooks.onChanged?.(root);
            regenAllBtn.disabled = false;
        });
    }

    /** Picks where thumbnails are written (any folder in Data, e.g. inside a module) and offers to rebuild the existing ones there. */
    async _pickThumbnailFolder(root) {
        const FPImpl = filePickerImplementation();
        const current = VNPresets.thumbnailDir();
        new FPImpl({
            type: 'folder',
            current,
            callback: async (path) => {
                const folder = String(path || '').trim();
                if (!folder || folder === current) return;
                await game.settings.set(MODULE_ID, 'thumbnailFolder', folder);
                ui.notifications.info(game.i18n.format('vn.dialog.thumbFolderSet', { folder: esc(folder) }));
                const rebuild = await this._confirmDialog(
                    game.i18n.localize('vn.dialog.thumbFolderRebuildTitle'),
                    `<p>${game.i18n.format('vn.dialog.thumbFolderRebuildConfirm', { folder: esc(folder) })}</p>`,
                    game.i18n.localize('vn.dialog.btnRegenAll'), 'fas fa-camera'
                );
                if (!rebuild) return;
                const count = await VNPresets.regenerate();
                ui.notifications.info(game.i18n.format('vn.dialog.presetRegenerated', { count }));
                this.refresh(root);
                this._hooks.onChanged?.(root);
            },
        }).browse(current);
    }

    _attachItemListeners(root) {
        const listEl = root.querySelector('.vn-preset-list');
        if (!listEl || listEl._presetItemListenerAttached) return;
        listEl._presetItemListenerAttached = true;

        listEl.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Folder breadcrumb nav
            const breadcrumbSeg = e.target.closest('.vn-folder-breadcrumb-seg');
            if (breadcrumbSeg) {
                this.currentFolderId = breadcrumbSeg.dataset.folderId || null;
                this.refresh(root);
                return;
            }

            // Folder action buttons (check before folder item nav)
            const folderNewBtn = e.target.closest('.vn-folder-new-btn');
            if (folderNewBtn) {
                const name = await this._promptFolderName(root, game.i18n.localize('vn.folders.createFolderTitle'));
                if (name) {
                    await VNFolders.create(name, this.currentFolderId);
                    this.refresh(root);
                }
                return;
            }

            const folderFavBtn = e.target.closest('.vn-folder-fav-btn');
            if (folderFavBtn) {
                await VNFolders.toggleFavorite(folderFavBtn.dataset.folderId);
                this.refresh(root);
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
                    this.refresh(root);
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
                const confirmed = await this._confirmDialog(
                    game.i18n.localize('vn.folders.deleteFolderTitle'),
                    `<p>${game.i18n.format('vn.folders.deleteFolderConfirm', { name: esc(folder.name) })}</p>`,
                    game.i18n.localize('vn.dialog.btnDelete'), 'fas fa-trash'
                );
                if (!confirmed) return;
                await VNFolders.delete(folderId);
                if (this.currentFolderId === folderId) this.currentFolderId = folder.parentId || null;
                this.refresh(root);
                return;
            }

            // Favorites shortcut navigation
            const favShortcut = e.target.closest('.vn-folder-fav-shortcut');
            if (favShortcut) {
                this.currentFolderId = favShortcut.dataset.folderId || null;
                this.refresh(root);
                return;
            }

            // Folder navigation — click on folder item (not on a button)
            const folderItem = e.target.closest('.vn-folder-item');
            if (folderItem && !e.target.closest('button')) {
                this.currentFolderId = folderItem.dataset.folderId || null;
                this.refresh(root);
                return;
            }

            const tagChip = e.target.closest('.vn-tag-chip[data-tag]');
            if (tagChip) {
                this._tags._toggleTagFilter(root, tagChip.dataset.tag);
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
            if (item?.dataset.preset) this._panel.select(root, item.dataset.preset);
        });

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
        });

        listEl.addEventListener('dragover', (e) => {
            const target = e.target.closest('.vn-folder-item, .vn-folder-breadcrumb-seg');
            if (target) { e.preventDefault(); target.classList.add('--drag-over'); }
        });

        listEl.addEventListener('dragleave', (e) => {
            e.target.closest('.vn-folder-item, .vn-folder-breadcrumb-seg')?.classList.remove('--drag-over');
        });

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
            this.refresh(root);
        });
    }

    async _handlePresetAction(action, presetId, btn, root) {
        switch (action) {
            case 'launch': {
                const preset = await VNPresets.load(presetId);
                if (preset) this._hooks.launchScene(preset);
                break;
            }
            case 'load': {
                const preset = await VNPresets.load(presetId);
                if (preset) this._hooks.applyPreset(root, preset);
                break;
            }
            case 'update': {
                const presetName = btn.closest('[data-preset-name]')?.dataset.presetName || '';
                const confirmed = await this._confirmDialog(
                    game.i18n.localize('vn.dialog.updatePresetTitle'),
                    `<p>${game.i18n.format('vn.dialog.updatePresetConfirm', {name: esc(presetName)})}</p>`,
                    game.i18n.localize('vn.dialog.btnUpdate'), 'fas fa-arrows-rotate'
                );
                if (!confirmed) return;
                const updatedState = this._hooks.gatherState(root);
                const sorted = await VNPresets.update(presetId, updatedState);
                this._hooks.syncPresetActors?.(updatedState.presetActors);
                this.refresh(root, sorted);
                break;
            }
            case 'rename':
                this._handlePresetRename(btn, presetId, root);
                break;
            case 'delete': {
                const presetName = btn.closest('[data-preset-name]')?.dataset.presetName || '';
                const confirmed = await this._confirmDialog(
                    game.i18n.localize('vn.dialog.deletePresetTitle'),
                    `<p>${game.i18n.format('vn.dialog.deletePresetConfirm', {name: esc(presetName)})}</p>`,
                    game.i18n.localize('vn.dialog.btnDelete'), 'fas fa-trash'
                );
                if (!confirmed) return;
                await VNPresets.delete(presetId);
                this.refresh(root);
                break;
            }
            case 'duplicate': {
                const source = await VNPresets.load(presetId);
                if (!source) return;
                const copy = await VNPresets.duplicate(presetId, game.i18n.format('vn.dialog.presetCopyName', { name: source.name }));
                if (!copy) return;
                await this.refresh(root);
                await this._panel.select(root, copy.id);
                ui.notifications.info(game.i18n.format('vn.dialog.presetDuplicated', { name: copy.name }));
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
                            <textarea readonly class="vn-macro-code" rows="2" spellcheck="false">${esc(code)}</textarea>
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
                const chosen = await VNScenePicker.pick({
                    title: game.i18n.format('vn.scenePicker.title', { presetName: preset.name }),
                    linked: presetScenes(preset),
                });
                if (!chosen) return;
                const sorted = await VNPresets.setScenes(presetId, chosen);
                this.refresh(root, sorted);
                this._hooks.onChanged?.(root);
                break;
            }
            case 'regen': {
                btn.disabled = true;
                await VNPresets.regenerate([presetId]);
                ui.notifications.info(game.i18n.localize('vn.dialog.presetRegeneratedOne'));
                this.refresh(root);
                this._hooks.onChanged?.(root);
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
                this.refresh(root, sorted);
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
        const label = groupKey || game.i18n.localize('vn.dialog.noScene');
        // A preset linked to other scenes too is not deleted with this group, it only loses this scene
        const members = Object.values(await VNPresets.getAll()).filter(p => {
            const names = presetSceneNames(p);
            return groupKey ? names.includes(groupKey) : !names.length;
        });
        const shared = members.filter(p => presetSceneNames(p).length > 1).length;
        const count = members.length - shared;
        const confirmed = await this._confirmDialog(
            game.i18n.localize('vn.dialog.deleteGroupDialogTitle'),
            `<p>${game.i18n.format('vn.dialog.deleteGroupConfirm', {count, label: esc(label)})}</p>${shared ? `<p>${game.i18n.format('vn.dialog.deleteGroupShared', { count: shared })}</p>` : ''}`,
            game.i18n.localize('vn.dialog.btnDeleteGroup'), 'fas fa-trash-can'
        );
        if (!confirmed) return;
        await VNPresets.deleteGroup(groupKey);
        this.refresh(root);
        this._hooks.onChanged?.(root);
    }

    async _handleGroupRegen(btn, root) {
        btn.disabled = true;
        const ids = [...(btn.closest('.vn-preset-scene-group')?.querySelectorAll('.vn-preset-item, .vn-preset-card') || [])]
            .map(el => el.dataset.preset).filter(Boolean);
        const count = await VNPresets.regenerate(ids);
        ui.notifications.info(game.i18n.format('vn.dialog.presetRegenerated', {count}));
        this.refresh(root);
        this._hooks.onChanged?.(root);
    }

    async _createSequence(root, { effectTest = false } = {}) {
        const input = root.querySelector('#vn-preset-name');
        let name = input?.value?.trim();
        if (!name && effectTest) name = game.i18n.localize('vn.sequence.btnEffectTest');
        if (!name) {
            name = await this._promptFolderName(root, game.i18n.localize('vn.sequence.newTitle'), {
                placeholder: game.i18n.localize('vn.sequence.namePlaceholder'), icon: 'fas fa-film',
            });
        }
        if (!name) return;
        const attachScene = root.querySelector('#vn-preset-scene-pin')?.classList.contains('active') ?? true;
        const opts = this.groupMode === 'folders' ? { folderId: this.currentFolderId } : {};
        if (effectTest) {
            const sources = buildEffectTestSteps(
                this._hooks.gatherState(root),
                key => game.i18n.localize(key),
                (key, data) => game.i18n.format(key, data),
            );
            // Every step shares the same background. Generate its thumbnail once for the preset cover.
            opts.steps = await Promise.all(sources.map((source, i) => VNPresets.makeStep(source, { generateThumbnail: i === 0 })));
        }
        const preset = await VNPresets.createSequence(name, attachScene, opts);
        if (!root.isConnected) return;
        if (input) input.value = '';
        await this.refresh(root);
        await this._panel.select(root, preset.id);
    }

    async _promptFolderName(root, title, { placeholder = game.i18n.localize('vn.folders.folderNamePlaceholder'), icon = 'fas fa-folder-plus' } = {}) {
        let value = '';
        return promptDialog({
            window: { title },
            classes: ['vn-confirm-dialog'],
            position: { width: 420 },
            content: `<div style="padding:6px 0"><input type="text" class="vn-folder-name-input" placeholder="${placeholder}" autofocus></div>`,
            buttons: [
                { action: 'create', label: game.i18n.localize('vn.folders.btnCreate'), icon, default: true },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel') },
            ],
        }, {
            cancelValue: '',
            onSubmit: action => action === 'create' ? value : '',
            onRender: dlg => {
                const inp = dlg.element?.querySelector('.vn-folder-name-input');
                if (inp) {
                    inp.focus();
                    inp.addEventListener('input', e => { value = e.target.value.trim(); });
                }
            },
        });
    }

    async refresh(root, sorted = null) {
        if (!sorted) sorted = await VNPresets.getSorted();
        const listEl = root.querySelector('.vn-preset-list');
        if (!listEl) return;

        const badge = root.querySelector('.vn-preset-count');
        if (badge) badge.textContent = sorted.length;

        const isFolder = this.groupMode === 'folders';
        listEl.classList.toggle('vn-preset-list--cards', this.viewMode === 'cards');
        listEl.classList.toggle('vn-preset-list--folder-mode', isFolder);
        if (isFolder) {
            listEl.innerHTML = this._view.folderHTML(sorted);
        } else {
            listEl.innerHTML = sorted.length === 0
                ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noSavedPresets')}</div>`
                : this._view.itemsHTML(sorted);
        }

        this._attachControlListeners(root);
        this._attachItemListeners(root);
        this._tags.refresh(root);
        this._view.applyFilters(root);

        this._panel.refresh(root, sorted);
    }
}

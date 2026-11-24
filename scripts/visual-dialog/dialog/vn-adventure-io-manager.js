// ============================================================
// vn-adventure-io-manager.js — вкладка "Adventure IO": экспорт/импорт пресетов в модули
// ============================================================

import { promptDialog } from '../../utils/dialog.js';
import { VNPresets } from '../presets/vn-presets.js';
import { MODULE_ID } from '../vn-constants.js';
import { VNAdventureIO } from '../presets/vn-adventure-io.js';
import { applyNameplateImage } from '../overlay/vn-nameplate.js';
import { decodePath } from '../../utils/paths.js';
import { buildIOPresetGroups, buildIOTab, buildModulesList, buildSetHint, buildImportSets, buildLibraryList,
    buildExportInstructions, buildEmptyHint, buildImportWarning, buildImportMessage,
    buildFolderImportMessage, IO_SPINNER, buildCopyButton } from './vn-adventure-io-view.js';
import { VNBackgroundManager } from './vn-background-manager.js';

export class VNAdventureIOManager {
    constructor() {
        this.viewMode = 'detailed';
        this.groupMode = 'scenes';
        this.foundModules = [];
        this.selectedModuleId = null;
        this.moduleSets = [];        // sets of the module being imported from: [{ name, presets, folders }]
        this.selectedSetIndex = 0;
        this.modulePresets = [];     // presets / folders of the selected set
        this.moduleFolders = [];
        this.existingSets = [];      // sets already stored in the export target module (for the name hint)
        this.importSource = null;    // what the loaded sets came from: { kind: 'module' | 'library', id, title }
        this.library = null;         // adventures of the built-in library (null = not opened yet)
        this.libraryQuery = '';
        this.libraryActiveOnly = false;
        this._hooks = null;
    }

    /** Last chosen mode of the tab (export / import); a failing storage just means "export" */
    static MODE_KEY = 'player-queue.vn-io-mode';

    _loadMode() {
        try { return localStorage.getItem(VNAdventureIOManager.MODE_KEY) === 'import' ? 'import' : 'export'; } catch { return 'export'; }
    }

    _saveMode(mode) {
        try { localStorage.setItem(VNAdventureIOManager.MODE_KEY, mode); } catch { /* storage unavailable */ }
    }

    _setMode(root, mode) {
        const tab = root.querySelector('.vn-io-tab');
        if (!tab) return;
        tab.dataset.mode = mode;
        root.querySelectorAll('.vn-io-mode-btn').forEach(b => {
            const on = b.dataset.mode === mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
        });
        this._saveMode(mode);
    }

    generateTab(sorted) {
        let nameplate = '';
        try { nameplate = game.settings.get(MODULE_ID, 'nameplateImage') || ''; } catch { /* unavailable */ }
        return buildIOTab({
            exportList: this._buildIOPresetGroups(sorted, 'exp', true, this.groupMode),
            empty: sorted.length === 0, mode: this._loadMode(), groupMode: this.groupMode,
            viewMode: this.viewMode, modules: [...game.modules.values()], nameplate,
            backgroundFolder: VNBackgroundManager.getCustomFolder() || '',
        });
    }

    _buildIOPresetGroups(presets, idPrefix, allChecked = false, groupBy = 'scenes') {
        return buildIOPresetGroups(VNAdventureIO.selectionGroups(presets, groupBy), idPrefix, allChecked, this.viewMode);
    }

    _updateIOExportCounter(root) {
        const checked = root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked').length;
        const total = root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb').length;
        const count = root.querySelector('#vn-io-export-count');
        if (count) {
            count.textContent = total ? game.i18n.format('vn.dialog.ioSelectedOf', { count: checked, total }) : '';
            count.classList.toggle('is-none', checked === 0);
        }
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
        if (!this.foundModules.length) {
            listEl.innerHTML = buildEmptyHint('vn.dialog.noModulesFound');
            return;
        }
        listEl.innerHTML = buildModulesList(this.foundModules, this.selectedModuleId);
        this._attachModuleLoadListeners(root);
    }

    /** Export: tells whether the typed name creates a set or updates one already stored in the target module, and lists the existing sets */
    _renderSetHint(root) {
        const hint = root.querySelector('#vn-io-set-hint');
        if (!hint) return;
        const moduleId = root.querySelector('#vn-io-module-id')?.value?.trim();
        if (!moduleId) { hint.innerHTML = ''; return; }
        const name = root.querySelector('#vn-io-set-name')?.value?.trim() || game.i18n.localize('vn.io.defaultSetName');
        const existing = this.existingSets.find(set => VNAdventureIO.sameSetName(set.name, name));
        hint.innerHTML = buildSetHint(this.existingSets, name, existing);
    }

    /** Import: when the module offers several sets the GM picks one here; the preset list below shows only that set */
    _renderImportSets(root) {
        const el = root.querySelector('#vn-io-import-sets');
        if (!el) return;
        if (this.moduleSets.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.innerHTML = buildImportSets(this.moduleSets, this.selectedSetIndex);
    }

    /** Tags the import can add to every preset: the module title and the set name (omitted when the file never named its set) */
    _importTags() {
        const set = this.moduleSets[this.selectedSetIndex];
        return [this.importSource?.title || this.importSource?.id, set && !set.implicit ? set.name : null]
            .map(t => String(t ?? '').trim()).filter(Boolean);
    }

    _renderImportTagsLabel(root) {
        const label = root.querySelector('#vn-io-import-tags-label');
        if (!label) return;
        label.textContent = game.i18n.format('vn.dialog.importTagsLabel', { tags: this._importTags().map(t => `«${t}»`).join(', ') });
    }

    _selectImportSet(index) {
        this.selectedSetIndex = index;
        const set = this.moduleSets[index];
        this.modulePresets = set?.presets ?? [];
        this.moduleFolders = set?.folders ?? [];
    }

    _renderImportPresets(root) {
        const listEl = root.querySelector('#vn-io-import-presets');
        const footer = root.querySelector('#vn-io-import-footer');
        if (!listEl) return;
        if (!this.modulePresets.length) {
            listEl.innerHTML = buildEmptyHint('vn.dialog.noPresetsInModule');
            if (footer) footer.hidden = true;
            return;
        }
        listEl.innerHTML = this._buildIOPresetGroups(this.modulePresets, 'imp', false);
        if (footer) footer.hidden = false;
        this._renderImportTagsLabel(root);
        this._updateIOImportCounter(root);
        listEl.closest('.vn-io-step')?.scrollIntoView?.({ block: 'nearest' });
    }

    // ── Built-in library ──

    _libraryAdventures() {
        const query = this.libraryQuery.trim().toLowerCase();
        const rank = { active: 0, inactive: 1, missing: 2 };
        return (this.library ?? [])
            .map(adv => ({ adv, status: VNAdventureIO.moduleStatus(adv.id) }))
            .filter(({ adv, status }) => (!this.libraryActiveOnly || status === 'active')
                && (!query || [adv.title, adv.id, adv.author].some(v => v.toLowerCase().includes(query))))
            .sort((a, b) => (rank[a.status] - rank[b.status]) || a.adv.title.localeCompare(b.adv.title));
    }

    _renderLibrary(root) {
        const listEl = root.querySelector('#vn-io-lib-list');
        const summaryEl = root.querySelector('#vn-io-lib-summary');
        if (!listEl || !summaryEl) return;
        const all = this.library ?? [];
        const count = status => all.filter(adv => VNAdventureIO.moduleStatus(adv.id) === status).length;
        summaryEl.textContent = all.length
            ? game.i18n.format('vn.dialog.librarySummary', { total: all.length, active: count('active'), inactive: count('inactive'), missing: count('missing') })
            : '';

        const items = this._libraryAdventures();
        if (!items.length) {
            listEl.innerHTML = buildEmptyHint(all.length ? 'vn.dialog.libraryNothing' : 'vn.dialog.libraryEmpty');
            return;
        }
        listEl.innerHTML = buildLibraryList(items, this.importSource);
    }

    /** Warns when the presets being imported use files of an adventure module that is not running */
    _renderImportWarn(root) {
        const el = root.querySelector('#vn-io-import-warn');
        if (!el) return;
        const status = this.importSource?.kind === 'library' ? VNAdventureIO.moduleStatus(this.importSource.id) : 'active';
        el.hidden = status === 'active';
        el.innerHTML = el.hidden ? '' : buildImportWarning(status, this.importSource.title);
    }

    async _toggleLibrary(root) {
        const panel = root.querySelector('#vn-io-library');
        if (!panel) return;
        if (!panel.hidden) { panel.hidden = true; return; }
        panel.hidden = false;
        try {
            this.library = await VNAdventureIO.readLibrary();
        } catch (err) {
            this.library = [];
            ui.notifications.error(game.i18n.format('vn.dialog.libraryError', { msg: err.message }));
        }
        this._renderLibrary(root);
    }

    async _loadLibraryAdventure(root, id, btn) {
        const adv = this.library?.find(a => a.id === id);
        if (!adv) return;
        btn.disabled = true;
        btn.innerHTML = IO_SPINNER;
        this.importSource = { kind: 'library', id: adv.id, title: adv.title };
        this.selectedModuleId = null;
        this.moduleSets = await VNAdventureIO.fetchLibrarySets(adv);
        this._selectImportSet(0);
        if (this.foundModules.length) this._renderModulesList(root);
        this._renderLibrary(root);
        this._renderImportSets(root);
        this._renderImportWarn(root);
        this._renderImportPresets(root);
    }

    async _applyNameplate(path) {
        if (!path) return;
        await game.settings.set(MODULE_ID, 'nameplateImage', path);
        applyNameplateImage(path);
        ui.notifications.info(game.i18n.localize('vn.dialog.nameplateInstalled'));
    }

    async _applyBackgroundFolder(path) {
        if (!path) return;
        await game.settings.set(MODULE_ID, 'backgroundFolder', path);
        ui.notifications.info(game.i18n.format('vn.dialog.folderInstalled', { folder: path }));
    }

    /** "Set nameplate" / "set background folder" buttons of a module or library item */

    _attachModuleLoadListeners(root) {
        root.querySelectorAll('.vn-io-load-module').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this.foundModules.find(m => m.id === moduleId);
                if (!mod) return;
                btn.disabled = true;
                btn.innerHTML = IO_SPINNER;
                this.selectedModuleId = moduleId;
                this.importSource = { kind: 'module', id: moduleId, title: mod.title };
                this.moduleSets = await VNAdventureIO.fetchSets(moduleId, mod.presetsFile);
                this._selectImportSet(0);
                this._renderModulesList(root);
                this._renderLibrary(root);
                this._renderImportSets(root);
                this._renderImportWarn(root);
                this._renderImportPresets(root);
            });
        });

        root.querySelectorAll('#vn-io-modules-list .vn-io-apply-nameplate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._applyNameplate(this.foundModules.find(m => m.id === btn.dataset.moduleId)?.nameplate);
            });
        });

        root.querySelectorAll('#vn-io-modules-list .vn-io-apply-folder').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._applyBackgroundFolder(this.foundModules.find(m => m.id === btn.dataset.moduleId)?.backgroundFolder);
            });
        });
    }

    /** The field shows a readable path, but the stored (possibly percent-encoded) one is exported while the text is untouched. */
    _folderValue(input) {
        const shown = input?.value?.trim() || '';
        const raw = input?.dataset.raw || '';
        return raw && decodePath(raw) === shown ? raw : shown;
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

    refreshExportList(root) {
        const listEl = root.querySelector('#vn-io-export-list');
        if (!listEl) return;
        VNPresets.getSorted().then(sorted => {
            if (!listEl.isConnected) return;
            listEl.innerHTML = sorted.length
                ? this._buildIOPresetGroups(sorted, 'exp', true, this.groupMode)
                : buildEmptyHint('vn.dialog.noPresetsToExport');
            this._updateIOExportCounter(root);
        });
    }

    async _promptFolderImportChoice(importedFolders) {
        if (!importedFolders.length) return { importFolders: false };
        const choice = await promptDialog({
            window: { title: game.i18n.localize('vn.folders.importChoiceTitle') },
            classes: ['vn-confirm-dialog'],
            content: buildFolderImportMessage(importedFolders.length),
            buttons: [
                { action: 'recreate', label: game.i18n.localize('vn.folders.btnImportRecreateFolders'), icon: 'fas fa-folder-tree', default: true },
                { action: 'drop', label: game.i18n.localize('vn.folders.btnImportDropToRoot'), icon: 'fas fa-list' },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel') },
            ],
        }, { cancelValue: 'cancel' });
        if (!choice || choice === 'cancel') return null;
        return choice === 'recreate'
            ? { importFolders: true, folders: importedFolders }
            : { importFolders: false };
    }

    attachListeners(root, hooks = {}) {
        this._hooks = hooks;
        if (root._vnIODelegated) return;
        root._vnIODelegated = true;

        this._attachSelectionListeners(root);
        this._attachTargetListeners(root);
        this._attachLibraryListeners(root);

        // Export button
        root.querySelector('#vn-io-export-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            return this._exportModule(root);
        });

        // Scan modules
        root.querySelector('#vn-io-scan-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            return this._scanModules(root);
        });

        // Export to file (browser download)
        root.querySelector('#vn-io-export-file-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            return this._exportFile(root);
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
            return this._importFile(root, file);
        });

        // Import button
        root.querySelector('#vn-io-import-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            return this._importSelected(root);
        });
    }

    _attachSelectionListeners(root) {
        // Export / import switch (the last choice is remembered)
        const modeBtns = [...root.querySelectorAll('.vn-io-mode-btn')];
        modeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); this._setMode(root, btn.dataset.mode); });
            btn.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = modeBtns[(modeBtns.indexOf(btn) + (e.key === 'ArrowRight' ? 1 : modeBtns.length - 1)) % modeBtns.length];
                this._setMode(root, next.dataset.mode);
                next.focus();
            });
        });

        // View mode toggle
        root.querySelectorAll('.vn-io-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.viewMode = btn.dataset.view;
                root.querySelectorAll('.vn-io-view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.refreshExportList(root);
                if (this.modulePresets.length) this._renderImportPresets(root);
            });
        });

        // Export list grouping: by scene / by preset folder
        root.querySelectorAll('.vn-io-group-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.groupMode = btn.dataset.group;
                root.querySelectorAll('.vn-io-group-btn').forEach(b => b.classList.toggle('active', b === btn));
                this.refreshExportList(root);
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

    }

    _attachTargetListeners(root) {
        // Folder picker for export section
        root.querySelector('#vn-io-pick-folder-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            const input = root.querySelector('#vn-io-export-folder');
            const startPath = this._folderValue(input) || 'modules/player-queue/assets/scenes';
            const fp = new FilePicker({
                type: 'folder',
                current: startPath,
                callback: (folderPath) => {
                    if (!input) return;
                    input.dataset.raw = folderPath;
                    input.value = decodePath(folderPath);
                }
            });
            fp.browse(startPath);
        });

        // Set name: the hint shows whether the name creates a new set or updates one that the target module already has
        const moduleSelect = root.querySelector('#vn-io-module-id');
        moduleSelect?.addEventListener('change', async () => {
            const moduleId = moduleSelect.value.trim();
            this.existingSets = [];
            this._renderSetHint(root);
            if (!moduleId) return;
            const sets = await VNAdventureIO.readSets(moduleId);
            if (moduleSelect.value.trim() !== moduleId) return; // another module was picked meanwhile
            this.existingSets = sets;
            this._renderSetHint(root);
        });
        root.querySelector('#vn-io-set-name')?.addEventListener('input', () => this._renderSetHint(root));
        root.querySelector('#vn-io-set-hint')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.vn-io-set-chip');
            if (!chip) return;
            e.preventDefault();
            root.querySelector('#vn-io-set-name').value = chip.dataset.name;
            this._renderSetHint(root);
        });
        root.querySelector('#vn-io-import-sets')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.vn-io-set-chip');
            if (!chip) return;
            e.preventDefault();
            this._selectImportSet(Number(chip.dataset.index));
            this._renderImportSets(root);
            this._renderImportPresets(root);
        });

    }

    _attachLibraryListeners(root) {
        // Library: open / search / "only running modules" / load
        root.querySelector('#vn-io-library-btn')?.addEventListener('click', (e) => { e.preventDefault(); this._toggleLibrary(root); });
        root.querySelector('#vn-io-lib-search')?.addEventListener('input', (e) => { this.libraryQuery = e.target.value; this._renderLibrary(root); });
        root.querySelector('#vn-io-lib-active-only')?.addEventListener('change', (e) => { this.libraryActiveOnly = e.target.checked; this._renderLibrary(root); });
        root.querySelector('#vn-io-lib-list')?.addEventListener('click', (e) => {
            const adv = id => this.library?.find(a => a.id === id);
            const load = e.target.closest('.vn-io-lib-load');
            const plate = e.target.closest('.vn-io-apply-nameplate');
            const folder = e.target.closest('.vn-io-apply-folder');
            if (!load && !plate && !folder) return;
            e.preventDefault();
            if (load) this._loadLibraryAdventure(root, load.dataset.id, load);
            else if (plate) this._applyNameplate(adv(plate.dataset.id)?.nameplate);
            else this._applyBackgroundFolder(adv(folder.dataset.id)?.backgroundFolder);
        });

    }

    async _exportModule(root) {
        const moduleId = root.querySelector('#vn-io-module-id')?.value?.trim();
        if (!moduleId) { ui.notifications.warn(game.i18n.localize('vn.dialog.specifyModuleId')); return; }
        const ids = [...root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked')].map(cb => cb.value);
        if (!ids.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.selectAtLeastOnePreset')); return; }
        const all = await VNPresets.getAll();
        const toExport = ids.map(id => all[id]).filter(Boolean);
        const nameplate = root.querySelector('#vn-io-nameplate')?.value || '';
        const backgroundFolder = this._folderValue(root.querySelector('#vn-io-export-folder'));
        const setName = root.querySelector('#vn-io-set-name')?.value?.trim() || game.i18n.localize('vn.io.defaultSetName');
        try {
            const { created, sets } = await VNAdventureIO.exportToModule(toExport, moduleId, setName);
            this.existingSets = sets;
            this._renderSetHint(root);
            ui.notifications.info(game.i18n.format(created ? 'vn.dialog.exportSetCreated' : 'vn.dialog.exportSetUpdated', {count: toExport.length, moduleId, set: setName}));
            this._showExportInstructions(moduleId, { nameplate, backgroundFolder, setName, created, setsTotal: sets.length });
        } catch (err) {
            ui.notifications.error(game.i18n.format('vn.dialog.exportError', {msg: err.message}));
        }
    }

    async _exportFile(root) {
        const ids = [...root.querySelectorAll('#vn-io-export-list .vn-io-preset-cb:checked')].map(cb => cb.value);
        const all = await VNPresets.getAll();
        const sorted = await VNPresets.getSorted();
        const toExport = ids.length > 0 ? ids.map(id => all[id]).filter(Boolean) : sorted;
        if (!toExport.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.noPresetsToDownload')); return; }
        VNAdventureIO.exportToFile(toExport);
        ui.notifications.info(game.i18n.format('vn.dialog.downloadingPresets', {count: toExport.length}));
    }

    async _importFile(root, file) {
        try {
            const { presets, folders } = await VNAdventureIO.readImportFile(file);
            if (!presets.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.noPresetsInFile')); return; }

            const { fresh, dupes } = await VNAdventureIO.classifyImport(presets);
            const hasDupes = dupes.length > 0;
            const msg = hasDupes
                ? game.i18n.format('vn.dialog.fileImportWithDupes', {total: presets.length, fresh: fresh.length, dupes: dupes.length})
                : game.i18n.format('vn.dialog.fileImportNoDupes', {total: presets.length});

            const buttons = [
                { action: 'fresh', label: game.i18n.localize('vn.dialog.btnImportFreshOnly'), icon: 'fas fa-plus', default: true },
                ...(hasDupes ? [{ action: 'overwrite', label: game.i18n.localize('vn.dialog.btnOverwriteDupes'), icon: 'fas fa-sync' }] : []),
                { action: 'replace', label: game.i18n.localize('vn.dialog.btnReplaceAll'), icon: 'fas fa-trash' },
            ];
            const choice = await promptDialog({
                window: { title: game.i18n.localize('vn.dialog.importFromFileTitle') },
                classes: ['vn-confirm-dialog'],
                content: buildImportMessage([msg], true),
                buttons,
            }, { cancelValue: 'cancel' });

            if (!choice || choice === 'cancel') return;

            const folderOpts = await this._promptFolderImportChoice(folders);
            if (folderOpts === null) return;

            let added = 0;
            if (choice === 'replace') {
                // The library is cleared inside the same write that adds the new presets: nothing is lost if the data is bad
                added = await VNAdventureIO.mergeImport(presets, true, folderOpts, { replace: true });
            } else if (choice === 'overwrite') {
                added = await VNAdventureIO.mergeImport(fresh, false, folderOpts);
                added += await VNAdventureIO.mergeImport(dupes, true, folderOpts);
            } else {
                added = await VNAdventureIO.mergeImport(fresh, false, folderOpts);
            }
            ui.notifications.info(game.i18n.format('vn.dialog.importedPresets', {count: added}));
            this._hooks.onImported?.(root);
            this.refreshExportList(root);
        } catch (err) {
            ui.notifications.error(game.i18n.format('vn.dialog.fileReadError', {msg: err.message}));
        }
    }

    async _importSelected(root) {
        const ids = [...root.querySelectorAll('#vn-io-import-presets .vn-io-preset-cb:checked')].map(cb => cb.value);
        if (!ids.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.selectAtLeastOnePreset')); return; }
        const toImport = this.modulePresets.filter(p => ids.includes(p.id));

        const { fresh, dupes } = await VNAdventureIO.classifyImport(toImport);

        let choice = 'new-only';
        if (dupes.length) {
            const bodyLines = [
                fresh.length ? game.i18n.format('vn.dialog.freshPresetsAdded', {count: fresh.length}) : null,
                game.i18n.format('vn.dialog.dupesExist', {count: dupes.length}),
            ];

            const buttons = [
                ...(fresh.length ? [{ action: 'new-only', label: game.i18n.format('vn.dialog.btnImportFreshCount', {count: fresh.length}), icon: 'fas fa-plus', default: true }] : []),
                { action: 'overwrite', label: game.i18n.format('vn.dialog.btnOverwriteAllCount', {count: toImport.length}), icon: 'fas fa-sync', default: !fresh.length },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' },
            ];

            choice = await promptDialog({
                window: { title: game.i18n.localize('vn.dialog.importPresetsDialogTitle') },
                classes: ['vn-confirm-dialog'],
                content: buildImportMessage(bodyLines),
                buttons,
            }, { cancelValue: 'cancel' });
            if (!choice || choice === 'cancel') return;
        }

        const folderOpts = await this._promptFolderImportChoice(this.moduleFolders);
        if (folderOpts === null) return;

        const presetsToImport = choice === 'new-only' ? fresh : toImport;
        const tags = root.querySelector('#vn-io-import-tags')?.checked ? this._importTags() : [];
        const added = await VNAdventureIO.mergeImport(presetsToImport, choice === 'overwrite', folderOpts, { tags });
        ui.notifications.info(game.i18n.format('vn.dialog.importedPresets', {count: added}));
        this._hooks.onImported?.(root);
    }

    _scanModules(root) {
        this.foundModules = VNAdventureIO.scanModules();
        this.selectedModuleId = null;
        this.importSource = null;
        this.moduleSets = [];
        this._selectImportSet(0);
        this._renderModulesList(root);
        this._renderLibrary(root);
        this._renderImportSets(root);
        this._renderImportWarn(root);
        const importPresets = root.querySelector('#vn-io-import-presets');
        if (importPresets) importPresets.innerHTML = '';
        const footer = root.querySelector('#vn-io-import-footer');
        if (footer) footer.hidden = true;
    }

    _showExportInstructions(moduleId, opts = {}) {
        const snippet = VNAdventureIO.moduleJsonSnippet(opts);

        const dialog = new foundry.applications.api.DialogV2({
            window: { title: game.i18n.localize('vn.dialog.exportDoneTitle'), icon: 'fas fa-check-circle' },
            classes: ['vn-instructions-dialog'],
            position: { width: 520 },
            content: buildExportInstructions(moduleId, opts, snippet),
            buttons: [{ action: 'ok', label: game.i18n.localize('vn.dialog.btnOk'), icon: 'fas fa-check', default: true }],
        });
        dialog.addEventListener('render', () => {
            dialog.element.querySelector('#vn-io-copy-snippet')?.addEventListener('click', async (e) => {
                e.preventDefault();
                await navigator.clipboard.writeText(snippet);
                const btn = dialog.element.querySelector('#vn-io-copy-snippet');
                if (!btn) return;
                btn.innerHTML = buildCopyButton(true);
                setTimeout(() => { btn.innerHTML = buildCopyButton(); }, 2000);
            });
        });
        dialog.render({ force: true });
    }
}

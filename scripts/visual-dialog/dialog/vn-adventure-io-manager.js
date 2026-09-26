// ============================================================
// vn-adventure-io-manager.js — вкладка "Adventure IO": экспорт/импорт пресетов в модули
// ============================================================

import { VNPresets, MODULE_ID } from '../vn-state.js';
import { VNAdventureIO } from '../vn-adventure-io.js';
import { NAMEPLATE_CONFIGS, applyNameplateImage } from '../../settings.js';
import { buildActorPipsHtml, groupPresetsByScene } from '../vn-id-utils.js';
import { VNBackgroundManager } from './vn-background-manager.js';

export class VNAdventureIOManager {
    constructor() {
        this.viewMode = 'detailed';
        this.foundModules = [];
        this.selectedModuleId = null;
        this.modulePresets = [];
        this.moduleFolders = [];
        this._hooks = null;
    }

    generateTab(sorted) {
        const exportList = this._buildIOPresetGroups(sorted, 'exp', true);
        const exportEmpty = sorted.length === 0
            ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsToExport')}</div>`
            : '';

        return `<div class="vn-io-tab">
            <div class="vn-io-section">
                <div class="vn-io-section-title"><i class="fas fa-file-export"></i> ${game.i18n.localize('vn.dialog.exportPresetsTitle')}</div>
                <div class="vn-io-controls">
                    <div class="vn-io-view-toggle">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this.viewMode === 'detailed' ? 'active' : ''}" data-view="detailed">${game.i18n.localize('vn.dialog.viewDetailed')}</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this.viewMode === 'compact' ? 'active' : ''}" data-view="compact">${game.i18n.localize('vn.dialog.viewCompact')}</button>
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
                                   value="${VNBackgroundManager.getCustomFolder() || ''}">
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
        return groupPresetsByScene(presets).map(({ key, presets: group }) => {
            const label = key || game.i18n.localize('vn.dialog.noScene');
            const items = this.viewMode === 'compact'
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
                <div class="vn-io-scene-presets ${this.viewMode === 'compact' ? 'vn-io-compact' : 'vn-io-detailed'}">${items}</div>
            </div>`;
        }).join('');
    }

    _buildIOCardDetailed(preset, idPrefix, checked) {
        const cbId = `${idPrefix}-cb-${preset.id}`;
        const bgSrc = preset.thumbnailData || (preset.background && preset.background !== 'none' ? preset.background : null);
        const imgHtml = bgSrc
            ? `<img class="vn-preset-card-img" src="${bgSrc}" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-preset-card-placeholder"><i class="fas fa-film"></i></div>`;

        const allIds = [...(preset.leftIds || []), ...(preset.centerIds || []), ...(preset.rightIds || [])];
        const pipsHtml = buildActorPipsHtml(allIds, preset.portraitImages || {}, preset.portraitNames || {});

        return `<label class="vn-io-card" data-preset-id="${preset.id}">
            <div class="vn-preset-card-poster">
                ${imgHtml}
                ${pipsHtml}
                <div class="vn-preset-card-footer">
                    <div class="vn-preset-card-name" title="${preset.name}">${preset.name}</div>
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
        if (!this.foundModules.length) {
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noModulesFound')}</div>`;
            return;
        }
        listEl.innerHTML = this.foundModules.map(m => {
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
            return `<div class="vn-io-module-item ${this.selectedModuleId === m.id ? 'active' : ''}" data-module-id="${m.id}">
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
        if (!this.modulePresets.length) {
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsInModule')}</div>`;
            if (footer) footer.hidden = true;
            return;
        }
        listEl.innerHTML = this._buildIOPresetGroups(this.modulePresets, 'imp', false);
        if (footer) footer.hidden = false;
        this._updateIOImportCounter(root);
    }

    _attachModuleLoadListeners(root) {
        root.querySelectorAll('.vn-io-load-module').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this.foundModules.find(m => m.id === moduleId);
                if (!mod) return;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                this.selectedModuleId = moduleId;
                const fetchedData = await VNAdventureIO.fetchPresets(moduleId, mod.presetsFile);
                this.modulePresets = fetchedData.presets;
                this.moduleFolders = fetchedData.folders;
                this._renderModulesList(root);
                this._renderImportPresets(root);
            });
        });

        root.querySelectorAll('.vn-io-apply-nameplate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const moduleId = btn.dataset.moduleId;
                const mod = this.foundModules.find(m => m.id === moduleId);
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
                const mod = this.foundModules.find(m => m.id === moduleId);
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

    refreshExportList(root) {
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

    attachListeners(root, hooks = {}) {
        this._hooks = hooks;
        if (root._vnIODelegated) return;
        root._vnIODelegated = true;

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
            this.foundModules = VNAdventureIO.scanModules();
            this.selectedModuleId = null;
            this.modulePresets = [];
            this.moduleFolders = [];
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
                this._hooks.onImported?.(root);
                this.refreshExportList(root);
            } catch (err) {
                ui.notifications.error(game.i18n.format('vn.dialog.fileReadError', {msg: err.message}));
            }
        });

        // Import button
        root.querySelector('#vn-io-import-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const ids = [...root.querySelectorAll('#vn-io-import-presets .vn-io-preset-cb:checked')].map(cb => cb.value);
            if (!ids.length) { ui.notifications.warn(game.i18n.localize('vn.dialog.selectAtLeastOnePreset')); return; }
            const toImport = this.modulePresets.filter(p => ids.includes(p.id));

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

            const folderOpts = await this._promptFolderImportChoice(this.moduleFolders);
            if (folderOpts === null) return;

            const presetsToImport = choice === 'new-only' ? fresh : toImport;
            const added = await VNAdventureIO.mergeImport(presetsToImport, choice === 'overwrite', folderOpts);
            ui.notifications.info(game.i18n.format('vn.dialog.importedPresets', {count: added}));
            this._hooks.onImported?.(root);
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
}

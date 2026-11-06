// ============================================================
// vn-adventure-io-manager.js — вкладка "Adventure IO": экспорт/импорт пресетов в модули
// ============================================================

import { VNPresets, VNFolders, MODULE_ID } from '../vn-state.js';
import { VNAdventureIO } from '../vn-adventure-io.js';
import { NAMEPLATE_CONFIGS, applyNameplateImage } from '../../settings.js';
import { buildActorPipsHtml, groupPresetsByScene, escapeHtml, presetSceneNames } from '../vn-id-utils.js';
import { VNBackgroundManager } from './vn-background-manager.js';

const esc = escapeHtml;
const decodePath = (p) => { try { return decodeURIComponent(p); } catch { return p; } };

export class VNAdventureIOManager {
    static MAX_IMPORT_BYTES = 30 * 1048576;

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
        const exportList = this._buildIOPresetGroups(sorted, 'exp', true, this.groupMode);
        const exportEmpty = sorted.length === 0
            ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsToExport')}</div>`
            : '';
        const mode = this._loadMode();
        const t = key => game.i18n.localize(key);
        const modeBtn = (id, icon, label, hint) => `<button type="button" class="vn-io-mode-btn${mode === id ? ' active' : ''}" role="tab"
                aria-selected="${mode === id}" tabindex="${mode === id ? 0 : -1}" data-mode="${id}">
                <i class="fas ${icon}"></i><span class="vn-io-mode-text"><b>${label}</b><small>${hint}</small></span></button>`;

        return `<div class="vn-io-tab" data-mode="${mode}">
            <div class="vn-io-mode-switch" role="tablist">
                ${modeBtn('export', 'fa-file-export', t('vn.dialog.ioModeExport'), t('vn.dialog.ioModeExportHint'))}
                ${modeBtn('import', 'fa-file-import', t('vn.dialog.ioModeImport'), t('vn.dialog.ioModeImportHint'))}
            </div>

            <div class="vn-io-pane vn-io-pane-export" data-pane="export" role="tabpanel">
                <div class="vn-io-export-layout">
                    <div class="vn-io-selection">
                        <div class="vn-io-controls">
                            <div class="vn-io-view-toggle" title="${t('vn.dialog.ioGroupBy')}">
                                <button type="button" class="vn-btn vn-btn-xs vn-io-group-btn ${this.groupMode === 'scenes' ? 'active' : ''}" data-group="scenes"><i class="fas fa-map-location-dot"></i> ${t('vn.dialog.ioGroupScenes')}</button>
                                <button type="button" class="vn-btn vn-btn-xs vn-io-group-btn ${this.groupMode === 'folders' ? 'active' : ''}" data-group="folders"><i class="fas fa-folder"></i> ${t('vn.dialog.ioGroupFolders')}</button>
                            </div>
                            <div class="vn-io-view-toggle">
                                <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this.viewMode === 'detailed' ? 'active' : ''}" data-view="detailed">${t('vn.dialog.viewDetailed')}</button>
                                <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${this.viewMode === 'compact' ? 'active' : ''}" data-view="compact">${t('vn.dialog.viewCompact')}</button>
                            </div>
                            <span class="vn-io-count" id="vn-io-export-count" aria-live="polite"></span>
                            <div class="vn-io-bulk-btns">
                                <button type="button" class="vn-btn vn-btn-xs vn-io-check-all" data-section="export">${t('vn.dialog.checkAll')}</button>
                                <button type="button" class="vn-btn vn-btn-xs vn-io-uncheck-all" data-section="export">${t('vn.dialog.uncheckAll')}</button>
                            </div>
                        </div>
                        <div class="vn-io-preset-list vn-io-scroll" id="vn-io-export-list">${exportEmpty || exportList}</div>
                    </div>
                    <div class="vn-io-export-footer">
                        <div class="vn-io-panel-title"><i class="fas fa-bullseye"></i> ${t('vn.dialog.ioExportTarget')}</div>
                        <div class="vn-io-fields">
                            <div class="vn-io-module-input-row">
                                <label class="vn-io-label"><i class="fas fa-cube"></i> ${t('vn.dialog.moduleLabel')}</label>
                                ${this._buildModuleSelect()}
                            </div>
                            <div class="vn-io-module-input-row">
                                <label class="vn-io-label" title="${esc(t('vn.dialog.setNameTitle'))}"><i class="fas fa-layer-group"></i> ${t('vn.dialog.setNameLabel')}</label>
                                <input type="text" id="vn-io-set-name" class="vn-io-select" maxlength="80" autocomplete="off"
                                       placeholder="${esc(t('vn.io.defaultSetName'))}">
                            </div>
                            <div class="vn-io-set-hint" id="vn-io-set-hint"></div>
                            <div class="vn-io-module-input-row">
                                <label class="vn-io-label"><i class="fas fa-id-badge"></i> ${t('vn.dialog.nameplateLabel')}</label>
                                ${this._buildNameplateSelect()}
                            </div>
                            <div class="vn-io-module-input-row">
                                <label class="vn-io-label"><i class="fas fa-folder-open"></i> ${t('vn.dialog.bgFolderLabel')}</label>
                                <div class="vn-io-folder-row">
                                    <input type="text" id="vn-io-export-folder" class="vn-io-select" placeholder="${t('vn.dialog.bgFolderPlaceholder')}"
                                           value="${esc(decodePath(VNBackgroundManager.getCustomFolder() || ''))}" data-raw="${esc(VNBackgroundManager.getCustomFolder() || '')}">
                                    <button type="button" class="vn-btn vn-btn-xs" id="vn-io-pick-folder-btn" title="${t('vn.dialog.pickFolderBtnTitle')}"><i class="fas fa-search"></i></button>
                                </div>
                            </div>
                        </div>
                        <div class="vn-io-export-btns">
                            <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" id="vn-io-export-btn">
                                <i class="fas fa-file-export"></i> <span id="vn-io-export-label">${t('vn.dialog.btnExportToModule')}</span>
                            </button>
                            <button type="button" class="vn-btn vn-btn-sm" id="vn-io-export-file-btn">
                                <i class="fas fa-download"></i> ${t('vn.dialog.btnDownloadJson')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="vn-io-pane vn-io-pane-import" data-pane="import" role="tabpanel">
                <div class="vn-io-scroll vn-io-steps">
                    <section class="vn-io-step">
                        <div class="vn-io-step-title"><span class="vn-io-step-num">1</span> ${t('vn.dialog.ioStepSource')}</div>
                        <div class="vn-io-sources">
                            <div class="vn-io-source">
                                <button type="button" class="vn-btn vn-btn-sm" id="vn-io-scan-btn">
                                    <i class="fas fa-magnifying-glass"></i> ${t('vn.dialog.btnFindAdventureModules')}
                                </button>
                                <span class="vn-io-scan-hint">${t('vn.dialog.scanModulesHint')}</span>
                            </div>
                            <div class="vn-io-source">
                                <button type="button" class="vn-btn vn-btn-sm" id="vn-io-library-btn">
                                    <i class="fas fa-book-atlas"></i> ${t('vn.dialog.btnOpenLibrary')}
                                </button>
                                <span class="vn-io-scan-hint">${t('vn.dialog.libraryHint')}</span>
                            </div>
                            <div class="vn-io-source">
                                <button type="button" class="vn-btn vn-btn-sm" id="vn-io-import-file-btn">
                                    <i class="fas fa-folder-open"></i> ${t('vn.dialog.btnSelectJsonFile')}
                                </button>
                                <input type="file" id="vn-io-file-input" accept=".json" style="display:none">
                                <span class="vn-io-scan-hint">${t('vn.dialog.loadFromFileHint')}</span>
                            </div>
                        </div>
                        <div id="vn-io-modules-list" class="vn-io-modules-list"></div>
                        <div id="vn-io-library" class="vn-io-library" hidden>
                            <div class="vn-io-lib-controls">
                                <label class="vn-io-lib-search">
                                    <i class="fas fa-magnifying-glass"></i>
                                    <input type="text" id="vn-io-lib-search" autocomplete="off" spellcheck="false" placeholder="${esc(t('vn.dialog.librarySearch'))}">
                                </label>
                                <label class="vn-io-tag-option vn-io-lib-active-only" title="${esc(t('vn.dialog.libraryActiveOnlyTitle'))}">
                                    <input type="checkbox" id="vn-io-lib-active-only"> ${t('vn.dialog.libraryActiveOnly')}
                                </label>
                            </div>
                            <div class="vn-io-lib-summary" id="vn-io-lib-summary"></div>
                            <div class="vn-io-lib-list" id="vn-io-lib-list"></div>
                        </div>
                    </section>

                    <section class="vn-io-step vn-io-step-presets">
                        <div class="vn-io-step-title"><span class="vn-io-step-num">2</span> ${t('vn.dialog.ioStepPresets')}</div>
                        <div id="vn-io-import-sets" class="vn-io-set-picker" hidden></div>
                        <div id="vn-io-import-warn" class="vn-io-hint vn-io-warn" hidden></div>
                        <div id="vn-io-import-presets" class="vn-io-preset-list"></div>
                        <div class="vn-io-empty-state"><i class="fas fa-arrow-up"></i> ${t('vn.dialog.ioImportEmpty')}</div>
                    </section>
                </div>
                <div class="vn-io-import-footer" id="vn-io-import-footer" hidden>
                    <span class="vn-io-step-num">3</span>
                    <label class="vn-io-tag-option" title="${esc(t('vn.dialog.importTagsTitle'))}">
                        <input type="checkbox" id="vn-io-import-tags">
                        <span id="vn-io-import-tags-label"></span>
                    </label>
                    <div class="vn-io-bulk-btns">
                        <button type="button" class="vn-btn vn-btn-xs vn-io-check-all" data-section="import">${t('vn.dialog.checkAll')}</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-io-uncheck-all" data-section="import">${t('vn.dialog.uncheckAll')}</button>
                    </div>
                    <button type="button" class="vn-btn vn-btn-sm vn-btn-accent" id="vn-io-import-btn">
                        <i class="fas fa-file-import"></i> <span id="vn-io-import-label">${t('vn.dialog.btnImportSelected')}</span>
                    </button>
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
                    ? `${esc(m.title || m.id)} (${esc(m.id)})`
                    : `${esc(m.title || m.id)} (${esc(m.id)}) ${game.i18n.localize('vn.dialog.moduleInactive')}`;
                return `<option value="${esc(m.id)}">${label}</option>`;
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
            `<option value="${esc(path)}" ${path === current ? 'selected' : ''}>${esc(cfg.label || path.split('/').pop().replace(/\.[^.]+$/, ''))}</option>`
        ).join('');
        return `<select id="vn-io-nameplate" class="vn-io-select">
            <option value="" ${!current ? 'selected' : ''}>${game.i18n.localize('vn.dialog.selectNameplate')}</option>
            ${opts}
        </select>`;
    }

    _groupPresets(presets, groupBy) {
        if (groupBy !== 'folders') {
            // unique: one checkbox per preset even when it is linked to several scenes
            return groupPresetsByScene(presets, { unique: true }).map(({ key, presets: group }) => ({
                label: key || game.i18n.localize('vn.dialog.noScene'), icon: 'fa-map-pin', presets: group,
            }));
        }
        const groups = new Map();
        for (const p of presets) {
            const key = p.folderId && VNFolders.get(p.folderId) ? p.folderId : '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
        }
        return [...groups.entries()]
            .map(([id, group]) => ({
                label: id ? VNFolders.getPath(id).map(f => f.name).join(' / ') : game.i18n.localize('vn.dialog.ioNoFolder'),
                icon: id ? 'fa-folder' : 'fa-folder-open',
                presets: group,
                root: !id,
            }))
            .sort((a, b) => (a.root - b.root) || a.label.localeCompare(b.label));
    }

    _buildIOPresetGroups(presets, idPrefix, allChecked = false, groupBy = 'scenes') {
        if (!presets.length) return '';
        return this._groupPresets(presets, groupBy).map(({ label, icon, presets: group }) => {
            const items = this.viewMode === 'compact'
                ? group.map(p => this._buildIORowCompact(p, idPrefix, allChecked)).join('')
                : group.map(p => this._buildIOCardDetailed(p, idPrefix, allChecked)).join('');
            return `<div class="vn-io-scene-group">
                <div class="vn-io-scene-header">
                    <label class="vn-io-group-check-label" title="${game.i18n.localize('vn.dialog.selectGroup')}">
                        <input type="checkbox" class="vn-io-group-cb"${allChecked ? ' checked' : ''}>
                    </label>
                    <i class="fas ${icon}"></i> ${esc(label)}
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
            ? `<img class="vn-preset-card-img" src="${esc(bgSrc)}" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-preset-card-placeholder"><i class="fas fa-film"></i></div>`;

        const allIds = [...(preset.leftIds || []), ...(preset.centerIds || []), ...(preset.rightIds || [])];
        const pipsHtml = buildActorPipsHtml(allIds, preset.portraitImages || {}, preset.portraitNames || {});

        return `<label class="vn-io-card" data-preset-id="${preset.id}">
            <div class="vn-preset-card-poster">
                ${imgHtml}
                ${pipsHtml}
                <div class="vn-preset-card-footer">
                    <div class="vn-preset-card-name" title="${esc(preset.name)}">${esc(preset.name)}</div>
                </div>
                <div class="vn-io-card-check-corner">
                    <input type="checkbox" class="vn-io-preset-cb" id="${cbId}" value="${preset.id}"${checked ? ' checked' : ''}>
                </div>
            </div>
        </label>`;
    }

    _buildIORowCompact(preset, idPrefix, checked) {
        const cbId = `${idPrefix}-cb-${preset.id}`;
        const sceneNames = presetSceneNames(preset);
        const sceneTag = sceneNames.length
            ? `<span class="vn-io-row-scene" title="${esc(sceneNames.join(', '))}"><i class="fas fa-map-pin"></i>${esc(sceneNames[0])}${sceneNames.length > 1 ? ` +${sceneNames.length - 1}` : ''}</span>` : '';
        return `<label class="vn-io-row" data-preset-id="${preset.id}">
            <input type="checkbox" class="vn-io-preset-cb" id="${cbId}" value="${preset.id}"${checked ? ' checked' : ''}>
            <span class="vn-io-row-name" title="${esc(preset.name)}">${esc(preset.name)}</span>
            ${sceneTag}
        </label>`;
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
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noModulesFound')}</div>`;
            return;
        }
        listEl.innerHTML = this.foundModules.map(m => {
            const applyBtns = this._applyButtonsHtml(m, `data-module-id="${esc(m.id)}"`);
            return `<div class="vn-io-module-item ${this.selectedModuleId === m.id ? 'active' : ''}" data-module-id="${m.id}">
                <div class="vn-io-module-info">
                    <span class="vn-io-module-title">${esc(m.title)}</span>
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

    /** Export: tells whether the typed name creates a set or updates one already stored in the target module, and lists the existing sets */
    _renderSetHint(root) {
        const hint = root.querySelector('#vn-io-set-hint');
        if (!hint) return;
        const moduleId = root.querySelector('#vn-io-module-id')?.value?.trim();
        if (!moduleId) { hint.innerHTML = ''; return; }
        const name = root.querySelector('#vn-io-set-name')?.value?.trim() || game.i18n.localize('vn.io.defaultSetName');
        const existing = this.existingSets.find(set => VNAdventureIO.sameSetName(set.name, name));
        const status = existing
            ? `<span class="vn-io-set-status is-update"><i class="fas fa-rotate"></i> ${game.i18n.format('vn.dialog.setWillUpdate', { name: esc(existing.name), count: existing.presets.length })}</span>`
            : `<span class="vn-io-set-status is-new"><i class="fas fa-plus"></i> ${game.i18n.format('vn.dialog.setWillCreate', { name: esc(name) })}</span>`;
        const chips = this.existingSets.map(set =>
            `<button type="button" class="vn-io-set-chip${existing === set ? ' active' : ''}" data-name="${esc(set.name)}" title="${esc(set.name)}">${esc(set.name)} <span class="vn-badge">${set.presets.length}</span></button>`).join('');
        hint.innerHTML = `${status}${chips ? `<div class="vn-io-set-chips"><span class="vn-io-set-chips-label">${game.i18n.localize('vn.dialog.setExisting')}</span>${chips}</div>` : ''}`;
    }

    /** Import: when the module offers several sets the GM picks one here; the preset list below shows only that set */
    _renderImportSets(root) {
        const el = root.querySelector('#vn-io-import-sets');
        if (!el) return;
        if (this.moduleSets.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.innerHTML = `<span class="vn-io-set-chips-label"><i class="fas fa-layer-group"></i> ${game.i18n.localize('vn.dialog.setPick')}</span>`
            + this.moduleSets.map((set, i) =>
                `<button type="button" class="vn-io-set-chip${i === this.selectedSetIndex ? ' active' : ''}" data-index="${i}" title="${esc(set.name)}">${esc(set.name)} <span class="vn-badge">${set.presets.length}</span></button>`).join('');
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
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsInModule')}</div>`;
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
            listEl.innerHTML = `<div class="vn-empty-hint">${game.i18n.localize(all.length ? 'vn.dialog.libraryNothing' : 'vn.dialog.libraryEmpty')}</div>`;
            return;
        }
        listEl.innerHTML = items.map(({ adv, status }) => {
            const meta = [
                `<span class="vn-io-module-id">${esc(adv.id)}</span>`,
                adv.author ? `<span><i class="fas fa-user-pen"></i> ${esc(adv.author)}</span>` : '',
                adv.entries.length > 1 ? `<span><i class="fas fa-layer-group"></i> ${game.i18n.format('vn.dialog.libraryCollections', { count: adv.entries.length })}</span>` : '',
            ].filter(Boolean).join('');
            const applyBtns = this._applyButtonsHtml(adv, `data-id="${esc(adv.id)}"`);
            const isActive = this.importSource?.kind === 'library' && this.importSource.id === adv.id;
            return `<div class="vn-io-module-item vn-io-lib-item${isActive ? ' active' : ''}" data-id="${esc(adv.id)}">
                <div class="vn-io-module-info">
                    <span class="vn-io-module-title">${esc(adv.title)}</span>
                    <span class="vn-io-lib-meta">${meta}</span>
                    ${adv.description ? `<span class="vn-io-lib-desc">${esc(adv.description)}</span>` : ''}
                    ${applyBtns ? `<div class="vn-io-module-apply-row">${applyBtns}</div>` : ''}
                </div>
                <span class="vn-io-lib-status is-${status}" title="${esc(game.i18n.localize(`vn.dialog.libraryStatus.${status}Title`))}">${game.i18n.localize(`vn.dialog.libraryStatus.${status}`)}</span>
                <button type="button" class="vn-btn vn-btn-xs vn-io-lib-load" data-id="${esc(adv.id)}">
                    <i class="fas fa-download"></i> ${game.i18n.localize('vn.dialog.btnLoadModule')}
                </button>
            </div>`;
        }).join('');
    }

    /** Warns when the presets being imported use files of an adventure module that is not running */
    _renderImportWarn(root) {
        const el = root.querySelector('#vn-io-import-warn');
        if (!el) return;
        const status = this.importSource?.kind === 'library' ? VNAdventureIO.moduleStatus(this.importSource.id) : 'active';
        el.hidden = status === 'active';
        el.innerHTML = el.hidden ? '' : `<i class="fas fa-triangle-exclamation"></i> ${game.i18n.format(`vn.dialog.libraryWarn.${status}`, { title: esc(this.importSource.title) })}`;
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
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
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
    _applyButtonsHtml(item, idAttr) {
        const nameplateLabel = item.nameplate
            ? (NAMEPLATE_CONFIGS[item.nameplate]?.label ?? item.nameplate.split('/').pop().replace(/\.[^.]+$/, ''))
            : null;
        const folderLabel = item.backgroundFolder ? (item.backgroundFolder.split('/').pop() || item.backgroundFolder) : null;
        return [
            nameplateLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-nameplate" ${idAttr} title="${esc(game.i18n.format('vn.dialog.setNameplateTitle', { label: nameplateLabel }))}"><i class="fas fa-id-badge"></i> ${esc(nameplateLabel)}</button>` : '',
            folderLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-folder" ${idAttr} title="${esc(game.i18n.format('vn.dialog.setFolderTitle', { folder: item.backgroundFolder }))}"><i class="fas fa-folder-open"></i> ${esc(folderLabel)}</button>` : '',
        ].filter(Boolean).join('');
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
        });

        // Scan modules
        root.querySelector('#vn-io-scan-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
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
            if (file.size > VNAdventureIOManager.MAX_IMPORT_BYTES) {
                ui.notifications.error(game.i18n.format('vn.dialog.fileTooLarge', { mb: VNAdventureIOManager.MAX_IMPORT_BYTES / 1048576 }));
                return;
            }
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                // A file may hold several sets (v3, e.g. copied from an adventure module): a file import takes all of them
                const sets = VNAdventureIO.normalizeSets(data);
                let presets = sets.flatMap(set => set.presets);
                presets = VNPresets.sanitizeImport(presets);
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

                const importedFolders = [...new Map(sets.flatMap(set => set.folders).map(f => [f.id, f])).values()];
                const folderOpts = await this._promptFolderImportChoice(importedFolders);
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
            const tags = root.querySelector('#vn-io-import-tags')?.checked ? this._importTags() : [];
            const added = await VNAdventureIO.mergeImport(presetsToImport, choice === 'overwrite', folderOpts, { tags });
            ui.notifications.info(game.i18n.format('vn.dialog.importedPresets', {count: added}));
            this._hooks.onImported?.(root);
        });
    }

    _showExportInstructions(moduleId, opts = {}) {
        const snippet = VNAdventureIO.moduleJsonSnippet(opts);
        const notesHtml = [
            opts.setName ? `<li>${game.i18n.format(opts.created ? 'vn.dialog.exportSetNoteCreated' : 'vn.dialog.exportSetNoteUpdated', { name: esc(opts.setName), total: opts.setsTotal })}</li>` : '',
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
                    <pre class="vn-io-snippet" id="vn-io-snippet-text">${esc(snippet)}</pre>
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

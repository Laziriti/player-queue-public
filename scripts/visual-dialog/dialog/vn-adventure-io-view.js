// Rendering helpers for import/export selection; actions and tab state stay in the manager.
import { NAMEPLATE_CONFIGS } from '../overlay/vn-nameplate.js';
import { buildActorPipsHtml } from './presets/vn-preset-card-html.js';
import { presetSceneNames } from '../presets/vn-preset-utils.js';
import { escapeHtml as esc } from '../../utils/text.js';
import { decodePath } from '../../utils/paths.js';

export function buildIOPresetGroups(groups, idPrefix, allChecked = false, viewMode = 'detailed') {
    return groups.map(({ label, icon, presets: group }) => {
        const items = viewMode === 'compact'
            ? group.map(p => buildIORowCompact(p, idPrefix, allChecked)).join('')
            : group.map(p => buildIOCardDetailed(p, idPrefix, allChecked)).join('');
        return `<div class="vn-io-scene-group">
            <div class="vn-io-scene-header">
                <label class="vn-io-group-check-label" title="${game.i18n.localize('vn.dialog.selectGroup')}">
                    <input type="checkbox" class="vn-io-group-cb"${allChecked ? ' checked' : ''}>
                </label>
                <i class="fas ${icon}"></i> ${esc(label)}
                <span class="vn-badge">${group.length}</span>
            </div>
            <div class="vn-io-scene-presets ${viewMode === 'compact' ? 'vn-io-compact' : 'vn-io-detailed'}">${items}</div>
        </div>`;
    }).join('');
}

export function buildIOCardDetailed(preset, idPrefix, checked) {
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

export function buildIORowCompact(preset, idPrefix, checked) {
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

export function applyButtonsHtml(item, idAttr) {
    const nameplateLabel = item.nameplate
        ? (NAMEPLATE_CONFIGS[item.nameplate]?.label ?? item.nameplate.split('/').pop().replace(/\.[^.]+$/, ''))
        : null;
    const folderLabel = item.backgroundFolder ? (item.backgroundFolder.split('/').pop() || item.backgroundFolder) : null;
    return [
        nameplateLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-nameplate" ${idAttr} title="${esc(game.i18n.format('vn.dialog.setNameplateTitle', { label: nameplateLabel }))}"><i class="fas fa-id-badge"></i> ${esc(nameplateLabel)}</button>` : '',
        folderLabel ? `<button type="button" class="vn-btn vn-btn-xs vn-io-apply-folder" ${idAttr} title="${esc(game.i18n.format('vn.dialog.setFolderTitle', { folder: item.backgroundFolder }))}"><i class="fas fa-folder-open"></i> ${esc(folderLabel)}</button>` : '',
    ].filter(Boolean).join('');
}

export function buildIOTab({ exportList, empty, mode, groupMode, viewMode, modules, nameplate, backgroundFolder }) {
    const exportEmpty = empty
        ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noPresetsToExport')}</div>`
        : '';
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
                            <button type="button" class="vn-btn vn-btn-xs vn-io-group-btn ${groupMode === 'scenes' ? 'active' : ''}" data-group="scenes"><i class="fas fa-map-location-dot"></i> ${t('vn.dialog.ioGroupScenes')}</button>
                            <button type="button" class="vn-btn vn-btn-xs vn-io-group-btn ${groupMode === 'folders' ? 'active' : ''}" data-group="folders"><i class="fas fa-folder"></i> ${t('vn.dialog.ioGroupFolders')}</button>
                        </div>
                        <div class="vn-io-view-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${viewMode === 'detailed' ? 'active' : ''}" data-view="detailed">${t('vn.dialog.viewDetailed')}</button>
                            <button type="button" class="vn-btn vn-btn-xs vn-io-view-btn ${viewMode === 'compact' ? 'active' : ''}" data-view="compact">${t('vn.dialog.viewCompact')}</button>
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
                            ${buildModuleSelect(modules)}
                        </div>
                        <div class="vn-io-module-input-row">
                            <label class="vn-io-label" title="${esc(t('vn.dialog.setNameTitle'))}"><i class="fas fa-layer-group"></i> ${t('vn.dialog.setNameLabel')}</label>
                            <input type="text" id="vn-io-set-name" class="vn-io-select" maxlength="80" autocomplete="off"
                                   placeholder="${esc(t('vn.io.defaultSetName'))}">
                        </div>
                        <div class="vn-io-set-hint" id="vn-io-set-hint"></div>
                        <div class="vn-io-module-input-row">
                            <label class="vn-io-label"><i class="fas fa-id-badge"></i> ${t('vn.dialog.nameplateLabel')}</label>
                            ${buildNameplateSelect(nameplate)}
                        </div>
                        <div class="vn-io-module-input-row">
                            <label class="vn-io-label"><i class="fas fa-folder-open"></i> ${t('vn.dialog.bgFolderLabel')}</label>
                            <div class="vn-io-folder-row">
                                <input type="text" id="vn-io-export-folder" class="vn-io-select" placeholder="${t('vn.dialog.bgFolderPlaceholder')}"
                                       value="${esc(decodePath(backgroundFolder))}" data-raw="${esc(backgroundFolder)}">
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


export function buildModuleSelect(modules) {
    const options = modules
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


export function buildNameplateSelect(current) {
    const opts = Object.entries(NAMEPLATE_CONFIGS).map(([path, cfg]) =>
        `<option value="${esc(path)}" ${path === current ? 'selected' : ''}>${esc(cfg.label || path.split('/').pop().replace(/\.[^.]+$/, ''))}</option>`
    ).join('');
    return `<select id="vn-io-nameplate" class="vn-io-select">
        <option value="" ${!current ? 'selected' : ''}>${game.i18n.localize('vn.dialog.selectNameplate')}</option>
        ${opts}
    </select>`;
}


export function buildModulesList(modules, selectedModuleId) {
    return modules.map(m => {
        const applyBtns = applyButtonsHtml(m, `data-module-id="${esc(m.id)}"`);
        return `<div class="vn-io-module-item ${selectedModuleId === m.id ? 'active' : ''}" data-module-id="${m.id}">
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
}

export function buildSetHint(sets, name, existing) {
    const status = existing
        ? `<span class="vn-io-set-status is-update"><i class="fas fa-rotate"></i> ${game.i18n.format('vn.dialog.setWillUpdate', { name: esc(existing.name), count: existing.presets.length })}</span>`
        : `<span class="vn-io-set-status is-new"><i class="fas fa-plus"></i> ${game.i18n.format('vn.dialog.setWillCreate', { name: esc(name) })}</span>`;
    const chips = sets.map(set =>
        `<button type="button" class="vn-io-set-chip${existing === set ? ' active' : ''}" data-name="${esc(set.name)}" title="${esc(set.name)}">${esc(set.name)} <span class="vn-badge">${set.presets.length}</span></button>`).join('');
    return `${status}${chips ? `<div class="vn-io-set-chips"><span class="vn-io-set-chips-label">${game.i18n.localize('vn.dialog.setExisting')}</span>${chips}</div>` : ''}`;
}

export function buildImportSets(sets, selectedSetIndex) {
    return `<span class="vn-io-set-chips-label"><i class="fas fa-layer-group"></i> ${game.i18n.localize('vn.dialog.setPick')}</span>`
        + sets.map((set, i) =>
            `<button type="button" class="vn-io-set-chip${i === selectedSetIndex ? ' active' : ''}" data-index="${i}" title="${esc(set.name)}">${esc(set.name)} <span class="vn-badge">${set.presets.length}</span></button>`).join('');
}

export function buildLibraryList(items, importSource) {
    return items.map(({ adv, status }) => {
        const meta = [
            `<span class="vn-io-module-id">${esc(adv.id)}</span>`,
            adv.author ? `<span><i class="fas fa-user-pen"></i> ${esc(adv.author)}</span>` : '',
            adv.entries.length > 1 ? `<span><i class="fas fa-layer-group"></i> ${game.i18n.format('vn.dialog.libraryCollections', { count: adv.entries.length })}</span>` : '',
        ].filter(Boolean).join('');
        const applyBtns = applyButtonsHtml(adv, `data-id="${esc(adv.id)}"`);
        const isActive = importSource?.kind === 'library' && importSource.id === adv.id;
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

export function buildExportInstructions(moduleId, opts, snippet) {
    const notesHtml = [
        opts.setName ? `<li>${game.i18n.format(opts.created ? 'vn.dialog.exportSetNoteCreated' : 'vn.dialog.exportSetNoteUpdated', { name: esc(opts.setName), total: opts.setsTotal })}</li>` : '',
        opts.nameplate ? `<li>${game.i18n.format('vn.dialog.nameplateNote', {filename: opts.nameplate.split('/').pop()})}</li>` : '',
        opts.backgroundFolder ? `<li>${game.i18n.format('vn.dialog.bgFolderNote', {folder: opts.backgroundFolder})}</li>` : '',
    ].filter(Boolean).join('');

    return `<div class="vn-io-instructions">
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
        </div>`;
}

export function buildEmptyHint(key) {
    return `<div class="vn-empty-hint">${game.i18n.localize(key)}</div>`;
}

export function buildImportWarning(status, title) {
    return `<i class="fas fa-triangle-exclamation"></i> ${game.i18n.format(`vn.dialog.libraryWarn.${status}`, { title: esc(title) })}`;
}

export function buildImportMessage(lines, file = false) {
    return `<div style="padding:6px 0">${lines.filter(Boolean).map(line => `<p style="margin:${file ? '0 0 8px' : '4px 0'}">${line}</p>`).join('')}</div>`;
}

export function buildFolderImportMessage(count) {
    return `<p>${game.i18n.format('vn.folders.importChoiceMsg', { count })}</p>`;
}

export const IO_SPINNER = '<i class="fas fa-spinner fa-spin"></i>';

export function buildCopyButton(copied = false) {
    return `<i class="fas ${copied ? 'fa-check' : 'fa-copy'}"></i> ${game.i18n.localize(copied ? 'vn.dialog.btnCopied' : 'vn.dialog.btnCopySnippet')}`;
}

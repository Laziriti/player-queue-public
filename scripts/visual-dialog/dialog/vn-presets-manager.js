// ============================================================
// vn-presets-manager.js — вкладка "Пресеты": сохранение/загрузка сцен
// ============================================================

import { VNPresets, VNFolders, MODULE_ID } from '../vn-state.js';
import { countPendingMigrations } from '../vn-migrations.js';
import { buildActorPipsHtml, groupPresetsByScene, escapeHtml } from '../vn-id-utils.js';
import { VNSequenceEditor } from './vn-sequence-editor.js';

const esc = escapeHtml;

const FOLDER_STORAGE_KEY = 'player-queue.vn-presets-folder';

export class VNPresetsManager {
    constructor() {
        this._sequenceEditor = new VNSequenceEditor(this);
        this.searchQuery = '';
        this.sceneFilter = false;
        this.tagFilter = null;
        this.viewMode = 'list';
        this.sortMode = 'newest';
        this.groupMode = 'scenes';
        this.selectedPresetId = null;
        this._currentFolderId = null;
        this._hooks = null;
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
        try { this.viewMode = game.settings.get(MODULE_ID, 'vnPresetsViewMode') || 'list'; } catch {}
        this.selectedPresetId = null;
        this._currentFolderId = this._restoreFolderId();
        return this._generateSection(sorted);
    }

    _generateSection(sorted) {
        const currentSceneName = canvas?.scene?.name ?? null;
        const currentSceneId = canvas?.scene?.id ?? null;
        const hasCurrent = !!currentSceneId;
        const isFolder = this.groupMode === 'folders';
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
                            data-scene-name="${esc(currentSceneName || '')}"${!hasCurrent ? ' disabled' : ''}>
                            <i class="fas fa-map-pin"></i>
                        </button>
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-accent vn-preset-save-btn"><i class="fas fa-save"></i> ${game.i18n.localize('vn.dialog.btnSavePreset')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-preset-new-seq-btn" title="${game.i18n.localize('vn.sequence.btnNewTitle')}"><i class="fas fa-film"></i> ${game.i18n.localize('vn.sequence.btnNew')}</button>
                    </div>
                    <div class="vn-preset-controls">
                        <div class="vn-presets-mode-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-presets-groupmode-btn${!isFolder ? ' active' : ''}" data-groupmode="scenes" title="${game.i18n.localize('vn.folders.modeScenes')}"><i class="fas fa-map-location-dot"></i><span class="vn-btn-label">${game.i18n.localize('vn.folders.modeScenes')}</span></button>
                            <button type="button" class="vn-btn vn-btn-xs vn-presets-groupmode-btn${isFolder ? ' active' : ''}" data-groupmode="folders" title="${game.i18n.localize('vn.folders.modeFolders')}"><i class="fas fa-folder"></i><span class="vn-btn-label">${game.i18n.localize('vn.folders.modeFolders')}</span></button>
                        </div>
                        <input type="text" class="vn-preset-search" placeholder="${game.i18n.localize('vn.dialog.searchPresetsPlaceholder')}">
                        <div class="vn-preset-view-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this.viewMode === 'list' ? 'active' : ''}" data-view="list" title="${game.i18n.localize('vn.dialog.viewList')}"><i class="fas fa-list"></i><span class="vn-btn-label">${game.i18n.localize('vn.dialog.viewList')}</span></button>
                            <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this.viewMode === 'cards' ? 'active' : ''}" data-view="cards" title="${game.i18n.localize('vn.dialog.viewCards')}"><i class="fas fa-th-large"></i><span class="vn-btn-label">${game.i18n.localize('vn.dialog.viewCards')}</span></button>
                        </div>
                        <button type="button" class="vn-btn vn-btn-sm vn-preset-scene-filter${this.sceneFilter ? ' active' : ''}" title="${game.i18n.format('vn.dialog.filterBySceneTitle', {sceneName: currentSceneName || game.i18n.localize('vn.dialog.thisSceneDefault')})}" data-scene-id="${currentSceneId || ''}">
                            <i class="fas fa-map"></i> ${game.i18n.localize('vn.dialog.thisScene')}
                        </button>
                        <select class="vn-preset-sort" title="${game.i18n.localize('vn.dialog.sortingTitle')}">
                            <option value="newest"${this.sortMode === 'newest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortNewest')}</option>
                            <option value="oldest"${this.sortMode === 'oldest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortOldest')}</option>
                            <option value="az"${this.sortMode === 'az' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortAZ')}</option>
                            <option value="za"${this.sortMode === 'za' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortZA')}</option>
                        </select>
                        <span class="vn-badge vn-preset-count" title="${game.i18n.localize('vn.dialog.savedPresetsHeader')}">${sorted.length}</span>
                        <details class="vn-menu vn-preset-menu">
                            <summary class="vn-btn vn-btn-xs" title="${game.i18n.localize('vn.dialog.presetsMenu')}"><i class="fas fa-ellipsis"></i></summary>
                            <div class="vn-menu-body">
                                <button type="button" class="vn-menu-item vn-preset-regen-all" title="${game.i18n.localize('vn.dialog.regenAllTitle')}"><i class="fas fa-camera"></i> ${game.i18n.localize('vn.dialog.btnRegenAll')}</button>
                                <button type="button" class="vn-menu-item vn-preset-thumb-folder" title="${esc(VNPresets.thumbnailDir())}"><i class="fas fa-folder-tree"></i> ${game.i18n.localize('vn.dialog.thumbFolderBtn')}</button>
                                ${game.settings.get(MODULE_ID, 'thumbnailFolder') ? `<button type="button" class="vn-menu-item vn-preset-thumb-folder-reset"><i class="fas fa-rotate-left"></i> ${game.i18n.localize('vn.dialog.thumbFolderReset')}</button>` : ''}
                                <button type="button" class="vn-menu-item vn-menu-item--danger vn-preset-clear-all" title="${game.i18n.localize('vn.dialog.deleteAllPresetsTitle')}"><i class="fas fa-trash-can"></i> ${game.i18n.localize('vn.dialog.btnDeleteAll')}</button>
                            </div>
                        </details>
                    </div>
                    <div class="vn-preset-tag-bar" hidden>
                        <input type="text" class="vn-tag-bar-search" placeholder="${game.i18n.localize('vn.dialog.tagBarSearch') || '…'}" autocomplete="off" spellcheck="false">
                        <div class="vn-tag-bar-chips"></div>
                    </div>
                    <div class="vn-preset-list${this.viewMode === 'cards' ? ' vn-preset-list--cards' : ''}${isFolder ? ' vn-preset-list--folder-mode' : ''}">${itemsHtml}</div>
                </div>
                <div class="vn-preset-detail-panel">
                    <div class="vn-panel-empty-hint"><i class="fas fa-hand-point-left"></i><span>${game.i18n.localize('vn.dialog.panelSelectHint')}</span></div>
                </div>
            </div>
        </div>`;
    }

    /** The folder a preset is shown in; an id that points to a deleted folder means the root. */
    _folderOf(p) {
        return p.folderId && VNFolders.get(p.folderId) ? p.folderId : null;
    }

    _sortPresets(presets) {
        const copy = [...presets];
        switch (this.sortMode) {
            case 'oldest': return copy.sort((a, b) => (a.createdAt || a.savedAt || 0) - (b.createdAt || b.savedAt || 0));
            case 'az':     return copy.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
            case 'za':     return copy.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ru'));
            default:       return copy.sort((a, b) => (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
        }
    }

    _buildFolderViewHtml(allPresets) {
        const favorites = VNFolders.getFavorites();
        const currentId = this.currentFolderId || null;
        const isCards = this.viewMode === 'cards';

        // Breadcrumb
        const path = VNFolders.getPath(currentId);
        const breadcrumbSegs = [
            `<span class="vn-folder-breadcrumb-seg${!currentId ? ' --active' : ''}" data-folder-id="">${game.i18n.localize('vn.folders.breadcrumbRoot')}</span>`
        ];
        for (const seg of path) {
            const isLast = seg.id === currentId;
            breadcrumbSegs.push(`<span class="vn-folder-breadcrumb-sep">/</span>`);
            breadcrumbSegs.push(`<span class="vn-folder-breadcrumb-seg${isLast ? ' --active' : ''}" data-folder-id="${seg.id}" title="${esc(seg.name)}">${esc(seg.name)}</span>`);
        }

        // Favorites quick-access strip
        const favFolders = favorites.map(id => VNFolders.get(id)).filter(Boolean);
        const favStrip = favFolders.length
            ? `<div class="vn-folder-favorites-strip">${
                favFolders.map(f => `<button type="button" class="vn-btn vn-btn-xs vn-folder-fav-shortcut${f.id === currentId ? ' --active' : ''}" data-folder-id="${f.id}" title="${esc(f.name)}"><i class="fas fa-star"></i> <span>${esc(f.name)}</span></button>`).join('')
              }</div>`
            : '';

        const toolbar = `<div class="vn-folder-toolbar">
            <button type="button" class="vn-btn vn-btn-xs vn-folder-new-btn"><i class="fas fa-folder-plus"></i> ${game.i18n.localize('vn.folders.btnNewFolder')}</button>
        </div>`;

        // When search is active — show flat list of all matching presets across all folders
        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            const matched = allPresets.filter(p =>
                (p.name || '').toLowerCase().includes(q) || (p.tags || []).some(t => t.toLowerCase().includes(q))
            );
            const presetsHtml = matched.length
                ? (isCards
                    ? `<div class="vn-preset-cards">${matched.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                    : matched.map(p => this._buildPresetListItemHtml(p, false, true)).join(''))
                : `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.nothingFound')}</div>`;
            return `<div class="vn-folder-bar"><div class="vn-folder-breadcrumb">${breadcrumbSegs.join('')}</div>${favStrip}${toolbar}</div>
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
            const fid = this._folderOf(p);
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
            return `<div class="vn-folder-item${isFav ? ' --favorite' : ''}${isCards ? ' --card' : ''}" data-folder-id="${f.id}" draggable="true" title="${esc(f.name)}">
                <i class="fas fa-folder"></i>
                <span class="vn-folder-item-name">${esc(f.name)}</span>
                ${badge}
                <span class="vn-folder-actions">
                    <button type="button" class="vn-btn vn-btn-xs vn-folder-fav-btn${isFav ? ' --active' : ''}" data-folder-id="${f.id}" title="${game.i18n.localize('vn.folders.toggleFavorite')}"><i class="fas fa-star"></i></button>
                    <button type="button" class="vn-btn vn-btn-xs vn-folder-rename-btn" data-folder-id="${f.id}" title="${game.i18n.localize('vn.folders.renameFolder')}"><i class="fas fa-pencil"></i></button>
                    <button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-folder-delete-btn" data-folder-id="${f.id}" title="${game.i18n.localize('vn.folders.deleteFolder')}"><i class="fas fa-trash"></i></button>
                </span>
            </div>`;
        }).join('');

        const folderItemsHtml = isCards && children.length
            ? `<div class="vn-folder-items-grid">${folderItems}</div>`
            : folderItems;

        // Preset items in current folder (cards are draggable for drop-to-folder)
        const folderPresets = allPresets.filter(p => this._folderOf(p) === currentId);
        const presetsHtml = folderPresets.length
            ? (isCards
                ? `<div class="vn-preset-cards">${folderPresets.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                : folderPresets.map(p => this._buildPresetListItemHtml(p, false, true)).join(''))
            : '';

        const emptyHint = !children.length && !folderPresets.length
            ? `<div class="vn-empty-hint">${game.i18n.localize('vn.folders.emptyFolder')}</div>`
            : '';

        return `<div class="vn-folder-bar"><div class="vn-folder-breadcrumb">${breadcrumbSegs.join('')}</div>${favStrip}${toolbar}</div>
            ${folderItemsHtml}
            ${presetsHtml}
            ${emptyHint}`;
    }

    _buildPresetItemsHtml(sortedPresets) {
        if (!sortedPresets.length) return '';
        sortedPresets = this._sortPresets(sortedPresets);
        const isCards = this.viewMode === 'cards';
        const hasAnyScene = sortedPresets.some(p => p.sceneName);

        // Items are always draggable: besides dropping into folders they can be dropped into a composite preset's step list
        if (!hasAnyScene) {
            return isCards
                ? `<div class="vn-preset-cards">${sortedPresets.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                : sortedPresets.map(p => this._buildPresetListItemHtml(p, false, true)).join('');
        }

        return groupPresetsByScene(sortedPresets).map(({ key, presets: group }) => {
            const label = esc(key || game.i18n.localize('vn.dialog.noScene'));
            const items = isCards
                ? `<div class="vn-preset-cards">${group.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                : `<div class="vn-preset-group-items">${group.map(p => this._buildPresetListItemHtml(p, true, true)).join('')}</div>`;
            return `<div class="vn-preset-scene-group" data-group-key="${esc(key)}">
                <div class="vn-preset-scene-hdr">
                    <i class="fas fa-map-pin"></i> ${label}
                    <span class="vn-badge">${group.length}</span>
                    <div class="vn-preset-group-actions">
                        <button type="button" class="vn-btn vn-btn-xs vn-preset-group-regen" data-group-key="${esc(key)}" title="${game.i18n.format('vn.dialog.regenGroupTitle', {label})}"><i class="fas fa-camera"></i></button>
                        <button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-preset-group-delete" data-group-key="${esc(key)}" title="${game.i18n.format('vn.dialog.deleteGroupTitle', {label})}"><i class="fas fa-trash-can"></i></button>
                    </div>
                </div>
                ${items}
            </div>`;
        }).join('');
    }

    // Returns pending-migration count plus both markup shapes callers need:
    // a labeled badge for the list view, a bare icon for the card view's version pill.
    _migrationBadgeHtml(p) {
        const count = countPendingMigrations(p);
        if (!count) return { count, badgeHtml: '', iconHtml: '' };
        const title = game.i18n.format('vn.dialog.presetMigrationHint', { count });
        return {
            count,
            badgeHtml: `<span class="vn-preset-migration-badge" title="${title}"><i class="fas fa-wrench"></i> ${count}</span>`,
            iconHtml: `<i class="fas fa-wrench" title="${title}"></i>`,
        };
    }

    _buildPresetListItemHtml(p, grouped = false, draggable = false) {
        const sceneTag = (!grouped && p.sceneName)
            ? `<span class="vn-preset-scene-tag"><i class="fas fa-map-pin"></i>${esc(p.sceneName)}</span>`
            : '';
        const createdStr = this._formatDate(p.createdAt || p.savedAt);
        const updatedStr = (p.updatedAt && p.updatedAt !== p.createdAt) ? this._formatDate(p.updatedAt) : null;
        const dateText = updatedStr
            ? game.i18n.format('vn.dialog.presetCreatedUpdated', {created: createdStr, updated: updatedStr})
            : createdStr ? game.i18n.format('vn.dialog.presetCreated', {date: createdStr}) : '';
        const { count: pendingMigrations, badgeHtml: migrationHtml } = this._migrationBadgeHtml(p);
        // The version is only worth a chip when it explains why the migration badge is there
        const versionHtml = (p.version && pendingMigrations) ? `<span class="vn-preset-version">v${p.version}</span>` : '';
        const isSeq = VNPresets.isSequence(p);
        const seqTag = isSeq
            ? `<span class="vn-preset-seq-tag" title="${game.i18n.format('vn.sequence.badgeTitle', { count: p.steps?.length ?? 0 })}"><i class="fas fa-film"></i> ${game.i18n.localize('vn.sequence.tagLabel')} · ${p.steps?.length ?? 0}</span>`
            : '';
        const metaHtml = (sceneTag || dateText || versionHtml || migrationHtml || seqTag)
            ? `<div class="vn-preset-meta">${seqTag}${sceneTag}<span class="vn-preset-dates">${dateText}</span>${versionHtml}${migrationHtml}</div>`
            : '';
        const tagsHtml = p.tags?.length
            ? `<div class="vn-preset-tags">${p.tags.map(t => `<span class="vn-tag-chip" data-tag="${esc(t)}">${esc(t)}</span>`).join('')}</div>`
            : '';
        return `<div class="vn-preset-item${isSeq ? ' vn-preset-item--seq' : ''}" data-preset="${p.id}" data-preset-name="${esc(p.name)}" data-scene-id="${p.sceneId || ''}" data-tags="${esc((p.tags || []).join(','))}"${draggable ? ' draggable="true"' : ''}>
            <div class="vn-preset-info">
                <span class="vn-preset-name" title="${esc(p.name)}">${esc(p.name)}</span>
                ${metaHtml}${tagsHtml}
            </div>
            <div class="vn-preset-actions">${this._presetActionButtons(p.id)}</div>
        </div>`;
    }

    _buildPresetCardHtml(p, draggable = false) {
        const bgSrc = p.thumbnailData || (p.background && p.background !== 'none' ? p.background : null);
        const imgHtml = bgSrc
            ? `<img class="vn-preset-card-img" src="${esc(bgSrc)}" loading="lazy" decoding="async" alt="">`
            : `<div class="vn-preset-card-placeholder"><i class="fas fa-film"></i></div>`;

        const allIds = [...(p.leftIds || []), ...(p.centerIds || []), ...(p.rightIds || [])];
        const pipsHtml = buildActorPipsHtml(allIds, p.portraitImages || {}, p.portraitNames || {});

        const { count: pendingMigrations, iconHtml: migrationIcon } = this._migrationBadgeHtml(p);
        const verHtml = pendingMigrations
            ? `<div class="vn-preset-card-ver --migration">${migrationIcon}${p.version ? `v${p.version}` : ''}</div>`
            : '';

        const MAX_CARD_TAGS = 3;
        const visibleTags = (p.tags || []).slice(0, MAX_CARD_TAGS);
        const hiddenCount = (p.tags?.length || 0) - visibleTags.length;
        const tagsHtml = visibleTags.length
            ? `<div class="vn-preset-tags">${visibleTags.map(t => `<span class="vn-tag-chip" data-tag="${esc(t)}">${esc(t)}</span>`).join('')}${hiddenCount > 0 ? `<span class="vn-preset-tags-more">+${hiddenCount}</span>` : ''}</div>`
            : '';

        const isSeq = VNPresets.isSequence(p);
        const seqHtml = isSeq
            ? `<div class="vn-preset-card-seq" title="${game.i18n.format('vn.sequence.badgeTitle', { count: p.steps?.length ?? 0 })}"><i class="fas fa-film"></i> ${p.steps?.length ?? 0}</div>`
            : '';

        return `<div class="vn-preset-card${isSeq ? ' vn-preset-card--seq' : ''}" data-preset="${p.id}" data-preset-name="${esc(p.name)}" data-scene-id="${p.sceneId || ''}" data-tags="${esc((p.tags || []).join(','))}"${draggable ? ' draggable="true"' : ''}>
            <div class="vn-preset-card-poster">
                ${imgHtml}
                ${pipsHtml}
                ${seqHtml}
                ${verHtml}
                <div class="vn-preset-card-footer">
                    <div class="vn-preset-card-name" title="${esc(p.name)}">${esc(p.name)}</div>
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

    _applyPresetFilters(root) {
        const q = this.searchQuery.toLowerCase();
        const filterScene = this.sceneFilter;
        const activeTag = this.tagFilter;
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
        return VNPresetsManager.PRESET_ACTIONS.map(a => this._presetBtn(a.action, presetId, a.icon, a.extra, game.i18n.localize(a.title))).join('');
    }

    attachListeners(root, hooks = {}) {
        this._hooks = hooks;
        this._attachControlListeners(root);
        this._attachItemListeners(root);
        this._attachPanelListeners(root);
    }

    _attachControlListeners(root) {
        if (root._presetControlsAttached) return;
        root._presetControlsAttached = true;

        root.querySelector('.vn-preset-search')?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim();
            if (this.groupMode === 'folders') {
                this.refresh(root);
            } else {
                this._applyPresetFilters(root);
            }
        });

        const filterBtn = root.querySelector('.vn-preset-scene-filter');
        filterBtn?.addEventListener('click', () => {
            this.sceneFilter = !this.sceneFilter;
            filterBtn.classList.toggle('active', this.sceneFilter);
            this._applyPresetFilters(root);
        });

        root.querySelector('.vn-preset-tag-bar')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.vn-tag-filter-chip');
            if (!chip) return;
            const tag = chip.dataset.tag;
            this.tagFilter = this.tagFilter === tag ? null : tag;
            this._refreshTagFilterBar(root);
            this._applyPresetFilters(root);
        });

        root.querySelector('.vn-preset-tag-bar')?.addEventListener('input', (e) => {
            if (!e.target.classList.contains('vn-tag-bar-search')) return;
            this._refreshTagFilterBar(root);
        });

        root.querySelector('.vn-preset-tag-bar')?.addEventListener('contextmenu', async (e) => {
            const chip = e.target.closest('.vn-tag-filter-chip');
            if (!chip) return;
            e.preventDefault();
            const tag = chip.dataset.tag;
            const confirmed = await this._confirmDialog(
                game.i18n.localize('vn.dialog.deleteTagGlobalTitle'),
                `<p>${game.i18n.format('vn.dialog.deleteTagGlobalConfirm', { tag: esc(tag) })}</p>`,
                game.i18n.localize('vn.dialog.btnDelete'), 'fas fa-trash'
            );
            if (!confirmed) return;
            const presets = await VNPresets.getAll();
            const affected = Object.values(presets).filter(p => (p.tags || []).includes(tag));
            for (const p of affected) {
                await VNPresets.setTags(p.id, (p.tags || []).filter(t => t !== tag));
            }
            if (this.tagFilter === tag) this.tagFilter = null;
            this.refresh(root);
        });

        this._refreshTagFilterBar(root);

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
            let timer = null;
            root._vnStoreHook = Hooks.on('vnStoreChanged', ({ remote }) => {
                if (!root.isConnected) { Hooks.off('vnStoreChanged', root._vnStoreHook); root._vnStoreHook = null; return; }
                if (!remote) return;
                clearTimeout(timer);
                timer = setTimeout(() => {
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
            await VNPresets.save(name, gatheredState, attachScene, saveOpts);
            this._hooks.syncPresetActors?.(gatheredState.presetActors);
            nameInput.value = '';
            this.refresh(root);
        });

        root.querySelector('.vn-preset-new-seq-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this._createSequence(root);
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
        const FPImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
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
            if (tagChip && !tagChip.closest('.vn-tag-popover')) {
                const tag = tagChip.dataset.tag;
                this.tagFilter = this.tagFilter === tag ? null : tag;
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
            case 'tags':
                await this._handlePresetTags(btn, presetId, root);
                break;
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

                const presetSceneHtml = preset.sceneName ? `<p style="margin:4px 0">${game.i18n.format('vn.dialog.presetSceneLabel', {sceneName: esc(preset.sceneName)})}</p>` : '';
                const curSceneHtml = curName ? `<p style="margin:4px 0">${game.i18n.format('vn.dialog.currentSceneLabel', {sceneName: esc(curName)})}</p>` : '';

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
                    ${tags.map((t, i) => `<span class="vn-tag-chip vn-tag-chip--rm"><span>${esc(t)}</span><button type="button" class="vn-tag-rm-btn" data-index="${i}" title="Remove">×</button></span>`).join('')}
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
            if (sorted) this.refresh(root, sorted);
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
            if (this.tagFilter) this.tagFilter = null;
            return;
        }
        bar.hidden = false;
        if (this.tagFilter && !allTags.has(this.tagFilter)) this.tagFilter = null;
        const query = (bar.querySelector('.vn-tag-bar-search')?.value || '').trim().toLowerCase();
        const visible = [...allTags].sort().filter(t => !query || t.includes(query));
        if (chipsEl) {
            chipsEl.innerHTML = visible.map(tag =>
                `<button type="button" class="vn-tag-filter-chip${this.tagFilter === tag ? ' active' : ''}" data-tag="${esc(tag)}">${esc(tag)}</button>`
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
        this.selectedPresetId = presetId;
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

        const sameBody = panel.dataset.presetId === preset.id ? panel.querySelector('.vn-panel-body') : null;
        const keepScroll = sameBody?.scrollTop ?? 0;

        panel.dataset.presetId = preset.id;
        panel.dataset.presetName = preset.name;

        const tags = [...(preset.tags || [])];
        const allTags = this._getAllExistingTags(root);
        const suggestions = allTags.filter(t => !tags.includes(t));
        const dateCreated = this._formatDate(preset.createdAt || preset.savedAt);
        const dateUpdated = (preset.updatedAt && preset.updatedAt !== preset.createdAt) ? this._formatDate(preset.updatedAt) : null;

        const tagsChipsHtml = tags.map((t, i) =>
            `<span class="vn-tag-chip vn-tag-chip--rm" data-tag="${esc(t)}"><span>${esc(t)}</span><button type="button" class="vn-tag-rm-btn" data-index="${i}">×</button></span>`
        ).join('');
        const suggestHtml = suggestions.map(t =>
            `<button type="button" class="vn-panel-tag-suggest" data-tag="${esc(t)}">${esc(t)}</button>`
        ).join('');

        const isSequence = VNPresets.isSequence(preset);
        const panelAction = (action, icon, key, extra = '') =>
            `<button type="button" class="vn-btn vn-btn-sm ${extra} vn-panel-action" data-action="${action}" data-preset="${preset.id}"><i class="fas ${icon}"></i> ${game.i18n.localize(key)}</button>`;
        // A sequence is launched, not loaded into the form; its content is edited step by step instead
        const primaryActions = isSequence
            ? panelAction('launch', 'fa-play', 'vn.dialog.presetActionLaunch', 'vn-btn-accent')
            : panelAction('load', 'fa-upload', 'vn.dialog.presetActionLoad') + panelAction('update', 'fa-arrows-rotate', 'vn.dialog.presetActionUpdate');
        const optionsHtml = isSequence ? this._sequenceEditor.optionsHtml(preset) : '';
        const stepsHtml = isSequence ? this._sequenceEditor.stepsHtml(preset) : '';

        const nameAndActions = `
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelName')}</label>
                    <input type="text" class="vn-panel-name-input" value="${esc(preset.name)}" autocomplete="off" spellcheck="false">
                </div>
                <div class="vn-panel-section">
                    <div class="vn-panel-actions${isSequence ? ' vn-panel-actions--compact' : ''}">
                        ${primaryActions}
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="regen" data-preset="${preset.id}"><i class="fas fa-camera"></i> ${game.i18n.localize('vn.dialog.presetActionRegen')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="macro" data-preset="${preset.id}"><i class="fas fa-code"></i> ${game.i18n.localize('vn.dialog.presetActionMacro')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="assign" data-preset="${preset.id}"><i class="fas fa-location-dot"></i> ${game.i18n.localize('vn.dialog.presetActionAssign')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-danger vn-panel-action vn-panel-action--delete" data-action="delete" data-preset="${preset.id}"><i class="fas fa-trash"></i> ${game.i18n.localize('vn.dialog.presetActionDelete')}</button>
                    </div>
                </div>`;

        const infoAndTags = `
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <div class="vn-panel-info">
                        ${preset.version ? `<span class="vn-panel-info-row"><i class="fas fa-code-branch"></i><span>v${preset.version}</span></span>` : ''}
                        ${dateCreated ? `<span class="vn-panel-info-row"><i class="fas fa-calendar-plus"></i><span>${dateCreated}</span></span>` : ''}
                        ${dateUpdated ? `<span class="vn-panel-info-row"><i class="fas fa-calendar-check"></i><span>${dateUpdated}</span></span>` : ''}
                        ${preset.sceneName ? `<span class="vn-panel-info-row"><i class="fas fa-map-pin"></i><span>${esc(preset.sceneName)}</span></span>` : ''}
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
                    ${suggestHtml ? `<span class="vn-panel-sublabel">${game.i18n.localize('vn.dialog.panelTagsExisting')}</span>` : ''}
                    <div class="vn-panel-tag-dropdown">${suggestHtml}</div>
                </div>`;

        // Same panel width as a regular preset; a composite one just scrolls further down (options, then the steps)
        const body = isSequence
            ? `<div class="vn-panel-body">${nameAndActions}${optionsHtml}<hr class="vn-panel-section-divider">${stepsHtml}${infoAndTags}</div>`
            : `<div class="vn-panel-body">${nameAndActions}${infoAndTags}</div>`;

        panel.innerHTML = `
            <div class="vn-panel-header--preset-detail">
                <span class="vn-panel-title"><i class="fas ${isSequence ? 'fa-film' : 'fa-pen-to-square'}"></i> ${esc(preset.name)}</span>
                <button type="button" class="vn-btn vn-btn-xs vn-panel-close-btn" title="${game.i18n.localize('vn.dialog.btnClose')}"><i class="fas fa-times"></i></button>
            </div>
            ${body}`;

        if (keepScroll) {
            const newBody = panel.querySelector('.vn-panel-body');
            if (newBody) newBody.scrollTop = keepScroll;
        }
    }

    _attachPanelListeners(root) {
        const panel = root.querySelector('.vn-preset-detail-panel');
        if (!panel || panel._panelListenerAttached) return;
        panel._panelListenerAttached = true;
        this._sequenceEditor.attach(panel, root);

        panel.addEventListener('click', async (e) => {
            if (e.target.closest('.vn-panel-close-btn')) {
                this.selectedPresetId = null;
                this._markSelectedItem(root, null);
                this._renderPresetPanel(root, null);
                return;
            }

            const rmBtn = e.target.closest('.vn-tag-rm-btn');
            if (rmBtn) {
                const presetId = this.selectedPresetId;
                if (!presetId) return;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                tags.splice(Number(rmBtn.dataset.index), 1);
                const sorted = await VNPresets.setTags(presetId, tags);
                if (sorted) this.refresh(root, sorted);
                return;
            }

            const suggest = e.target.closest('.vn-panel-tag-suggest');
            if (suggest) {
                const presetId = this.selectedPresetId;
                if (!presetId) return;
                const tag = suggest.dataset.tag;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                if (!tags.includes(tag)) {
                    tags.push(tag);
                    const sorted = await VNPresets.setTags(presetId, tags);
                    if (sorted) this.refresh(root, sorted);
                }
                return;
            }

            const actionBtn = e.target.closest('.vn-panel-action[data-action]');
            if (actionBtn) {
                await this._handlePresetAction(actionBtn.dataset.action, actionBtn.dataset.preset, actionBtn, root);
            }
        });

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
                    `<button type="button" class="vn-panel-tag-suggest" data-tag="${esc(t)}">${esc(t)}</button>`
                ).join('');
            }
        });

        panel.addEventListener('keydown', async (e) => {
            if (e.target.classList.contains('vn-panel-tag-input')) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const presetId = this.selectedPresetId;
                if (!presetId) return;
                const val = e.target.value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
                if (!val) return;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                if (!tags.includes(val)) { tags.push(val); }
                e.target.value = '';
                const sorted = await VNPresets.setTags(presetId, tags);
                if (sorted) this.refresh(root, sorted);
                root.querySelector('.vn-preset-detail-panel')?.querySelector('.vn-panel-tag-input')?.focus();
            } else if (e.target.classList.contains('vn-panel-name-input')) {
                if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    const preset = await VNPresets.load(this.selectedPresetId);
                    if (preset) e.target.value = preset.name;
                    e.target.blur();
                }
            }
        });

        panel.addEventListener('blur', async (e) => {
            if (!e.target.classList.contains('vn-panel-name-input')) return;
            const presetId = this.selectedPresetId;
            if (!presetId) return;
            const preset = await VNPresets.load(presetId);
            if (!preset) return;
            const newName = e.target.value.trim();
            if (newName && newName !== preset.name) {
                const sorted = await VNPresets.rename(presetId, newName);
                if (sorted) this.refresh(root, sorted);
            }
        }, { capture: true });

        panel.addEventListener('contextmenu', async (e) => {
            if (!e.target.closest('.vn-panel-tags-chips')) return;
            const chip = e.target.closest('.vn-tag-chip');
            if (!chip) return;
            e.preventDefault();
            const presetId = this.selectedPresetId;
            if (!presetId) return;
            const tag = chip.dataset.tag;
            const preset = await VNPresets.load(presetId);
            if (!preset) return;
            const sorted = await VNPresets.setTags(presetId, (preset.tags || []).filter(t => t !== tag));
            if (sorted) this.refresh(root, sorted);
        });
    }

    async _handleGroupDelete(btn, root) {
        const groupKey = btn.dataset.groupKey;
        const label = groupKey || game.i18n.localize('vn.dialog.noScene');
        const count = btn.closest('.vn-preset-scene-group')?.querySelectorAll('.vn-preset-item, .vn-preset-card').length || 0;
        const confirmed = await this._confirmDialog(
            game.i18n.localize('vn.dialog.deleteGroupDialogTitle'),
            `<p>${game.i18n.format('vn.dialog.deleteGroupConfirm', {count, label: esc(label)})}</p>`,
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

    async _createSequence(root) {
        const input = root.querySelector('#vn-preset-name');
        let name = input?.value?.trim();
        if (!name) {
            name = await this._promptFolderName(root, game.i18n.localize('vn.sequence.newTitle'), {
                placeholder: game.i18n.localize('vn.sequence.namePlaceholder'), icon: 'fas fa-film',
            });
        }
        if (!name) return;
        const attachScene = root.querySelector('#vn-preset-scene-pin')?.classList.contains('active') ?? true;
        const opts = this.groupMode === 'folders' ? { folderId: this.currentFolderId } : {};
        const preset = await VNPresets.createSequence(name, attachScene, opts);
        if (input) input.value = '';
        await this.refresh(root);
        await this._selectPreset(root, preset.id);
    }

    async _promptFolderName(root, title, { placeholder = game.i18n.localize('vn.folders.folderNamePlaceholder'), icon = 'fas fa-folder-plus' } = {}) {
        return new Promise(resolve => {
            let value = '', submitted = false;
            const dlg = new foundry.applications.api.DialogV2({
                window: { title },
                classes: ['vn-confirm-dialog'],
                position: { width: 420 },
                content: `<div style="padding:6px 0"><input type="text" class="vn-folder-name-input" placeholder="${placeholder}" autofocus></div>`,
                buttons: [
                    { action: 'create', label: game.i18n.localize('vn.folders.btnCreate'), icon, default: true },
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
            listEl.innerHTML = this._buildFolderViewHtml(sorted);
        } else {
            listEl.innerHTML = sorted.length === 0
                ? `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noSavedPresets')}</div>`
                : this._buildPresetItemsHtml(sorted);
        }

        this._attachControlListeners(root);
        this._attachItemListeners(root);
        this._refreshTagFilterBar(root);
        this._applyPresetFilters(root);

        if (this.selectedPresetId) {
            const still = sorted.find(p => p.id === this.selectedPresetId);
            if (still) {
                this._markSelectedItem(root, this.selectedPresetId);
                this._renderPresetPanel(root, still);
            } else {
                this.selectedPresetId = null;
                this._renderPresetPanel(root, null);
            }
        }
        this._attachPanelListeners(root);
    }
}

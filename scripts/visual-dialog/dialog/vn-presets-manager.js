// ============================================================
// vn-presets-manager.js — вкладка "Пресеты": сохранение/загрузка сцен
// ============================================================

import { VNPresets, VNFolders, MODULE_ID } from '../vn-state.js';
import { countPendingMigrations } from '../vn-migrations.js';
import { buildActorPipsHtml, groupPresetsByScene, escapeHtml, presetScenes, presetSceneNames } from '../vn-id-utils.js';
import { VNSequenceEditor } from './vn-sequence-editor.js';
import { VNScenePicker } from './vn-scene-picker.js';
import { VISUAL_LABELS, VISUAL_ICONS } from '../visual-effects/atmosphere/config/visual-types.js';
import { PARTICLE_LABELS, PARTICLE_ICONS } from '../visual-effects/atmosphere/config/particle-types.js';

const esc = escapeHtml;

const FOLDER_STORAGE_KEY = 'player-queue.vn-presets-folder';
// Foundry keeps a client-scope setting in localStorage under "<module>.<key>" (JSON) and only after it was set explicitly
const VIEW_SETTING_STORAGE_KEY = `${MODULE_ID}.vnPresetsViewMode`;

export class VNPresetsManager {
    constructor() {
        this._sequenceEditor = new VNSequenceEditor(this);
        this.searchQuery = '';
        this.sceneFilter = false;
        this.tagFilters = new Set();   // tags picked in the tag picker
        this.tagMatch = 'all';         // 'all' = a preset must have every picked tag, 'any' = at least one
        this._tagCounts = new Map();   // tag -> number of presets, rebuilt from the list by _refreshTagFilterBar
        this._tagOutsideListener = null;
        this.viewMode = 'cards';
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
                    <div class="vn-preset-save-row" role="group" aria-label="${esc(game.i18n.localize('vn.dialog.btnSavePreset'))}">
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
                        <select class="vn-preset-sort" title="${game.i18n.localize('vn.dialog.sortingTitle')}">
                            <option value="newest"${this.sortMode === 'newest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortNewest')}</option>
                            <option value="oldest"${this.sortMode === 'oldest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortOldest')}</option>
                            <option value="az"${this.sortMode === 'az' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortAZ')}</option>
                            <option value="za"${this.sortMode === 'za' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortZA')}</option>
                        </select>
                        <button type="button" class="vn-btn vn-btn-sm vn-preset-scene-filter${this.sceneFilter ? ' active' : ''}" title="${game.i18n.format('vn.dialog.filterBySceneTitle', {sceneName: currentSceneName || game.i18n.localize('vn.dialog.thisSceneDefault')})}" data-scene-id="${currentSceneId || ''}">
                            <i class="fas fa-map"></i><span class="vn-preset-scene-filter-label">${game.i18n.localize('vn.dialog.thisScene')}</span>
                        </button>
                        <div class="vn-preset-tag-bar" hidden>
                            <button type="button" class="vn-btn vn-btn-xs vn-tag-picker-btn" title="${esc(game.i18n.localize('vn.dialog.tagPickerTitle'))}">
                                <i class="fas fa-tags"></i><span class="vn-tag-picker-btn-label">${game.i18n.localize('vn.dialog.tagPickerBtn')}</span> <span class="vn-badge vn-tag-picker-count" hidden></span> <i class="fas fa-caret-down"></i>
                            </button>
                            <div class="vn-tag-bar-picked" hidden>
                                <div class="vn-tag-bar-active"></div>
                                <button type="button" class="vn-btn vn-btn-xs vn-tag-bar-clear" title="${esc(game.i18n.localize('vn.dialog.tagClearTitle'))}" hidden><i class="fas fa-xmark"></i></button>
                            </div>
                            <div class="vn-tag-picker" hidden>
                                <div class="vn-tag-picker-head">
                                    <label class="vn-tag-picker-search">
                                        <i class="fas fa-magnifying-glass"></i>
                                        <input type="text" class="vn-tag-picker-input" placeholder="${esc(game.i18n.localize('vn.dialog.tagPickerSearch'))}" autocomplete="off" spellcheck="false">
                                    </label>
                                    <div class="vn-tag-match" title="${esc(game.i18n.localize('vn.dialog.tagMatchTitle'))}">
                                        <button type="button" class="vn-btn vn-btn-xs vn-tag-match-btn" data-match="all">${game.i18n.localize('vn.dialog.tagMatchAll')}</button>
                                        <button type="button" class="vn-btn vn-btn-xs vn-tag-match-btn" data-match="any">${game.i18n.localize('vn.dialog.tagMatchAny')}</button>
                                    </div>
                                </div>
                                <div class="vn-tag-picker-list"></div>
                                <div class="vn-tag-picker-foot">
                                    <span class="vn-tag-picker-total"></span>
                                    <button type="button" class="vn-btn vn-btn-xs vn-tag-picker-reset">${game.i18n.localize('vn.dialog.tagPickerReset')}</button>
                                </div>
                            </div>
                        </div>
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
                    <div class="vn-preset-list${this.viewMode === 'cards' ? ' vn-preset-list--cards' : ''}${isFolder ? ' vn-preset-list--folder-mode' : ''}">${itemsHtml}</div>
                </div>
                <div class="vn-preset-detail-panel" hidden></div>
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

    // The sort mode orders the scene groups too (they were always alphabetical, so the selector looked dead); "no scene" stays last
    _sortSceneGroups(groups) {
        const time = p => p.createdAt || p.savedAt || 0;
        const newest = g => Math.max(...g.presets.map(time));
        const oldest = g => Math.min(...g.presets.map(time));
        const byKey = (a, b) => a.key.localeCompare(b.key, 'ru');
        const cmp = {
            az: byKey,
            za: (a, b) => byKey(b, a),
            oldest: (a, b) => oldest(a) - oldest(b),
            newest: (a, b) => newest(b) - newest(a),
        }[this.sortMode] ?? byKey;
        return [...groups].sort((a, b) => (!a.key) - (!b.key) || cmp(a, b));
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
        const folderPresets = this._sortPresets(allPresets.filter(p => this._folderOf(p) === currentId));
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
        const hasAnyScene = sortedPresets.some(p => presetSceneNames(p).length);

        // Items are always draggable: besides dropping into folders they can be dropped into a composite preset's step list
        if (!hasAnyScene) {
            return isCards
                ? `<div class="vn-preset-cards">${sortedPresets.map(p => this._buildPresetCardHtml(p, true)).join('')}</div>`
                : sortedPresets.map(p => this._buildPresetListItemHtml(p, false, true)).join('');
        }

        return this._sortSceneGroups(groupPresetsByScene(sortedPresets)).map(({ key, presets: group }) => {
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
        const sceneTag = grouped ? '' : this._sceneTagHtml(p);
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
        // One line under the name: kind, effect/music hints, scene, date, then the tags in whatever room is left
        const shortDate = this._formatDate(p.updatedAt || p.createdAt || p.savedAt).split(' ')[0];
        const dateHtml = shortDate ? `<span class="vn-preset-dates" title="${esc(dateText)}"><i class="fas fa-clock"></i>${shortDate}</span>` : '';
        const metaHtml = `<div class="vn-preset-meta">${seqTag}${this._hintsHtml(p)}${sceneTag}${dateHtml}${versionHtml}${migrationHtml}</div>`;
        const tagsHtml = this._presetTagsHtml(p);
        const bgSrc = this._previewSrc(p);
        const thumbHtml = bgSrc
            ? `<img src="${esc(bgSrc)}" loading="lazy" decoding="async" alt="" draggable="false">`
            : '<i class="fas fa-film"></i>';
        return `<div class="vn-preset-item${isSeq ? ' vn-preset-item--seq' : ''}" data-preset="${p.id}" data-preset-name="${esc(p.name)}" data-scene-ids="${this._sceneIdsAttr(p)}" data-tags="${esc((p.tags || []).join(','))}"${draggable ? ' draggable="true"' : ''}>
            <div class="vn-preset-thumb">${thumbHtml}</div>
            <div class="vn-preset-info">
                <span class="vn-preset-name" title="${esc(p.name)}">${esc(p.name)}</span>
                <div class="vn-preset-sub">${metaHtml}${tagsHtml}</div>
            </div>
            <div class="vn-preset-actions">${this._presetActionButtons(p.id)}</div>
        </div>`;
    }

    _previewSrc(p) {
        return p.thumbnailData || (p.background && p.background !== 'none' ? p.background : null);
    }

    /** Icons for what the scene brings along: visual effect, particles, music. Empty when it has none of them. */
    _hintsHtml(p) {
        const loc = (k) => game.i18n.localize(k);
        const one = (cls, icon, title) => `<span class="vn-preset-hint ${cls}" title="${esc(title)}"><i class="fas ${icon}"></i></span>`;
        const visual = String(p.visualEffect || 'none').split(':')[0];
        const particle = String(p.particleEffect || 'none').split(':')[0];
        const hints = [];
        if (visual !== 'none' && VISUAL_LABELS[visual]) hints.push(one('--visual', VISUAL_ICONS[visual] || 'fa-wand-magic-sparkles', loc(VISUAL_LABELS[visual])));
        if (particle !== 'none' && PARTICLE_LABELS[particle]) hints.push(one('--particle', PARTICLE_ICONS[particle] || 'fa-circle', loc(PARTICLE_LABELS[particle])));
        if (p.musicUuid) hints.push(one('--music', 'fa-music', loc('vn.dialog.hintMusic')));
        return hints.length ? `<span class="vn-preset-hints">${hints.join('')}</span>` : '';
    }

    /** First linked scene (alphabetically) and "+N" for the rest; the tooltip lists them all */
    _sceneTagHtml(p) {
        const names = presetSceneNames(p);
        if (!names.length) return '';
        const more = names.length > 1 ? `<span class="vn-preset-scene-more">+${names.length - 1}</span>` : '';
        return `<span class="vn-preset-scene-tag" title="${esc(names.join(', '))}"><i class="fas fa-map-pin"></i><span class="vn-preset-scene-name">${esc(names[0])}</span>${more}</span>`;
    }

    _sceneIdsAttr(p) {
        return esc(presetScenes(p).map(s => s.id).filter(Boolean).join(','));
    }

    /** Every tag of a preset in one row; _fitPresetTags then hides the ones that do not fit and adds "+N" */
    _presetTagsHtml(p) {
        if (!p.tags?.length) return '';
        return `<div class="vn-preset-tags">${p.tags.map(t => `<span class="vn-tag-chip" data-tag="${esc(t)}" title="${esc(t)}"><span>${esc(t)}</span></span>`).join('')}</div>`;
    }

    /**
     * Keeps the tags under every visible list item / card to a single row: shows as many as fit (the first one is always shown,
     * shortened with an ellipsis if it alone is wider than the row) and a "+N" badge for the rest, whose tooltip lists them.
     * Three passes (reset, measure, apply) so the whole list costs one layout, not one per item.
     */
    _fitPresetTags(root) {
        const rows = [...root.querySelectorAll('.vn-preset-tags')].filter(el => el.offsetParent !== null && el.clientWidth > 0);
        if (!rows.length) return;

        for (const el of rows) {
            el.querySelector('.vn-preset-tags-more')?.remove();
            el.querySelectorAll('.vn-tag-overflow').forEach(c => c.classList.remove('vn-tag-overflow'));
            el.classList.add('is-measuring');
            const more = document.createElement('span');
            more.className = 'vn-preset-tags-more';
            more.textContent = `+${el.querySelectorAll('.vn-tag-chip').length}`; // the widest the badge can get
            el.appendChild(more);
        }

        const plans = rows.map(el => {
            const room = el.clientWidth - 1;
            const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
            const chips = [...el.querySelectorAll('.vn-tag-chip')];
            const moreW = el.querySelector('.vn-preset-tags-more').offsetWidth;
            let used = 0, shown = 0;
            for (let i = 0; i < chips.length; i++) {
                const next = used + (i ? gap : 0) + Math.min(chips[i].offsetWidth, room);
                const needsBadge = i < chips.length - 1;
                if (i > 0 && next + (needsBadge ? gap + moreW : 0) > room) break;
                used = next;
                shown = i + 1;
            }
            return { el, chips, shown };
        });

        for (const { el, chips, shown } of plans) {
            el.classList.remove('is-measuring');
            const more = el.querySelector('.vn-preset-tags-more');
            if (shown >= chips.length) { more.remove(); continue; }
            const hidden = chips.slice(shown);
            hidden.forEach(c => c.classList.add('vn-tag-overflow'));
            more.textContent = `+${hidden.length}`;
            more.title = hidden.map(c => c.dataset.tag).join(', ');
        }
    }

    _buildPresetCardHtml(p, draggable = false) {
        const bgSrc = this._previewSrc(p);
        const imgHtml = bgSrc
            ? `<img class="vn-preset-card-img" src="${esc(bgSrc)}" loading="lazy" decoding="async" alt="" draggable="false">`
            : `<div class="vn-preset-card-placeholder"><i class="fas fa-film"></i></div>`;

        const allIds = [...(p.leftIds || []), ...(p.centerIds || []), ...(p.rightIds || [])];
        const pipsHtml = buildActorPipsHtml(allIds, p.portraitImages || {}, p.portraitNames || {});

        const { count: pendingMigrations, iconHtml: migrationIcon } = this._migrationBadgeHtml(p);
        const verHtml = pendingMigrations
            ? `<div class="vn-preset-card-ver --migration">${migrationIcon}${p.version ? `v${p.version}` : ''}</div>`
            : '';

        const tagsHtml = this._presetTagsHtml(p);
        const hintsHtml = this._hintsHtml(p);
        // Only outside the scene grouping (folders / search), where nothing else says which scene the card belongs to
        const sceneTag = this.groupMode === 'folders' ? this._sceneTagHtml(p) : '';

        const isSeq = VNPresets.isSequence(p);
        const seqHtml = isSeq
            ? `<div class="vn-preset-card-seq" title="${game.i18n.format('vn.sequence.badgeTitle', { count: p.steps?.length ?? 0 })}"><i class="fas fa-film"></i> ${p.steps?.length ?? 0}</div>`
            : '';

        return `<div class="vn-preset-card${isSeq ? ' vn-preset-card--seq' : ''}" data-preset="${p.id}" data-preset-name="${esc(p.name)}" data-scene-ids="${this._sceneIdsAttr(p)}" data-tags="${esc((p.tags || []).join(','))}"${draggable ? ' draggable="true"' : ''}>
            <div class="vn-preset-card-poster">
                ${imgHtml}
                ${pipsHtml}
                ${seqHtml}
                ${verHtml}
                <div class="vn-preset-card-footer">
                    <div class="vn-preset-card-name" title="${esc(p.name)}">${esc(p.name)}</div>
                </div>
                <div class="vn-preset-card-overlay">
                    <button type="button" class="vn-preset-card-launch vn-preset-action" data-action="launch" data-preset="${p.id}" title="${game.i18n.localize('vn.dialog.presetActionLaunch')}" aria-label="${game.i18n.localize('vn.dialog.presetActionLaunch')}"><i class="fas fa-play"></i></button>
                </div>
            </div>
            ${hintsHtml ? `<div class="vn-preset-card-sub">${hintsHtml}${sceneTag}</div>` : ''}
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
        const pickedTags = [...this.tagFilters];
        const currentSceneId = root.querySelector('.vn-preset-scene-filter')?.dataset.sceneId || null;
        let anyVisible = false;

        root.querySelectorAll('.vn-preset-item, .vn-preset-card').forEach(item => {
            const name = (item.dataset.presetName || '').toLowerCase();
            const itemTags = (item.dataset.tags || '').split(',').filter(Boolean);
            const matchSearch = !q || name.includes(q) || itemTags.some(t => t.toLowerCase().includes(q));
            const matchScene = !filterScene || (item.dataset.sceneIds || '').split(',').includes(currentSceneId);
            const matchTag = !pickedTags.length
                || (this.tagMatch === 'all' ? pickedTags.every(t => itemTags.includes(t)) : pickedTags.some(t => itemTags.includes(t)));
            const visible = matchSearch && matchScene && matchTag;
            item.style.display = visible ? '' : 'none';
            if (visible) anyVisible = true;
        });

        // Hide scene groups where all items are filtered out (both list and card mode)
        root.querySelectorAll('.vn-preset-scene-group').forEach(group => {
            const hasVisible = [...group.querySelectorAll('.vn-preset-item, .vn-preset-card')].some(c => c.style.display !== 'none');
            group.style.display = hasVisible ? '' : 'none';
        });

        this._fitPresetTags(root);

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

    /**
     * A list row has one obvious action, the big "launch" button; deleting is a small, quiet icon next to it
     * (still behind a confirmation). Everything else lives in the detail panel.
     */
    _presetActionButtons(presetId) {
        const launch = game.i18n.localize('vn.dialog.presetActionLaunch');
        const del = game.i18n.localize('vn.dialog.presetActionDelete');
        return `<button type="button" class="vn-btn vn-btn-accent vn-preset-action vn-preset-launch" data-action="launch" data-preset="${presetId}" title="${launch}" aria-label="${launch}"><i class="fas fa-play"></i><span class="vn-preset-launch-label">${game.i18n.localize('vn.dialog.presetLaunchShort')}</span></button>`
            + `<button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-preset-action vn-preset-delete" data-action="delete" data-preset="${presetId}" title="${del}" aria-label="${del}"><i class="fas fa-trash"></i></button>`;
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

        this._attachTagBarListeners(root);
        this._refreshTagFilterBar(root);

        // The tag rows depend on the list width (window resize, panel open/close, switching to the tab, list <-> cards)
        const listEl = root.querySelector('.vn-preset-list');
        if (listEl && typeof ResizeObserver !== 'undefined') {
            let frame = 0;
            new ResizeObserver(() => {
                cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => this._fitPresetTags(root));
            }).observe(listEl);
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
            if (tagChip) {
                this._toggleTagFilter(root, tagChip.dataset.tag);
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
                await this._selectPreset(root, copy.id);
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

    // ══════════════════════════════════════════════════════════
    // Tag filter: button + active chips + picker window
    // ══════════════════════════════════════════════════════════

    static TAG_PICKER_MAX_ROWS = 300;

    /** Tags present in the list with the number of presets that carry each */
    _countListTags(root) {
        const counts = new Map();
        root.querySelectorAll('.vn-preset-item[data-tags], .vn-preset-card[data-tags]').forEach(item => {
            for (const t of (item.dataset.tags || '').split(',').filter(Boolean)) counts.set(t, (counts.get(t) || 0) + 1);
        });
        return counts;
    }

    _toggleTagFilter(root, tag) {
        if (this.tagFilters.has(tag)) this.tagFilters.delete(tag);
        else this.tagFilters.add(tag);
        this._refreshTagFilterBar(root);
        this._applyPresetFilters(root);
    }

    _clearTagFilters(root) {
        this.tagFilters.clear();
        this._refreshTagFilterBar(root);
        this._applyPresetFilters(root);
    }

    _openTagPicker(root) {
        const picker = root.querySelector('.vn-tag-picker');
        if (!picker || !picker.hidden) return;
        picker.hidden = false;
        this._placeTagPicker(root, picker);
        this._renderTagPicker(root);
        const input = picker.querySelector('.vn-tag-picker-input');
        input?.focus();
        input?.select();
        this._tagOutsideListener = (e) => {
            if (picker.contains(e.target) || e.target.closest('.vn-tag-picker-btn')) return;
            this._closeTagPicker(root);
        };
        document.addEventListener('mousedown', this._tagOutsideListener, true);
    }

    // The bar is `display: contents`, so the picker is positioned from the button's rect: under the button, kept inside the list pane
    _placeTagPicker(root, picker) {
        const btn = root.querySelector('.vn-tag-picker-btn');
        const host = picker.offsetParent;
        if (!btn || !host) return;
        const pane = root.querySelector('.vn-presets-list-pane')?.getBoundingClientRect() ?? host.getBoundingClientRect();
        const h = host.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        const width = Math.min(420, pane.width);
        const left = Math.max(pane.left, Math.min(b.left, pane.right - width));
        picker.style.width = `${width}px`;
        picker.style.left = `${left - h.left}px`;
        picker.style.top = `${b.bottom - h.top + 2}px`;
    }

    _closeTagPicker(root) {
        const picker = root.querySelector('.vn-tag-picker');
        if (picker) picker.hidden = true;
        if (this._tagOutsideListener) document.removeEventListener('mousedown', this._tagOutsideListener, true);
        this._tagOutsideListener = null;
    }

    _attachTagBarListeners(root) {
        const bar = root.querySelector('.vn-preset-tag-bar');
        if (!bar) return;

        bar.addEventListener('click', (e) => {
            if (e.target.closest('.vn-tag-picker-btn')) {
                bar.querySelector('.vn-tag-picker')?.hidden ? this._openTagPicker(root) : this._closeTagPicker(root);
                return;
            }
            if (e.target.closest('.vn-tag-bar-clear') || e.target.closest('.vn-tag-picker-reset')) {
                this._clearTagFilters(root);
                return;
            }
            const matchBtn = e.target.closest('.vn-tag-match-btn');
            if (matchBtn) {
                this.tagMatch = matchBtn.dataset.match === 'any' ? 'any' : 'all';
                this._refreshTagFilterBar(root);
                this._applyPresetFilters(root);
                return;
            }
            const del = e.target.closest('.vn-tag-picker-del');
            if (del) {
                e.preventDefault();
                this._deleteTagEverywhere(root, del.closest('.vn-tag-picker-row')?.dataset.tag);
                return;
            }
            // Active chip (also its ×): drop that tag from the filter
            const chip = e.target.closest('.vn-tag-bar-active .vn-tag-chip');
            if (chip) this._toggleTagFilter(root, chip.dataset.tag);
        });

        bar.addEventListener('change', (e) => {
            const row = e.target.closest('.vn-tag-picker-row');
            if (row && e.target.matches('input[type="checkbox"]')) this._toggleTagFilter(root, row.dataset.tag);
        });

        bar.addEventListener('input', (e) => {
            if (e.target.classList.contains('vn-tag-picker-input')) this._renderTagPicker(root);
        });

        bar.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || bar.querySelector('.vn-tag-picker')?.hidden) return;
            e.preventDefault();
            e.stopPropagation();
            this._closeTagPicker(root);
            bar.querySelector('.vn-tag-picker-btn')?.focus();
        });
    }

    /** Removes a tag from every preset after a confirmation */
    async _deleteTagEverywhere(root, tag) {
        if (!tag) return;
        const confirmed = await this._confirmDialog(
            game.i18n.localize('vn.dialog.deleteTagGlobalTitle'),
            `<p>${game.i18n.format('vn.dialog.deleteTagGlobalConfirm', { tag: esc(tag) })}</p>`,
            game.i18n.localize('vn.dialog.btnDelete'), 'fas fa-trash'
        );
        if (!confirmed) return;
        const presets = await VNPresets.getAll();
        for (const p of Object.values(presets).filter(p => (p.tags || []).includes(tag))) {
            await VNPresets.setTags(p.id, (p.tags || []).filter(t => t !== tag));
        }
        this.tagFilters.delete(tag);
        this.refresh(root);
    }

    /** The picker rows for the current search; the open window is only redrawn, never closed */
    _renderTagPicker(root) {
        const picker = root.querySelector('.vn-tag-picker');
        if (!picker) return;
        const query = (picker.querySelector('.vn-tag-picker-input')?.value || '').trim().toLowerCase();
        const all = [...this._tagCounts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const found = query ? all.filter(t => t.toLowerCase().includes(query)) : all;
        const shown = found.slice(0, VNPresetsManager.TAG_PICKER_MAX_ROWS);

        const list = picker.querySelector('.vn-tag-picker-list');
        const keepScroll = list.scrollTop;
        const delTitle = esc(game.i18n.localize('vn.dialog.tagDeleteEverywhere'));
        list.innerHTML = shown.length
            ? shown.map(t => {
                const on = this.tagFilters.has(t);
                return `<label class="vn-tag-picker-row${on ? ' is-on' : ''}" data-tag="${esc(t)}">
                    <input type="checkbox"${on ? ' checked' : ''}>
                    <span class="vn-tag-picker-name" title="${esc(t)}">${esc(t)}</span>
                    <span class="vn-tag-picker-n">${this._tagCounts.get(t)}</span>
                    <button type="button" class="vn-tag-picker-del" title="${delTitle}"><i class="fas fa-trash-can"></i></button>
                </label>`;
            }).join('')
            : `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.tagPickerEmpty')}</div>`;
        list.scrollTop = keepScroll;

        const more = found.length > shown.length
            ? ` · ${game.i18n.format('vn.dialog.tagPickerMore', { n: shown.length })}` : '';
        picker.querySelector('.vn-tag-picker-total').textContent =
            game.i18n.format('vn.dialog.tagPickerTotal', { shown: found.length, total: all.length }) + more;
        picker.querySelector('.vn-tag-picker-reset').disabled = !this.tagFilters.size;
        picker.querySelectorAll('.vn-tag-match-btn').forEach(b => b.classList.toggle('active', b.dataset.match === this.tagMatch));
    }

    _refreshTagFilterBar(root) {
        const bar = root.querySelector('.vn-preset-tag-bar');
        if (!bar) return;
        this._tagCounts = this._countListTags(root);
        if (!this._tagCounts.size) {
            this._closeTagPicker(root);
            bar.querySelector('.vn-tag-bar-active').innerHTML = '';
            bar.hidden = true;
            this.tagFilters.clear();
            return;
        }
        bar.hidden = false;
        for (const t of [...this.tagFilters]) if (!this._tagCounts.has(t)) this.tagFilters.delete(t);

        const n = this.tagFilters.size;
        const badge = bar.querySelector('.vn-tag-picker-count');
        badge.hidden = !n;
        badge.textContent = n;
        bar.querySelector('.vn-tag-bar-clear').hidden = !n;
        bar.querySelector('.vn-tag-bar-picked').hidden = !n;
        bar.querySelector('.vn-tag-bar-active').innerHTML = [...this.tagFilters].map(t =>
            `<span class="vn-tag-chip vn-tag-chip--rm" data-tag="${esc(t)}" title="${esc(t)}"><span>${esc(t)}</span><button type="button" class="vn-tag-rm-btn">×</button></span>`
        ).join('');

        if (!bar.querySelector('.vn-tag-picker').hidden) this._renderTagPicker(root);
        else bar.querySelectorAll('.vn-tag-match-btn').forEach(b => b.classList.toggle('active', b.dataset.match === this.tagMatch));
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

        const split = panel.closest('.vn-presets-split');
        // The panel exists only while a preset is open: with nothing selected the list gets the whole width
        panel.hidden = !preset;
        split?.classList.toggle('has-panel', !!preset);

        if (!preset) {
            panel.removeAttribute('data-preset-id');
            panel.removeAttribute('data-preset-name');
            panel.innerHTML = '';
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

        const scenes = presetScenes(preset);
        const sceneChipsHtml = scenes.map((s, i) => `<span class="vn-scene-chip" title="${esc(s.name || s.id)}"><i class="fas fa-map-pin"></i><span>${esc(s.name || s.id)}</span><button type="button" class="vn-scene-rm-btn" data-index="${i}">×</button></span>`).join('');

        const isSequence = VNPresets.isSequence(preset);
        const panelAction = (action, icon, key, extra = '') =>
            `<button type="button" class="vn-btn vn-btn-sm ${extra} vn-panel-action" data-action="${action}" data-preset="${preset.id}"><i class="fas ${icon}"></i> ${game.i18n.localize(key)}</button>`;
        // A sequence is launched, not loaded into the form; its content is edited step by step instead
        const launchAction = panelAction('launch', 'fa-play', 'vn.dialog.presetActionLaunch', 'vn-btn-accent vn-panel-action--launch');
        const primaryActions = isSequence
            ? launchAction
            : launchAction + panelAction('load', 'fa-upload', 'vn.dialog.presetActionLoad') + panelAction('update', 'fa-arrows-rotate', 'vn.dialog.presetActionUpdate');
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
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="duplicate" data-preset="${preset.id}" title="${esc(game.i18n.localize('vn.dialog.presetActionDuplicateTitle'))}"><i class="fas fa-clone"></i> ${game.i18n.localize('vn.dialog.presetActionDuplicate')}</button>
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
                    </div>
                </div>
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelScenes')} <span class="vn-badge">${scenes.length}</span></label>
                    <div class="vn-panel-scenes">${sceneChipsHtml}</div>
                    <button type="button" class="vn-btn vn-btn-sm vn-panel-action vn-panel-scenes-btn" data-action="assign" data-preset="${preset.id}"><i class="fas fa-location-dot"></i> ${game.i18n.localize('vn.dialog.presetActionAssign')}</button>
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
                <button type="button" class="vn-btn vn-btn-xs vn-panel-close-btn" title="${game.i18n.localize('vn.dialog.btnClose')}" aria-label="${game.i18n.localize('vn.dialog.btnClose')}"><i class="fas fa-times vn-panel-close-icon"></i><i class="fas fa-arrow-left vn-panel-back-icon"></i><span class="vn-panel-back-label">${game.i18n.localize('vn.dialog.panelBack')}</span></button>
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

            const sceneRm = e.target.closest('.vn-scene-rm-btn');
            if (sceneRm) {
                const presetId = this.selectedPresetId;
                const preset = presetId ? await VNPresets.load(presetId) : null;
                if (!preset) return;
                const sorted = await VNPresets.setScenes(presetId, presetScenes(preset).filter((_, i) => i !== Number(sceneRm.dataset.index)));
                if (sorted) { this.refresh(root, sorted); this._hooks.onChanged?.(root); }
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
            const filtered = query ? available.filter(t => t.toLowerCase().includes(query)) : available;
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
                const typed = e.target.value.trim().replace(/,+/g, '');
                // An existing tag typed in other letter case (imported tags keep capitals and spaces) is reused, not duplicated
                const val = this._getAllExistingTags(root).find(t => t.toLowerCase() === typed.toLowerCase())
                    ?? typed.toLowerCase().replace(/\s+/g, '-').slice(0, 32);
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

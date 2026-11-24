// Preset list presentation: cards, rows, folders, sorting and DOM filtering.
import { VNPresets } from '../../presets/vn-presets.js';
import { VNFolders } from '../../presets/vn-folders.js';
import { MODULE_ID } from '../../vn-constants.js';
import { countPendingMigrations } from '../../presets/vn-migrations.js';
import { buildActorPipsHtml } from './vn-preset-card-html.js';
import { groupPresetsByScene, presetScenes, presetSceneNames } from '../../presets/vn-preset-utils.js';
import { escapeHtml } from '../../../utils/text.js';
import { VISUAL_LABELS, VISUAL_ICONS } from '../../visual-effects/atmosphere/config/visual-types.js';
import { PARTICLE_LABELS, PARTICLE_ICONS } from '../../visual-effects/atmosphere/config/particle-types.js';

const esc = escapeHtml;

export function formatPresetDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yy} ${hh}:${min}`;
}

export class VNPresetsView {
    constructor(getState) { this._getState = getState; }
    get state() { return this._getState(); }

    render(sorted) {
        const currentSceneName = canvas?.scene?.name ?? null;
        const currentSceneId = canvas?.scene?.id ?? null;
        const hasCurrent = !!currentSceneId;
        const isFolder = this.state.groupMode === 'folders';
        const itemsHtml = isFolder
            ? this.folderHTML(sorted)
            : (this.itemsHTML(sorted) || `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.noSavedPresets')}</div>`);

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
                        ${game.user.isGM ? `<button type="button" class="vn-btn vn-btn-sm vn-preset-effect-test-btn" title="${esc(game.i18n.localize('vn.sequence.btnEffectTestTitle'))}"><i class="fas fa-flask"></i> ${esc(game.i18n.localize('vn.sequence.btnEffectTest'))}</button>` : ''}
                    </div>
                    <div class="vn-preset-controls">
                        <div class="vn-presets-mode-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-presets-groupmode-btn${!isFolder ? ' active' : ''}" data-groupmode="scenes" title="${game.i18n.localize('vn.folders.modeScenes')}"><i class="fas fa-map-location-dot"></i><span class="vn-btn-label">${game.i18n.localize('vn.folders.modeScenes')}</span></button>
                            <button type="button" class="vn-btn vn-btn-xs vn-presets-groupmode-btn${isFolder ? ' active' : ''}" data-groupmode="folders" title="${game.i18n.localize('vn.folders.modeFolders')}"><i class="fas fa-folder"></i><span class="vn-btn-label">${game.i18n.localize('vn.folders.modeFolders')}</span></button>
                        </div>
                        <input type="text" class="vn-preset-search" placeholder="${game.i18n.localize('vn.dialog.searchPresetsPlaceholder')}">
                        <div class="vn-preset-view-toggle">
                            <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this.state.viewMode === 'list' ? 'active' : ''}" data-view="list" title="${game.i18n.localize('vn.dialog.viewList')}"><i class="fas fa-list"></i><span class="vn-btn-label">${game.i18n.localize('vn.dialog.viewList')}</span></button>
                            <button type="button" class="vn-btn vn-btn-xs vn-preset-view-btn ${this.state.viewMode === 'cards' ? 'active' : ''}" data-view="cards" title="${game.i18n.localize('vn.dialog.viewCards')}"><i class="fas fa-th-large"></i><span class="vn-btn-label">${game.i18n.localize('vn.dialog.viewCards')}</span></button>
                        </div>
                        <select class="vn-preset-sort" title="${game.i18n.localize('vn.dialog.sortingTitle')}">
                            <option value="newest"${this.state.sortMode === 'newest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortNewest')}</option>
                            <option value="oldest"${this.state.sortMode === 'oldest' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortOldest')}</option>
                            <option value="az"${this.state.sortMode === 'az' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortAZ')}</option>
                            <option value="za"${this.state.sortMode === 'za' ? ' selected' : ''}>${game.i18n.localize('vn.dialog.sortZA')}</option>
                        </select>
                        <button type="button" class="vn-btn vn-btn-sm vn-preset-scene-filter${this.state.sceneFilter ? ' active' : ''}" title="${game.i18n.format('vn.dialog.filterBySceneTitle', {sceneName: currentSceneName || game.i18n.localize('vn.dialog.thisSceneDefault')})}" data-scene-id="${currentSceneId || ''}">
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
                    <div class="vn-preset-list${this.state.viewMode === 'cards' ? ' vn-preset-list--cards' : ''}${isFolder ? ' vn-preset-list--folder-mode' : ''}">${itemsHtml}</div>
                </div>
                <div class="vn-preset-detail-panel" hidden></div>
            </div>
        </div>`;
    }

    _folderOf(p) {
        return p.folderId && VNFolders.get(p.folderId) ? p.folderId : null;
    }

    _sortPresets(presets) {
        const copy = [...presets];
        switch (this.state.sortMode) {
            case 'oldest': return copy.sort((a, b) => (a.createdAt || a.savedAt || 0) - (b.createdAt || b.savedAt || 0));
            case 'az':     return copy.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
            case 'za':     return copy.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ru'));
            default:       return copy.sort((a, b) => (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
        }
    }

    // Apply the chosen sort to groups too; the group without a scene stays last.
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
        }[this.state.sortMode] ?? byKey;
        return [...groups].sort((a, b) => (!a.key) - (!b.key) || cmp(a, b));
    }

    folderHTML(allPresets) {
        const favorites = VNFolders.getFavorites();
        const currentId = this.state.currentFolderId || null;
        const isCards = this.state.viewMode === 'cards';

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
        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase();
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

    itemsHTML(sortedPresets) {
        if (!sortedPresets.length) return '';
        sortedPresets = this._sortPresets(sortedPresets);
        const isCards = this.state.viewMode === 'cards';
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
        const createdStr = formatPresetDate(p.createdAt || p.savedAt);
        const updatedStr = (p.updatedAt && p.updatedAt !== p.createdAt) ? formatPresetDate(p.updatedAt) : null;
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
        const shortDate = formatPresetDate(p.updatedAt || p.createdAt || p.savedAt).split(' ')[0];
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

    _sceneTagHtml(p) {
        const names = presetSceneNames(p);
        if (!names.length) return '';
        const more = names.length > 1 ? `<span class="vn-preset-scene-more">+${names.length - 1}</span>` : '';
        return `<span class="vn-preset-scene-tag" title="${esc(names.join(', '))}"><i class="fas fa-map-pin"></i><span class="vn-preset-scene-name">${esc(names[0])}</span>${more}</span>`;
    }

    _sceneIdsAttr(p) {
        return esc(presetScenes(p).map(s => s.id).filter(Boolean).join(','));
    }

    _presetTagsHtml(p) {
        if (!p.tags?.length) return '';
        return `<div class="vn-preset-tags">${p.tags.map(t => `<span class="vn-tag-chip" data-tag="${esc(t)}" title="${esc(t)}"><span>${esc(t)}</span></span>`).join('')}</div>`;
    }

    // Reset, measure, then apply: fit tags into one row with one shared layout pass.
    fitTags(root) {
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
        const sceneTag = this.state.groupMode === 'folders' ? this._sceneTagHtml(p) : '';

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

    applyFilters(root) {
        const q = this.state.searchQuery.toLowerCase();
        const filterScene = this.state.sceneFilter;
        const pickedTags = [...this.state.tagFilters];
        const currentSceneId = root.querySelector('.vn-preset-scene-filter')?.dataset.sceneId || null;
        let anyVisible = false;

        root.querySelectorAll('.vn-preset-item, .vn-preset-card').forEach(item => {
            const name = (item.dataset.presetName || '').toLowerCase();
            const itemTags = (item.dataset.tags || '').split(',').filter(Boolean);
            const matchSearch = !q || name.includes(q) || itemTags.some(t => t.toLowerCase().includes(q));
            const matchScene = !filterScene || (item.dataset.sceneIds || '').split(',').includes(currentSceneId);
            const matchTag = !pickedTags.length
                || (this.state.tagMatch === 'all' ? pickedTags.every(t => itemTags.includes(t)) : pickedTags.some(t => itemTags.includes(t)));
            const visible = matchSearch && matchScene && matchTag;
            item.style.display = visible ? '' : 'none';
            if (visible) anyVisible = true;
        });

        // Hide scene groups where all items are filtered out (both list and card mode)
        root.querySelectorAll('.vn-preset-scene-group').forEach(group => {
            const hasVisible = [...group.querySelectorAll('.vn-preset-item, .vn-preset-card')].some(c => c.style.display !== 'none');
            group.style.display = hasVisible ? '' : 'none';
        });

        this.fitTags(root);

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

    _presetActionButtons(presetId) {
        const launch = game.i18n.localize('vn.dialog.presetActionLaunch');
        const del = game.i18n.localize('vn.dialog.presetActionDelete');
        return `<button type="button" class="vn-btn vn-btn-accent vn-preset-action vn-preset-launch" data-action="launch" data-preset="${presetId}" title="${launch}" aria-label="${launch}"><i class="fas fa-play"></i><span class="vn-preset-launch-label">${game.i18n.localize('vn.dialog.presetLaunchShort')}</span></button>`
            + `<button type="button" class="vn-btn vn-btn-xs vn-btn-danger vn-preset-action vn-preset-delete" data-action="delete" data-preset="${presetId}" title="${del}" aria-label="${del}"><i class="fas fa-trash"></i></button>`;
    }
}

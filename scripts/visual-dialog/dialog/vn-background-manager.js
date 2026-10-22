// ============================================================
// vn-background-manager.js — управление фонами, галерея, переходы
// ============================================================

import { VNTransitions } from '../visual-effects/vn-transitions.js';
import { VNPreloader } from '../vn-preload.js';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const loc = (key, data) => data ? game.i18n.format(key, data) : game.i18n.localize(key);

const NATURAL = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export class VNBackgroundManager {
    static IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    static VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov'];
    static get ALL_EXTENSIONS() {
        return this._allExt ??= [...this.IMAGE_EXTENSIONS, ...this.VIDEO_EXTENSIONS];
    }

    static MODULE_ID = 'player-queue';
    static FOLDER_SETTING = 'backgroundFolder';
    static LAST_PATH_KEY = 'player-queue.bg-last-folder';
    static SEARCH_MAX_RESULTS = 240;
    static INDEX_MAX_FOLDERS = 3000;

    static getCustomFolder() {
        try { return game.settings.get(this.MODULE_ID, this.FOLDER_SETTING) || ''; } catch { return ''; }
    }

    static async saveCustomFolder(path) {
        try { await game.settings.set(this.MODULE_ID, this.FOLDER_SETTING, path); } catch {}
    }

    constructor(moduleId) {
        this.moduleId = moduleId;
        this.available = [];
        this._defaultPath = `modules/${moduleId}/assets/scenes`;
        this.currentPath = this._defaultPath;
        this.navigation = [];

        this._query = '';
        this._searchToken = 0;
        this._searchTimer = null;
        this._indexPromise = null;
        this._indexRoot = null;
    }

    static isVideo(path) {
        if (!path) return false;
        return this.VIDEO_EXTENSIONS.includes(path.split('.').pop().split('?')[0].toLowerCase());
    }

    // ══════════════════════════════════════════════════════════
    // Loading & Navigation
    // ══════════════════════════════════════════════════════════

    static _decode(p) {
        try { return decodeURIComponent(p); } catch { return p; }
    }

    static _cleanPath(p) {
        return String(p || '').replace(/^\/+/, '').replace(/\/+$/, '');
    }

    static _prettify(s) {
        return this._decode(s).replace(/[-_]/g, ' ');
    }

    static _fileLabel(path) {
        const file = String(path).split('?')[0].split('/').pop();
        const dot = file.lastIndexOf('.');
        return this._prettify(dot > 0 ? file.slice(0, dot) : file);
    }

    async _fetchFolder(targetPath) {
        const FPImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
        const response = await FPImpl.browse('data', targetPath);

        const folders = (response.dirs || []).map(dir => {
            const name = VNBackgroundManager._prettify(dir.split('/').pop());
            return { type: 'folder', path: dir, name, displayName: `📁 ${name}` };
        }).sort(NATURAL);

        const media = (response.files || [])
            .filter(f => VNBackgroundManager.ALL_EXTENSIONS.includes(f.split('.').pop().toLowerCase()))
            .map(file => {
                const name = VNBackgroundManager._fileLabel(file);
                const isVid = VNBackgroundManager.isVideo(file);
                return { type: isVid ? 'video' : 'image', path: file, name, displayName: isVid ? `🎬 ${name}` : name };
            }).sort(NATURAL);

        return [...folders, ...media];
    }

    async load(path = null) {
        try {
            this.available = await this._fetchFolder(path || this.currentPath);
            return true;
        } catch (error) {
            console.error('VN: Error loading backgrounds:', error);
            this.available = [];
            return false;
        }
    }

    async navigate(folderPath, isBack = false) {
        if (isBack) {
            if (!this.navigation.length) return;
            ({ path: folderPath } = this.navigation.pop());
        } else {
            this.navigation.push({ path: this.currentPath });
        }
        this.currentPath = folderPath;
        await this.load(folderPath);
        this._persistPath();
    }

    /** Jumps to a crumb: keeps the first `depth` stack entries, current becomes the crumb's folder. */
    async gotoDepth(depth) {
        const paths = [...this.navigation.map(n => n.path), this.currentPath];
        if (!(depth >= 0 && depth < paths.length - 1)) return;
        this.navigation = this.navigation.slice(0, depth);
        this.currentPath = paths[depth];
        await this.load();
        this._persistPath();
    }

    /** Jumps to any folder below the root (search results). */
    async gotoPath(folderPath) {
        const segs = this._relativeSegments(folderPath);
        if (!segs) return false;
        const prev = { navigation: this.navigation, currentPath: this.currentPath, available: this.available };
        this._setPathFromSegments(segs);
        if (await this.load()) { this._persistPath(); return true; }
        ({ navigation: this.navigation, currentPath: this.currentPath, available: this.available } = prev);
        return false;
    }

    resetPath() {
        this.currentPath = this.rootPath;
        this.navigation = [];
        this._persistPath();
    }

    // ── Root / relative-path helpers ──────────────────────────

    get rootPath() {
        return VNBackgroundManager._cleanPath(VNBackgroundManager.getCustomFolder() || this._defaultPath);
    }

    /** Path segments of `path` below the gallery root, or null if it lies outside it. */
    _relativeSegments(path) {
        const root = this.rootPath;
        const p = VNBackgroundManager._cleanPath(path);
        if (p.startsWith(root + '/')) return p.slice(root.length + 1).split('/').filter(Boolean);
        const dRoot = VNBackgroundManager._decode(root), dP = VNBackgroundManager._decode(p);
        if (dP.startsWith(dRoot + '/')) return dP.slice(dRoot.length + 1).split('/').filter(Boolean);
        return null;
    }

    _persistPath() {
        try {
            if (this.navigation.length) localStorage.setItem(VNBackgroundManager.LAST_PATH_KEY, this.currentPath);
            else localStorage.removeItem(VNBackgroundManager.LAST_PATH_KEY);
        } catch {}
    }

    /** Builds the back-stack for a folder `segs` deep below the root and makes it current. */
    _setPathFromSegments(segs) {
        let cur = this.rootPath;
        this.navigation = [];
        for (const seg of segs) {
            this.navigation.push({ path: cur });
            cur = `${cur}/${seg}`;
        }
        this.currentPath = cur;
    }

    /** Opens the gallery in the folder that was open last time (falls back to the root). */
    async restoreLastPath() {
        let saved = '';
        try { saved = localStorage.getItem(VNBackgroundManager.LAST_PATH_KEY) || ''; } catch {}
        this.resetPath();
        this._indexPromise = null;

        const segs = saved ? this._relativeSegments(saved) : null;
        if (segs?.length) {
            this._setPathFromSegments(segs);
            if (await this.load()) { this._persistPath(); return; }
            this.resetPath();
        }
        await this.load();
    }

    // ── Search index ──────────────────────────────────────────

    _ensureIndex() {
        const root = this.rootPath;
        if (!this._indexPromise || this._indexRoot !== root) {
            this._indexRoot = root;
            this._indexPromise = this._crawl(root);
        }
        return this._indexPromise;
    }

    /** Breadth-first crawl of the whole backgrounds tree (a few folders in parallel). */
    async _crawl(root) {
        const out = [];
        const seen = new Set([root]);
        let level = [root];
        while (level.length && seen.size < VNBackgroundManager.INDEX_MAX_FOLDERS) {
            const next = [];
            for (let i = 0; i < level.length; i += 6) {
                const results = await Promise.all(level.slice(i, i + 6).map(d => this._fetchFolder(d).catch(() => [])));
                for (const items of results) {
                    for (const it of items) {
                        const rel = this._relativeSegments(it.path) ?? [];
                        const relDir = rel.slice(0, -1).map(s => VNBackgroundManager._prettify(s)).join(' / ');
                        out.push({ ...it, relDir, hay: `${relDir} ${it.name}`.toLowerCase().replace(/\//g, ' ') });
                        if (it.type === 'folder' && !seen.has(it.path)) { seen.add(it.path); next.push(it.path); }
                    }
                }
            }
            level = next;
        }
        return out;
    }

    async _runSearch(root, query) {
        const token = ++this._searchToken;
        const current = this._checkedValue(root);

        if (!this._indexPromise || this._indexRoot !== this.rootPath) {
            this._setGallery(root, `<div class="vn-bg-search-info"><i class="fas fa-spinner fa-spin"></i> ${loc('vn.bg.searching')}</div>`);
        }
        const index = await this._ensureIndex();
        if (token !== this._searchToken) return;

        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = [];
        for (const it of index) {
            if (!tokens.every(t => it.hay.includes(t))) continue;
            const nameHit = tokens.every(t => it.name.toLowerCase().includes(t));
            matches.push({ it, score: (it.type === 'folder' ? 0 : 2) + (nameHit ? 0 : 1) });
        }
        matches.sort((a, b) => a.score - b.score);

        const max = VNBackgroundManager.SEARCH_MAX_RESULTS;
        let html = `<div class="vn-bg-search-info"><i class="fas fa-search"></i> ${
            !matches.length ? loc('vn.bg.searchEmpty')
                : matches.length > max ? loc('vn.bg.searchTruncated', { n: matches.length, max })
                    : loc('vn.bg.searchResults', { n: matches.length })}</div>`;

        for (const { it } of matches.slice(0, max)) {
            html += it.type === 'folder'
                ? this._folderNavBtn('goto', 'fa-folder', it.displayName, it.path, it.relDir)
                : this._bgOption(it.path, it.displayName, null, this._checkedValue(root) ?? current, it.relDir);
        }
        this._setGallery(root, html);
    }

    _clearSearchUI(root) {
        this._query = '';
        this._searchToken++;
        clearTimeout(this._searchTimer);
        const input = root?.querySelector('.vn-bg-search-input');
        if (input) input.value = '';
        const clear = root?.querySelector('.vn-bg-search-clear');
        if (clear) clear.hidden = true;
    }

    // ── Selection model ───────────────────────────────────────
    // The selected background is always exactly one checked `input[name=background]`:
    // either a gallery card, or the hidden `.vn-bg-holder` radio when the file is not currently shown.

    _checkedValue(root) {
        return root?.querySelector('input[name="background"]:checked')?.value;
    }

    _setHolder(root, path, label) {
        const holder = root.querySelector('.vn-bg-holder');
        if (!holder) return;
        holder.value = path;
        holder.dataset.label = label || '';
        holder.checked = true;
    }

    /** Selects `path`: a matching gallery card if visible, otherwise the holder. */
    addDynamicOption(root, path, label) {
        const radio = [...root.querySelectorAll('.vn-background-gallery input[name="background"]')].find(r => r.value === path);
        if (radio) radio.checked = true;
        else this._setHolder(root, path, label);
        this._syncSelectionUI(root);
    }

    /** Guarantees a valid selection after the gallery DOM was replaced. */
    _keepSelection(root, current) {
        if (root.querySelector('input[name="background"]:checked')) return;
        if (current && current !== 'none') {
            this._setHolder(root, current, VNBackgroundManager._fileLabel(current));
        } else {
            const none = [...root.querySelectorAll('.vn-background-gallery input[name="background"]')].find(r => r.value === 'none');
            if (none) none.checked = true;
            else this._setHolder(root, 'none', '');
        }
    }

    _syncSelectionUI(root) {
        root.querySelectorAll('.vn-background-gallery .vn-bg-option:not(.vn-folder-nav)').forEach(o => {
            o.classList.toggle('selected', !!o.querySelector('input[type="radio"]')?.checked);
        });
        this._renderCurrentBar(root);
    }

    _setGallery(root, html) {
        const gallery = root?.querySelector('.vn-background-gallery');
        if (!gallery) return;
        const current = this._checkedValue(root);
        gallery.innerHTML = html;
        this._keepSelection(root, current);
        this._syncSelectionUI(root);
    }

    // ── Locate current background ─────────────────────────────

    _canLocate(bg) {
        return !!bg && bg !== 'none' && !!this._relativeSegments(bg)?.length;
    }

    async locateCurrent(root) {
        const bg = this._checkedValue(root);
        const segs = this._canLocate(bg) ? this._relativeSegments(bg) : null;
        if (!segs) return;

        const prev = { navigation: this.navigation, currentPath: this.currentPath, available: this.available };
        this._setPathFromSegments(segs.slice(0, -1));

        const target = VNBackgroundManager._decode(VNBackgroundManager._cleanPath(bg));
        let item = null;
        if (await this.load()) {
            item = this.available.find(i => i.type !== 'folder' && VNBackgroundManager._decode(i.path.replace(/^\/+/, '')) === target);
        }
        if (!item) {
            ({ navigation: this.navigation, currentPath: this.currentPath, available: this.available } = prev);
            ui.notifications.warn(loc('vn.bg.locateNotFound'));
            return;
        }

        this._persistPath();
        this.refreshGallery(root, item.path);
        root.querySelector('.vn-background-gallery .vn-bg-option.selected')?.scrollIntoView({ block: 'nearest' });
    }

    // ══════════════════════════════════════════════════════════
    // Apply Background to DOM
    // ══════════════════════════════════════════════════════════

    applyBackground($overlay, background, showOverlay) {
        const el = $overlay[0] ?? $overlay;
        if (!el) return;

        const bgLayer = el.querySelector('.vn-bg-layer');
        bgLayer?.querySelector('.vn-bg-video')?.remove();

        if (background && background !== 'none') {
            if (VNBackgroundManager.isVideo(background)) {
                if (bgLayer) {
                    bgLayer.style.backgroundImage = '';
                    const video = Object.assign(document.createElement('video'), {
                        className: 'vn-bg-video', src: background,
                        autoplay: true, loop: true, muted: true, playsInline: true
                    });
                    video.setAttribute('playsinline', '');
                    video.setAttribute('disablepictureinpicture', '');
                    bgLayer.appendChild(video);
                    video.play().catch(() => {});
                }
            } else if (bgLayer) {
                const current = bgLayer.style.backgroundImage;
                const currentBase = current.replace(/\?t=\d+/, '').replace(/url\(["']?|["']?\)/g, '');
                if (currentBase !== background) {
                    bgLayer.style.backgroundImage = `url("${background.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
                }
            }

            const existing = el.querySelector('.vn-background-overlay');
            if (showOverlay) {
                if (!existing) bgLayer?.insertAdjacentHTML('afterend', '<div class="vn-background-overlay"></div>');
            } else existing?.remove();
        } else {
            if (bgLayer) bgLayer.style.backgroundImage = '';
            el.querySelector('.vn-background-overlay')?.remove();
        }
    }

    /**
     * Animated background switch. `timing` comes from VNTransitions.timing (transition type + speed; 'cut' = instant).
     * The background dimming is NOT handled here: the caller fades it at the start (fadeOverlay).
     */
    async switchWithTransition($overlay, newBg, showOverlay, atmosphere, timing) {
        const el = $overlay[0] ?? $overlay;
        if (!el || !newBg || newBg === 'none' || timing.type === 'cut') {
            this.applyBackground($overlay, newBg, showOverlay);
            return;
        }

        // Nothing to transition from (first background): just show it. A video counts as content too.
        const oldBgLayer = el.querySelector('.vn-bg-layer');
        if (!oldBgLayer?.style.backgroundImage && !oldBgLayer?.querySelector('.vn-bg-video')) {
            this.applyBackground($overlay, newBg, showOverlay);
            return;
        }

        try {
            // Start the dissolve only once the new image is decoded, otherwise it fades in from an empty layer
            await VNPreloader.ready(newBg);
            await VNTransitions.switchBackground(el, newBg, timing.type, timing.bg || null);
            atmosphere?.resetZoom?.();
        } catch (e) {
            console.error('VN: Background transition failed:', e);
            this.applyBackground($overlay, newBg, showOverlay);
        }
    }

    /**
     * applyBackground without the layer's own 0.8 s background-image cross-fade. Used while a curtain covers the
     * scene (VNTransitions.cover), where the swap must be instant or it would keep fading after the curtain opens.
     */
    applyBackgroundInstant($overlay, background, showOverlay) {
        const el = $overlay[0] ?? $overlay;
        const layer = el?.querySelector('.vn-bg-layer');
        if (layer) layer.style.transition = 'none';
        this.applyBackground($overlay, background, showOverlay);
        if (layer) {
            void layer.offsetWidth; // commit the swap before the transition is switched back on
            layer.style.transition = '';
        }
    }

    /**
     * Fades the background dimming (.vn-background-overlay) in or out over `--vn-tr-fx`. Used at the START of a
     * step switch so the dimming changes together with the visual effect instead of after the dissolve.
     * A leaving overlay is renamed (`vn-bo-leaving`) so applyBackground / setBackgroundOverlay never see it.
     */
    fadeOverlay($overlay, show, background) {
        const el = $overlay[0] ?? $overlay;
        if (!el) return;
        const existing = el.querySelector('.vn-background-overlay');
        const hasBackground = !!background && background !== 'none';

        if (show && hasBackground && !existing) {
            const layers = el.querySelectorAll('.vn-bg-layer');
            const dimming = document.createElement('div');
            dimming.className = 'vn-background-overlay vn-bo-in';
            dimming.addEventListener('animationend', () => dimming.classList.remove('vn-bo-in'), { once: true });
            layers[layers.length - 1]?.insertAdjacentElement('afterend', dimming);
        } else if ((!show || !hasBackground) && existing) {
            existing.classList.remove('vn-background-overlay', 'vn-bo-in');
            existing.classList.add('vn-bo-leaving', 'vn-bo-out');
            existing.addEventListener('animationend', () => existing.remove(), { once: true });
            setTimeout(() => existing.remove(), 1000);
        }
    }

    // ══════════════════════════════════════════════════════════
    // HTML Generation
    // ══════════════════════════════════════════════════════════

    generateSelector(currentBg = null, currentOverlay = true) {
        const sceneBg = canvas.scene?.levels?.contents[0]?.background?.src || '';
        const customFolder = VNBackgroundManager.getCustomFolder();
        const folderLabel = customFolder
            ? customFolder.split('/').pop() || customFolder
            : `${this.moduleId}/assets/scenes`;
        const thumbSize = parseInt(localStorage.getItem('player-queue.bg-thumb-size')) || 120;

        const inGallery = !currentBg || currentBg === 'none' || this.available.some(i => i.path === currentBg);
        const holder = inGallery
            ? `<input type="radio" name="background" class="vn-bg-holder" value="none" hidden>`
            : `<input type="radio" name="background" class="vn-bg-holder" value="${esc(currentBg)}" data-label="${esc(VNBackgroundManager._fileLabel(currentBg))}" checked hidden>`;

        return `<details class="vn-collapsible vn-bg-section" open>
            <summary class="vn-collapsible-header"><i class="fas fa-image"></i> ${loc('vn.bg.header')} <i class="fas fa-chevron-down vn-chevron"></i></summary>
            <div class="vn-collapsible-body">
                <div class="vn-bg-toolbar">
                  <div class="vn-bg-toolbar-row">
                    <label class="vn-overlay-toggle">
                        <input type="checkbox" id="background-overlay" ${currentOverlay ? 'checked' : ''}><span class="vn-toggle-track"></span><span>${loc('vn.bg.overlay')}</span>
                    </label>
                    ${sceneBg ? `<button type="button" class="vn-btn vn-btn-sm vn-use-scene-btn" data-background="${esc(sceneBg)}"><i class="fas fa-map"></i> ${loc('vn.bg.currentScene')}</button>` : ''}
                    <div class="vn-custom-path">
                        <input type="text" id="custom-background-path" placeholder="${loc('vn.bg.pathPlaceholder')}"
                               value="${currentBg && !currentBg.startsWith('modules/') ? esc(currentBg) : ''}">
                        <button type="button" class="vn-btn vn-btn-sm vn-apply-path-btn" title="${loc('vn.bg.applyPathTitle')}"><i class="fas fa-check"></i></button>
                    </div>
                  </div>
                <div class="vn-folder-row">
                    <i class="fas fa-folder-open"></i>
                    <span class="vn-folder-row-label" title="${esc(customFolder || this._defaultPath)}">${esc(folderLabel)}</span>
                    <button type="button" class="vn-btn vn-btn-sm vn-pick-folder-btn" title="${loc('vn.bg.pickFolderTitle')}"><i class="fas fa-folder-tree"></i> ${loc('vn.bg.pickFolder')}</button>
                    ${customFolder ? `<button type="button" class="vn-btn vn-btn-sm vn-reset-folder-btn" title="${loc('vn.bg.resetFolderTitle')}"><i class="fas fa-undo"></i></button>` : ''}
                    <div class="vn-bg-search">
                        <i class="fas fa-search"></i>
                        <input type="text" class="vn-bg-search-input" placeholder="${loc('vn.bg.searchPlaceholder')}" autocomplete="off" spellcheck="false">
                        <button type="button" class="vn-bg-search-clear" title="${loc('vn.bg.searchClear')}" hidden><i class="fas fa-xmark"></i></button>
                    </div>
                    <label class="vn-bg-size-ctrl" title="${loc('vn.bg.cardSizeTitle')}"><i class="fas fa-th-large"></i><span class="vn-bg-size-label">${loc('vn.bg.cardSizeLabel')}</span><input type="range" class="vn-bg-size-slider" min="72" max="240" step="8" value="${thumbSize}"></label>
                </div>
                </div>
                <div class="vn-bg-crumbs">${this._crumbsHtml()}</div>
                <div class="vn-bg-current">${holder}<div class="vn-bg-current-body">${this._currentBarHtml(currentBg, inGallery ? '' : VNBackgroundManager._fileLabel(currentBg))}</div></div>
                <div class="vn-background-gallery" style="--vn-bg-thumb-w: ${thumbSize}px">${this.generateGalleryContent(currentBg)}</div>
            </div></details>`;
    }

    _crumbsHtml() {
        const paths = [...this.navigation.map(n => n.path), this.currentPath];
        const last = paths.length - 1;
        const rootLabel = esc(VNBackgroundManager._prettify(this.rootPath.split('/').pop() || this.rootPath));
        return paths.map((p, i) => {
            const label = i === 0 ? rootLabel : esc(VNBackgroundManager._prettify(p.split('/').pop()));
            const icon = i === 0 ? 'fa-house' : 'fa-folder';
            const btn = `<button type="button" class="vn-bg-crumb ${i === last ? 'vn-bg-crumb-current' : ''}" data-depth="${i}" title="${label}" ${i === last ? 'disabled' : ''}><i class="fas ${icon}"></i> ${label}</button>`;
            return i === 0 ? btn : `<i class="fas fa-chevron-right vn-bg-crumb-sep"></i>${btn}`;
        }).join('');
    }

    _renderCrumbs(root) {
        const el = root?.querySelector('.vn-bg-crumbs');
        if (el) el.innerHTML = this._crumbsHtml();
    }

    _currentBarHtml(bg, label = '') {
        if (!bg || bg === 'none') {
            return `<span class="vn-bg-current-empty"><i class="fas fa-image"></i> ${loc('vn.bg.currentNone')}</span>`;
        }
        const name = label || VNBackgroundManager._fileLabel(bg);
        const segs = this._relativeSegments(bg);
        const where = !segs ? loc('vn.bg.outsideFolder')
            : segs.length > 1 ? segs.slice(0, -1).map(s => VNBackgroundManager._prettify(s)).join(' / ')
                : VNBackgroundManager._prettify(this.rootPath.split('/').pop() || '');
        const thumb = VNBackgroundManager.isVideo(bg)
            ? `<div class="vn-bg-current-thumb"><i class="fas fa-film"></i></div>`
            : `<div class="vn-bg-current-thumb" style="background-image: url('${esc(bg)}')"></div>`;
        const canLocate = this._canLocate(bg);
        return `<div class="vn-bg-current-main ${canLocate ? 'vn-locatable' : ''}" ${canLocate ? `title="${loc('vn.bg.locateTitle')}"` : ''}>
                ${thumb}
                <div class="vn-bg-current-text">
                    <span class="vn-bg-current-name">${esc(name)}</span>
                    <span class="vn-bg-current-where"><i class="fas fa-folder"></i> ${esc(where)}</span>
                </div>
            </div>
            <button type="button" class="vn-bg-current-clear" title="${loc('vn.bg.currentClear')}"><i class="fas fa-xmark"></i></button>`;
    }

    _renderCurrentBar(root) {
        const body = root?.querySelector('.vn-bg-current-body');
        if (!body) return;
        const checked = root.querySelector('input[name="background"]:checked');
        body.innerHTML = this._currentBarHtml(checked?.value, checked?.dataset.label);
    }

    generateGalleryContent(currentBg = null) {
        let html = '';
        if (this.navigation.length) html += this._folderNavBtn('back', 'fa-arrow-left', loc('vn.bg.back'));
        html += this._bgOption('none', loc('vn.bg.default'), 'vn-no-background', currentBg);

        for (const item of this.available) {
            html += item.type === 'folder'
                ? this._folderNavBtn('navigate', 'fa-folder', item.displayName, item.path)
                : this._bgOption(item.path, item.displayName, null, currentBg);
        }
        return html;
    }

    _folderNavBtn(action, icon, text, path = null, sub = '') {
        return `<div class="vn-bg-option vn-folder-nav" data-action="${action}" ${path ? `data-path="${esc(path)}"` : ''} title="${esc(sub ? `${sub} / ${text}` : text)}">
            <div class="vn-bg-preview vn-folder-preview"><i class="fas ${icon}"></i></div>
            <span class="vn-bg-name">${esc(text)}</span>${sub ? `<span class="vn-bg-sub">${esc(sub)}</span>` : ''}</div>`;
    }

    _bgOption(value, name, cssClass = null, currentBg = null, sub = '') {
        const selected = currentBg === value || (!currentBg && value === 'none');
        let previewInner = '', bgStyle = '';

        if (cssClass === 'vn-no-background') previewInner = `<span class="vn-no-bg-text">${loc('vn.bg.noBackground')}</span>`;
        else if (VNBackgroundManager.isVideo(value)) previewInner = `<video class="vn-bg-preview-video" src="${esc(value)}" muted loop playsinline preload="metadata"></video>`;
        else bgStyle = `style="background-image: url('${esc(value)}')"`;

        return `<label class="vn-bg-option ${selected ? 'selected' : ''}" title="${esc(sub ? `${sub} / ${name}` : name)}">
            <input type="radio" name="background" value="${esc(value)}" ${selected ? 'checked' : ''}>
            <div class="vn-bg-preview ${cssClass || ''}" ${bgStyle}>${previewInner}</div>
            <span class="vn-bg-name">${esc(name)}</span>${sub ? `<span class="vn-bg-sub">${esc(sub)}</span>` : ''}</label>`;
    }

    // ══════════════════════════════════════════════════════════
    // DOM Listeners (for dialog)
    // ══════════════════════════════════════════════════════════

    attachListeners(root) {
        if (!root || root._vnBgDelegated) return;
        root._vnBgDelegated = true;

        root.addEventListener('click', async (e) => {
            const opt = e.target.closest('.vn-background-gallery .vn-bg-option:not(.vn-folder-nav)');
            if (opt) {
                e.preventDefault(); e.stopPropagation();
                const radio = opt.querySelector('input[type="radio"]');
                if (radio) radio.checked = true;
                this._syncSelectionUI(root);
                return;
            }

            const nav = e.target.closest('.vn-folder-nav');
            if (nav) {
                e.preventDefault(); e.stopPropagation();
                const action = nav.dataset.action;
                if (action === 'goto') await this.gotoPath(nav.dataset.path);
                else await this.navigate(nav.dataset.path, action === 'back');
                this.refreshGallery(root);
                return;
            }

            const crumb = e.target.closest('.vn-bg-crumb:not([disabled])');
            if (crumb) {
                e.preventDefault();
                await this.gotoDepth(Number(crumb.dataset.depth));
                this.refreshGallery(root);
                return;
            }

            if (e.target.closest('.vn-bg-current-clear')) {
                e.preventDefault();
                this.addDynamicOption(root, 'none', '');
                return;
            }

            if (e.target.closest('.vn-bg-current-main.vn-locatable')) {
                e.preventDefault();
                await this.locateCurrent(root);
                return;
            }

            if (e.target.closest('.vn-bg-search-clear')) {
                e.preventDefault();
                this.refreshGallery(root);
                root.querySelector('.vn-bg-search-input')?.focus();
                return;
            }

            const sceneBtn = e.target.closest('.vn-use-scene-btn');
            if (sceneBtn) {
                e.preventDefault();
                const bg = sceneBtn.dataset.background;
                if (bg) this.addDynamicOption(root, bg, loc('vn.bg.currentScene'));
                return;
            }

            const pathBtn = e.target.closest('.vn-apply-path-btn');
            if (pathBtn) {
                e.preventDefault();
                const path = root.querySelector('#custom-background-path')?.value?.trim();
                if (path) this.addDynamicOption(root, path, loc('vn.bg.custom'));
                return;
            }

            if (e.target.closest('.vn-pick-folder-btn')) {
                e.preventDefault();
                this._openFolderPicker(root);
                return;
            }

            if (e.target.closest('.vn-reset-folder-btn')) {
                e.preventDefault();
                await VNBackgroundManager.saveCustomFolder('');
                this.resetPath();
                await this.load();
                this._rebuildSelector(root);
            }
        });

        root.addEventListener('mouseenter', (e) => {
            const video = e.target.closest?.('.vn-bg-option')?.querySelector('.vn-bg-preview-video');
            if (video) video.play().catch(() => {});
        }, true);

        root.addEventListener('mouseleave', (e) => {
            const video = e.target.closest?.('.vn-bg-option')?.querySelector('.vn-bg-preview-video');
            if (video) { video.pause(); video.currentTime = 0; }
        }, true);

        root.addEventListener('input', (e) => {
            const sizeSlider = e.target.closest('.vn-bg-size-slider');
            if (sizeSlider) {
                const val = sizeSlider.value;
                root.querySelector('.vn-background-gallery')?.style.setProperty('--vn-bg-thumb-w', val + 'px');
                localStorage.setItem('player-queue.bg-thumb-size', val);
                return;
            }

            const search = e.target.closest('.vn-bg-search-input');
            if (search) {
                const q = search.value.trim();
                const clear = root.querySelector('.vn-bg-search-clear');
                if (clear) clear.hidden = !search.value;
                clearTimeout(this._searchTimer);
                if (!q) { this.refreshGallery(root); return; }
                this._query = q;
                this._searchTimer = setTimeout(() => this._runSearch(root, q), 180);
            }
        });

        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && e.target.closest?.('.vn-bg-search-input') && e.target.value) {
                e.preventDefault(); e.stopPropagation();
                this.refreshGallery(root);
            }
        });
    }

    _openFolderPicker(root) {
        const startPath = VNBackgroundManager.getCustomFolder() || this._defaultPath;
        const FPImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
        const fp = new FPImpl({
            type: 'folder',
            current: startPath,
            callback: async (folderPath) => {
                await VNBackgroundManager.saveCustomFolder(folderPath);
                this.resetPath();
                this._indexPromise = null;
                await this.load();
                this._rebuildSelector(root);
            }
        });
        fp.browse(startPath);
    }

    _rebuildSelector(root) {
        const section = root.querySelector('.vn-bg-section');
        if (!section) return;
        this._clearSearchUI(root);
        const currentBg = this._checkedValue(root) ?? null;
        const currentOverlay = root.querySelector('#background-overlay')?.checked ?? true;
        section.outerHTML = this.generateSelector(currentBg, currentOverlay);
        this._keepSelection(root, currentBg);
        this._syncSelectionUI(root);
    }

    /**
     * Shows the current folder in an open dialog (also leaves search mode).
     * `selectedBg` forces that gallery card to be the selection.
     */
    refreshGallery(dialogElement, selectedBg = null) {
        if (!dialogElement?.querySelector('.vn-background-gallery')) return;
        this._clearSearchUI(dialogElement);
        const current = selectedBg ?? this._checkedValue(dialogElement);
        this._renderCrumbs(dialogElement);
        this._setGallery(dialogElement, this.generateGalleryContent(current));
    }
}

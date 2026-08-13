// ============================================================
// vn-background-manager.js — управление фонами, галерея, переходы
// ============================================================

import { VNAtmosphere } from './visual-effects/atmosphere/index.js';
import { VNTransitions } from './visual-effects/vn-transitions.js';

export class VNBackgroundManager {
    static IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    static VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov'];
    static get ALL_EXTENSIONS() {
        return this._allExt ??= [...this.IMAGE_EXTENSIONS, ...this.VIDEO_EXTENSIONS];
    }

    static MODULE_ID = 'player-queue';
    static FOLDER_SETTING = 'backgroundFolder';

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
    }

    static isVideo(path) {
        if (!path) return false;
        return this.VIDEO_EXTENSIONS.includes(path.split('.').pop().split('?')[0].toLowerCase());
    }

    // ══════════════════════════════════════════════════════════
    // Loading & Navigation
    // ══════════════════════════════════════════════════════════

    async load(path = null) {
        try {
            const targetPath = path || this.currentPath;
            const response = await FilePicker.browse('data', targetPath);

            const folders = (response.dirs || []).map(dir => {
                const name = decodeURIComponent(dir.split('/').pop()).replace(/[-_]/g, ' ');
                return { type: 'folder', path: dir, name, displayName: `📁 ${name}` };
            });

            const media = (response.files || [])
                .filter(f => VNBackgroundManager.ALL_EXTENSIONS.includes(f.split('.').pop().toLowerCase()))
                .map(file => {
                    const name = decodeURIComponent(file.split('/').pop().split('.')[0]).replace(/[-_]/g, ' ');
                    const isVid = VNBackgroundManager.isVideo(file);
                    return { type: isVid ? 'video' : 'image', path: file, name, displayName: isVid ? `🎬 ${name}` : name };
                });

            this.available = [...folders, ...media];
        } catch (error) {
            console.error('VN: Error loading backgrounds:', error);
            this.available = [];
        }
    }

    async navigate(folderPath, folderName, isBack = false) {
        if (isBack) {
            if (!this.navigation.length) return null;
            ({ path: folderPath, name: folderName } = this.navigation.pop());
        } else {
            this.navigation.push({
                path: this.currentPath,
                name: this.currentPath.split('/').pop() || 'scenes'
            });
        }
        this.currentPath = folderPath;
        await this.load(folderPath);
        return folderName;
    }

    resetPath() {
        const custom = VNBackgroundManager.getCustomFolder();
        this.currentPath = custom || this._defaultPath;
        this.navigation = [];
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
                bgLayer.style.backgroundImage = `url("${background}?t=${Date.now()}")`;
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
     * Animated background switch (dissolve transition)
     */
    async switchWithTransition($overlay, newBg, showOverlay, atmosphere) {
        const el = $overlay[0] ?? $overlay;
        if (!el || !newBg || newBg === 'none' || VNBackgroundManager.isVideo(newBg)) {
            this.applyBackground($overlay, newBg, showOverlay);
            return;
        }

        const oldBgLayer = el.querySelector('.vn-bg-layer');
        if (!oldBgLayer?.style.backgroundImage) {
            this.applyBackground($overlay, newBg, showOverlay);
            return;
        }

        try {
            await VNTransitions.switchBackground(el, `${newBg}?t=${Date.now()}`, 'dissolve');
            atmosphere?.resetZoom?.();

            const existing = el.querySelector('.vn-background-overlay');
            if (showOverlay) {
                if (!existing) oldBgLayer.insertAdjacentHTML('afterend', '<div class="vn-background-overlay"></div>');
            } else existing?.remove();
        } catch (e) {
            console.error('VN: Background transition failed:', e);
            this.applyBackground($overlay, newBg, showOverlay);
        }
    }

    // ══════════════════════════════════════════════════════════
    // HTML Generation
    // ══════════════════════════════════════════════════════════

    generateSelector(currentBg = null, currentOverlay = true, currentEffect = 'particles') {
        const sceneBg = canvas.scene?.levels?.contents[0]?.background?.src || '';
        const effectOptions = VNAtmosphere.EFFECT_GROUPS
            .map(g => `<optgroup label="${g.label}">${
                g.effects.map(e => `<option value="${e}" ${e === currentEffect ? 'selected' : ''}>${VNAtmosphere.EFFECT_LABELS[e]}</option>`).join('')
            }</optgroup>`)
            .join('');
        const customFolder = VNBackgroundManager.getCustomFolder();
        const folderLabel = customFolder
            ? customFolder.split('/').pop() || customFolder
            : `${this.moduleId}/assets/scenes`;

        return `<details class="vn-collapsible vn-bg-section" open>
            <summary class="vn-collapsible-header"><i class="fas fa-image"></i> Фон сцены <i class="fas fa-chevron-down vn-chevron"></i></summary>
            <div class="vn-collapsible-body">
                <div class="vn-bg-toolbar">
                    <label class="vn-overlay-toggle">
                        <input type="checkbox" id="background-overlay" ${currentOverlay ? 'checked' : ''}><span>Затенение</span>
                    </label>
                    <label class="vn-overlay-toggle">
                        <i class="fas fa-magic"></i>
                        <select id="atmosphere-effect" class="vn-atmosphere-select">${effectOptions}</select>
                    </label>
                    ${sceneBg ? `<button type="button" class="vn-btn vn-btn-sm vn-use-scene-btn" data-background="${sceneBg}"><i class="fas fa-map"></i> Текущая сцена</button>` : ''}
                    <div class="vn-custom-path">
                        <input type="text" id="custom-background-path" placeholder="Путь к изображению или видео..."
                               value="${currentBg && !currentBg.startsWith('modules/') ? currentBg : ''}">
                        <button type="button" class="vn-btn vn-btn-sm vn-apply-path-btn"><i class="fas fa-check"></i></button>
                    </div>
                </div>
                <div class="vn-folder-row">
                    <i class="fas fa-folder-open"></i>
                    <span class="vn-folder-row-label" title="${customFolder || this._defaultPath}">${folderLabel}</span>
                    <button type="button" class="vn-btn vn-btn-sm vn-pick-folder-btn" title="Выбрать папку с изображениями"><i class="fas fa-search"></i> Выбрать папку</button>
                    ${customFolder ? `<button type="button" class="vn-btn vn-btn-sm vn-reset-folder-btn" title="Вернуть папку по умолчанию"><i class="fas fa-undo"></i></button>` : ''}
                </div>
                <div class="vn-background-gallery">${this.generateGalleryContent(currentBg)}</div>
            </div></details>`;
    }

    generateGalleryContent(currentBg = null, folderName = null) {
        let html = '';
        if (folderName) html += `<div class="vn-folder-title"><i class="fas fa-folder-open"></i> ${folderName}</div>`;
        if (this.navigation.length) html += this._folderNavBtn('back', 'fa-arrow-left', 'Назад');
        html += this._bgOption('none', 'По умолчанию', 'vn-no-background', currentBg);

        for (const item of this.available) {
            html += item.type === 'folder'
                ? this._folderNavBtn('navigate', 'fa-folder', item.displayName, item.path)
                : this._bgOption(item.path, item.displayName, null, currentBg);
        }
        return html;
    }

    _folderNavBtn(action, icon, text, path = null) {
        return `<div class="vn-bg-option vn-folder-nav" data-action="${action}" ${path ? `data-path="${path}"` : ''}>
            <div class="vn-bg-preview vn-folder-preview"><i class="fas ${icon}"></i></div>
            <span class="vn-bg-name">${text}</span></div>`;
    }

    _bgOption(value, name, cssClass = null, currentBg = null) {
        const selected = currentBg === value || (!currentBg && value === 'none');
        let previewInner = '', bgStyle = '';

        if (cssClass === 'vn-no-background') previewInner = '<span class="vn-no-bg-text">Без фона</span>';
        else if (VNBackgroundManager.isVideo(value)) previewInner = `<video class="vn-bg-preview-video" src="${value}" muted loop playsinline preload="metadata"></video>`;
        else bgStyle = `style="background-image: url('${value}')"`;

        return `<label class="vn-bg-option ${selected ? 'selected' : ''}">
            <input type="radio" name="background" value="${value}" ${selected ? 'checked' : ''}>
            <div class="vn-bg-preview ${cssClass || ''}" ${bgStyle}>${previewInner}</div>
            <span class="vn-bg-name">${name}</span></label>`;
    }

    // ══════════════════════════════════════════════════════════
    // DOM Listeners (for dialog)
    // ══════════════════════════════════════════════════════════

    addDynamicOption(root, path, label) {
        root.querySelectorAll('.vn-bg-option').forEach(o => o.classList.remove('selected'));
        root.querySelectorAll('input[name="background"]').forEach(r => r.checked = false);
        root.querySelectorAll('.vn-bg-option.vn-dynamic').forEach(el => el.remove());

        const isVid = VNBackgroundManager.isVideo(path);
        const opt = document.createElement('label');
        opt.className = 'vn-bg-option selected vn-dynamic';
        opt.innerHTML = `
            <input type="radio" name="background" value="${path}">
            <div class="vn-bg-preview" ${isVid ? '' : `style="background-image: url('${path}')"`}>
                ${isVid ? `<video class="vn-bg-preview-video" src="${path}" muted loop playsinline preload="metadata"></video>` : ''}
            </div>
            <span class="vn-bg-name">${isVid ? '🎬 ' : ''}${label}</span>`;

        root.querySelector('.vn-background-gallery')?.prepend(opt);
        opt.querySelector('input[type="radio"]').checked = true;

        opt.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            root.querySelectorAll('.vn-bg-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            opt.querySelector('input[type="radio"]').checked = true;
        });

        const vid = opt.querySelector('.vn-bg-preview-video');
        if (vid) {
            opt.addEventListener('mouseenter', () => vid.play().catch(() => {}));
            opt.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
        }
    }

    attachListeners(root, onNavigate) {
        if (!root) return;

        if (!root._vnBgDelegated) {
            root._vnBgDelegated = true;

            root.addEventListener('click', async (e) => {
                const opt = e.target.closest('.vn-bg-option:not(.vn-folder-nav)');
                if (opt) {
                    e.preventDefault(); e.stopPropagation();
                    root.querySelectorAll('.vn-bg-option').forEach(o => o.classList.remove('selected'));
                    opt.classList.add('selected');
                    const radio = opt.querySelector('input[type="radio"]');
                    if (radio) radio.checked = true;
                    return;
                }

                const nav = e.target.closest('.vn-folder-nav');
                if (nav) {
                    e.preventDefault(); e.stopPropagation();
                    const isBack = nav.dataset.action === 'back';
                    const name = isBack ? null : (nav.querySelector('.vn-bg-name')?.textContent?.replace('📁 ', '') || '');
                    const path = isBack ? null : nav.dataset.path;
                    const folderName = await this.navigate(path, name, isBack);
                    this._onNavigate?.(folderName);
                    return;
                }

                const sceneBtn = e.target.closest('.vn-use-scene-btn');
                if (sceneBtn) {
                    e.preventDefault();
                    const bg = sceneBtn.dataset.background;
                    if (bg) this.addDynamicOption(root, bg, 'Текущая сцена');
                    return;
                }

                const pathBtn = e.target.closest('.vn-apply-path-btn');
                if (pathBtn) {
                    e.preventDefault();
                    const path = root.querySelector('#custom-background-path')?.value?.trim();
                    if (path) this.addDynamicOption(root, path, 'Пользовательский');
                    return;
                }

                const pickFolderBtn = e.target.closest('.vn-pick-folder-btn');
                if (pickFolderBtn) {
                    e.preventDefault();
                    this._openFolderPicker(root);
                    return;
                }

                const resetFolderBtn = e.target.closest('.vn-reset-folder-btn');
                if (resetFolderBtn) {
                    e.preventDefault();
                    await VNBackgroundManager.saveCustomFolder('');
                    this.resetPath();
                    await this.load();
                    this._rebuildSelector(root);
                }
            });

            root.addEventListener('mouseenter', (e) => {
                const video = e.target.closest('.vn-bg-option')?.querySelector('.vn-bg-preview-video');
                if (video) video.play().catch(() => {});
            }, true);

            root.addEventListener('mouseleave', (e) => {
                const video = e.target.closest('.vn-bg-option')?.querySelector('.vn-bg-preview-video');
                if (video) { video.pause(); video.currentTime = 0; }
            }, true);
        }

        this._onNavigate = onNavigate;
    }

    _openFolderPicker(root) {
        const startPath = VNBackgroundManager.getCustomFolder() || this._defaultPath;
        const fp = new FilePicker({
            type: 'folder',
            current: startPath,
            callback: async (folderPath) => {
                await VNBackgroundManager.saveCustomFolder(folderPath);
                this.resetPath();
                await this.load();
                this._rebuildSelector(root);
            }
        });
        fp.browse(startPath);
    }

    _rebuildSelector(root) {
        const section = root.querySelector('.vn-bg-section');
        if (!section) return;
        const currentBg = root.querySelector('input[name="background"]:checked')?.value ?? null;
        const currentOverlay = root.querySelector('#background-overlay')?.checked ?? true;
        const currentEffect = root.querySelector('#atmosphere-effect')?.value ?? 'particles';
        const newHtml = this.generateSelector(currentBg, currentOverlay, currentEffect);
        section.outerHTML = newHtml;
        this.attachListeners(root, (name) => this.refreshGallery(root, name));
    }

    /**
     * Refresh gallery inside an open dialog
     */
    refreshGallery(dialogElement, folderName = null) {
        const gallery = dialogElement?.querySelector('.vn-background-gallery');
        if (!gallery) return;
        const current = gallery.querySelector('input[name="background"]:checked')?.value;
        gallery.innerHTML = this.generateGalleryContent(current, folderName);
        this.attachListeners(dialogElement, (name) => this.refreshGallery(dialogElement, name));
    }
}

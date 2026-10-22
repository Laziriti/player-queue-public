// ============================================================
// vn-transitions.js — Character & Background transitions
// ============================================================

import { VNPreloader } from '../vn-preload.js';

class VNTransitions {

    static ENTER_TYPES = ['left', 'right', 'dramatic', 'shadow', 'rise'];

    static BG_TYPES = ['dissolve', 'zoom', 'blur', 'flash', 'black', 'sweep'];

    static BG_DURATIONS = {
        dissolve: 1000, zoom: 1200, blur: 1400,
        flash: 1000, black: 1800, sweep: 1000
    };

    static ENTER_DURATIONS = {
        left: 800, right: 800, dramatic: 1200,
        shadow: 1000, rise: 1000
    };

    // ═══════════════════════════════════════════
    // Тайминг смены шага (составные пресеты)
    //
    // Любая смена сцены (ручная правка или шаг составного пресета) запускает фон, выход и вход
    // персонажей одновременно; тайминг задаётся одним выбором: тип перехода фона + скорость.
    // ═══════════════════════════════════════════

    /** 'cut' — фон меняется мгновенно, остальное как обычно. */
    static TRANSITION_TYPES = ['dissolve', 'zoom', 'blur', 'flash', 'black', 'sweep', 'cut'];

    static SPEEDS = { fast: 0.6, normal: 1, slow: 1.6 };

    /**
     * «Занавесные» переходы. Когда вместе с фоном меняются и персонажи, они накрывают всю сцену слоем-занавесом
     * (см. cover()), а не только слой фона; остальные типы — плавные перетекания, там персонажи справляются сами.
     */
    static COVER_TYPES = ['flash', 'black', 'sweep'];

    /** Доля общей длительности, которую занавес закрывается (остальное — открывается). */
    static COVER_SPLIT = { black: 0.4, flash: 0.18, sweep: 0.5 };

    static STEP_EXIT_MS = 400;
    static STEP_ENTER_MS = 600;
    static STEP_STAGGER_MS = 70;

    /** Spec `{ type, speed }` (it also arrives over the socket) → concrete durations; anything missing or invalid falls back to dissolve / normal. */
    static timing(spec) {
        if (!spec || typeof spec !== 'object') spec = {};
        const type = this.TRANSITION_TYPES.includes(spec.type) ? spec.type : 'dissolve';
        const k = this.SPEEDS[spec.speed] ?? 1;
        return {
            type,
            cover: this.COVER_TYPES.includes(type),
            bg: type === 'cut' ? 0 : Math.round(this.BG_DURATIONS[type] * k),
            exit: Math.round(this.STEP_EXIT_MS * k),
            enter: Math.round(this.STEP_ENTER_MS * k),
            stagger: Math.round(this.STEP_STAGGER_MS * k),
        };
    }

    // ═══════════════════════════════════════════
    // Вход персонажа
    // ═══════════════════════════════════════════

    static enterCharacter(charEl, type = 'auto', duration = null) {
        if (!charEl) return Promise.resolve();

        if (type === 'auto') {
            const side = charEl.closest('.vn-side');
            // ▼ ИСПРАВЛЕНО: было vn-side-left, стало vn-left-side
            if (side?.classList.contains('vn-left-side')) type = 'left';
            else if (side?.classList.contains('vn-right-side')) type = 'right';
            else type = 'left'; // center → left entrance
        }

        this._cleanAnimClasses(charEl);

        const img = charEl.querySelector('.vn-character-img');
        if (img) img.style.opacity = '0';

        const timed = Number.isFinite(duration);
        if (timed) this._applyTimed(charEl, duration);
        charEl.classList.add('vn-entering', `vn-entering-${type}`);

        requestAnimationFrame(() => {
            if (img) img.style.opacity = '';
        });

        const ms = timed ? duration : (this.ENTER_DURATIONS[type] || 800);

        return new Promise(resolve => {
            setTimeout(() => {
                this._cleanAnimClasses(charEl);
                resolve();
            }, ms + 50);
        });
    }

    // ═══════════════════════════════════════════
    // Выход персонажа
    // ═══════════════════════════════════════════

    static exitCharacter(charEl, duration = null) {
        if (!charEl) return Promise.resolve();

        this._cleanAnimClasses(charEl);
        const timed = Number.isFinite(duration);
        if (timed) this._applyTimed(charEl, duration);
        charEl.classList.add('vn-exiting');

        return new Promise(resolve => {
            setTimeout(resolve, timed ? duration : 650);
        });
    }

    // ═══════════════════════════════════════════
    // Смена фона
    // ═══════════════════════════════════════════

    static async switchBackground(overlayEl, newImageUrl, type = 'dissolve', duration = null) {
        if (!overlayEl || !newImageUrl) return;

        // A video background is loaded off-screen first, so the layer is never shown empty
        const video = VNPreloader.isVideo(newImageUrl) ? await this._loadVideo(newImageUrl) : null;

        // A previous switch may still be running (fast stepping): finish it so layers never stack up
        const layers = [...overlayEl.querySelectorAll('.vn-bg-layer')];
        if (layers.length > 1) {
            layers.slice(0, -1).forEach(layer => layer.remove());
            const newest = layers[layers.length - 1];
            newest.className = 'vn-bg-layer';
            newest.style.removeProperty('--vn-bg-rest');
            newest.style.removeProperty('--vn-bg-ms');
        }

        const oldBg = overlayEl.querySelector('.vn-bg-layer');
        if (!oldBg) return;

        duration = duration || this.BG_DURATIONS[type] || 1000;

        const currentTransform = oldBg.style.transform || '';

        const newBg = document.createElement('div');
        newBg.className = 'vn-bg-layer';
        if (video) newBg.appendChild(video);
        else newBg.style.backgroundImage = `url("${newImageUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
        if (currentTransform) newBg.style.transform = currentTransform;
        newBg.style.position = 'absolute';
        newBg.style.inset = '-15px';
        newBg.style.zIndex = '0';
        newBg.style.backgroundSize = 'cover';
        newBg.style.backgroundPosition = 'center';

        oldBg.insertAdjacentElement('afterend', newBg);

        // The look the active visual effect gives this layer. The transition keyframes animate `filter` as well, so
        // they are built on top of it (--vn-bg-rest, see vn-fx-base.css); otherwise the effect would only snap in
        // when the transition ends. Read it before the transition class (and its animation) is added.
        const restFilter = getComputedStyle(newBg).filter;
        if (restFilter && restFilter !== 'none') newBg.style.setProperty('--vn-bg-rest', restFilter);
        newBg.style.setProperty('--vn-bg-ms', `${duration}ms`);
        newBg.classList.add(`vn-bg-transition-${type}`);

        return new Promise(resolve => {
            let resolved = false;

            const cleanup = () => {
                if (resolved) return;
                resolved = true;
                newBg.className = 'vn-bg-layer';
                newBg.style.removeProperty('--vn-bg-rest');
                newBg.style.removeProperty('--vn-bg-ms');
                if (oldBg.parentNode) oldBg.remove();
                resolve();
            };

            newBg.addEventListener('animationend', cleanup, { once: true });
            setTimeout(cleanup, duration + 200);
        });
    }

    /** Same element VNBackgroundManager.applyBackground builds for a video background; resolves once data is loaded (max 2.5 s). */
    static async _loadVideo(url) {
        const video = Object.assign(document.createElement('video'), {
            className: 'vn-bg-video', src: url,
            autoplay: true, loop: true, muted: true, playsInline: true, preload: 'auto'
        });
        video.setAttribute('playsinline', '');
        video.setAttribute('disablepictureinpicture', '');
        await new Promise(resolve => {
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 2500);
        });
        video.play().catch(() => {});
        return video;
    }

    // ═══════════════════════════════════════════
    // Занавес поверх всей сцены (flash / black / sweep)
    // ═══════════════════════════════════════════

    /**
     * Накрывает всю сцену, вызывает `swap()` пока она закрыта (там всё меняется мгновенно: фон, персонажи, эффект)
     * и открывает снова. Общая длительность — `timing.bg`.
     */
    static async cover(overlayEl, timing, swap) {
        const total = Math.max(timing.bg, 300);
        const msIn = Math.round(total * (this.COVER_SPLIT[timing.type] ?? 0.4));
        const curtain = document.createElement('div');
        curtain.className = `vn-tr-cover vn-tr-cover--${timing.type}`;
        overlayEl.appendChild(curtain);
        try {
            await this._coverPhase(curtain, 'in', msIn);
            await swap();
            await this._coverPhase(curtain, 'out', total - msIn);
        } finally {
            curtain.remove();
        }
    }

    static _coverPhase(curtain, phase, ms) {
        return new Promise(resolve => {
            curtain.style.setProperty('--vn-cover-ms', `${ms}ms`);
            curtain.classList.remove('vn-tr-cover--in', 'vn-tr-cover--out');
            void curtain.offsetWidth; // restart the animation for the new phase
            curtain.classList.add(`vn-tr-cover--${phase}`);
            curtain.addEventListener('animationend', resolve, { once: true });
            setTimeout(resolve, ms + 80);
        });
    }

    // ═══════════════════════════════════════════
    // Утилиты
    // ═══════════════════════════════════════════

    /** Overrides the CSS animation length of one character (see `.vn-tr-timed` in vn-characters.css). */
    static _applyTimed(el, ms) {
        el.style.setProperty('--vn-tr-ms', `${ms}ms`);
        el.classList.add('vn-tr-timed');
    }

    static _cleanAnimClasses(el) {
        if (!el) return;
        el.style.removeProperty('--vn-tr-ms');
        el.classList.remove(
            'vn-tr-timed',
            'vn-entering', 'vn-exiting',
            'vn-entering-left', 'vn-entering-right',
            'vn-entering-dramatic', 'vn-entering-shadow',
            'vn-entering-rise'
        );
    }
}

export { VNTransitions };

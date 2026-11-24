// ============================================================
// vn-transitions.js — Character & Background transitions
// ============================================================

import { VNPreloader } from '../media/vn-preload.js';
import { createBackgroundVideo, releaseVideo } from '../media/vn-media-utils.js';
import { cssUrl } from '../../utils/paths.js';
import { VNStageTransition } from './vn-stage-transition.js';
import { startPortraitMotion, stopPortraitMotion } from './character-fx/portrait-effects.js';
import { ENTER_TYPES, DEFAULT_ENTRANCE, TRANSITION_TYPES, TRANSITION_SPEEDS } from './vn-transition-config.js';

class VNTransitions {

    static ENTER_TYPES = ENTER_TYPES;
    static DEFAULT_ENTRANCE = DEFAULT_ENTRANCE;

    static resolveEntrance(value) { return this.ENTER_TYPES.includes(value) ? value : this.DEFAULT_ENTRANCE; }

    static _running = new WeakMap();
    static _characterRuns = new WeakMap();

    static _start(overlay, type) {
        this.cancel(overlay);
        const run = new AbortController();
        this._running.set(overlay, { run, type });
        return run;
    }

    static _finish(overlay, run) {
        if (this._running.get(overlay)?.run === run) this._running.delete(overlay);
    }

    static cancel(overlay) {
        this._running.get(overlay)?.run.abort();
        VNStageTransition.cancel(overlay);
    }

    static BG_DURATIONS = {
        dissolve: 1000, zoom: 1200, blur: 1400,
        flash: 1000, black: 1800, sweep: 1000, orbit: 1400, teleport: 1500
    };

    static ENTER_DURATIONS = {
        left: 800, right: 800, dramatic: 1200,
        shadow: 1000, rise: 1000, fade: 800, drop: 1000, pop: 800
    };

    // ═══════════════════════════════════════════
    // Тайминг смены шага (составные пресеты)
    //
    // Любая смена сцены (ручная правка или шаг составного пресета) запускает фон, выход и вход
    // персонажей одновременно; тайминг задаётся одним выбором: тип перехода фона + скорость.
    // ═══════════════════════════════════════════

    /** 'cut' — фон меняется мгновенно, остальное как обычно. */
    static TRANSITION_TYPES = TRANSITION_TYPES;

    static SPEEDS = TRANSITION_SPEEDS;

    /**
     * «Занавесные» переходы. Когда вместе с фоном меняются и персонажи, они накрывают всю сцену слоем-занавесом
     * (см. cover()), а не только слой фона; остальные типы — плавные перетекания, там персонажи справляются сами.
     */
    static COVER_TYPES = ['flash', 'black', 'sweep'];
    static STAGE_TYPES = ['orbit', 'teleport'];

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
            direction: spec.direction === -1 ? -1 : 1,
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

    static enterCharacter(charEl, type = this.DEFAULT_ENTRANCE, duration = null) {
        if (!charEl) return Promise.resolve();
        type = this.resolveEntrance(type);
        this._cleanAnimClasses(charEl);
        const img = charEl.querySelector('.vn-character-img');
        charEl.style.visibility = '';
        if (img) img.style.opacity = '';
        if (type === 'none' || duration === 0) return Promise.resolve();

        if (type === 'auto') {
            const side = charEl.closest('.vn-side');
            // ▼ ИСПРАВЛЕНО: было vn-side-left, стало vn-left-side
            if (side?.classList.contains('vn-left-side')) type = 'left';
            else if (side?.classList.contains('vn-right-side')) type = 'right';
            else type = 'left'; // center → left entrance
        }

        const timed = Number.isFinite(duration);
        if (timed) this._applyTimed(charEl, duration);
        charEl.classList.add('vn-entering', `vn-entering-${type}`);

        const ms = timed ? duration : (this.ENTER_DURATIONS[type] || 800);

        startPortraitMotion(charEl, type, ms);
        return this._waitCharacter(charEl, ms + 50, true);
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

        if (duration !== 0) startPortraitMotion(charEl, 'exit', timed ? duration : 600);
        return this._waitCharacter(charEl, timed ? duration : 650, false);
    }

    static _waitCharacter(el, ms, entering) {
        return new Promise(resolve => {
            const finish = () => {
                clearTimeout(timer);
                this._characterRuns.delete(el);
                resolve();
            };
            const timer = setTimeout(() => {
                finish();
                if (entering) this._cleanAnimClasses(el);
            }, ms);
            this._characterRuns.set(el, finish);
        });
    }

    // ═══════════════════════════════════════════
    // Смена фона
    // ═══════════════════════════════════════════

    /**
     * Останавливает и отпускает видео внутри элемента, который сейчас будет убран из DOM: оторванный <video> с autoplay
     * продолжает декодироваться и держать память до сборки мусора.
     */
    static releaseVideos(root) {
        const videos = [...(root?.querySelectorAll?.('video') ?? [])];
        if (root?.matches?.('video')) videos.unshift(root);
        videos.forEach(releaseVideo);
    }

    static async switchBackground(overlayEl, newImageUrl, type = 'dissolve', duration = null, isCurrent = () => true) {
        if (!overlayEl || !newImageUrl) return;

        const run = this._start(overlayEl);
        const { signal } = run;
        let video;
        let promote;
        try {
            // Load video off-screen; the outgoing background stays visible until the incoming media is ready.
            video = VNPreloader.isVideo(newImageUrl) ? await this._loadVideo(newImageUrl, signal) : null;
            const oldBg = overlayEl.querySelector('.vn-bg-layer');
            if (signal.aborted || !isCurrent() || !oldBg) return;
            duration = duration || this.BG_DURATIONS[type] || 1000;

            const newBg = document.createElement('div');
            newBg.className = 'vn-bg-layer vn-bg-transitioning';
            newBg.style.visibility = 'hidden';
            newBg.style.transform = oldBg.style.transform;
            if (video) {
                newBg.style.inset = '-15px';
                newBg.appendChild(video);
            } else newBg.style.backgroundImage = cssUrl(newImageUrl);
            oldBg.insertAdjacentElement('afterend', newBg);

            promote = () => {
                newBg.className = 'vn-bg-layer';
                newBg.style.visibility = '';
                if (oldBg.parentNode) { this.releaseVideos(oldBg); oldBg.remove(); }
            };
            signal.addEventListener('abort', promote, { once: true });
            try {
                const { playPixiBackground } = await import('./vn-pixi-transitions.js');
                if (!signal.aborted) await playPixiBackground(newBg, newImageUrl, video, type, duration, signal);
            } catch (error) {
                if (!signal.aborted) console.error('VN: Pixi background transition failed', error);
            }
        } finally {
            if (!signal.aborted) promote?.();
            if (video && !video.isConnected) this.releaseVideos(video);
            this._finish(overlayEl, run);
        }
    }

    /** Same element VNSceneBackground.applyBackground builds for a video background; resolves once data is loaded (max 2.5 s). */
    static prepareVideo(url) { return this._loadVideo(url); }

    static async _loadVideo(url, signal) {
        const video = createBackgroundVideo(url);
        video.preload = 'auto';
        if (!signal?.aborted) await new Promise(resolve => {
            const listeners = new AbortController();
            const finish = () => {
                clearTimeout(timer);
                listeners.abort();
                resolve();
            };
            const timer = setTimeout(finish, 2500);
            video.addEventListener('loadeddata', finish, { signal: listeners.signal });
            video.addEventListener('error', finish, { signal: listeners.signal });
            signal?.addEventListener('abort', finish, { signal: listeners.signal });
        });
        if (!signal?.aborted) video.play().catch(() => {});
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
        const run = this._start(overlayEl);
        const { signal } = run;
        const total = Math.max(timing.bg, 300);
        const msIn = Math.round(total * (this.COVER_SPLIT[timing.type] ?? 0.4));
        const msOut = total - msIn;
        try {
            const pixi = await import('./vn-pixi-transitions.js').catch(error => {
                if (!signal.aborted) console.error('VN: Pixi curtain failed to load', error);
            });
            if (signal.aborted || !overlayEl.isConnected) return;
            if (pixi) await pixi.playPixiCover(overlayEl, timing.type, msIn, msOut, swap, signal);
            else await swap();
        } finally { this._finish(overlayEl, run); }
    }

    static async stage(overlay, timing, swap, media) {
        if (timing.type === 'orbit') return VNStageTransition.run(overlay, timing, swap);
        if (!overlay?.isConnected) return;
        if (overlay.classList.contains('minimized') || matchMedia('(prefers-reduced-motion: reduce)').matches
            || !document.startViewTransition || !CSS.supports('view-transition-class: vn-teleport-cast')) return swap();
        const run = this._start(overlay, timing.type);
        let swapped = false, swapping = false;
        const commit = async () => {
            swapped = swapping = true;
            await swap();
            swapping = false;
        };
        try {
            const { playPixiTeleport } = await import('./vn-pixi-transitions.js');
            if (!run.signal.aborted) await playPixiTeleport(overlay, timing, media, commit, run.signal);
        } catch (error) {
            if (swapping) throw error;
            if (!run.signal.aborted) console.warn('VN: Pixi teleport skipped:', error.message);
        } finally {
            this._finish(overlay, run);
        }
        // The layout revision guard rejects a stale swap after navigation or close.
        if (!swapped && overlay.isConnected) await swap();
    }

    static cancelStage(overlay) {
        const active = this._running.get(overlay);
        if (active?.type === 'teleport') active.run.abort();
        VNStageTransition.cancel(overlay);
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
        this._characterRuns.get(el)?.();
        stopPortraitMotion(el);
        el.style.removeProperty('--vn-tr-ms');
        el.classList.remove(
            'vn-tr-timed',
            'vn-entering', 'vn-exiting',
            ...this.ENTER_TYPES.map(type => `vn-entering-${type}`)
        );
    }
}

export { VNTransitions };

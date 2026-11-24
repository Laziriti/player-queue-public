// Background rendering for a running scene. No gallery, file browsing or editor state.
import { VNTransitions } from '../visual-effects/vn-transitions.js';
import { VNPreloader } from '../media/vn-preload.js';
import { createBackgroundVideo, isVideoSource } from '../media/vn-media-utils.js';
import { cssUrl } from '../../utils/paths.js';

const elementOf = value => value?.[0] ?? (typeof value?.querySelector === 'function' ? value : null);

export class VNSceneBackground {
    applyBackground($overlay, background, showOverlay, preparedVideo = null) {
        const el = elementOf($overlay);
        if (!el) return;

        const bgLayer = el.querySelector('.vn-bg-layer');
        const currentVideo = bgLayer?.querySelector('.vn-bg-video');
        // Layout updates can carry the same background while changing only the visual effect.
        if (!preparedVideo && currentVideo && !currentVideo.error
            && currentVideo.getAttribute('src') === background && isVideoSource(background)) {
            this.setOverlay(el, background, showOverlay);
            return;
        }
        VNTransitions.releaseVideos(bgLayer);
        currentVideo?.remove();

        if (background && background !== 'none') {
            if (isVideoSource(background)) {
                if (bgLayer) {
                    bgLayer.style.backgroundImage = '';
                    const video = preparedVideo ?? createBackgroundVideo(background);
                    bgLayer.appendChild(video);
                    video.play().catch(() => {});
                }
            } else if (bgLayer) {
                const current = bgLayer.style.backgroundImage;
                const currentBase = current.replace(/\?t=\d+/, '').replace(/url\(["']?|["']?\)/g, '');
                if (currentBase !== background) {
                    bgLayer.style.backgroundImage = cssUrl(background);
                }
            }

        } else {
            if (bgLayer) bgLayer.style.backgroundImage = '';
        }
        this.setOverlay(el, background, showOverlay);
    }

    /** Dimming does not reload the image or recreate/restart a playing video. */
    setOverlay($overlay, background, showOverlay) {
        const el = elementOf($overlay);
        if (!el) return;
        const existing = el.querySelector('.vn-background-overlay');
        if (showOverlay && background && background !== 'none') {
            if (!existing) el.querySelector('.vn-bg-layer')?.insertAdjacentHTML('afterend', '<div class="vn-background-overlay"></div>');
        } else existing?.remove();
    }

    /**
     * Animated background switch. `timing` comes from VNTransitions.timing (transition type + speed; 'cut' = instant).
     * The background dimming is NOT handled here: the caller fades it at the start (fadeOverlay).
     */
    async switchWithTransition($overlay, newBg, showOverlay, atmosphere, timing, isCurrent = () => true) {
        if (!isCurrent()) return;
        const el = elementOf($overlay);
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
            if (!isCurrent()) return;
            await VNTransitions.switchBackground(el, newBg, timing.type, timing.bg || null, isCurrent);
            if (isCurrent()) atmosphere?.resetZoom?.();
        } catch (e) {
            if (!isCurrent()) return;
            console.error('VN: Background transition failed:', e);
            this.applyBackground($overlay, newBg, showOverlay);
        }
    }

    /**
     * applyBackground without the layer's own 0.8 s background-image cross-fade. Used while a curtain covers the
     * scene (VNTransitions.cover), where the swap must be instant or it would keep fading after the curtain opens.
     */
    applyBackgroundInstant($overlay, background, showOverlay, preparedVideo = null) {
        const el = elementOf($overlay);
        const layer = el?.querySelector('.vn-bg-layer');
        if (layer) layer.style.transition = 'none';
        this.applyBackground($overlay, background, showOverlay, preparedVideo);
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
        const el = elementOf($overlay);
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
}

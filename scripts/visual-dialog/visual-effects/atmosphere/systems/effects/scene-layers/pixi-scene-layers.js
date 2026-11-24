import { Container, ImageSource, Sprite, Texture, WebGLRenderer } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { bakeSceneMaterial, readSourcePaint, sceneMaterial, sourcePaintClass } from './scene-layer-material.js';

export const sceneLayerSelector = '.vn-fx-tint, .vn-fx-rays, .vn-fx-edges, .vn-fx-flash, .vn-fx-scan, .vn-fx-bloom, '
    + '.vn-vignette, .vn-ground-fog, .vn-ambient-light, .vn-fx-grain';
const sources = `${sceneLayerSelector}, .vn-fx-before, .vn-fx-after, .vn-background-overlay, .vn-bo-leaving`;
const paintedClass = 'vn-fx-pixi-painted';
const renderClasses = new Set([sourcePaintClass, paintedClass]);
const sceneClasses = value => (value ?? '').split(/\s+/).filter(name => name && !renderClasses.has(name)).join(' ');

/** Each bitmap keeps the original stacking and blend with the DOM scene. All passes share one Pixi renderer. */
export class PixiSceneLayers {
    #entries = new Map();
    #lifetime = new AbortController();
    #frame = null;

    async start(overlay) {
        const signal = this.#lifetime.signal;
        this.overlay = overlay;
        const canvas = this.surface = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('webgl2', { alpha: true, depth: false, stencil: true, antialias: false });
        if (!context) throw new Error('WebGL 2 unavailable for scene layers');
        const renderer = new WebGLRenderer();
        try {
            await renderer.init({ canvas, context, backgroundAlpha: 0, textureGCActive: false });
        } catch (error) {
            if (renderer.gl) renderer.destroy();
            context.getExtension('WEBGL_lose_context')?.loseContext();
            throw error;
        }
        if (signal.aborted || !overlay.isConnected || context.isContextLost()) {
            renderer.destroy();
            if (!signal.aborted && overlay.isConnected) throw new Error('Scene layers WebGL context lost during startup');
            return;
        }
        this.renderer = renderer;
        canvas.addEventListener('webglcontextlost', () => {
            console.error('VN: Pixi scene layers WebGL context lost');
            this.stop();
        }, { signal });
        this.mutations = new MutationObserver(records => {
            if (records.some(({ target, type, attributeName, oldValue }) => {
                if (target !== overlay && (type !== 'attributes' || !this.#entries.has(target))) return false;
                return attributeName !== 'class' || sceneClasses(oldValue) !== sceneClasses(target.className);
            })) {
                this.refresh();
            }
        });
        this.mutations.observe(overlay, { attributeOldValue: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
        this.resize = new ResizeObserver(() => this.refresh());
        this.resize.observe(overlay);
        window.addEventListener('resize', () => this.refresh(), { signal });
        this.refresh();
    }

    refresh() {
        if (!this.renderer || this.#frame !== null) return;
        this.#frame = requestAnimationFrame(() => {
            this.#frame = null;
            if (!this.overlay.isConnected) { this.stop(); return; }
            try { this.#sync(); }
            catch (error) {
                console.error('VN: Pixi scene layers failed', error);
                this.stop();
            }
        });
    }

    #sync() {
        const elements = new Set(this.overlay.querySelectorAll(sources));
        for (const [element, entry] of this.#entries) {
            if (elements.has(element)) continue;
            this.#release(entry);
            this.#entries.delete(element);
        }
        const materials = readSourcePaint(this.overlay, () => [...elements].flatMap(element => {
            const width = element.offsetWidth, height = element.offsetHeight;
            if (!width || !height) return [];
            return [[element, sceneMaterial(element, getComputedStyle(element), width, height)]];
        }));
        for (const [element, material] of materials) {
            let entry = this.#entries.get(element);
            if (!entry) {
                entry = { element };
                this.#entries.set(element, entry);
            }
            const resolution = window.devicePixelRatio;
            const key = material && JSON.stringify([material.definition, resolution]);
            if (entry.key === key && entry.track === material?.track) continue;
            entry.key = key;
            entry.track = material?.track;
            if (material) void this.#load(entry, material, resolution);
            else this.#release(entry);
        }
    }

    async #load(entry, material, resolution) {
        const request = entry.request = {};
        const { definition: { width, height, paint, label, padding, patterns }, track } = material;
        try {
            const [base, ...images] = await Promise.all([
                bakeSceneMaterial(width, height, paint, label, resolution, padding),
                ...patterns.map(pattern => bakeSceneMaterial(pattern.width, pattern.height, pattern.paint, '', resolution))
            ]);
            if (entry.request !== request || !this.renderer || !entry.element.isConnected) return;

            // Keep the previous frame visible while the new material decodes.
            this.#release(entry);
            entry.request = request;
            entry.canvas = this.#present(base, width + 2 * padding, height + 2 * padding, resolution, padding);
            const children = [entry.canvas];
            if (patterns.length) {
                const motion = entry.motion = document.createElement('div');
                motion.className = 'vn-fx-pixi-motion';
                motion.setAttribute('aria-hidden', 'true');
                children.push(motion);
                entry.animations = [];
                // CSS lists the topmost background first. Place it last in the element's paint order.
                for (let index = patterns.length - 1; index >= 0; index--) {
                    const pattern = patterns[index];
                    const canvas = this.#present(images[index], pattern.width, pattern.height, resolution);
                    motion.appendChild(canvas);
                    const animation = new Animation(new KeyframeEffect(canvas, pattern.frames, track.effect.getTiming()), track.timeline);
                    entry.animations.push(animation);
                    animation.startTime = track.startTime;
                    if (track.startTime === null) {
                        animation.currentTime = track.currentTime;
                        if (track.playState === 'paused') animation.pause();
                        else animation.play();
                    }
                }
            }
            entry.element.prepend(...children);
            entry.element.classList.add(paintedClass);
        } catch (error) {
            if (entry.request !== request) return;
            console.error('VN: Pixi scene material failed', error);
            this.#release(entry);
        }
    }

    #present(resource, width, height, resolution, padding = 0) {
        const size = `${width},${height},${resolution}`;
        if (size !== this.size) {
            this.renderer.resize(width, height, resolution);
            this.size = size;
        }
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.className = 'vn-fx-pixi-layer';
        canvas.width = this.surface.width;
        canvas.height = this.surface.height;
        canvas.style.cssText = `top:${-padding}px;left:${-padding}px;width:${width}px;height:${height}px`;
        const context = canvas.getContext('bitmaprenderer');
        if (!context) throw new Error('Bitmap renderer unavailable');
        const stage = new Container();
        const texture = new Texture({ source: new ImageSource({ resource, resolution }) });
        stage.addChild(new Sprite(texture));
        try {
            this.renderer.render({ container: stage, clear: true });
            const gl = this.renderer.gl;
            if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('Scene layer could not render');
            const bitmap = this.surface.transferToImageBitmap();
            try { context.transferFromImageBitmap(bitmap); }
            finally { bitmap.close(); }
            return canvas;
        } finally {
            stage.destroy({ children: true });
            texture.destroy(true);
        }
    }

    #release(entry) {
        entry.request = null;
        entry.canvas?.remove();
        entry.motion?.remove();
        for (const animation of entry.animations ?? []) animation.cancel();
        entry.canvas = entry.motion = entry.animations = null;
        entry.element.classList.remove(paintedClass);
    }

    stop() {
        this.#lifetime.abort();
        this.mutations?.disconnect();
        this.resize?.disconnect();
        if (this.#frame !== null) cancelAnimationFrame(this.#frame);
        this.#frame = null;
        for (const entry of this.#entries.values()) this.#release(entry);
        this.#entries.clear();
        this.renderer?.destroy();
        this.renderer = null;
    }
}

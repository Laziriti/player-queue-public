import { mediaExtension } from '../../../../../media/vn-media-utils.js';

export const backgroundSurfaces = new WeakMap();

export function imageURL(backgroundImage) {
    return backgroundImage.match(/^url\("(.*)"\)$/s)?.[1]?.replace(/\\(["\\])/g, '$1');
}

function readyVideo(video, signal) {
    if (video.error) return Promise.reject(video.error);
    if (video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const listeners = new AbortController();
        const done = (callback, value) => {
            signal.removeEventListener('abort', cancel);
            listeners.abort();
            callback(value);
        };
        const cancel = () => done(reject, signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        video.addEventListener('loadeddata', () => done(resolve), { signal: listeners.signal });
        video.addEventListener('error', () => done(reject, video.error), { signal: listeners.signal });
    });
}

export class PixiBackgroundEffect {
    #layers = new Map();
    #lifetime = new AbortController();
    #frame = null;
    #animateUntil = 0;

    constructor({ load, canvasClass, measure = (_overlay, layer) => ({
        width: layer.clientWidth, height: layer.clientHeight
    }), prepare, animate = (mesh, now) => mesh.render(now / 1000), mount = (canvas, layer) => layer.appendChild(canvas),
        continuous = true, composeBackground = false }) {
        this.load = load;
        this.canvasClass = canvasClass;
        this.measure = measure;
        this.prepare = prepare;
        this.animate = animate;
        this.mount = mount;
        this.continuous = continuous;
        this.composeBackground = composeBackground;
    }

    get signal() { return this.#lifetime.signal; }

    drawFor(milliseconds) {
        this.#animateUntil = performance.now() + milliseconds;
        this.#requestFrame();
    }

    start(overlay) {
        this.overlay = overlay;
        this.mutations = new MutationObserver(records => {
            if (records.some(({ target, type }) => {
                if (type === 'childList') return target === overlay || target.matches?.('.vn-bg-layer, .vn-orbit-stage');
                if (target.classList?.contains('vn-bg-video')) return true;
                // Parallax updates the layer transform every frame, without changing its media.
                const entry = this.#layers.get(target);
                return entry && entry.backgroundImage !== target.style.backgroundImage;
            })) this.#syncLayers();
        });
        this.mutations.observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src'] });
        this.resize = new ResizeObserver(() => this.#syncLayers());
        this.resize.observe(overlay);
        this.#syncLayers();
    }

    stop() {
        this.#lifetime.abort();
        this.mutations?.disconnect();
        this.resize?.disconnect();
        if (this.#frame !== null) cancelAnimationFrame(this.#frame);
        for (const entry of this.#layers.values()) this.#dispose(entry);
        this.#layers.clear();
    }

    #syncLayers() {
        const layers = new Set(this.overlay.querySelectorAll(':scope > .vn-bg-layer, :scope > .vn-orbit-stage > .vn-bg-layer'));
        for (const [layer, entry] of this.#layers) {
            if (layers.has(layer)) continue;
            this.resize.unobserve(layer);
            this.#dispose(entry);
            this.#layers.delete(layer);
        }
        for (const layer of layers) {
            const video = layer.querySelector(':scope > .vn-bg-video');
            const backgroundImage = layer.style.backgroundImage;
            const url = video ? video.getAttribute('src') : imageURL(backgroundImage);
            let entry = this.#layers.get(layer);
            if (!entry || entry.video !== video || entry.url !== url) {
                if (entry) this.#dispose(entry);
                else this.resize.observe(layer);
                entry = { layer, video, url, abort: new AbortController() };
                this.#layers.set(layer, entry);
            }
            entry.backgroundImage = backgroundImage;
            if (!url || entry.abort.signal.aborted) continue;
            const layout = this.measure(this.overlay, layer);
            const wasVisible = entry.visible;
            entry.visible = layout.width > 0 && layout.height > 0;
            if (!entry.visible) continue;
            const dpr = window.devicePixelRatio;
            const changed = !entry.layout || Object.keys(layout).some(key => layout[key] !== entry.layout[key]);
            if (changed) {
                entry.layout = layout;
                entry.data = this.prepare?.(layout, layer);
                entry.start = performance.now();
            }
            if (!entry.pending && !entry.mesh) {
                entry.pending = true;
                void this.#load(entry);
            } else if (entry.mesh && (changed || dpr !== entry.dpr || !wasVisible)) {
                this.#tryRender(entry, () => {
                    entry.mesh.resize(layout, entry.data);
                    if (!this.continuous) this.animate(entry.mesh, performance.now(), entry.start, entry.data);
                });
            }
            entry.dpr = dpr;
        }
        this.#requestFrame();
    }

    async #load(entry) {
        const { layer, video, url, abort: { signal } } = entry;
        const canvas = document.createElement('canvas');
        canvas.className = `vn-pixi-background ${this.canvasClass}`;
        canvas.setAttribute('aria-hidden', 'true');
        entry.canvas = canvas;
        let mesh;
        try {
            let resource = video;
            if (!resource) {
                resource = entry.image = new Image();
                resource.crossOrigin = 'anonymous';
                resource.src = url;
            }
            const [Mesh] = await Promise.all([
                this.load(), video ? readyVideo(video, signal) : resource.decode()
            ]);
            if (signal.aborted || !layer.isConnected) return;
            mesh = new Mesh();
            await mesh.init(canvas, resource, video ? 'video' : mediaExtension(url));
            if (signal.aborted || !layer.isConnected) return;
            mesh.resize(entry.layout, entry.data);
            this.animate(mesh, performance.now(), entry.start, entry.data);
            mesh.checkUpload();
            canvas.addEventListener('webglcontextlost', () => this.#fail(entry, new Error('WebGL context lost')), { signal });
            video?.addEventListener('error', () => this.#fail(entry, video.error), { signal });
            this.mount(canvas, layer, this.overlay);
            entry.mesh = mesh;
            backgroundSurfaces.set(canvas, {
                mesh, composeBackground: this.composeBackground,
                redraw: (now = performance.now()) => {
                    this.animate(entry.mesh, now, entry.start, entry.data);
                    this.#requestFrame();
                }
            });
            mesh = null;
            entry.mesh.watchVideo(() => {
                if (!this.continuous && entry.visible && !entry.mesh.present) {
                    this.#tryRender(entry, () => this.animate(entry.mesh, performance.now(), entry.start, entry.data));
                }
            });
            this.#requestFrame();
        } catch (error) {
            if (!signal.aborted) this.#fail(entry, error);
        } finally {
            mesh?.destroy();
            entry.pending = false;
        }
    }

    #requestFrame() {
        if (this.#frame === null && [...this.#layers.values()].some(entry => this.#needsFrame(entry))) {
            this.#frame = requestAnimationFrame(this.#render);
        }
    }

    #render = now => {
        this.#frame = null;
        for (const entry of this.#layers.values()) {
            if (entry.mesh && entry.visible && !entry.mesh.present) {
                this.#tryRender(entry, () => this.animate(entry.mesh, now, entry.start, entry.data));
            }
        }
        this.#requestFrame();
    };

    #needsFrame(entry) {
        return entry.mesh && entry.visible && !entry.mesh.present && (this.continuous || this.#animateUntil >= performance.now()
            || (entry.video && !entry.video.requestVideoFrameCallback));
    }

    #tryRender(entry, operation) {
        try {
            operation();
        } catch (error) {
            this.#fail(entry, error);
        }
    }

    #fail(entry, error) {
        console.error(`VN: Pixi background effect failed (${this.canvasClass})`, error);
        this.#dispose(entry);
    }

    #dispose(entry) {
        entry.abort.abort();
        if (entry.canvas) backgroundSurfaces.delete(entry.canvas);
        entry.canvas?.remove();
        entry.mesh?.destroy();
        entry.mesh = null;
        entry.image?.removeAttribute('src');
    }
}

// ============================================================
// canvas/particle-canvas.js — хозяин канвас-частиц на главном потоке
//
// CanvasParticles собирает описание сцены (какие частицы, с какими параметрами), создаёт по канвасу на слой
// («под персонажами» и «над ними») и отдаёт всё рисовальщику ParticleRenderer (renderer.js):
//   • в воркере — канвас передаётся как OffscreenCanvas, главный поток Foundry вообще не рисует частицы;
//   • если воркер или OffscreenCanvas недоступны (или воркер упал) — тот же рисовальщик работает на главном потоке.
// Случайные числа берутся здесь, на главном потоке (ParticleSystem), поэтому частицы не зависят от того, где рисуются.
// ============================================================

import { ParticleRenderer } from './renderer.js';
import { observeParticleNameplates } from './particle-nameplates.js';

// Холст не больше ~12 млн пикселей (нативный 4K с запасом на то, что контейнер шире экрана на 3–5%): это до 48 МБ на слой.
// Выше разрешение понижается; пока предел не достигнут, холст рисуется в точности 1:1 к пикселям экрана — иначе браузер растягивает
// его нецелым множителем, и медленные яркие точки «плывут» и мерцают.
const MAX_CANVAS_PIXELS = 12e6;
// Адреса картинок воркер разрешал бы от адреса своего скрипта, а не страницы (в Foundry это 404): делаем их абсолютными здесь
const absolute = url => new URL(url, document.baseURI).href;
const WORKER_URL = new URL('./particle-worker.js', import.meta.url);

/** Пикселей на css px: не больше 2 и так, чтобы холст контейнера не превышал MAX_CANVAS_PIXELS */
function pickRes(container) {
    const area = container.clientWidth * container.clientHeight;
    const wanted = Math.min(window.devicePixelRatio || 1, 2);
    const fit = area ? Math.sqrt(MAX_CANVAS_PIXELS / area) : wanted;
    // Если предел достигнут — берём шаг в четверть пикселя, чтобы масштаб оставался «круглым»
    return fit >= wanted ? wanted : Math.max(0.5, Math.floor(fit * 4) / 4);
}

export class CanvasParticles {
    /** Работающие сейчас движки — для tools/dev (кадр в заданный момент) */
    static instances = new Set();
    /** tools/dev: рисовать на главном потоке (?worker=0), чтобы замерять кадр */
    static forceLocal = false;

    /**
     * @param {HTMLElement} back      контейнер под персонажами (.vn-particles)
     * @param {HTMLElement|null} front  контейнер над персонажами (.vn-particles-upper) или null
     * @param {object} [opts]  { overlay } — оверлей сцены: его класс vn-vfx-dream замедляет частицы до 20 с на круг;
     *   { wind } — ветер -10…10, { gusts } — порывами (иначе ровный); { parallax } — частицы с глубиной сдвигаются за мышью
     *   { wrap } — перенос через боковые края (по умолчанию включён)
     */
    constructor(back, front = null, opts = {}) {
        this.res = pickRes(back);
        this.overlay = opts.overlay ?? null;
        this.wind = opts.wind ?? 0;
        this.wrap = opts.wrap !== false;
        this.gusts = opts.gusts !== false;
        this.parallax = !!opts.parallax;
        this.scale = opts.scale ?? 1;
        this.opacity = opts.opacity ?? 100;
        this.solidTexture = opts.solidTexture ?? false;
        this.tempo = opts.tempo ?? 1;
        this.tintColor = opts.tintColor ?? '#ffffff';
        this.tintStrength = opts.tintStrength ?? 0;
        this.layers = { back: { container: back } };
        if (front) this.layers.front = { container: front };
        for (const layer of Object.values(this.layers)) this.#placeCanvas(layer);

        this.scene = { kinds: {}, ghost: null, items: [] };
        this.counts = {};
        this.worker = null;
        this.renderer = null;
        this.pendingFreeze = null;
        this.stats = null; // { fps, ms, worst } рисовальщика за последнюю секунду
        this.observers = [];
        CanvasParticles.instances.add(this);
    }

    get split() { return !!this.layers.front; }

    /** 'worker' | 'local' — где сейчас рисуются частицы */
    get mode() { return this.worker ? 'worker' : 'local'; }

    // ─── Описание сцены ──────────────────────────────────────

    /**
     * Спрайтовая частица: kindId — вид (тип:вариант), spec — его описание из config/particle-canvas.js, p — параметры старта,
     * images — адреса картинок вида (частица выбирает одну по p.img). К p добавляется idx — номер среди частиц слоя (для :nth-child-палитр).
     */
    addSprite(kindId, spec, p, layer = 'back', images = null) {
        this.scene.kinds[kindId] ??= images?.length ? { ...spec, images: images.map(absolute) } : spec;
        this.counts[layer] = (this.counts[layer] ?? 0) + 1;
        p.idx = this.counts[layer];
        this.scene.items.push({ t: 's', k: kindId, p, l: layer });
    }

    setGhosts(images, variant, count) { this.scene.ghost = { images: images.map(absolute), variant, count }; }

    /** Ветер -5…5 (плюс — вправо), порывами или ровный: рисовальщик плавно переходит к новому значению */
    setWind(level, gusts = true) {
        this.wind = level;
        this.gusts = gusts;
        this.#post({ type: 'wind', level, gusts });
    }

    setAppearance(scale, opacity, tintColor = this.tintColor, tintStrength = this.tintStrength,
        solidTexture = this.solidTexture) {
        if (this.solidTexture !== solidTexture) {
            this.solidTexture = solidTexture;
            this.#post({ type: 'solid-texture', enabled: solidTexture });
        }
        if (this.scale !== scale) {
            this.scale = scale;
            this.#post({ type: 'scale', scale });
        }
        if (this.opacity !== opacity) {
            this.opacity = opacity;
            for (const { canvas } of Object.values(this.layers)) canvas.style.opacity = opacity / 100;
        }
        if (this.tintColor !== tintColor || this.tintStrength !== tintStrength) {
            this.tintColor = tintColor;
            this.tintStrength = tintStrength;
            this.#post({ type: 'tint', color: tintColor, strength: tintStrength });
        }
    }

    setTempo(tempo) {
        if (this.tempo === tempo) return;
        this.tempo = tempo;
        this.#post({ type: 'tempo', tempo });
    }

    addVapor(n) { this.scene.items.push({ t: 'v', n, l: 'back' }); }

    /** n — сквозной номер, pos — номер среди душ слоя (от него зависят путь и глубина), head — индекс картинки головы или -1 */
    addSoul(n, pos, head, layer = 'back') { this.scene.items.push({ t: 'g', n, pos, head, l: layer }); }

    // ─── Запуск ──────────────────────────────────────────────

    start() {
        const canWorker = !CanvasParticles.forceLocal
            && typeof Worker !== 'undefined'
            && typeof OffscreenCanvas !== 'undefined'
            && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
        let started = false;
        if (canWorker) {
            try { this.#startWorker(); started = true; }
            catch (err) {
                console.warn('player-queue | particle worker unavailable, drawing on the main thread', err);
                this.#resetRenderer();
            }
        }
        if (!started) this.#startLocal();
        this.#observe();
    }

    #placeCanvas(layer) {
        layer.canvas = document.createElement('canvas');
        layer.canvas.className = 'vn-particles-canvas';
        layer.canvas.style.opacity = this.opacity / 100;
        layer.container.appendChild(layer.canvas);
    }

    #sizes() {
        return Object.fromEntries(Object.entries(this.layers).map(([name, l]) => [name, { W: l.container.clientWidth, H: l.container.clientHeight }]));
    }

    #init(canvases) {
        return {
            type: 'init', scene: this.scene, res: this.res, vh: window.innerHeight / 100, vw: window.innerWidth / 100,
            sizes: this.#sizes(), override: this.#override(), wind: this.wind, gusts: this.gusts, wrap: this.wrap,
            scale: this.scale, tempo: this.tempo, solidTexture: this.solidTexture,
            tintColor: this.tintColor, tintStrength: this.tintStrength, canvases,
        };
    }

    /** Сдвиг частиц за мышью (только при включённом параллаксе клиента): x, y в -1…1, не чаще раза в 40 мс */
    #watchMouse() {
        let enabled = false;
        try { enabled = !!game.settings.get('player-queue', 'parallaxEnabled'); } catch { /* настройки недоступны */ }
        if (!this.parallax || !enabled) return;
        let last = 0;
        const onMove = e => {
            const now = performance.now();
            if (now - last < 40) return;
            last = now;
            this.#post({ type: 'look', x: e.clientX / window.innerWidth * 2 - 1, y: e.clientY / window.innerHeight * 2 - 1 });
        };
        document.addEventListener('mousemove', onMove, { passive: true });
        this.observers.push({ disconnect: () => document.removeEventListener('mousemove', onMove) });
    }

    #override() { return this.overlay?.classList.contains('vn-vfx-dream') ? 20 : 0; }

    #startWorker() {
        const canvases = Object.fromEntries(Object.entries(this.layers).map(([name, l]) => [name, l.canvas.transferControlToOffscreen()]));
        const worker = this.worker = new Worker(WORKER_URL, { type: 'module' });
        worker.onmessage = e => {
            if (this.worker === worker) this.#onReply(e.data);
        };
        worker.onerror = e => {
            if (this.worker === worker) this.#renderFailed(e.message);
        };
        worker.postMessage(this.#init(canvases), Object.values(canvases));
    }

    #startLocal() {
        const renderer = this.renderer = new ParticleRenderer(msg => {
            if (this.renderer === renderer) this.#onReply(msg);
        });
        renderer.handle(this.#init(Object.fromEntries(Object.entries(this.layers).map(([name, l]) => [name, l.canvas]))));
    }

    /** Канвас, отданный воркеру, назад не вернуть: заменяем его новым и рисуем на главном потоке */
    #fallbackToLocal() {
        this.#resetRenderer();
        this.#startLocal();
        this.#repeatFreeze();
    }

    #resetRenderer() {
        this.worker?.terminate();
        this.worker = null;
        this.renderer?.handle({ type: 'destroy' });
        this.renderer = null;
        for (const layer of Object.values(this.layers)) {
            const old = layer.canvas;
            this.#placeCanvas(layer);
            old.remove();
        }
    }

    #renderFailed(reason, contextLost) {
        if (this.worker) {
            console.warn('player-queue | Pixi particle worker failed, drawing on the main thread', reason);
            this.#fallbackToLocal();
        } else if (contextLost && !this.retriedLocal) {
            this.retriedLocal = true;
            this.#fallbackToLocal();
        } else {
            console.error('player-queue | Pixi particles failed', reason);
            this.destroy();
        }
    }

    #onReply(msg) {
        if (msg.type === 'frozen') { this.pendingFreeze?.(); this.pendingFreeze = null; }
        else if (msg.type === 'stats') this.stats = msg;
        else if (msg.type === 'ready') {
            for (const { canvas } of Object.values(this.layers)) canvas.dataset.backend = msg.backend;
        } else if (msg.type === 'render-failed') this.#renderFailed(msg.reason, msg.contextLost);
    }

    #post(msg) {
        if (this.worker) this.worker.postMessage(msg);
        else this.renderer?.handle(msg);
    }

    /** Пересчёт res после смены размера окна или плотности пикселей: с задержкой, чтобы не перепекать спрайты на каждом шаге перетаскивания, и только если res реально изменился */
    #refreshRes() {
        clearTimeout(this.resTimer);
        this.resTimer = setTimeout(() => {
            const container = this.layers.back.container;
            if (!container.clientWidth) return; // сцена свёрнута: размера нет, решать не по чему
            const res = pickRes(container);
            if (res === this.res) return;
            this.res = res;
            this.#post({ type: 'res', res });
        }, 300);
    }

    /** ResizeObserver не видит смену devicePixelRatio при том же css-размере (окно на другом мониторе), поэтому слушаем media query и перевзводим её на новое значение */
    #watchPixelRatio() {
        const arm = () => {
            const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            const onChange = () => { this.#refreshRes(); arm(); };
            mq.addEventListener('change', onChange, { once: true });
            this.pixelRatioWatch = { disconnect: () => mq.removeEventListener('change', onChange) };
        };
        arm();
        this.observers.push({ disconnect: () => this.pixelRatioWatch?.disconnect() });
    }

    #observe() {
        for (const [name, layer] of Object.entries(this.layers)) {
            const ro = new ResizeObserver(() => {
                this.#post({ type: 'resize', layer: name, W: layer.container.clientWidth, H: layer.container.clientHeight, vh: window.innerHeight / 100, vw: window.innerWidth / 100 });
                if (name === 'back') this.#refreshRes();
            });
            ro.observe(layer.container);
            this.observers.push(ro);
        }
        this.#watchPixelRatio();
        this.#watchMouse();
        if (this.overlay) {
            const upper = this.layers.front?.container;
            let nameplates;
            const syncNameplates = () => {
                if (upper || this.overlay.classList.contains('vn-particles-fg')) {
                    nameplates ??= observeParticleNameplates(this.overlay, this.layers.back.container, upper);
                } else {
                    nameplates?.disconnect();
                    nameplates = null;
                }
            };
            const mo = new MutationObserver(() => {
                this.#post({ type: 'override', seconds: this.#override() });
                syncNameplates();
            });
            mo.observe(this.overlay, { attributes: true, attributeFilter: ['class'] });
            this.observers.push(mo, { disconnect: () => nameplates?.disconnect() });
            syncNameplates();
        }
    }

    // ─── tools/dev ───────────────────────────────────────────

    /** Остановить цикл и нарисовать кадр в момент ms (мс от начала, как currentTime у анимаций); промис — когда кадр готов */
    freeze(ms) {
        return new Promise(resolve => {
            this.pendingFreeze = resolve;
            this.freezeTime = ms;
            this.#repeatFreeze();
        });
    }

    #repeatFreeze() {
        if (this.pendingFreeze) this.#post({ type: 'freeze', ms: this.freezeTime });
    }

    static freezeAll(ms) {
        return Promise.all([...CanvasParticles.instances].map(engine => engine.freeze(ms)));
    }

    destroy() {
        clearTimeout(this.resTimer);
        for (const o of this.observers) o.disconnect();
        this.observers = [];
        this.#post({ type: 'destroy' });
        this.worker?.terminate();
        this.worker = null;
        this.renderer = null;
        for (const layer of Object.values(this.layers)) layer.canvas.remove();
        this.pendingFreeze?.();
        this.pendingFreeze = null;
        CanvasParticles.instances.delete(this);
    }
}

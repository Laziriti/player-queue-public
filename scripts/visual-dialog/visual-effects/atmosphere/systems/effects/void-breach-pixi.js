import { TimedEffect } from './timed-effect.js';
import { cubicBezier } from '../../../easing.js';

import { generateCrack, outlineOf, bboxOf } from '../../../crack-geometry.js';

// Палитры трещин. inner — CSS-фон «окна» внутри разлома, flash — вспышка при рождении, debris — искры или крошка
// (dir: -1 поднимаются, 1 падают)
const CRACK_VOID = {
    glow: 'rgba(130, 60, 255, 0.55)', edge: 'rgba(228, 200, 255, 0.92)', hair: 'rgba(18, 4, 40, 0.95)',
    inner: 'radial-gradient(circle at 30% 40%, rgba(205, 115, 255, 0.95) 0%, rgba(120, 50, 230, 0.6) 35%, transparent 70%) 0 0 / 180px 150px,'
        + 'radial-gradient(circle at 70% 65%, rgba(90, 70, 255, 0.85) 0%, transparent 65%) 60px 40px / 220px 190px,'
        + 'radial-gradient(circle, rgba(255, 255, 255, 0.95) 0 1px, transparent 1.7px) 0 0 / 41px 37px,'
        + 'radial-gradient(circle, rgba(200, 170, 255, 0.8) 0 1px, transparent 1.6px) 17px 21px / 59px 53px,'
        + '#12052e',
    flash: 'rgba(225, 175, 255, 0.9)',
    debris: { color: 'rgba(214, 170, 255, 0.95)', dir: -1 },
};

// Чёрные разрывы: пустота почти без цвета, слабая кромка, редкие холодные звёзды
const CRACK_DARK = {
    glow: 'rgba(95, 40, 170, 0.55)', edge: 'rgba(214, 196, 255, 0.95)', hair: 'rgba(6, 0, 14, 0.95)',
    inner: 'radial-gradient(circle at 35% 45%, rgba(70, 30, 120, 0.5) 0%, transparent 60%) 0 0 / 240px 200px,'
        + 'radial-gradient(circle, rgba(255, 255, 255, 0.85) 0 0.8px, transparent 1.4px) 0 0 / 67px 59px,'
        + '#030008',
    flash: 'rgba(120, 70, 200, 0.55)',
    debris: { color: 'rgba(170, 140, 235, 0.85)', dir: -1 },
};

// Планы стихий (вариант `planes`): у каждого разлома своя палитра, окно открывается в один из четырёх миров.
// Порядок: огонь, вода, земля, воздух
const CRACK_PLANES = {
    fire: {
        glow: 'rgba(255, 110, 30, 0.55)', edge: 'rgba(255, 214, 130, 0.95)', hair: 'rgba(30, 6, 0, 0.95)',
        inner: 'radial-gradient(circle at 30% 60%, rgba(255, 220, 90, 0.95) 0%, rgba(255, 120, 30, 0.75) 30%, transparent 68%) 0 0 / 170px 150px,'
            + 'radial-gradient(circle at 70% 35%, rgba(255, 70, 20, 0.85) 0%, transparent 62%) 50px 30px / 210px 180px,'
            + 'radial-gradient(circle, rgba(255, 230, 150, 0.9) 0 1px, transparent 1.8px) 0 0 / 37px 43px,'
            + '#2a0904',
        flash: 'rgba(255, 170, 70, 0.9)',
        debris: { color: 'rgba(255, 170, 60, 0.95)', dir: -1 },
    },
    water: {
        glow: 'rgba(50, 180, 240, 0.5)', edge: 'rgba(190, 240, 255, 0.95)', hair: 'rgba(0, 12, 28, 0.95)',
        inner: 'radial-gradient(ellipse at 30% 40%, rgba(120, 235, 255, 0.85) 0%, rgba(30, 130, 200, 0.6) 38%, transparent 72%) 0 0 / 200px 120px,'
            + 'radial-gradient(ellipse at 70% 70%, rgba(40, 90, 220, 0.8) 0%, transparent 65%) 60px 40px / 230px 150px,'
            + 'radial-gradient(circle, rgba(220, 250, 255, 0.85) 0 1.2px, transparent 2px) 0 0 / 47px 41px,'
            + '#031a33',
        flash: 'rgba(150, 230, 255, 0.85)',
        debris: { color: 'rgba(190, 240, 255, 0.9)', dir: -1 },
    },
    earth: {
        glow: 'rgba(150, 100, 40, 0.5)', edge: 'rgba(230, 200, 140, 0.95)', hair: 'rgba(18, 10, 4, 0.95)',
        inner: 'radial-gradient(circle at 35% 40%, rgba(150, 110, 60, 0.9) 0%, rgba(90, 60, 30, 0.7) 40%, transparent 75%) 0 0 / 190px 160px,'
            + 'radial-gradient(circle at 70% 65%, rgba(70, 110, 50, 0.75) 0%, transparent 62%) 50px 40px / 220px 190px,'
            + 'radial-gradient(circle, rgba(255, 220, 130, 0.9) 0 1.3px, transparent 2px) 0 0 / 53px 47px,'
            + '#1a0f07',
        flash: 'rgba(210, 170, 100, 0.85)',
        debris: { color: 'rgba(170, 140, 90, 0.95)', dir: 1 },
    },
    air: {
        glow: 'rgba(190, 225, 255, 0.5)', edge: 'rgba(255, 255, 255, 0.95)', hair: 'rgba(30, 50, 90, 0.9)',
        inner: 'radial-gradient(ellipse at 30% 45%, rgba(255, 255, 255, 0.95) 0%, rgba(190, 225, 255, 0.7) 40%, transparent 72%) 0 0 / 200px 120px,'
            + 'radial-gradient(ellipse at 72% 60%, rgba(150, 200, 255, 0.85) 0%, transparent 64%) 70px 30px / 240px 140px,'
            + 'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0 1px, transparent 1.8px) 0 0 / 45px 39px,'
            + '#3a5f9a',
        flash: 'rgba(235, 245, 255, 0.9)',
        debris: { color: 'rgba(235, 245, 255, 0.9)', dir: -1 },
    },
};

// Вид разлома по варианту эффекта (VISUAL_VARIANTS.void_breach). wobble / branch — извилистость и ветвление
// (crack-geometry.js), widthK — множитель ширины раскрытия
const CRACK_STYLES = {
    all:     { palette: CRACK_VOID, widthK: 1 },
    dark:    { palette: CRACK_DARK, widthK: 1.45 },
    fissure: { palette: CRACK_DARK, widthK: 1.25, wobble: 0.2, branch: 0.55 },
    planes:  { planes: CRACK_PLANES, widthK: 1.7 },
};

// Размеры разломов; weight — доля общего «бюджета»: много больших сразу забивали бы весь кадр
const CRACK_TIERS = [
    { len: 0.20, width: 11, depth: 2, weight: 1 },
    { len: 0.36, width: 22, depth: 3, weight: 2 },
    { len: 0.58, width: 32, depth: 3, weight: 4 },
];
const CRACK_BUDGET = 6;
// Сколько разломов может быть открыто одновременно
const CRACK_MAX = 4;

function makeVoidCrack(W, H, style, open) {
    const diag = Math.hypot(W, H);
    const sc = Math.max(0.6, H / 1080);

    // Открытых разломов не больше CRACK_MAX, а их суммарный размер укладывается в CRACK_BUDGET: если большому
    // не хватает места, берём поменьше, а если нет места и мелкому — не создаём ничего
    if (open.length >= CRACK_MAX) return;
    const free = CRACK_BUDGET - open.reduce((sum, c) => sum + c.weight, 0);
    const roll = Math.random();
    let tierIdx = roll < 0.35 ? 0 : roll < 0.85 ? 1 : 2;
    while (tierIdx > 0 && CRACK_TIERS[tierIdx].weight > free) tierIdx--;
    const tier = CRACK_TIERS[tierIdx];
    if (tier.weight > free) return;

    // Точка удара — самая далёкая от уже открытых разломов из нескольких случайных кандидатов
    let cx = 0, cy = 0, farthest = -1;
    for (let k = 0; k < 8; k++) {
        const x = (0.08 + Math.random() * 0.84) * W;
        const y = (0.08 + Math.random() * 0.84) * H;
        const gap = open.length
            ? Math.min(...open.map(c => Math.hypot(c.cx - x, c.cy - y)))
            : Infinity;
        if (gap > farthest) { farthest = gap; cx = x; cy = y; }
    }
    // Планы стихий: каждый разлом ведёт в свой мир, по возможности не в тот, что уже открыт
    let plane = null, palette = style.palette;
    if (style.planes) {
        const names = Object.keys(style.planes);
        const taken = new Set(open.map(c => c.plane));
        const fresh = names.filter(n => !taken.has(n));
        const pool = fresh.length ? fresh : names;
        plane = pool[Math.floor(Math.random() * pool.length)];
        palette = style.planes[plane];
    }
    const angle = Math.random() * Math.PI * 2;
    const make = a => generateCrack(Math.random, {
        x: cx, y: cy, angle: a,
        length: diag * tier.len * (0.8 + Math.random() * 0.4) * 0.5,
        width: tier.width * style.widthK * sc * (0.8 + Math.random() * 0.4),
        maxDepth: tier.depth, step: 44 * sc, bounds: { w: W, h: H },
        wobble: style.wobble, branch: style.branch,
    }).branches;
    const branches = [...make(angle), ...make(angle + Math.PI + (Math.random() - 0.5) * 0.7)];

    const openings = [], hairs = [], allPts = [];
    for (const b of branches) {
        const poly = outlineOf(b, Math.random);
        if (poly) { openings.push({ poly, b }); allPts.push(...poly); }
        else { hairs.push(b); allPts.push(...b.pts); }
    }
    if (!allPts.length) return;

    const box = bboxOf(allPts, 48);
    const reach = Math.max(...allPts.map(p => Math.hypot(p.x - cx, p.y - cy))) + 70;
    return { cx, cy, plane, weight: tier.weight, palette, openings, hairs, box, reach };
}

const easeOut = [0, 0, 0.58, 1];

function lightSprite(color, stop, core = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, color);
    gradient.addColorStop(core, color);
    gradient.addColorStop(stop, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    return canvas;
}

export class PixiVoidBreachEffect extends TimedEffect {
    start(overlay, variant = 'all') {
        this.overlay = overlay;
        this.lifetime = new AbortController();
        this.cracks = [];
        this.lights = [];
        this.paletteSprites = new Map();
        void this.#createSurface(overlay, variant, this.lifetime.signal);
    }

    async #createSurface(overlay, variant, signal) {
        let surface;
        try {
            const [{ PixiSceneSurface }, { PixiCrack }] = await Promise.all([
                import('./scene-layers/pixi-scene-surface.js'), import('./void-pixi-surfaces.js')
            ]);
            if (signal.aborted) return;
            surface = new PixiSceneSurface();
            if (await surface.mount(overlay, 'vn-void-pixi', signal, () => {
                if (!signal.aborted) console.error('VN: Pixi void breach WebGL context lost');
                this.stop();
            })) {
                this.surface = surface;
                this.Crack = PixiCrack;
                this.#schedule(overlay, variant);
            }
        } catch (error) {
            if (!signal.aborted) {
                console.error('VN: Pixi void breach failed', error);
                this.stop();
            }
        } finally {
            if (surface && surface !== this.surface) surface.destroy();
        }
    }

    #schedule(overlayEl, variant) {
        const style = CRACK_STYLES[variant] ?? CRACK_STYLES.all;
        let phase = 0;
        this.interval(() => {
            phase += 0.07;
            const tint = overlayEl.querySelector('.vn-fx-tint');
            if (tint) tint.style.opacity = (0.72 + Math.sin(phase) * 0.16).toFixed(3);
        }, 2000);

        // Каждая трещина сама управляет своей жизнью; интервал лишь подсевает новые
        this.interval(() => {
            const active = this.cracks.length;
            const burst = active < 2 ? 2 : 1;
            for (let i = 0; i < burst; i++) this.#spawnCrack(overlayEl, i * 250, style);
        }, 3000);

        for (let i = 0; i < 2; i++) {
            this.timeout(() => this.#spawnCrack(overlayEl, 0, style), 400 + i * 600);
        }
    }

    #spawnCrack(overlay, delay, style) {
        if (!this.surface || !overlay.isConnected) return;
        const open = this.cracks.map(crack => crack.model);
        const model = makeVoidCrack(overlay.clientWidth, overlay.clientHeight, style, open);
        if (!model) return;
        try {
            const crack = new this.Crack(model, performance.now() + delay);
            this.cracks.push(crack);
            this.surface.stage.addChild(crack.mesh);
            this.#spawnLights(crack);
            if (!this.frame) this.frame = requestAnimationFrame(this.#render);
        } catch (error) {
            console.warn('VN: Pixi void breach could not prepare the crack materials', error);
            this.#removeSurface();
            super._spawnVoidCrack(overlay, delay, style);
        }
    }

    #spawnLights(crack) {
        const { cx, cy, openings, reach, palette } = crack.model;
        if (!this.paletteSprites.has(palette)) {
            this.paletteSprites.set(palette, {
                flash: lightSprite(palette.flash, 0.68),
                spark: lightSprite(palette.debris.color, 0.92, 0.23)
            });
        }
        const { flash, spark } = this.paletteSprites.get(palette);
        this.lights.push({ x: cx, y: cy, size: 280, start: crack.start, duration: 520, image: flash });
        const main = openings.filter(opening => opening.b.depth <= 1).flatMap(opening => opening.b.pts);
        if (!main.length) return;
        const count = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const pt = main[Math.floor(Math.random() * main.length)];
            this.lights.push({
                x: pt.x, y: pt.y, size: 12 + Math.random() * 2.5, image: spark,
                start: crack.start + Math.hypot(pt.x - cx, pt.y - cy) / reach * crack.grow,
                dx: (Math.random() - 0.5) * 40, dy: palette.debris.dir * (35 + Math.random() * 60),
                duration: 800 + Math.random() * 700, spark: true
            });
        }
    }

    #render = now => {
        this.frame = 0;
        const { surface } = this;
        if (!surface) return;
        const { width, height, dpr } = surface;
        for (let i = this.cracks.length - 1; i >= 0; i--) {
            if (!this.cracks[i].update(now, width, height)) this.cracks.splice(i, 1)[0].destroy();
        }
        this.lights = this.lights.filter(light => now < light.start + light.duration);
        surface.clearRect();
        if (width && height) {
            surface.setTransform(dpr, 0, 0, dpr, 0, 0);
            for (const light of this.lights) {
                if (now < light.start) continue;
                const t = cubicBezier(easeOut, (now - light.start) / light.duration);
                const size = light.spark ? light.size : light.size * (0.3 + t * 1.2);
                surface.globalAlpha = light.spark ? Math.min(t / 0.15, (1 - t) / 0.85) : 1 - t;
                const x = light.x + (light.dx ?? 0) * t - size / 2;
                const y = light.y + (light.dy ?? 0) * t - size / 2;
                surface.drawImage(light.image, x, y, size, size);
            }
            surface.present();
        }
        if (this.cracks.length || this.lights.length) this.frame = requestAnimationFrame(this.#render);
    };

    #removeSurface() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        for (const crack of this.cracks) crack.destroy();
        this.cracks = [];
        this.lights = [];
        this.surface?.destroy();
        this.surface = null;
        this.paletteSprites.clear();
    }

    stop() {
        this.lifetime?.abort();
        this.#removeSurface();
        super.stop();
        const tint = this.overlay?.querySelector('.vn-fx-tint');
        if (tint) tint.style.opacity = '';
        this.overlay = null;
    }
}

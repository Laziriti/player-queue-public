// ============================================================
// canvas/ghosts.js — призраки на канвасе: души с хвостом из 13 сегментов и головой-картинкой, пар позади
// Души идут по четырём кривым: у каждого сегмента хвоста своя задержка (0.073 с), фаза и скорость зависят от номера души.
// ============================================================

import { bakeSprite, bakeBlurredBody } from './sprites.js';

// Пути (px от левого верхнего угла сцены); тот же расчёт кривых раньше делал tools/dev/ghost-keyframes.mjs
const PATH_DATA = {
    A: 'M -450 790 C 170 790 890 725 1410 550 C 1840 405 2140 175 2420 30',
    B: 'M -450 745 C 160 770 890 705 1420 520 C 1850 370 2150 160 2420 10',
    C: 'M -450 815 C 190 815 900 755 1430 565 C 1840 418 2150 190 2420 65',
    D: 'M -450 770 C 180 795 910 685 1430 515 C 1840 380 2130 140 2420 -10',
};
const N = 64;
const TAIL_SEGMENTS = 13;
const SEGMENT_DELAY = 0.073;
const TAIL_W = 125;
const HEAD_BOX = { w: 48, h: 78, left: -39.84, top: -39 };

const bez = (p, t) => {
    const u = 1 - t;
    return [0, 1].map(i => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i]);
};

/** Кривая → N+1 равноотстоящих по длине точек (x, y, угол касательной в градусах); тот же расчёт, что в tools/dev/ghost-keyframes.mjs */
function samplePath(d) {
    const n = d.match(/-?[\d.]+/g).map(Number);
    const seg1 = [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]], [n[6], n[7]]];
    const seg2 = [seg1[3], [n[8], n[9]], [n[10], n[11]], [n[12], n[13]]];
    const pts = [];
    for (const seg of [seg1, seg2]) for (let i = 0; i <= 4000; i++) pts.push(bez(seg, i / 4000));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum.at(-1);
    const x = new Float32Array(N + 1), y = new Float32Array(N + 1), ang = new Float32Array(N + 1);
    let j = 0;
    for (let k = 0; k <= N; k++) {
        const target = total * k / N;
        while (j < cum.length - 2 && cum[j + 1] < target) j++;
        const f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
        x[k] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
        y[k] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
        const a = Math.max(j - 20, 0), b = Math.min(j + 21, pts.length - 1);
        ang[k] = Math.atan2(pts[b][1] - pts[a][1], pts[b][0] - pts[a][0]);
    }
    return { x, y, ang };
}

let paths = null;
const getPaths = () => (paths ??= Object.fromEntries(Object.entries(PATH_DATA).map(([k, d]) => [k, samplePath(d)])));

// opacity из vnGhostTravel*: 0% → 0, 10% → 1, 87% → 1, 100% → 0
const envelope = u => (u < 0.1 ? u / 0.1 : u < 0.87 ? 1 : (1 - u) / 0.13);

// Точка на пути в доле u (0…1): линейно между соседними из N+1 точек, как интерполирует CSS между ключевыми кадрами
const out = { x: 0, y: 0, ang: 0 };
function at(path, u) {
    const f = u * N;
    const i = Math.min(N - 1, f | 0);
    const k = f - i;
    out.x = path.x[i] + (path.x[i + 1] - path.x[i]) * k;
    out.y = path.y[i] + (path.y[i + 1] - path.y[i]) * k;
    out.ang = path.ang[i] + (path.ang[i + 1] - path.ang[i]) * k;
}

/** Спрайты хвоста и тумана — общие для всех душ, запекаются один раз на движок. */
// Спрайты (хвост, пар) почти не масштабируются — им хватает билинейной выборки без мип-уровней (быстро); голова-картинка уменьшается
// в разы, поэтому для неё 'medium'. Переключение запоминаем в v.quality, чтобы не трогать свойство контекста зря.
export function setQuality(ctx, v, quality) {
    if (v.quality !== quality) { ctx.imageSmoothingQuality = quality; v.quality = quality; }
}

export class GhostSprites {
    constructor(res, imageUrls) {
        const bake = res * 1.5;
        this.res = res;
        this.tail = [];
        for (let t = 1; t <= TAIL_SEGMENTS; t++) {
            const h = 36 - t * 2.15;
            const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${a})`;
            this.tail[t] = bakeSprite({
                gradient: {
                    type: 'radial', shape: 'ellipse', at: [0.67, 0.5],
                    stops: [
                        [0, rgba(238, 241, 245, 0.67 - t * 0.035)],
                        [0.33, rgba(194, 202, 212, 0.45 - t * 0.025)],
                        [0.53, rgba(151, 164, 179, 0.23 - t * 0.014)],
                        [0.74, 'transparent'],
                    ],
                },
            }, TAIL_W, h, bake);
        }
        this.vapor = bakeBlurredBody({
            gradient: {
                type: 'radial', shape: 'ellipse', at: [0.65, 0.5],
                stops: [[0, '#d0d9e261'], [0.35, '#a8b7c534'], [0.73, 'transparent']],
            },
        }, 570, 105, 24, res);
        this.all = () => [...this.tail.filter(Boolean), this.vapor];
        // Головы грузятся fetch + createImageBitmap (в воркере нет Image); пока не загрузились — душа рисуется без головы
        this.heads = [];
        (imageUrls ?? []).forEach((url, i) => {
            fetch(url).then(r => r.blob()).then(createImageBitmap).then(bmp => { this.heads[i] = bmp; }).catch(() => {});
        });
    }
}

/** Пар: две размытые полосы, едущие по одному пути (одна на 6 с позади другой). */
export class GhostVapor {
    constructor(n, sprites) {
        this.sprites = sprites;
        this.lane = (n - 3.5) * 150;
        const even = n % 2 === 1; // :nth-child(even) среди восьми
        this.path = getPaths()[even ? 'C' : 'B'];
        this.duration = even ? 14 : 12;
        this.phase = -21 - n * 1.93;
    }

    draw(ctx, v) {
        setQuality(ctx, v, 'low');
        const spr = this.sprites.vapor, res = v.res;
        for (const delay of [this.phase, this.phase - 6]) {
            const u = (((v.t - delay) % this.duration) / this.duration);
            at(this.path, u);
            const c = Math.cos(out.ang), s = Math.sin(out.ang);
            ctx.setTransform(c * res, s * res, -s * res, c * res, out.x * res, (out.y + this.lane) * res);
            ctx.globalAlpha = 0.34 * envelope(u);
            ctx.drawImage(spr.canvas, -456 - spr.padX, -52.5 - spr.padY, spr.canvas.width / res, spr.canvas.height / res);
        }
    }
}

/** Душа: голова-картинка и 13 сегментов хвоста; каждый — на пути с задержкой 0.073 с относительно соседнего. */
export class GhostSoul {
    /**
     * @param {number} n          сквозной номер души (--n)
     * @param {number} position   номер среди душ своего слоя, с 1 (на нём в CSS держатся :nth-child)
     * @param {number} headIndex  какая из картинок головы
     */
    constructor(n, position, headIndex, sprites) {
        this.sprites = sprites;
        this.headIndex = headIndex;
        this.lane = (n - 20.5) * 28;
        this.path = getPaths()['ABCD'[(position - 1) % 4]];
        this.phase = -17 - n * 1.379;

        let size = 1, brightness = 0.84, duration = 8.1 + n * 0.047;
        if (position % 7 === 0) { size = 1.58; brightness = 1; duration = 6.5 + n * 0.024; }
        else if (position % 5 === 0) { size = 1.24; brightness = 0.92; duration = 7.2 + n * 0.028; }
        else if (position % 3 === 0) { size = 0.72; brightness = 0.45; duration = 10.8 + n * 0.036; }
        Object.assign(this, { size, brightness, duration });
    }

    draw(ctx, v) {
        const { size, duration, brightness, lane, phase } = this;
        const res = v.res;
        setQuality(ctx, v, 'low');

        for (let t = TAIL_SEGMENTS; t >= 1; t--) {
            const u = (((v.t - (phase + t * SEGMENT_DELAY)) % duration) / duration);
            const o = envelope(u) * brightness;
            if (o <= 0.003) continue;
            at(this.path, u);
            const c = Math.cos(out.ang) * size, s = Math.sin(out.ang) * size;
            const spr = this.sprites.tail[t];
            ctx.setTransform(c * res, s * res, -s * res, c * res, out.x * res, (out.y + lane) * res);
            ctx.globalAlpha = o;
            ctx.drawImage(spr.canvas, -TAIL_W * 0.83, -spr.h / 2, TAIL_W, spr.h);
        }

        const img = this.sprites.heads[this.headIndex];
        if (!img) return;
        const u = (((v.t - phase) % duration) / duration);
        const o = envelope(u) * brightness;
        if (o <= 0.003) return;
        at(this.path, u);
        setQuality(ctx, v, 'medium');
        // Картинка нарисована «головой вверх», путь почти горизонтален: поворот на 90° вокруг центра (см. .vn-particle-ghost-head-img)
        ctx.setTransform(res, 0, 0, res, 0, 0);
        ctx.translate(out.x, out.y + lane);
        ctx.rotate(out.ang);
        ctx.translate(-15.84, 15.84 * size);
        ctx.rotate(Math.PI / 2);
        ctx.scale(size, size);
        ctx.globalAlpha = o;
        const fit = Math.min(HEAD_BOX.w / img.width, HEAD_BOX.h / img.height);
        const w = img.width * fit, h = img.height * fit;
        ctx.drawImage(img, HEAD_BOX.left + (HEAD_BOX.w - w) / 2, HEAD_BOX.top + (HEAD_BOX.h - h) / 2, w, h);
    }
}

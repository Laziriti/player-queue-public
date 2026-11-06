// ============================================================
// canvas/sprites.js — одноразовая «запечка» спрайтов частиц
// Градиенты считаются попиксельно так же, как CSS (интерполяция в премультиплицированном виде, farthest-corner),
// чтобы канвас-частица совпадала с DOM-частицей. Рисуется спрайт один раз, потом он только копируется на сцену.
// Не использует document/window: работает в воркере.
// ============================================================

const SQRT2 = Math.SQRT2;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (a, n) => ((a % n) + n) % n;

// Работает и в воркере (там нет document), и на главном потоке
function makeCanvas(w, h) {
    const width = Math.max(1, Math.ceil(w)), height = Math.max(1, Math.ceil(h));
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    return Object.assign(document.createElement('canvas'), { width, height });
}

/**
 * Готовый спрайт отдаём как ImageBitmap: видеокарте он быстрее, чем холст-источник (холст при каждом drawImage приходится
 * «снимать» и проверять, не менялся ли он), и текстура у него одна на весь срок жизни.
 */
function finalize(canvas) {
    return typeof canvas.transferToImageBitmap === 'function' ? canvas.transferToImageBitmap() : canvas;
}

let colorCtx = null;
const colorCache = new Map();

/** Любой CSS-цвет → [r, g, b, a] (a в 0…1). */
export function parseColor(css) {
    let hit = colorCache.get(css);
    if (hit) return hit;
    colorCtx ??= makeCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = css;
    if (css === 'transparent') hit = [0, 0, 0, 0];
    else {
        colorCtx.fillRect(0, 0, 1, 1);
        const d = colorCtx.getImageData(0, 0, 1, 1).data;
        // getImageData отдаёт альфу 8-битной: для чисел вида .67 этого хватает, но берём точное значение из строки, если оно есть
        hit = [d[0], d[1], d[2], d[3] / 255];
        const m = /\/\s*([\d.]+%?)\s*\)|rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(css);
        if (m) { const v = m[1] ?? m[2]; hit[3] = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v); }
    }
    colorCache.set(css, hit);
    return hit;
}

/** stops: [[позиция 0…1, 'css-цвет'], …] → таблица премультиплицированных цветов для быстрой выборки */
function stopTable(stops) {
    const parsed = stops.map(([pos, css]) => {
        const [r, g, b, a] = parseColor(css);
        return { pos, r: r * a, g: g * a, b: b * a, a };
    });
    return pos => {
        if (pos <= parsed[0].pos) return parsed[0];
        for (let i = 1; i < parsed.length; i++) {
            const s1 = parsed[i];
            if (pos <= s1.pos) {
                const s0 = parsed[i - 1];
                const f = s1.pos === s0.pos ? 1 : (pos - s0.pos) / (s1.pos - s0.pos);
                return { r: s0.r + (s1.r - s0.r) * f, g: s0.g + (s1.g - s0.g) * f, b: s0.b + (s1.b - s0.b) * f, a: s0.a + (s1.a - s0.a) * f };
            }
        }
        return parsed[parsed.length - 1];
    };
}

/**
 * Покрытие пикселя формой (0…1, с антиалиасингом по краю) для прямоугольника W×H с центром в (cx, cy):
 * эллипс (border-radius: 50%), скруглённый прямоугольник (radius px) или прямоугольник.
 */
function coverage(x, y, W, H, cx, cy, round, radius, res) {
    if (W <= 0 || H <= 0) return 0;
    if (round) {
        const e = Math.hypot((x - cx) / (W / 2), (y - cy) / (H / 2));
        return clamp01(0.5 + (1 - e) * Math.min(W, H) / 2 * res);
    }
    if (radius > 0) {
        const r = Math.min(radius, W / 2, H / 2);
        const dx = Math.abs(x - cx) - (W / 2 - r), dy = Math.abs(y - cy) - (H / 2 - r);
        const dist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
        return clamp01(0.5 - dist * res);
    }
    const inside = Math.min(x - (cx - W / 2), cx + W / 2 - x, y - (cy - H / 2), cy + H / 2 - y);
    return clamp01(0.5 + inside * res);
}

function addShapePath(ctx, x, y, w, h, round, radius) {
    ctx.beginPath();
    if (round) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (radius > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
    else ctx.rect(x, y, w, h);
}

/**
 * Тело частицы: прямоугольник w×h (css px, border-box) с градиентом и рамкой, обрезанный по форме.
 * Градиент рассчитан по padding-box и повторяется под рамкой (как background в CSS).
 * @returns canvas размером w*res × h*res
 */
function bakeBody(w, h, res, spec) {
    const { gradient, round = true, radius = 0, border = null } = spec;
    const cw = Math.max(1, Math.ceil(w * res)), ch = Math.max(1, Math.ceil(h * res));
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const px = img.data;
    const color = stopTable(gradient.stops);
    const bw = border?.width ?? 0;
    const bcol = border ? parseColor(border.color) : null;
    const pw = Math.max(0.01, w - 2 * bw), ph = Math.max(0.01, h - 2 * bw);

    let cx = 0.5, cy = 0.5, rx = 1, ry = 1;
    if (gradient.type === 'radial') {
        [cx, cy] = gradient.at ?? [0.5, 0.5];
        const sideX = Math.max(cx, 1 - cx) * pw, sideY = Math.max(cy, 1 - cy) * ph;
        if (gradient.shape === 'ellipse') { rx = sideX * SQRT2; ry = sideY * SQRT2; }
        else rx = ry = Math.hypot(sideX, sideY);
    }
    const innerRadius = Math.max(0, radius - bw);

    for (let j = 0; j < ch; j++) {
        const y = (j + 0.5) / res;
        for (let i = 0; i < cw; i++) {
            const x = (i + 0.5) / res;
            const outer = coverage(x, y, w, h, w / 2, h / 2, round, radius, res);
            if (outer === 0) continue;

            const gx = bw ? mod(x - bw, pw) : x, gy = bw ? mod(y - bw, ph) : y;
            const pos = gradient.type === 'radial' ? Math.hypot((gx - cx * pw) / rx, (gy - cy * ph) / ry) : gy / ph;
            const c = color(pos);
            let r = c.r, g = c.g, b = c.b, a = c.a;           // премультиплицированные

            if (bw) {
                // рамка поверх фона в кольце между внешней и внутренней формой
                const inner = coverage(x, y, w - 2 * bw, h - 2 * bw, w / 2, h / 2, round, innerRadius, res);
                const ringA = bcol[3] * clamp01(outer - inner);
                r = bcol[0] * ringA + r * (1 - ringA);
                g = bcol[1] * ringA + g * (1 - ringA);
                b = bcol[2] * ringA + b * (1 - ringA);
                a = ringA + a * (1 - ringA);
            }
            a *= outer; r *= outer; g *= outer; b *= outer;
            if (a <= 0) continue;
            const o = (j * cw + i) * 4;
            px[o] = Math.min(255, r / a + 0.5);
            px[o + 1] = Math.min(255, g / a + 0.5);
            px[o + 2] = Math.min(255, b / a + 0.5);
            px[o + 3] = a * 255 + 0.5;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

// ── Шумовое тело (дым, пар) ───────────────────────────────────
// Детерминированный value-noise по целочисленной решётке: один и тот же seed рисует тот же клуб в воркере и на главном потоке.
function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (lo, hi, v) => { const t = clamp01((v - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

/**
 * Тело-клуб из шума: неровный облачный силуэт, плотнее к середине и прозрачный по краю.
 * noise: { seed, freq (клеток шума поперёк), octaves, cover (порог плотности), soft (мягкость края порога), color: [r, g, b], alpha (макс.) }
 */
function bakeNoiseBody(w, h, res, noise) {
    const { seed = 1, freq = 3, octaves = 4, cover = 0.32, soft = 0.4, color = [90, 88, 92], alpha = 0.5 } = noise;
    const cw = Math.max(1, Math.ceil(w * res)), ch = Math.max(1, Math.ceil(h * res));
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const px = img.data;
    for (let j = 0; j < ch; j++) {
        const ny = (j + 0.5) / ch;
        for (let i = 0; i < cw; i++) {
            const nx = (i + 0.5) / cw;
            const r = Math.hypot(nx - 0.5, ny - 0.5) * 2;
            if (r >= 1) continue;
            // Огибающая: широкая, к самому краю истончается; сама форма — из шума, а не из круга
            const env = 1 - smooth(0.45, 1, r);
            // Искажение координат вторым шумом даёт завитки вместо круглых «комков»
            const wx = valueNoise(nx * freq * 1.6 + 7.3, ny * freq * 1.6, seed + 99) - 0.5;
            const wy = valueNoise(nx * freq * 1.6, ny * freq * 1.6 + 3.1, seed + 131) - 0.5;
            let n = 0, amp = 0.5, f = freq, norm = 0;
            for (let o = 0; o < octaves; o++) {
                n += amp * valueNoise(nx * f + wx * 2.2, ny * f + wy * 2.2, seed + o * 31);
                norm += amp; amp *= 0.5; f *= 2;
            }
            const density = (n / norm) * 0.85 + env * 0.3;
            const a = smooth(cover, cover + soft, density) * env ** 0.5 * alpha;
            if (a <= 0.002) continue;
            // Объём: середина светлее, края темнее
            const shade = 0.8 + 0.35 * smooth(cover, cover + soft + 0.3, density);
            const o4 = (j * cw + i) * 4;
            px[o4] = Math.min(255, color[0] * shade);
            px[o4 + 1] = Math.min(255, color[1] * shade);
            px[o4 + 2] = Math.min(255, color[2] * shade);
            px[o4 + 3] = a * 255 + 0.5;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/** Размытие готового рисунка (CSS filter: blur / тень). Если браузер не умеет ctx.filter — рисунок остаётся как есть. */
function blurred(source, filter, pad) {
    const out = makeCanvas(source.width + pad * 2, source.height + pad * 2);
    const ctx = out.getContext('2d');
    if ('filter' in ctx) ctx.filter = filter;
    ctx.drawImage(source, pad, pad);
    if ('filter' in ctx) ctx.filter = 'none';   // иначе вырез тени (destination-out) тоже размоется и тень останется под телом
    return out;
}

/**
 * Спрайт частицы.
 * @param {object} spec   { gradient, round?, radius?, border?: { width, color }, blur?, hue?, glow?: { blur, color } | [..] }
 * @param {number} w,h    размер тела в css px
 * @param {number} res    пикселей на css px
 * @returns {{ canvas, padX, padY, w, h }} padX/padY — поля вокруг тела в css px (под размытие и свечение)
 */
export function bakeSprite(spec, w, h, res) {
    const round = spec.round ?? true;
    const radius = spec.radius ?? 0;
    const body = spec.noise ? bakeNoiseBody(w, h, res, spec.noise) : bakeBody(w, h, res, spec);
    const blur = spec.blur ?? 0;
    const hue = spec.hue ?? 0;
    const glows = [].concat(spec.glow ?? []);
    const widest = glows.reduce((m, g) => Math.max(m, g.blur), 0);
    const padCss = Math.ceil(widest * 1.6 + blur * 3);
    if (!padCss && !hue) return { canvas: finalize(body), padX: 0, padY: 0, w, h };

    const pad = padCss * res;
    const full = makeCanvas(body.width + pad * 2, body.height + pad * 2);
    const ctx = full.getContext('2d');

    // box-shadow: тень фигуры размытая по гауссу σ = blur/2; видна только снаружи границы элемента; первая тень лежит выше
    for (const glow of [...glows].reverse()) {
        const shape = makeCanvas(body.width, body.height);
        const sctx = shape.getContext('2d');
        sctx.fillStyle = glow.color;
        addShapePath(sctx, 0, 0, shape.width, shape.height, round, radius * res);
        sctx.fill();
        const shadow = blurred(shape, `blur(${glow.blur / 2 * res}px)`, pad);
        const sh = shadow.getContext('2d');
        sh.globalCompositeOperation = 'destination-out';
        addShapePath(sh, pad, pad, body.width, body.height, round, radius * res);
        sh.fill();
        ctx.drawImage(shadow, 0, 0);
    }
    ctx.drawImage(body, pad, pad);

    const filter = [blur ? `blur(${blur * res}px)` : '', hue ? `hue-rotate(${hue}deg)` : ''].filter(Boolean).join(' ');
    if (!filter) return { canvas: finalize(full), padX: padCss, padY: padCss, w, h };
    const soft = makeCanvas(full.width, full.height);
    const sctx = soft.getContext('2d');
    if ('filter' in sctx) sctx.filter = filter;
    sctx.drawImage(full, 0, 0);
    return { canvas: finalize(soft), padX: padCss, padY: padCss, w, h };
}

/** Спрайт-«полоска» для вытянутых частиц (дождь): запекается один раз и растягивается до нужных w×h. */
export function bakeUnit(spec, bakeW, bakeH, res) {
    return bakeSprite({ ...spec, blur: 0, glow: null }, bakeW, bakeH, res);
}

/** Готовый (размытый) блок для тумана призраков: эллипс w×h с радиальным градиентом, размыт на blur px. */
export function bakeBlurredBody(spec, w, h, blur, res) {
    return bakeSprite({ ...spec, blur }, w, h, res);
}

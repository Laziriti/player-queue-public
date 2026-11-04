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

/** Размытие готового рисунка (CSS filter: blur / тень). Если браузер не умеет ctx.filter — рисунок остаётся как есть. */
function blurred(source, filter, pad) {
    const out = makeCanvas(source.width + pad * 2, source.height + pad * 2);
    const ctx = out.getContext('2d');
    if ('filter' in ctx) ctx.filter = filter;
    ctx.drawImage(source, pad, pad);
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
    const body = bakeBody(w, h, res, spec);
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

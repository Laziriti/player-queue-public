// ============================================================
// crack-geometry.js — геометрия трещин (чистые функции, без DOM)
// Общий источник для «Разрыва пустоты», «Землетрясения» (visual-fx.js) и «Треснувшего камня» (vn-character-fx.js).
//
// Трещина — не ломаная одной толщины, а дерево разломов: ствол растёт с «инерцией» направления, от него
// отходят ветки (вероятность падает с глубиной), у веток — тонкие волосяные трещинки. Каждая ветка — гладкая
// кривая (Catmull-Rom) с профилем ширины, сужающимся к вершине; из неё строится заливаемый контур с неровными краями.
// ============================================================

// ≈ N(0, 1): сумма трёх равномерных
const gauss = rnd => (rnd() + rnd() + rnd() - 1.5) * 2;

/** Центростремительный Catmull-Rom между узлами; возвращает плотную ломаную с параметром t (0..1 вдоль ветки). */
function smooth(nodes, sub = 5) {
    const out = [];
    for (let i = 0; i < nodes.length - 1; i++) {
        const p0 = nodes[Math.max(0, i - 1)], p1 = nodes[i], p2 = nodes[i + 1], p3 = nodes[Math.min(nodes.length - 1, i + 2)];
        for (let s = 0; s < sub; s++) {
            const u = s / sub, u2 = u * u, u3 = u2 * u;
            out.push({
                x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
                y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
            });
        }
    }
    out.push({ x: nodes[nodes.length - 1].x, y: nodes[nodes.length - 1].y });
    const n = out.length - 1;
    out.forEach((p, k) => { p.t = n ? k / n : 0; });
    return out;
}

function grow(rnd, o, out) {
    const nodes = [{ x: o.x, y: o.y, ang: o.angle }];
    let ang = o.angle, turn = 0;
    for (let i = 0; i < o.steps; i++) {
        turn = turn * 0.55 + gauss(rnd) * 0.30;
        ang += turn;
        const len = o.step * (0.7 + rnd() * 0.6);
        const p = nodes[nodes.length - 1];
        const x = p.x + Math.cos(ang) * len, y = p.y + Math.sin(ang) * len;
        nodes.push({ x, y, ang });
        if (o.bounds && (x < -60 || y < -60 || x > o.bounds.w + 60 || y > o.bounds.h + 60)) break;
    }
    if (nodes.length < 2) return;

    const pts = smooth(nodes);
    // Ширина сужается к вершине; у начала ветки она не меньше доли ширины родителя
    for (const p of pts) p.w = Math.max(0.5, o.width * Math.pow(1 - p.t, 0.55));
    out.push({ pts, depth: o.depth, width: o.width, hair: o.hair === true });

    if (o.hair) return;

    for (let i = 1; i < nodes.length - 1; i++) {
        const t = i / (nodes.length - 1);
        const wHere = Math.max(0.5, o.width * Math.pow(1 - t, 0.55));
        const left = nodes.length - 1 - i;

        if (o.depth < o.maxDepth && rnd() < 0.34 * Math.pow(0.62, o.depth)) {
            const side = rnd() < 0.5 ? -1 : 1;
            grow(rnd, {
                ...o,
                x: nodes[i].x, y: nodes[i].y,
                angle: nodes[i].ang + side * (0.4 + rnd() * 0.55),
                steps: Math.max(2, Math.floor(left * (0.35 + rnd() * 0.35))),
                width: wHere * 0.62,
                depth: o.depth + 1,
            }, out);
        } else if (rnd() < 0.2) {
            // Волосяная трещинка: тонкая, 1–3 шага, без своей «пустоты»
            grow(rnd, {
                ...o,
                x: nodes[i].x, y: nodes[i].y,
                angle: nodes[i].ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.8),
                steps: 1 + Math.floor(rnd() * 3),
                step: o.step * 0.55,
                width: 1,
                depth: o.depth + 1,
                hair: true,
            }, out);
        }
    }
}

/**
 * Дерево трещин от точки (x, y).
 * @param {() => number} rnd — ГСЧ (Math.random или детерминированный)
 * @param {{x:number,y:number,angle:number,length:number,width:number,maxDepth?:number,step?:number,bounds?:{w:number,h:number}}} o
 *   length — примерная длина ствола, width — ширина раскрытия у начала ствола, step — длина узлового отрезка
 * @returns {{branches: Array<{pts: Array<{x:number,y:number,t:number,w:number}>, depth:number, width:number, hair:boolean}>}}
 */
export function generateCrack(rnd, o) {
    const step = o.step ?? 44;
    const out = [];
    grow(rnd, {
        x: o.x, y: o.y, angle: o.angle,
        steps: Math.max(3, Math.round(o.length / step)),
        step, width: o.width, depth: 0, maxDepth: o.maxDepth ?? 3, bounds: o.bounds ?? null,
    }, out);
    return { branches: out };
}

/** Контур раскрытия ветки (замкнутый многоугольник) с неровными краями; для волосяных веток — null. */
export function outlineOf(branch, rnd) {
    if (branch.hair) return null;
    const { pts } = branch;
    const left = [], right = [];
    for (let k = 0; k < pts.length; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        const hw = pts[k].w / 2;
        const jl = 1 + (rnd() - 0.5) * 0.55, jr = 1 + (rnd() - 0.5) * 0.55;
        left.push({ x: pts[k].x + nx * hw * jl, y: pts[k].y + ny * hw * jl });
        right.push({ x: pts[k].x - nx * hw * jr, y: pts[k].y - ny * hw * jr });
    }
    const tip = pts[pts.length - 1];
    const poly = [...left, { x: tip.x, y: tip.y }, ...right.reverse()];

    // Единая ориентация обхода: иначе при объединении контуров в один clip-path (nonzero) места их
    // перекрытия с противоположным обходом превращались бы в дыры
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        area += p.x * q.y - q.x * p.y;
    }
    return area < 0 ? poly.reverse() : poly;
}

/** Габариты по всем точкам, с запасом под свечение. */
export function bboxOf(points, margin = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
    }
    return { x: Math.floor(x0 - margin), y: Math.floor(y0 - margin), w: Math.ceil(x1 - x0 + margin * 2), h: Math.ceil(y1 - y0 + margin * 2) };
}

/** «M x y L … Z» для замкнутого многоугольника или «M x y L …» для линии; координаты сдвигаются на (-ox, -oy). */
export function pathD(points, ox = 0, oy = 0, close = true) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${(p.x - ox).toFixed(1)} ${(p.y - oy).toFixed(1)}`).join('') + (close ? 'Z' : '');
}

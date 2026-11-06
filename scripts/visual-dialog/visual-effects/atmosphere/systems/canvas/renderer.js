// ============================================================
// canvas/renderer.js — ядро рисования канвас-частиц (без DOM: работает и в воркере, и на главном потоке)
//
// ParticleRenderer получает сообщения от CanvasParticles (particle-canvas.js):
//   init    { scene, res, vh, sizes, override, canvases }  — запечь спрайты, создать частицы, запустить цикл
//   resize  { layer, W, H, vh, vw }                        — размер слоя в css px (0 — слой скрыт) и 1vh / 1vw окна в px
//   res     { res }                                        — пикселей на css px сменилось: пересобрать холсты и спрайты
//   override{ seconds }                                   — подмена длительности всех частиц (эффект «сон»), 0 — нет
//   freeze  { ms }                                         — для tools/dev: остановить цикл и нарисовать кадр в момент ms
//   destroy
// Частица — это спрайт, запечённый один раз (sprites.js), или картинка, и движение по доле пути u (0…1): дорожки x, y, r, s, sx, ry, o
// с ключевыми кадрами, как @keyframes (config/particle-canvas.js).
// ============================================================

import { bakeSprite, bakeUnit } from './sprites.js';
import { GhostSprites, GhostSoul, GhostVapor, setQuality } from './ghosts.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Ширина «переворачивающегося» листа: cos² плавно ходит между min и 1, без изломов в крайних точках */
function flipWidth(flip, u, ph) {
    const c = Math.cos(Math.PI * (flip.cycles * u + ph));
    return flip.min + (1 - flip.min) * c * c;
}

/** cubic-bezier(x1, y1, x2, y2) как animation-timing-function: прогресс x (0…1) → выход y */
function cubicBezier([x1, y1, x2, y2], x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
        const u = 1 - t;
        const cx = 3 * x1 * u * u * t + 3 * x2 * u * t * t + t * t * t - x;
        const dx = 3 * x1 * u * u + 6 * (x2 - x1) * u * t + 3 * (1 - x2) * t * t;
        if (Math.abs(cx) < 1e-5 || !dx) break;
        t -= cx / dx;
    }
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const u = 1 - t;
    return 3 * y1 * u * u * t + 3 * y2 * u * t * t + t * t * t;
}

/**
 * [[u, значение, ease?], …] → дорожка. Значение: число (px / доля / градусы) или объект — линейная комбинация параметров частицы:
 * drift·--drift + driftY·--drift-y + rot·--rotation + rise·--rise(vh) + vh·(1% высоты экрана) + vw·(1% ширины) + px.
 * ease — cubic-bezier [x1, y1, x2, y2] на промежутке от этого кадра до следующего (animation-timing-function кадра).
 */
const COEF = ['drift', 'driftY', 'rot', 'rise', 'vh', 'vw', 'px'];
function compileTrack(keys) {
    const n = keys.length;
    const tr = { n, t: new Float32Array(n), ease: keys.map(k => k[2] ?? null), anyEase: keys.some(k => k[2]) };
    for (const c of COEF) tr[c] = new Float32Array(n);
    keys.forEach(([t, val], i) => {
        tr.t[i] = t;
        if (typeof val === 'number') tr.px[i] = val;
        else for (const c of COEF) tr[c][i] = val[c] ?? 0;
    });
    return tr;
}

function valueAt(tr, i, p, vh, vw) {
    return tr.drift[i] * (p.drift ?? 0) + tr.driftY[i] * (p.driftY ?? 0) + tr.rot[i] * (p.rotation ?? 0)
        + tr.rise[i] * (p.rise ?? 0) * vh + tr.vh[i] * vh + tr.vw[i] * vw + tr.px[i];
}

function sample(tr, u, p, vh, vw) {
    const { n, t } = tr;
    let i = 0;
    while (i < n - 1 && u > t[i + 1]) i++;
    const v0 = valueAt(tr, i, p, vh, vw);
    if (i === n - 1 || u <= t[i]) return v0;
    let f = (u - t[i]) / (t[i + 1] - t[i]);
    if (tr.anyEase && tr.ease[i]) f = cubicBezier(tr.ease[i], f);
    return v0 + (valueAt(tr, i + 1, p, vh, vw) - v0) * f;
}

// ── Ветер ────────────────────────────────────────────────────
// Скорость ветра (px/с) и размах порывов по уровню 0…5; уровень и порывистость меняются плавно (WIND_RAMP уровней в секунду, GUST_RAMP долей в секунду).
const WIND_SPEED = [0, 40, 100, 180, 290, 420];
const WIND_GUST = [0, 0.25, 0.4, 0.5, 0.6, 0.65];
const WIND_RAMP = 2;
const GUST_RAMP = 0.5;
// Шаг истории пройденного ветром пути и её длина (хватает на самую долгую частицу)
const WIND_STEP = 1 / 20;
const WIND_CAP = 2400;
// Вылетевшая за край частица появляется с другой стороны: запас за краем больше любого спрайта вместе со свечением
const WIND_WRAP = 120;
// Сдвиг самой близкой частицы за мышью, px
const PARALLAX_PX = 26;

const table = (tab, a) => { const i = Math.min(tab.length - 2, Math.floor(a)); return tab[i] + (tab[i + 1] - tab[i]) * (a - i); };

/**
 * Путь, пройденный ветром, как функция времени: частица возраста age сдвинута на at(t) - at(t - age), поэтому
 * смена ветра и порывы не дёргают частицы, уже летящие по сцене. История считается шагами по 1/20 с (детерминированно).
 */
class Wind {
    constructor(level, gusts = true) {
        this.target = level;
        this.level = level;
        this.gustTarget = gusts ? 1 : 0;
        this.gustAmt = this.gustTarget;
        this.seen = level !== 0;
        this.hist = new Float64Array(WIND_CAP);
        this.step = 0;
        this.vx = this.velocity(0);
        this.now = 0;
    }

    setTarget(level, gusts = true) {
        this.target = level;
        this.gustTarget = gusts ? 1 : 0;
        if (level) this.seen = true;
    }

    velocity(ts) {
        const a = Math.abs(this.level);
        if (a < 1e-4) return 0;
        const gust = 1 + this.gustAmt * table(WIND_GUST, a) * (0.6 * Math.sin(ts * 2 * Math.PI / 7) + 0.4 * Math.sin(ts * 2 * Math.PI / 13 + 1.3));
        return Math.sign(this.level) * table(WIND_SPEED, a) * gust;
    }

    advance(t) {
        const last = Math.floor(t / WIND_STEP) + 1;
        const ramp = WIND_RAMP * WIND_STEP;
        while (this.step < last) {
            this.step++;
            this.level += Math.max(-ramp, Math.min(ramp, this.target - this.level));
            this.gustAmt += Math.max(-GUST_RAMP * WIND_STEP, Math.min(GUST_RAMP * WIND_STEP, this.gustTarget - this.gustAmt));
            this.vx = this.velocity(this.step * WIND_STEP);
            this.hist[this.step % WIND_CAP] = this.hist[(this.step - 1) % WIND_CAP] + this.vx * WIND_STEP;
        }
        this.now = this.at(t);
    }

    at(tau) {
        const s = Math.max(0, tau) / WIND_STEP, i = Math.floor(s);
        const a = this.hist[i % WIND_CAP];
        return a + (this.hist[(i + 1) % WIND_CAP] - a) * (s - i);
    }
}

const bitmaps = new Map();
/** Картинка частицы как ImageBitmap (в воркере нет Image): fetch + createImageBitmap, одна загрузка на адрес */
function loadBitmap(url) {
    let hit = bitmaps.get(url);
    if (!hit) bitmaps.set(url, hit = fetch(url).then(r => r.blob()).then(createImageBitmap).catch(() => null));
    return hit;
}

/** Внешний вид и движение одного вида частиц (тип + вариант). */
class SpriteKind {
    constructor(spec, res) {
        this.res = res;
        const sprite = spec.sprite ?? {};
        const m = spec.motion;
        this.x = compileTrack(m.x ?? [[0, 0]]);
        this.y = compileTrack(m.y ?? [[0, 0]]);
        this.r = compileTrack(m.r ?? [[0, 0]]);
        this.s = compileTrack(m.s ?? [[0, 1]]);
        this.sx = compileTrack(m.sx ?? [[0, 1]]);
        this.ry = compileTrack(m.ry ?? [[0, 0]]);
        this.o = compileTrack(m.o);
        // Плавные колебания вместо ломаной по ключам: sway { amp, cycles } качает вбок (px), flip { min, cycles } «переворачивает» лист
        // сжатием по ширине; у каждой частицы своя фаза (p.ph, p.ph2), поэтому они не качаются хором
        this.sway = m.sway ?? null;
        this.flip = m.flip ?? null;
        // Поворот и масштаб из ключевых кадров нужны не всем: без них частица считается без тригонометрии
        const trivial = (tr, v) => tr.n === 1 && tr.px[0] === v && COEF.every(c => c === 'px' || tr[c][0] === 0);
        this.plain = trivial(this.r, 0) && trivial(this.s, 1) && trivial(this.sx, 1) && trivial(this.ry, 0) && !this.flip;

        // Вид спрайта: одна заготовка, палитра (по номеру среди соседей, как :nth-child) и/или стадии фильтра по времени (hue-rotate)
        this.variants = sprite.palette ?? [sprite];
        this.stages = sprite.stages ?? null;
        this.unitSize = sprite.unit ?? null;
        this.windTilt = !!spec.windTilt;
        this.cache = new Map();

        this.bitmaps = [];
        (spec.images ?? []).forEach((url, i) => loadBitmap(url).then(bmp => { this.bitmaps[i] = bmp; }));
        this.isImage = !!spec.images?.length;
    }

    /** Размеры тела округляются до 0.5 px: спрайт почти не масштабируется, поэтому остаётся чётким */
    spriteFor(w, h, idx, stage, extraBlur = 0) {
        const which = (idx - 1) % this.variants.length;
        const base = this.variants[which];
        let spec = stage === undefined ? base : { ...base, ...this.stages[stage] };
        const unit = this.unitSize;
        // Размытие глубины: у вытянутых заготовок (капли) и картинок его нет
        const extra = unit || this.isImage ? 0 : extraBlur;
        if (extra) spec = { ...spec, blur: (spec.blur ?? 0) + extra };
        const bw = unit ? unit[0] : Math.max(0.5, Math.round(w * 2) / 2), bh = unit ? unit[1] : Math.max(0.5, Math.round(h * 2) / 2);
        const key = `${which}|${stage}|${extra}|${bw}x${bh}`;
        let spr = this.cache.get(key);
        if (!spr) this.cache.set(key, spr = unit ? bakeUnit(spec, bw, bh, this.res) : bakeSprite(spec, bw, bh, this.res));
        return spr;
    }
}

/**
 * Частица с параметрами p: { w, h, left (% ширины), top | bottom (% высоты), delay, duration (с), drift, driftY (px), rotation (градусы, --rotation),
 * rise (vh), rot (градусы, свойство rotate), idx (номер среди частиц слоя), img (номер картинки) }.
 * Положение и порядок преобразований те же, что у DOM-элемента: T(центр) · rotate · transform из ключевых кадров.
 */
class SpriteParticle {
    constructor(kind, p) {
        this.kind = kind;
        this.p = p;
        const idx = p.idx ?? 1;
        this.depth = p.dd ?? 0;
        if (kind.stages) {
            this.stageSprites = kind.stages.map((_, i) => kind.spriteFor(p.w, p.h, idx, i, p.xb));
            this.stageU = kind.stages.map(st => st.u);
        } else if (!kind.isImage) this.sprite = kind.spriteFor(p.w, p.h, idx, undefined, p.xb);
        const rot = (p.rot ?? 0) * DEG;
        this.c0 = Math.cos(rot);
        this.s0 = Math.sin(rot);
    }

    draw(ctx, v) {
        const { kind, p } = this;
        const duration = v.override || p.duration;
        const phase = v.t - p.delay;
        if (phase < 0) return;
        const u = (phase % duration) / duration;

        const o = sample(kind.o, u, p, v.vh, v.vw);
        if (o <= 0.003) return;

        let sprite = this.sprite, image = null;
        if (kind.isImage) {
            image = kind.bitmaps[p.img ?? 0];
            if (!image) return;
        } else if (this.stageSprites) {
            let best = 0;
            for (let i = 1; i < this.stageU.length; i++) if (Math.abs(this.stageU[i] - u) < Math.abs(this.stageU[best] - u)) best = i;
            sprite = this.stageSprites[best];
        }

        let x = sample(kind.x, u, p, v.vh, v.vw);
        if (kind.sway) x += kind.sway.amp * Math.sin(TAU * (kind.sway.cycles * u + (p.ph ?? 0)));
        const y = sample(kind.y, u, p, v.vh, v.vw);

        const left = p.left / 100 * v.W;
        const top = p.top !== undefined ? p.top / 100 * v.H : v.H - p.bottom / 100 * v.H - p.h;
        const { c0, s0 } = this;
        let a = c0, b = s0, c = -s0, d = c0;
        // Ветер сносит частицу на путь, пройденный им за её жизнь; вытянутая (капля) ложится вдоль полёта
        const wind = v.wind;
        const windy = !!p.wk && wind.seen;
        const lean = windy && kind.windTilt ? -Math.atan(wind.vx * p.wk / (110 * v.vh / duration)) : 0;
        if (!kind.plain || lean) {
            const kr = kind.plain ? 0 : sample(kind.r, u, p, v.vh, v.vw) * DEG;
            const ks = kind.plain ? 1 : sample(kind.s, u, p, v.vh, v.vw);
            const sx = kind.plain ? 1 : sample(kind.sx, u, p, v.vh, v.vw) * Math.cos(sample(kind.ry, u, p, v.vh, v.vw) * DEG) * (kind.flip ? flipWidth(kind.flip, u, p.ph2 ?? 0) : 1);
            const theta = Math.atan2(s0, c0) + kr + lean;
            const ct = Math.cos(theta) * ks, st = Math.sin(theta) * ks;
            a = ct * sx; b = st * sx; c = -st; d = ct;
        }
        const res = v.res;

        let cx = left + p.w / 2 + c0 * x - s0 * y, cy = top + p.h / 2 + s0 * x + c0 * y;
        if (windy) {
            cx += (wind.now - wind.at(v.t - u * duration)) * p.wk;
            const range = v.W + 2 * WIND_WRAP;
            cx = ((cx + WIND_WRAP) % range + range) % range - WIND_WRAP;
        }
        if (p.pd) {
            cx -= v.look.x * PARALLAX_PX * p.pd;
            cy -= v.look.y * PARALLAX_PX * p.pd;
        }

        ctx.setTransform(a * res, b * res, c * res, d * res, cx * res, cy * res);
        ctx.globalAlpha = p.alpha === undefined ? o : o * p.alpha;

        setQuality(ctx, v, image ? 'medium' : 'low');
        if (image) {
            // background: center / contain no-repeat
            const fit = Math.min(p.w / image.width, p.h / image.height);
            const iw = image.width * fit, ih = image.height * fit;
            ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
            return;
        }
        const sx = p.w / sprite.w, sy = p.h / sprite.h;
        ctx.drawImage(sprite.canvas, -p.w / 2 - sprite.padX * sx, -p.h / 2 - sprite.padY * sy,
            sprite.canvas.width / res * sx, sprite.canvas.height / res * sy);
    }
}

const raf = cb => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(() => cb(performance.now()), 16));
const cancelRaf = id => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

export class ParticleRenderer {
    /** @param {(msg: object) => void} reply  ответы хозяину (ready, frozen) */
    constructor(reply = () => {}) {
        this.reply = reply;
        this.layers = {};
        this.id = 0;
        this.t0 = 0;
        this.frozen = false;
    }

    handle(m) {
        switch (m.type) {
            case 'init': return this.#init(m);
            case 'resize': return this.#resize(m.layer, m.W, m.H, m.vh, m.vw);
            case 'res': return this.#setRes(m.res);
            case 'override': this.override = m.seconds || 0; return;
            case 'wind': this.wind?.setTarget(m.level || 0, m.gusts !== false); return;
            case 'look': if (this.look) { this.look.tx = m.x; this.look.ty = m.y; } return;
            case 'freeze': return this.#freeze(m.ms);
            case 'destroy': return this.#stop();
        }
    }

    #init(m) {
        this.res = m.res;
        this.vh = m.vh;
        this.vw = m.vw;
        this.override = m.override || 0;
        this.scene = m.scene;
        this.wind = new Wind(m.wind || 0, m.gusts !== false);
        this.look = { x: 0, y: 0, tx: 0, ty: 0 };

        for (const [name, canvas] of Object.entries(m.canvases)) {
            this.layers[name] = { canvas, ctx: canvas.getContext('2d'), items: [], W: 0, H: 0 };
            this.#resize(name, m.sizes[name].W, m.sizes[name].H, m.vh, m.vw);
        }

        this.#build();

        this.t0 = performance.now();
        this.reply({ type: 'ready' });
        if (!this.frozen) this.#loop();
    }

    /** Запекает спрайты в текущем res и создаёт частицы слоёв. Частица — чистая функция времени, поэтому пересборка не сбрасывает анимацию. */
    #build() {
        const { scene, res } = this;
        const kinds = {};
        for (const [id, spec] of Object.entries(scene.kinds)) kinds[id] = new SpriteKind(spec, res);
        const ghosts = scene.ghost ? new GhostSprites(res, scene.ghost.images) : null;

        for (const layer of Object.values(this.layers)) layer.items = [];
        for (const it of scene.items) {
            const layer = this.layers[it.l] ?? this.layers.back;
            if (it.t === 's') layer.items.push(new SpriteParticle(kinds[it.k], it.p));
            else if (it.t === 'v') layer.items.push(new GhostVapor(it.n, ghosts));
            else if (it.t === 'g') layer.items.push(new GhostSoul(it.n, it.pos, it.head, ghosts));
        }
        // Дальние рисуются раньше ближних (сортировка устойчива: без глубины порядок прежний)
        for (const layer of Object.values(this.layers)) {
            if (layer.items.some(item => item.depth)) layer.items.sort((p, q) => (p.depth ?? 0) - (q.depth ?? 0));
        }

        // Первый кадр рисует каждый спрайт один раз почти прозрачно: текстуры уходят на видеокарту сразу, а не рывком, когда частица впервые появится
        this.warm = [...Object.values(kinds).flatMap(k => [...k.cache.values()]), ...(ghosts?.all() ?? [])];
    }

    /** Холст стал другого разрешения (другой монитор, масштаб, полный экран): холсты слоёв и спрайты пересобираются в новом res */
    #setRes(res) {
        if (!res || res === this.res || !this.scene) return;
        this.res = res;
        for (const [name, layer] of Object.entries(this.layers)) this.#resize(name, layer.W, layer.H);
        this.#build();
    }

    #resize(name, W, H, vh, vw) {
        if (vh) this.vh = vh;
        if (vw) this.vw = vw;
        const layer = this.layers[name];
        if (!layer) return;
        layer.W = W;
        layer.H = H;
        layer.canvas.width = Math.round(W * this.res);
        layer.canvas.height = Math.round(H * this.res);
        layer.ctx.imageSmoothingQuality = 'low'; // размер холста сбрасывает состояние контекста
    }

    #loop() {
        // Раз в секунду отправляем хозяину частоту кадров и время рисования кадра (CanvasParticles.stats, tools/dev/worker-fps.mjs)
        let frames = 0, spent = 0, worst = 0, since = performance.now();
        const frame = () => {
            this.id = raf(frame);
            const start = performance.now();
            this.#render((start - this.t0) / 1000);
            const took = performance.now() - start;
            frames++; spent += took; worst = Math.max(worst, took);
            if (start - since >= 1000) {
                this.reply({ type: 'stats', fps: frames * 1000 / (start - since), ms: spent / frames, worst });
                frames = 0; spent = 0; worst = 0; since = start;
            }
        };
        this.id = raf(frame);
    }

    #render(t) {
        this.wind.advance(t);
        const look = this.look;
        look.x += (look.tx - look.x) * 0.1;
        look.y += (look.ty - look.y) * 0.1;
        for (const layer of Object.values(this.layers)) {
            const { ctx, canvas, W, H } = layer;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Слой скрыт (свёрнутая сцена): размер 0, рисовать нечего
            if (!W || !H) continue;
            const view = { t, W, H, vh: this.vh, vw: this.vw, res: this.res, override: this.override, wind: this.wind, look };
            for (const item of layer.items) item.draw(ctx, view);
            if (this.warm) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalAlpha = 0.02;
                for (const spr of this.warm) ctx.drawImage(spr.canvas, 0, 0);
                this.warm = null;
            }
            ctx.globalAlpha = 1;
        }
    }

    #freeze(ms) {
        cancelRaf(this.id);
        this.id = 0;
        this.frozen = true;
        this.#render(ms / 1000);
        this.reply({ type: 'frozen' });
    }

    #stop() {
        cancelRaf(this.id);
        this.id = 0;
        this.layers = {};
    }
}

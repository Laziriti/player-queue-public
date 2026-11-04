// ============================================================
// systems/visual-fx.js — Визуальные пост-эффекты (overlay FX)
// ============================================================

import { generateCrack, outlineOf, bboxOf, pathD } from '../../crack-geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

// Один толчок землетрясения: полный цикл анимации vnQuakeBg / vnQuakeSide (с запасом на сдвиг боковых колонок)
const QUAKE_JOLT_MS = 1330;

// Чётное число: нечётные сегменты зеркальные, при нечётном шов на 360° не сойдётся
const KALEIDO_SEGMENTS = 6;
const KALEIDO_SWAY_DEG = 6;   // амплитуда качания картинки в клине
const KALEIDO_SWAY_SEC = 32;  // полный цикл качания
const KALEIDO_SPIN_SEC = 60;  // полный оборот всего калейдоскопа

export class VisualFXSystem {
    constructor() {
        this._overlayEl = null;
        this._kaleidoResize = null;
        this._kaleidoObserver = null;
        this._visual = 'none';
        this._flashInterval = null;
        this._glitchInterval = null;
        this._voidCrackInterval = null;
        this._crackTimeouts = [];
    }

    /**
     * Применить визуальный эффект к overlay
     * @param {HTMLElement} overlayEl — корневой overlay-элемент
     * @param {string} visual — тип визуального эффекта, возможно с вариантом ("noir:blinds", см. VISUAL_VARIANTS)
     */
    apply(overlayEl, visual) {
        this._overlayEl = overlayEl;
        this._visual = visual;

        this.remove();

        const [type, variant] = String(visual || 'none').split(':');
        if (type === 'none') return;

        this._injectSVGFilters();

        overlayEl.classList.add(`vn-vfx-${type}`);
        if (variant) overlayEl.classList.add(`vn-vfx-${type}-${variant}`);
        this._ensureFXLayers(overlayEl);

        switch (type) {
            case 'storm':
                this._startLightning(overlayEl, variant);
                break;
            case 'eldritch':
                this._startGlitch(overlayEl, false);
                break;
            case 'corruption':
                this._startGlitch(overlayEl, true);
                break;
            case 'apocalypse':
                this._startLightning(overlayEl);
                this._startGlitch(overlayEl, false);
                break;
            case 'void_breach':
                this._startVoidBreach(overlayEl, variant);
                break;
            case 'glass_shatter':
                this._startGlassShatter(overlayEl, variant);
                break;
            case 'cosmic_horror':
                this._startCosmicPulse(overlayEl);
                break;
            case 'abyss':
                this._startAbyssPressure(overlayEl);
                break;
            case 'ghosts':
                this._startGhostHaunt(overlayEl);
                break;
            case 'hologram':
                this._startGlitch(overlayEl, false);
                break;
            case 'kaleidoscope':
                this._startKaleidoscope(overlayEl);
                break;
            case 'vhs':
                this._startGlitch(overlayEl, variant === 'chewed');
                break;
            case 'earthquake':
                this._startEarthquake(overlayEl, variant);
                break;
        }
    }

    /**
     * Удалить все визуальные эффекты
     */
    remove() {
        this._stopTimers();

        if (!this._overlayEl) return;

        this._kaleidoObserver?.disconnect();
        this._kaleidoObserver = null;
        this._kaleidoResize?.disconnect();
        this._kaleidoResize = null;
        this._overlayEl.querySelectorAll('.vn-kd-wheel').forEach(el => el.remove());

        // Удалить VFX-классы с overlay
        [...this._overlayEl.classList]
            .filter(c => c.startsWith('vn-vfx-'))
            .forEach(c => this._overlayEl.classList.remove(c));

        // Убрать временные state-классы
        this._overlayEl.classList.remove(
            'vn-void-tear-active', 'vn-glitch-active',
            'vn-gravity-wave', 'vn-pressure-wave', 'vn-quake-active', 'vn-quake-soft'
        );
        this._overlayEl.style.removeProperty('--qs');

        // Убрать animation-state классы с FX-слоёв
        const flashEl = this._overlayEl.querySelector('.vn-fx-flash');
        if (flashEl) flashEl.classList.remove('vn-ghost-presence');

        // Удалить динамически созданные crack-элементы
        this._overlayEl.querySelectorAll('.vn-fx-ray').forEach(el => el.remove());

        // Сбросить ВСЕ инлайновые стили FX-слоёв (они могут быть выставлены JS)
        ['vn-fx-tint', 'vn-fx-rays', 'vn-fx-edges', 'vn-fx-flash', 'vn-fx-scan'].forEach(cls => {
            const el = this._overlayEl.querySelector(`.${cls}`);
            if (el) el.style.cssText = '';
        });

        // Сбросить стили bg-layer
        const bgLayer = this._overlayEl.querySelector('.vn-bg-layer');
        if (bgLayer) {
            bgLayer.style.filter = '';
            bgLayer.style.animation = '';
        }
    }

    /**
     * Полная очистка (при destroy)
     */
    destroy() {
        this.remove();
        this._overlayEl = null;
        this._visual = 'none';
    }

    /**
     * Текущий визуальный эффект
     */
    get current() {
        return this._visual;
    }

    // ─── Private ─────────────────────────────────────────────

    _stopTimers() {
        if (this._flashInterval) {
            clearTimeout(this._flashInterval);
            clearInterval(this._flashInterval);
            this._flashInterval = null;
        }
        if (this._glitchInterval) {
            clearTimeout(this._glitchInterval);
            clearInterval(this._glitchInterval);
            this._glitchInterval = null;
        }
        if (this._voidCrackInterval) {
            clearInterval(this._voidCrackInterval);
            this._voidCrackInterval = null;
        }
        for (const t of this._crackTimeouts) clearTimeout(t);
        this._crackTimeouts = [];
    }

    _ensureFXLayers(overlayEl) {
        const bgLayer = overlayEl.querySelector('.vn-bg-layer');
        const insertRef = bgLayer?.nextSibling || null;

        const layers = ['vn-fx-tint', 'vn-fx-rays', 'vn-fx-edges', 'vn-fx-flash', 'vn-fx-scan'];

        for (const cls of layers) {
            if (!overlayEl.querySelector(`.${cls}`)) {
                const div = document.createElement('div');
                div.className = cls;
                insertRef
                    ? overlayEl.insertBefore(div, insertRef)
                    : overlayEl.prepend(div);
            }
        }
    }

    _injectSVGFilters() {
        if (document.getElementById('vn-svg-filters')) return;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.id = 'vn-svg-filters';
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = `<defs>
            <filter id="vn-distort-wave" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.008" numOctaves="3" seed="5" stitchTiles="stitch" result="noise"/>
                <feOffset in="noise" result="shifted">
                    <animate attributeName="dx" values="0;256;0" dur="20s" repeatCount="indefinite" calcMode="linear"/>
                    <animate attributeName="dy" values="0;128;0" dur="28s" repeatCount="indefinite" calcMode="linear"/>
                </feOffset>
                <feDisplacementMap in="SourceGraphic" in2="shifted" scale="14" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
            <filter id="vn-distort-dream" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0.007 0.005" numOctaves="2" seed="12" stitchTiles="stitch" result="noise"/>
                <feOffset in="noise" result="shifted">
                    <animate attributeName="dx" values="0;150;0" dur="32s" repeatCount="indefinite" calcMode="linear"/>
                    <animate attributeName="dy" values="0;80;0"  dur="44s" repeatCount="indefinite" calcMode="linear"/>
                </feOffset>
                <feDisplacementMap in="SourceGraphic" in2="shifted" scale="8" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
            <filter id="vn-distort-eldritch" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
                <feTurbulence type="turbulence" baseFrequency="0.025 0.020" numOctaves="4" seed="7" stitchTiles="stitch" result="noise"/>
                <feOffset in="noise" result="shifted">
                    <animate attributeName="dx" from="0" to="512" dur="22s" repeatCount="indefinite" calcMode="linear" accumulate="sum"/>
                    <animate attributeName="dy" from="0" to="256" dur="30s" repeatCount="indefinite" calcMode="linear" accumulate="sum"/>
                </feOffset>
                <feDisplacementMap in="SourceGraphic" in2="shifted" scale="18" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
        </defs>`;
        document.body.appendChild(svg);
    }

    // Варианты (VISUAL_VARIANTS.storm): обычная гроза — частые вспышки, иногда двойные; «далёкая» — только зарницы:
    // мягкое свечение в случайном месте неба (CSS читает --bolt-x / --bolt-y); «ночная буря» — молнии реже
    _startLightning(overlayEl, variant = 'all') {
        const flash = overlayEl.querySelector('.vn-fx-flash');
        if (!flash) return;

        if (variant === 'distant') {
            this._flashInterval = setInterval(() => {
                if (Math.random() >= 0.4) return;
                flash.style.setProperty('--bolt-x', `${(8 + Math.random() * 84).toFixed(0)}%`);
                flash.style.setProperty('--bolt-y', `${(6 + Math.random() * 22).toFixed(0)}%`);
                flash.classList.add('vn-lightning-active');
                this._crackTimeouts.push(
                    setTimeout(() => flash.classList.remove('vn-lightning-active'), 1000)
                );
            }, 3500);
            return;
        }

        const chance = variant === 'gale' ? 0.18 : 0.3;
        this._flashInterval = setInterval(() => {
            if (Math.random() >= chance) return;

            flash.classList.add('vn-lightning-active');
            this._crackTimeouts.push(
                setTimeout(() => flash.classList.remove('vn-lightning-active'), 150)
            );

            this._crackTimeouts.push(setTimeout(() => {
                if (Math.random() < 0.5) {
                    flash.classList.add('vn-lightning-active');
                    this._crackTimeouts.push(
                        setTimeout(() => flash.classList.remove('vn-lightning-active'), 100)
                    );
                }
            }, 300));
        }, 3000);
    }

    _startGlitch(overlayEl, intense) {
        const interval = intense ? 2000 : 5000;
        const chance = intense ? 0.5 : 0.2;
        const maxDuration = intense ? 400 : 200;

        this._glitchInterval = setInterval(() => {
            if (Math.random() >= chance) return;

            overlayEl.classList.add('vn-glitch-active');
            this._crackTimeouts.push(setTimeout(
                () => overlayEl.classList.remove('vn-glitch-active'),
                100 + Math.random() * maxDuration
            ));
        }, interval);
    }

    // ─── Void Breach / трещины ───────────────────────────────

    _startVoidBreach(overlayEl, variant = 'all') {
        const style = CRACK_STYLES[variant] ?? CRACK_STYLES.all;
        let phase = 0;
        this._flashInterval = setInterval(() => {
            phase += 0.07;
            const tint = overlayEl.querySelector('.vn-fx-tint');
            if (tint) tint.style.opacity = (0.72 + Math.sin(phase) * 0.16).toFixed(3);
        }, 2000);

        // Каждая трещина сама управляет своей жизнью; интервал лишь подсевает новые
        this._voidCrackInterval = setInterval(() => {
            const active = overlayEl.querySelectorAll('.vn-crack').length;
            const burst = active < 2 ? 2 : 1;
            for (let i = 0; i < burst; i++) this._spawnVoidCrack(overlayEl, i * 250, style);
        }, 3000);

        for (let i = 0; i < 2; i++) {
            const t = setTimeout(() => this._spawnVoidCrack(overlayEl, 0, style), 400 + i * 600);
            this._crackTimeouts.push(t);
        }
    }

    /**
     * Разлом: дерево трещин (crack-geometry.js) из точки удара в обе стороны. Слои одного элемента .vn-crack:
     * мягкое свечение, «окно» — контур раскрытия, обрезающий движущийся фон palette.inner, и тонкая кромка
     * с волосяными трещинками. Рост и закрытие — маска из радиальных градиентов с анимируемыми
     * зарегистрированными свойствами --crack-grow / --crack-heal (CSS в vn-fx-chaos.css): рост идёт от точки
     * удара наружу, закрытие «залечивает» от корня.
     */
    _spawnVoidCrack(overlayEl, extraDelay = 0, style = CRACK_STYLES.all) {
        if (!overlayEl.isConnected) return;

        const W = overlayEl.offsetWidth || 1200;
        const H = overlayEl.offsetHeight || 700;
        const diag = Math.hypot(W, H);
        const sc = Math.max(0.6, H / 1080);

        // Открытых разломов не больше CRACK_MAX, а их суммарный размер укладывается в CRACK_BUDGET: если большому
        // не хватает места, берём поменьше, а если нет места и мелкому — не создаём ничего
        const open = [...overlayEl.querySelectorAll('.vn-crack')];
        if (open.length >= CRACK_MAX) return;
        const free = CRACK_BUDGET - open.reduce((sum, c) => sum + Number(c.dataset.weight || 0), 0);
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
                ? Math.min(...open.map(c => Math.hypot(Number(c.dataset.impactX) - x, Number(c.dataset.impactY) - y)))
                : Infinity;
            if (gap > farthest) { farthest = gap; cx = x; cy = y; }
        }
        // Планы стихий: каждый разлом ведёт в свой мир, по возможности не в тот, что уже открыт
        let plane = null, palette = style.palette;
        if (style.planes) {
            const names = Object.keys(style.planes);
            const taken = new Set(open.map(c => c.dataset.plane));
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
        const ox = box.x, oy = box.y;
        const reach = Math.max(...allPts.map(p => Math.hypot(p.x - cx, p.y - cy))) + 70;

        // Свечение идёт по контуру раскрытия, а не по осевой линии постоянной ширины: у сужающихся концов
        // оно сужается вместе с разломом и не расплывается вокруг тонких мест
        const glow = openings.map(({ poly }) =>
            `<path d="${pathD(poly, ox, oy)}" fill="${palette.glow}" stroke="${palette.glow}" stroke-width="3" stroke-linejoin="round"/>`
        ).join('');
        const rim = openings.map(({ poly }) =>
            `<path d="${pathD(poly, ox, oy)}" fill="none" stroke="${palette.edge}" stroke-width="2.8" stroke-linejoin="round"/>`
        ).join('') + hairs.map(b => {
            const d = pathD(b.pts, ox, oy, false);
            return `<path d="${d}" fill="none" stroke="${palette.edge}" stroke-opacity="0.35" stroke-width="2.6" stroke-linecap="round"/>`
                 + `<path d="${d}" fill="none" stroke="${palette.hair}" stroke-width="1.1" stroke-linecap="round"/>`;
        }).join('');
        const windowD = openings.map(({ poly }) => pathD(poly, ox, oy)).join('');

        const el = document.createElement('div');
        el.className = 'vn-fx-ray vn-crack';
        el.dataset.weight = tier.weight;
        if (plane) el.dataset.plane = plane;
        el.dataset.impactX = cx.toFixed(0);
        el.dataset.impactY = cy.toFixed(0);
        el.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;--cx:${(cx - ox).toFixed(0)}px;--cy:${(cy - oy).toFixed(0)}px;`;
        // Порядок слоёв важен: кромка лежит ПОД окном. Контуры отдельных веток обведены вдвое толще, а окно
        // (объединение всех контуров) перекрывает их изнутри, поэтому остаётся видна только внешняя граница
        // всей структуры, без линий в местах, где ветки сливаются
        el.innerHTML = `<svg class="vn-crack-glow" viewBox="0 0 ${box.w} ${box.h}">${glow}</svg>`
            + `<svg class="vn-crack-rim" viewBox="0 0 ${box.w} ${box.h}">${rim}</svg>`
            + `<div class="vn-crack-window" style="clip-path:path('${windowD}')"><div class="vn-crack-inner" style="background:${palette.inner}"></div></div>`;
        overlayEl.appendChild(el);

        // Чуть быстрее у точки удара, к краям медленнее; мелкий разрыв раскрывается ~1,4 с, огромный ~3 с
        const growMs = Math.max(1400, Math.min(3500, reach * 3.5));
        el.animate(
            [{ '--crack-grow': '0px' }, { '--crack-grow': `${reach.toFixed(0)}px` }],
            { duration: growMs, delay: extraDelay, easing: 'cubic-bezier(0.3, 0.05, 0.3, 1)', fill: 'forwards' }
        );

        this._crackTimeouts.push(setTimeout(
            () => this._crackBirth(overlayEl, cx, cy, openings, reach, growMs, palette), extraDelay
        ));

        const lifetime = 9000 + Math.random() * 7000;
        this._crackTimeouts.push(setTimeout(() => this._closeCrack(el, reach), extraDelay + lifetime));
    }

    // Вспышка в точке удара и искры (пустота) либо крошка (землетрясение) вдоль основных разломов
    _crackBirth(overlayEl, cx, cy, openings, reach, growMs, palette) {
        if (!overlayEl.isConnected) return;

        const flash = document.createElement('div');
        flash.className = 'vn-fx-ray';
        flash.style.cssText = `position:absolute;left:${cx - 140}px;top:${cy - 140}px;width:280px;height:280px;border-radius:50%;`
            + `pointer-events:none;background:radial-gradient(circle, ${palette.flash} 0%, transparent 68%);`;
        overlayEl.appendChild(flash);
        flash.animate(
            [{ opacity: 1, scale: '0.3' }, { opacity: 0, scale: '1.5' }],
            { duration: 520, easing: 'ease-out' }
        ).addEventListener('finish', () => flash.remove());

        const main = openings.filter(o => o.b.depth <= 1).flatMap(o => o.b.pts);
        if (!main.length) return;
        const count = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const pt = main[Math.floor(Math.random() * main.length)];
            const spark = document.createElement('div');
            const size = 2 + Math.random() * 2.5;
            spark.className = 'vn-fx-ray';
            spark.style.cssText = `position:absolute;left:${pt.x}px;top:${pt.y}px;width:${size}px;height:${size}px;border-radius:50%;`
                + `pointer-events:none;background:${palette.debris.color};box-shadow:0 0 6px ${palette.debris.color};`;
            overlayEl.appendChild(spark);
            // Искра вылетает, когда рост доходит до её места
            const delay = (Math.hypot(pt.x - cx, pt.y - cy) / reach) * growMs;
            spark.animate(
                [
                    { opacity: 0, translate: '0 0' },
                    { opacity: 1, translate: `${((Math.random() - 0.5) * 14).toFixed(0)}px ${(palette.debris.dir * 10).toFixed(0)}px`, offset: 0.15 },
                    { opacity: 0, translate: `${((Math.random() - 0.5) * 40).toFixed(0)}px ${(palette.debris.dir * (35 + Math.random() * 60)).toFixed(0)}px` },
                ],
                { duration: 800 + Math.random() * 700, delay, easing: 'ease-out' }
            ).addEventListener('finish', () => spark.remove());
        }
    }

    // Закрытие: трещина затягивается от точки удара наружу (маска --crack-heal), затем исчезает
    _closeCrack(el, reach) {
        if (!el.isConnected) return;
        const dur = 1300 + Math.random() * 600;
        el.animate(
            [{ '--crack-heal': '-60px' }, { '--crack-heal': `${reach.toFixed(0)}px` }],
            { duration: dur, easing: 'cubic-bezier(0.45, 0, 0.9, 0.6)', fill: 'forwards' }
        ).addEventListener('finish', () => el.remove());
    }

    // ─── Glass Shatter ───────────────────────────────────────

    // Варианты (VISUAL_VARIANTS.glass_shatter): осколки по всему кадру или только вокруг удара + длинные трещины
    _startGlassShatter(overlayEl, variant = 'all') {
        const bgLayer  = overlayEl.querySelector('.vn-bg-layer');
        let bgImage = 'none';
        if (bgLayer) {
            bgImage = bgLayer.style.backgroundImage
                || window.getComputedStyle(bgLayer).backgroundImage
                || 'none';
        }

        const container = document.createElement('div');
        container.className = 'vn-fx-ray vn-glass-container';
        overlayEl.appendChild(container);

        const W = overlayEl.offsetWidth  || 1200;
        const H = overlayEl.offsetHeight || 700;
        this._generateGlassShards(container, bgImage, W, H, variant === 'center');
    }

    _generateGlassShards(container, bgImage, W, H, centerOnly = false) {
        const cx   = W * (0.46 + Math.random() * 0.08);
        const cy   = H * (0.46 + Math.random() * 0.08);
        const N    = centerOnly ? 9 : 10 + Math.floor(Math.random() * 3);
        const diag = Math.sqrt(W * W + H * H);
        const Nf   = N * 2;

        const ringK = centerOnly ? 0.72 : 1;
        const ringR = [
            diag * (0.13 + Math.random() * 0.04) * ringK,
            diag * (0.28 + Math.random() * 0.06) * ringK,
            diag * (0.50 + Math.random() * 0.08),
            diag * 1.05,
        ];

        // Each ring boundary has its own independent angles — inner/outer edges of
        // each shard are NOT on the same radii, giving truly irregular quadrilaterals
        const mkAng = (count, jitter) =>
            Array.from({ length: count }, (_, i) =>
                (2 * Math.PI * i / count) + (Math.random() - 0.5) * (2 * Math.PI / count) * jitter
            ).sort((a, b) => a - b);

        const bHole = mkAng(Nf, 0.55);
        const bR0   = mkAng(Nf, 0.55);
        const bR1   = mkAng(Nf, 0.50);
        const bR2   = mkAng(N,  0.45);
        const bR3   = mkAng(N,  0.40);

        const onRing = (ang, rIdx, ai) => {
            const a = ang[((ai % ang.length) + ang.length) % ang.length];
            return { x: cx + Math.cos(a) * ringR[rIdx], y: cy + Math.sin(a) * ringR[rIdx] };
        };

        // Hole polygon using bHole angles
        const holeBaseR = diag * (0.04 + Math.random() * 0.02);
        const holePts   = bHole.map(a => {
            const r = holeBaseR * (0.55 + Math.random() * 0.9);
            return {
                x: cx + Math.cos(a + (Math.random() - 0.5) * 0.25) * r,
                y: cy + Math.sin(a + (Math.random() - 0.5) * 0.25) * r,
            };
        });

        // Helper: emit shard, randomly splitting quads diagonally for inner rings
        const emit = (pts, depth, canSplit = false) => {
            if (canSplit && Math.random() < 0.38) {
                const [p0, p1, p2, p3] = pts;
                if (Math.random() < 0.5) {
                    this._makeGlassShard(container, [p0, p1, p2], bgImage, depth, cx, cy);
                    this._makeGlassShard(container, [p0, p2, p3], bgImage, depth, cx, cy);
                } else {
                    this._makeGlassShard(container, [p0, p1, p3], bgImage, depth, cx, cy);
                    this._makeGlassShard(container, [p1, p2, p3], bgImage, depth, cx, cy);
                }
            } else {
                this._makeGlassShard(container, pts, bgImage, depth, cx, cy);
            }
        };

        // Inner ring (hole → bR0): angles differ → irregular quads, 38% split
        for (let i = 0; i < Nf; i++) {
            emit([
                holePts[i], holePts[(i + 1) % Nf],
                onRing(bR0, 0, (i + 1) % Nf), onRing(bR0, 0, i),
            ], 0.10, true);
        }

        // Second ring (bR0 → bR1): same approach
        for (let i = 0; i < Nf; i++) {
            emit([
                onRing(bR0, 0, i), onRing(bR0, 0, (i + 1) % Nf),
                onRing(bR1, 1, (i + 1) % Nf), onRing(bR1, 1, i),
            ], 0.35, true);
        }

        if (centerOnly) {
            // Скол ограничен двумя внутренними кольцами; за его границей кадр цел, а щели между осколками чернит подложка
            const dark = 'rgba(4, 8, 16, 0.85)';
            const r0 = ringR[1] * 0.9, r1 = ringR[1] * 1.08;
            container.style.background = `radial-gradient(circle at ${cx.toFixed(0)}px ${cy.toFixed(0)}px, ${dark} 0, ${dark} ${r0.toFixed(0)}px, transparent ${r1.toFixed(0)}px)`;
            container.appendChild(this._glassCracks(W, H, cx, cy, ringR[1], diag));
            return;
        }

        // Transition ring (bR1 → bR2): bridge fine→coarse, each coarse shard spans 2 fine points
        for (let i = 0; i < N; i++) {
            emit([
                onRing(bR1, 1, 2 * i), onRing(bR1, 1, (2 * i + 2) % Nf),
                onRing(bR2, 2, (i + 1) % N), onRing(bR2, 2, i),
            ], 0.65);
        }

        // Outer ring (bR2 → bR3)
        for (let i = 0; i < N; i++) {
            emit([
                onRing(bR2, 2, i), onRing(bR2, 2, (i + 1) % N),
                onRing(bR3, 3, (i + 1) % N), onRing(bR3, 3, i),
            ], 0.90);
        }
    }

    // Длинные ломаные трещины от центра сквозь кольцо осколков и дальше по целому стеклу, с короткими ответвлениями
    _glassCracks(W, H, cx, cy, startR, diag) {
        const rays = 9 + Math.floor(Math.random() * 4);
        const paths = [];
        for (let i = 0; i < rays; i++) {
            let ang = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            let r = startR * (0.55 + Math.random() * 0.25);
            const len = diag * (0.34 + Math.random() * 0.3);
            let x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
            let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
            const end = r + len;
            while (r < end) {
                const step = 38 + Math.random() * 55;
                r += step;
                ang += (Math.random() - 0.5) * 0.16;
                x = cx + Math.cos(ang) * r;
                y = cy + Math.sin(ang) * r;
                d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
                if (Math.random() < 0.22) {
                    const ba = ang + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
                    const bl = 30 + Math.random() * 90;
                    paths.push(`M${x.toFixed(1)} ${y.toFixed(1)} L${(x + Math.cos(ba) * bl).toFixed(1)} ${(y + Math.sin(ba) * bl).toFixed(1)}`);
                }
            }
            paths.push(d);
        }
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'vn-glass-cracks');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        for (const cls of ['vn-crack-dark', 'vn-crack-light']) {
            for (const d of paths) {
                const p = document.createElementNS(SVG_NS, 'path');
                p.setAttribute('class', cls);
                p.setAttribute('d', d);
                svg.appendChild(p);
            }
        }
        return svg;
    }

    // Shrinks each polygon vertex toward its centroid by `px` pixels
    _insetPolygon(points, px) {
        const n   = points.length;
        const gcx = points.reduce((s, p) => s + p.x, 0) / n;
        const gcy = points.reduce((s, p) => s + p.y, 0) / n;
        return points.map(p => {
            const dx = p.x - gcx, dy = p.y - gcy;
            const d  = Math.sqrt(dx * dx + dy * dy);
            if (d < px) return { x: gcx, y: gcy };
            return { x: gcx + dx * (d - px) / d, y: gcy + dy * (d - px) / d };
        });
    }

    _makeGlassShard(container, points, bgImage, depthFactor = 0.5, impactX = 0, impactY = 0) {
        // Explicit gap between shards: inset each polygon toward its centroid
        const insetPx = 5 + depthFactor * 8;
        const inset   = this._insetPolygon(points, insetPx);
        const clip    = `polygon(${inset.map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(', ')})`;

        // Per-shard light direction: glint angle depends on shard position vs impact
        const scx        = inset.reduce((s, p) => s + p.x, 0) / inset.length;
        const scy        = inset.reduce((s, p) => s + p.y, 0) / inset.length;
        const shineAngle = ((Math.atan2(scy - impactY, scx - impactX) * 180 / Math.PI) - 50 + 360) % 360;

        // Outer shards tilt and wobble more than inner ones
        const amp = 0.4 + depthFactor * 2.0;
        const rx  = (Math.random() - 0.5) * 22 * amp;
        const ry  = (Math.random() - 0.5) * 22 * amp;
        const rz  = (Math.random() - 0.5) * 6  * amp;
        const tz  = (Math.random() - 0.5) * 18 * amp;
        const drx = (Math.random() - 0.5) * 6  * amp;
        const dry = (Math.random() - 0.5) * 6  * amp;
        const drz = (Math.random() - 0.5) * 2.5 * amp;
        const dtz = (Math.random() - 0.5) * 8  * amp;

        const dur   = 8000 + Math.random() * 10000;
        const delay = -(Math.random() * 18000);

        const t0 = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) translateZ(${tz.toFixed(2)}px)`;
        const t1 = `perspective(900px) rotateX(${(rx+drx).toFixed(2)}deg) rotateY(${(ry+dry).toFixed(2)}deg) rotateZ(${(rz+drz).toFixed(2)}deg) translateZ(${(tz+dtz).toFixed(2)}px)`;

        const div = document.createElement('div');
        div.className = 'vn-glass-shard';
        div.style.clipPath = clip;
        div.style.setProperty('--shard-shine', `${shineAngle.toFixed(0)}deg`);
        if (bgImage !== 'none') div.style.backgroundImage = bgImage;

        container.appendChild(div);

        div.animate(
            [{ transform: t0 }, { transform: t1 }, { transform: t0 }],
            { duration: dur, delay, iterations: Infinity, easing: 'ease-in-out' }
        );
    }

    // ─── Cosmic Horror ───────────────────────────────────────

    _startCosmicPulse(overlayEl) {
        let cosmicPhase = 0;
        const tint = overlayEl.querySelector('.vn-fx-tint');

        this._flashInterval = setInterval(() => {
            if (!tint) return;
            cosmicPhase += 0.08;
            tint.style.opacity = (0.6 + Math.sin(cosmicPhase) * 0.2).toFixed(3);
        }, 1500);

        this._glitchInterval = setInterval(() => {
            if (Math.random() >= 0.4) return;
            overlayEl.classList.add('vn-gravity-wave');
            this._crackTimeouts.push(
                setTimeout(() => overlayEl.classList.remove('vn-gravity-wave'), 3000)
            );
        }, 10000);
    }

    // ─── Earthquake ──────────────────────────────────────────

    // Класс .vn-quake-active трясёт фон и персонажей (CSS); с потолка сыплются обломки и крошка.
    // Два варианта (VISUAL_VARIANTS.earthquake): «Толчки» — случайные события с паузами, «Непрерывная» —
    // ровная дрожь без остановок (её анимация — в .vn-vfx-earthquake-constant).
    _startEarthquake(overlayEl, variant = 'all') {
        if (variant === 'constant') {
            overlayEl.classList.add('vn-quake-active');
            const rain = () => {
                this._glitchInterval = setTimeout(() => {
                    this._spawnQuakeDebris(overlayEl, 1500, 0.35);
                    rain();
                }, 1200 + Math.random() * 2300);
            };
            rain();
            return;
        }

        const later = (fn, ms) => this._crackTimeouts.push(setTimeout(fn, ms));
        // `restart`: сбросить анимацию, чтобы новый удар начался с рывка, а не продолжил предыдущий
        const jolt = (strength, restart) => {
            overlayEl.style.setProperty('--qs', strength.toFixed(2));
            overlayEl.classList.remove('vn-quake-soft');
            if (restart) {
                overlayEl.classList.remove('vn-quake-active');
                void overlayEl.offsetWidth;
            }
            overlayEl.classList.add('vn-quake-active');
        };

        // Событие случайного вида; следующее наступает после паузы, отсчитанной от конца этого, поэтому они не накладываются
        const schedule = delay => {
            this._glitchInterval = setTimeout(() => {
                const roll = Math.random();
                let total;

                if (roll < 0.4) {
                    // Один толчок
                    jolt(0.7 + Math.random() * 0.7, false);
                    this._spawnQuakeDebris(overlayEl, QUAKE_JOLT_MS, 0.5);
                    total = QUAKE_JOLT_MS;
                } else if (roll < 0.75) {
                    // Несколько ударов подряд, с короткими разрывами между ними
                    const hits = 2 + Math.floor(Math.random() * 3);
                    let at = 0;
                    for (let i = 0; i < hits; i++) {
                        const strength = 0.6 + Math.random() * 0.9;
                        later(() => { jolt(strength, true); this._spawnQuakeDebris(overlayEl, QUAKE_JOLT_MS, 0.4); }, at);
                        at += i < hits - 1 ? 350 + Math.random() * 900 : QUAKE_JOLT_MS;
                    }
                    total = at;
                } else {
                    // Затяжное землетрясение: несколько циклов подряд, к концу слабеет
                    total = 3000 + Math.random() * 2500;
                    jolt(0.9 + Math.random() * 0.4, false);
                    later(() => overlayEl.classList.add('vn-quake-soft'), total - 700);
                    this._spawnQuakeDebris(overlayEl, total, 1);
                }

                later(() => overlayEl.classList.remove('vn-quake-active', 'vn-quake-soft'), total);
                // Чаще короткая передышка, иногда долгое затишье
                schedule(total + (Math.random() < 0.35 ? 1200 + Math.random() * 1800 : 3500 + Math.random() * 7000));
            }, delay);
        };
        schedule(1500);
    }

    // Обломки и крошка с потолка: сыплются из 2–3 мест (как из трещин в перекрытии), падают с ускорением
    // и кувыркаются. Пока идёт серия, их становится меньше к концу — так же, как слабеют толчки.
    // `amount` — доля от полной «порции» (одиночному толчку хватает половины)
    _spawnQuakeDebris(overlayEl, duration, amount = 1) {
        const W = overlayEl.offsetWidth  || 1200;
        const H = overlayEl.offsetHeight || 700;
        const sources = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => (0.08 + Math.random() * 0.84) * W);
        const count = Math.max(4, Math.round((18 + Math.floor(Math.random() * 10)) * amount));

        for (let i = 0; i < count; i++) {
            const dust = Math.random() < 0.55;
            const size = dust ? 2 + Math.random() * 3 : 5 + Math.random() * 9;
            const x = sources[i % sources.length] + (Math.random() + Math.random() - 1) * 90;

            const el = document.createElement('div');
            el.className = dust ? 'vn-fx-ray vn-quake-debris vn-quake-dust' : 'vn-fx-ray vn-quake-debris';
            el.style.cssText = `left:${x.toFixed(0)}px;top:${-size - 4}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;`;
            if (!dust) {
                // Неровный камешек: 5–7 вершин на окружности со случайным радиусом
                const n = 5 + Math.floor(Math.random() * 3);
                const pts = Array.from({ length: n }, (_, k) => {
                    const a = (k / n + (Math.random() - 0.5) * 0.3 / n) * Math.PI * 2;
                    const r = 32 + Math.random() * 18;
                    return `${(50 + Math.cos(a) * r).toFixed(0)}% ${(50 + Math.sin(a) * r).toFixed(0)}%`;
                });
                el.style.clipPath = `polygon(${pts.join(',')})`;
            }
            overlayEl.appendChild(el);

            // Падение с ускорением: время растёт как корень из высоты, кривая — ease-in (квадратичная)
            const fall = H * (0.6 + Math.random() * 0.5);
            const fallMs = 650 * Math.sqrt(fall / 400) * (dust ? 1.35 : 1);
            const delay = Math.pow(Math.random(), 1.6) * Math.max(0, duration - 500);
            const spin = (Math.random() - 0.5) * (dust ? 0 : 720);
            el.animate(
                [
                    { translate: '0 0', rotate: '0deg', opacity: 1 },
                    { opacity: 1, offset: 0.85 },
                    { translate: `${((Math.random() - 0.5) * 50).toFixed(0)}px ${fall.toFixed(0)}px`, rotate: `${spin.toFixed(0)}deg`, opacity: 0 },
                ],
                { duration: fallMs, delay, easing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', fill: 'backwards' }
            ).addEventListener('finish', () => el.remove());
        }
    }

    // ─── Kaleidoscope ────────────────────────────────────────

    // Сегменты живут внутри каждого .vn-bg-layer (картинку они берут через CSS inherit), поэтому переходы фонов,
    // параллакс и смена картинки работают сами. Новые слои переходов наполняем через MutationObserver.
    _startKaleidoscope(overlayEl) {
        overlayEl.querySelectorAll('.vn-bg-layer').forEach(layer => this._fillKaleidoscope(layer));

        this._kaleidoObserver = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1 && node.classList.contains('vn-bg-layer')) this._fillKaleidoscope(node);
                }
            }
        });
        this._kaleidoObserver.observe(overlayEl, { childList: true });

        // Клин и зум зависят от размера слоя — пересчитываем при ресайзе окна
        this._kaleidoResize = new ResizeObserver(() => {
            overlayEl.querySelectorAll('.vn-bg-layer').forEach(layer => this._sizeKaleidoscope(layer));
        });
        this._kaleidoResize.observe(overlayEl);
    }

    _fillKaleidoscope(layer) {
        if (layer.querySelector(':scope > .vn-kd-wheel')) return;

        const step = 360 / KALEIDO_SEGMENTS;

        // Общая фаза у всех слоёв, иначе при переходе фона картинка «прыгнет»
        const now = performance.now() / 1000;
        const swayDelay = -(now % KALEIDO_SWAY_SEC);
        const wheel = document.createElement('div');
        wheel.className = 'vn-kd-wheel';
        wheel.style.animationDuration = `${KALEIDO_SPIN_SEC}s`;
        wheel.style.animationDelay = `${(-(now % KALEIDO_SPIN_SEC)).toFixed(2)}s`;

        // Исток — клин шириной step вокруг оси +X (вдоль длинной стороны кадра). Его копия k ложится в сектор
        // вокруг k*step: чётные — поворотом, нечётные — отражением относительно оси k*step/2
        for (let k = 0; k < KALEIDO_SEGMENTS; k++) {
            const axis = k * step / 2;
            const seg = document.createElement('div');
            seg.className = 'vn-kd-seg';
            seg.style.transform = k % 2 === 0
                ? `rotate(${k * step}deg)`
                : `rotate(${axis}deg) scaleY(-1) rotate(${-axis}deg)`;
            seg.style.setProperty('--kd-sway', `${KALEIDO_SWAY_DEG}deg`);

            const img = document.createElement('div');
            img.className = 'vn-kd-img';
            img.style.animationDuration = `${KALEIDO_SWAY_SEC}s`;
            img.style.animationDelay = `${swayDelay.toFixed(2)}s`;
            seg.appendChild(img);
            wheel.appendChild(seg);
        }
        layer.appendChild(wheel);

        this._sizeKaleidoscope(layer);
    }

    _sizeKaleidoscope(layer) {
        const w = layer.offsetWidth;
        const h = layer.offsetHeight;
        if (!w || !h) return;

        const half = Math.PI / KALEIDO_SEGMENTS;
        const overlap = 0.007; // нахлёст клиньев (рад), чтобы по швам не просвечивал фон слоя
        const reach = Math.hypot(w, h);
        const far = a => `${(w / 2 + reach * Math.cos(a)).toFixed(1)}px ${(h / 2 + reach * Math.sin(a)).toFixed(1)}px`;
        const wedge = `polygon(${w / 2}px ${h / 2}px, ${far(-half - overlap)}, ${far(half + overlap)})`;
        const zoom = this._kaleidoZoom(w, h).toFixed(3);

        for (const seg of layer.querySelectorAll('.vn-kd-seg')) {
            seg.style.clipPath = wedge;
            seg.style.setProperty('--kd-zoom', zoom);
        }
    }

    /**
     * Минимальный зум картинки в клине, при котором во всех копиях нет пустых мест.
     * Колесо вращается целиком, поэтому любая точка кадра рано или поздно попадает в любое место клина:
     * достаточно, чтобы картинка покрывала весь исходный сектор на радиусе до угла кадра (с обеими
     * ориентациями — копии бывают зеркальными) при крайних углах качания.
     */
    _kaleidoZoom(w, h) {
        const half = Math.PI / KALEIDO_SEGMENTS;
        const sway = KALEIDO_SWAY_DEG * Math.PI / 180;
        const hw = w / 2, hh = h / 2;
        const reach = Math.hypot(hw, hh);
        const samples = 24;
        let need = 1;

        for (let i = 0; i <= samples; i++) {
            const a = -half + 2 * half * i / samples;
            for (const s of [sway, -sway]) {
                const px = reach * Math.cos(a), py = reach * Math.sin(a);
                const ix = px * Math.cos(s) + py * Math.sin(s);
                const iy = -px * Math.sin(s) + py * Math.cos(s);
                need = Math.max(need, Math.abs(ix) / hw, Math.abs(iy) / hh);
            }
        }
        return Math.max(1.05, need * 1.06);
    }

    // ─── Ghosts ──────────────────────────────────────────────

    _startGhostHaunt(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');
        if (!flash) return;

        const scheduleHaunt = () => {
            this._flashInterval = setTimeout(() => {
                if (!flash.classList.contains('vn-ghost-presence')) {
                    const x = 12 + Math.random() * 76;
                    const y =  8 + Math.random() * 62;
                    flash.style.setProperty('--ghost-x', `${x.toFixed(1)}%`);
                    flash.style.setProperty('--ghost-y', `${y.toFixed(1)}%`);
                    flash.classList.add('vn-ghost-presence');
                    // Remove after animation completes (animation is 8s)
                    this._crackTimeouts.push(
                        setTimeout(() => flash.classList.remove('vn-ghost-presence'), 8500)
                    );
                }
                scheduleHaunt();
            }, 7000 + Math.random() * 9000);
        };
        scheduleHaunt();
    }

    // ─── Abyss ───────────────────────────────────────────────

    _startAbyssPressure(overlayEl) {
        const flash = overlayEl.querySelector('.vn-fx-flash');

        const schedulePressure = () => {
            this._flashInterval = setTimeout(() => {
                overlayEl.classList.add('vn-pressure-wave');
                this._crackTimeouts.push(
                    setTimeout(() => overlayEl.classList.remove('vn-pressure-wave'), 2500)
                );
                schedulePressure();
            }, 6000 + Math.random() * 4000);
        };
        schedulePressure();

        const scheduleBiolum = () => {
            this._glitchInterval = setTimeout(() => {
                if (Math.random() < 0.4 && flash) {
                    const x = 15 + Math.random() * 70;
                    const y = 20 + Math.random() * 60;
                    flash.style.setProperty('--biolum-x', `${x}%`);
                    flash.style.setProperty('--biolum-y', `${y}%`);
                    flash.style.setProperty('--biolum-hue', `${160 + Math.random() * 40}`);
                    flash.classList.add('vn-biolum-flash');
                    this._crackTimeouts.push(
                        setTimeout(() => flash.classList.remove('vn-biolum-flash'), 2000 + Math.random() * 1500)
                    );
                }
                scheduleBiolum();
            }, 5000 + Math.random() * 3000);
        };
        scheduleBiolum();
    }
}

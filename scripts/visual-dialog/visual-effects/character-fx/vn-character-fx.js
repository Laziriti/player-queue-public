// ============================================================
// vn-character-fx.js — эффекты самого портрета персонажа (голограмма, тень, огонь, лёд, стекло…)
// Не связан с атмосферой сцены (частицы / visual FX): отдельное поле состояния, отдельный CSS.
// ============================================================

import { escapeHtml } from '../../vn-id-utils.js';
import { generateCrack, outlineOf, pathD } from '../crack-geometry.js';
import { isFxDisabled } from '../fx-performance.js';

/**
 * Эффекты по группам — в таком виде их показывает меню выбора. Группа 'svg' — эффекты на SVG-фильтрах
 * (feTurbulence / feDisplacementMap): заметно тяжелее для процессора, поэтому в меню они отделены.
 */
export const CHAR_FX_GROUPS = [
    {
        id: 'css',
        fx: [
            'none', 'hologram', 'shadow', 'ghost', 'glitch',
            'fire', 'ice', 'gold', 'stone', 'cracked', 'glass', 'xray', 'memory', 'dream',
            'noir', 'neon', 'invisible', 'rage', 'possessed', 'drunk', 'holy',
        ],
    },
    { id: 'svg', fx: ['vhs'] },
];

/**
 * Подварианты эффекта — в меню выбора тип раскрывается списком (как подтемы частиц и визуальных эффектов).
 * Каждый вариант — самостоятельный id эффекта (так он и хранится в state.charFx); первый — сам базовый тип.
 */
export const CHAR_FX_VARIANTS = {
    holy: [
        { id: 'holy',         label: 'vn.charFx.variants.normal' },
        { id: 'holy_radiant', label: 'vn.charFx.variants.exalted' },
    ],
};

export const CHAR_FX = CHAR_FX_GROUPS.flatMap(g => g.fx.flatMap(id => CHAR_FX_VARIANTS[id]?.map(v => v.id) ?? [id]));

/** Базовый тип для варианта ('holy_radiant' → 'holy'); не вариант — сам id. */
export function charFxBase(fx) {
    return Object.keys(CHAR_FX_VARIANTS).find(base => CHAR_FX_VARIANTS[base].some(v => v.id === fx)) ?? fx;
}

export const CHAR_FX_ICONS = {
    none: 'fa-wand-magic-sparkles',
    hologram: 'fa-cube',
    shadow: 'fa-moon',
    ghost: 'fa-ghost',
    glitch: 'fa-bolt',
    fire: 'fa-fire',
    ice: 'fa-snowflake',
    gold: 'fa-crown',
    stone: 'fa-mountain',
    cracked: 'fa-hammer',
    glass: 'fa-gem',
    xray: 'fa-x-ray',
    memory: 'fa-clock-rotate-left',
    dream: 'fa-cloud',
    noir: 'fa-film',
    neon: 'fa-lightbulb',
    invisible: 'fa-eye-slash',
    rage: 'fa-face-angry',
    possessed: 'fa-skull',
    drunk: 'fa-wine-bottle',
    holy: 'fa-hands-praying',
    holy_radiant: 'fa-sun',
    vhs: 'fa-tape',
};

const CLASS = 'vn-character-fx';
const SHARD_CLASS = 'vn-fx-shard';
const GLOSS_CLASS = 'vn-fx-shard-gloss';
const HOLY_CLASS = 'vn-fx-holy';
const SVG_NS = 'http://www.w3.org/2000/svg';
const FILTERS_ID = 'vn-charfx-filters';
const SVG_FX = new Set(CHAR_FX_GROUPS.find(g => g.id === 'svg').fx);

function absUrl(src) {
    let abs = String(src ?? '');
    try { abs = new URL(abs, document.baseURI).href; } catch { /* keep as is */ }
    return abs;
}

/** Absolute CSS url() for a mask/background copy of the portrait (a relative path would resolve against the stylesheet). */
function cssUrl(src) {
    return `url("${absUrl(src).replace(/["\\\r\n]/g, encodeURIComponent)}")`;
}

function svgUrl(svg) {
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Детерминированный ГСЧ от адреса портрета: узор трещин и осколков не меняется от обновления к обновлению сцены
// и одинаков на всех клиентах
function seededRandom(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const fmt = n => n.toFixed(2);
const pointsAttr = poly => poly.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');

/**
 * Трещины для эффекта «Треснувший камень»: дерево разломов из crack-geometry.js (сужающиеся раскрытия + волосяные
 * трещинки) в координатах 100×200 — типичная пропорция портрета; картинка растягивается на весь слой.
 */
function crackStyle(key) {
    const rnd = seededRandom(`crack|${key}`);
    const box = { w: 100, h: 200 };
    const openings = [], hairs = [];
    const main = 3 + Math.floor(rnd() * 2);
    for (let c = 0; c < main; c++) {
        const crack = generateCrack(rnd, {
            x: 20 + rnd() * 60, y: 14 + rnd() * 140, angle: rnd() * Math.PI * 2,
            length: 60 + rnd() * 60, width: 2.6 + rnd() * 1.4, maxDepth: 2, step: 9, bounds: box,
        });
        for (const b of crack.branches) {
            const poly = outlineOf(b, rnd);
            if (poly) openings.push(pathD(poly));
            else hairs.push(pathD(b.pts, 0, 0, false));
        }
    }
    const hair = hairs.join('');
    const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 200" preserveAspectRatio="none">`
        // Сначала кромка вдвое толще, затем заливка поверх: внутренние линии в местах слияния веток закрываются,
        // остаётся только внешняя граница всей структуры
        + `<path d="${openings.join('')}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
        + `<path d="${hair}" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
        + `<path d="${hair}" fill="none" stroke="rgba(8,6,4,0.9)" stroke-width="1.1" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
        + `<path d="${openings.join('')}" fill="rgba(8,6,4,0.92)"/></svg>`;
    return svgUrl(svg);
}

/**
 * Осколки для эффекта «Стекло». Удар приходится в случайную точку корпуса: от неё расходятся лучи, а кольца
 * (хаб → середина → край) делят картинку на неправильные четырёхугольники, часть из них — на два треугольника.
 * Общие рёбра соседних осколков берутся из одних и тех же точек, поэтому щелей между ними нет, пока осколки не сдвинуты.
 * Возвращает осколки: контур в процентах, поза, длительность покачивания и SVG-грань (`facet`) для слоя блика.
 */
function glassShards(key) {
    const rnd = seededRandom(`glass|${key}`);
    const cx = 40 + rnd() * 20, cy = 24 + rnd() * 22;
    const N = 6;
    const radii = [9 + rnd() * 5, 24 + rnd() * 9, 160];

    const ring = (r, jitter) => {
        const angles = Array.from({ length: N }, (_, i) => (i / N + (rnd() - 0.5) * jitter / N) * Math.PI * 2).sort((a, b) => a - b);
        return angles.map(a => [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.6]);
    };
    const rings = [ring(radii[0], 0.6), ring(radii[1], 0.5), ring(radii[2], 0.4)];

    const polys = [rings[0]];
    for (let r = 0; r < 2; r++) {
        for (let i = 0; i < N; i++) {
            const j = (i + 1) % N;
            const quad = [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]];
            if (r === 0 && rnd() < 0.35) {
                polys.push([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]);
            } else {
                polys.push(quad);
            }
        }
    }

    // Небольшой зазор между осколками: каждую вершину подтягиваем к центру осколка
    const inset = (poly, px) => {
        const gx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
        const gy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        return poly.map(([x, y]) => {
            const dx = x - gx, dy = y - gy, d = Math.hypot(dx, dy);
            return d < px ? [gx, gy] : [gx + dx * (d - px) / d, gy + dy * (d - px) / d];
        });
    };

    const shards = polys.map(poly => {
        const clip = inset(poly, 0.8);
        const gx = clip.reduce((s, p) => s + p[0], 0) / clip.length;
        const gy = clip.reduce((s, p) => s + p[1], 0) / clip.length;
        // Чем дальше от удара, тем сильнее осколок повело
        const amp = 0.6 + Math.min(1, Math.hypot(gx - cx, (gy - cy) / 1.6) / 60) * 1.8;
        const pose = k => {
            const tilt = () => ((rnd() - 0.5) * 11 * amp).toFixed(2);
            return `translate(${((rnd() - 0.5) * 1.8 * amp * k).toFixed(2)}%, ${((rnd() - 0.5) * 1.1 * amp * k).toFixed(2)}%) `
                + `perspective(900px) rotateX(${tilt()}deg) rotateY(${tilt()}deg) rotate(${((rnd() - 0.5) * 2.6 * amp).toFixed(2)}deg)`;
        };
        return {
            clip: `polygon(${clip.map(([x, y]) => `${fmt(x)}% ${fmt(y)}%`).join(', ')})`,
            origin: `${fmt(gx)}% ${fmt(gy)}%`,
            t0: pose(1), t1: pose(1.6),
            dur: 7 + rnd() * 7, delay: -rnd() * 12,
            poly: clip,
        };
    });

    // Грань каждого осколка — своя SVG-картинка (слабый блик или затемнение, по краю светлая кромка): она лежит
    // на слое блика этого осколка и двигается вместе с ним
    for (const s of shards) {
        const light = rnd() < 0.7;
        const fill = light ? `rgba(255,255,255,${(0.03 + rnd() * 0.16).toFixed(2)})` : `rgba(10,40,70,${(0.04 + rnd() * 0.12).toFixed(2)})`;
        s.facet = svgUrl(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" preserveAspectRatio="none">`
            + `<polygon points="${pointsAttr(s.poly)}" fill="${fill}" stroke="rgba(235,248,255,0.6)" stroke-width="0.7" vector-effect="non-scaling-stroke"/></svg>`);
    }

    return shards;
}

export class VNCharFx {
    /** Keeps only known effects; 'none' is never stored (sparse map, like visibility). */
    static normalize(map) {
        const out = {};
        if (!map || typeof map !== 'object') return out;
        for (const [tokenId, fx] of Object.entries(map)) {
            if (fx !== 'none' && CHAR_FX.includes(fx)) out[tokenId] = fx;
        }
        return out;
    }

    /**
     * SVG-фильтры эффектов из группы 'svg'. Вставляются в документ один раз; `filter: url(#…)` в CSS ссылается на них.
     * VHS: строчные сдвиги идут от шума, растянутого по горизонтали (baseFrequency «0 y»), поэтому смещаются целые
     * строки, а таблица в feComponentTransfer оставляет лишь редкие полосы со сдвигом; редкие сильные «срывы» задаёт
     * скачущий scale; каналы R и B разнесены в стороны.
     */
    static ensureFilters() {
        if (document.getElementById(FILTERS_ID)) return;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.id = FILTERS_ID;
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = `<defs>
            <filter id="vn-fx-vhs" x="-6%" y="-2%" width="112%" height="104%" color-interpolation-filters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0 0.32" numOctaves="1" seed="7" result="noise"/>
                <feOffset in="noise" result="rows">
                    <animate attributeName="dy" from="0" to="320" dur="7s" repeatCount="indefinite" calcMode="linear"/>
                </feOffset>
                <feColorMatrix in="rows" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1" result="rowsX"/>
                <feComponentTransfer in="rowsX" result="bands">
                    <feFuncR type="table" tableValues="0.5 0.5 0.5 0.5 0.5 0.5 0.9 0.5 0.5 0.5 0.1 0.5 0.5 0.5 0.5 0.5"/>
                </feComponentTransfer>
                <feDisplacementMap in="SourceGraphic" in2="bands" scale="3" xChannelSelector="R" yChannelSelector="G" result="torn">
                    <animate attributeName="scale" values="3;3;3;30;6;3;3;3;3;22;4;3" keyTimes="0;0.2;0.4;0.41;0.45;0.5;0.7;0.8;0.81;0.84;0.88;1" calcMode="discrete" dur="5s" repeatCount="indefinite"/>
                </feDisplacementMap>
                <feColorMatrix in="torn" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
                <feColorMatrix in="torn" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
                <feColorMatrix in="torn" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
                <feOffset in="r" dx="2.5" result="r2"/>
                <feOffset in="b" dx="-2.5" result="b2"/>
                <feBlend in="r2" in2="g" mode="screen" result="rg"/>
                <feBlend in="rg" in2="b2" mode="screen"/>
            </filter>
        </defs>`;
        document.body.appendChild(svg);
    }

    /** Custom properties the effect needs on the wrapper (name → value). Glass shards and their gloss layers are built later, in apply(). */
    static _vars(fx, src) {
        const vars = { '--fx-src': cssUrl(src) };
        if (fx === 'cracked') vars['--fx-cracks'] = crackStyle(absUrl(src));
        return vars;
    }

    /**
     * The portrait is wrapped in a layer that carries the effect. The portrait itself already owns `filter`,
     * `animation`, `translate` and `opacity` (speaker dimming, breathing, entrances), so the effect lives one level up
     * and composes with them instead of fighting over the same properties.
     * Осколки «Стекла» собираются позже, на живом элементе (apply): при открытии сцены у всех `.vn-character-img`
     * разом ставится inline opacity: 0, а снимается он только у первого.
     */
    static wrapHTML(imgHTML, fx, src) {
        if (!fx || isFxDisabled('charfx', fx)) return imgHTML;
        if (SVG_FX.has(fx)) VNCharFx.ensureFilters();
        const style = Object.entries(VNCharFx._vars(fx, src)).map(([k, v]) => `${k}: ${v}`).join('; ');
        return `<div class="${CLASS}" data-fx="${fx}" style="${escapeHtml(style)}">${imgHTML}</div>`;
    }

    /** Sets (or clears) the effect on a live `.vn-character`. The layer is created on demand and kept once created. */
    static apply(charEl, fx) {
        // Отключённый на этом клиенте эффект ведёт себя так, будто его нет (состояние сцены не меняется)
        if (fx && isFxDisabled('charfx', fx)) fx = null;
        let layer = charEl.querySelector(`:scope > .${CLASS}`);
        if (!fx) {
            if (layer) {
                layer.removeAttribute('data-fx');
                VNCharFx._clearShards(layer);
                VNCharFx._clearHoly(layer);
            }
            return;
        }
        const img = layer?.querySelector(`.vn-character-img:not(.${SHARD_CLASS})`) ?? charEl.querySelector(':scope > .vn-character-img');
        if (!img) return;
        if (!layer) {
            layer = document.createElement('div');
            layer.className = CLASS;
            img.before(layer);
            layer.append(img);
        }
        if (SVG_FX.has(fx)) VNCharFx.ensureFilters();

        const vars = VNCharFx._vars(fx, img.src);
        layer.style.setProperty('--fx-src', vars['--fx-src']);
        if ('--fx-cracks' in vars) layer.style.setProperty('--fx-cracks', vars['--fx-cracks']);
        else layer.style.removeProperty('--fx-cracks');
        if (layer.dataset.fx !== fx) layer.dataset.fx = fx;

        if (fx === 'glass') VNCharFx._buildShards(layer, img);
        else VNCharFx._clearShards(layer);
        if (fx === 'holy' || fx === 'holy_radiant') VNCharFx._buildHoly(layer, fx);
        else VNCharFx._clearHoly(layer);
    }

    /**
     * Дополнительные слои «Святого» — псевдоэлементов слоя (нимб с лучами и контровой свет) не хватает.
     * Позади фигуры: столп света сверху (::before) и обод нимба (.vn-fx-holy-ring — квадратный элемент, чтобы
     * кольцо было круглым). У «Высшего святого» ещё сияние лучами от фигуры и свет изнутри поверх неё.
     */
    static _buildHoly(layer, fx) {
        if (layer.dataset.holyFx === fx && layer.querySelector(`:scope > .${HOLY_CLASS}`)) return;
        VNCharFx._clearHoly(layer);

        const radiant = fx === 'holy_radiant';
        const back = document.createElement('div');
        back.className = `${HOLY_CLASS} ${HOLY_CLASS}-back`;
        back.innerHTML = (radiant ? `<div class="${HOLY_CLASS}-burst"></div>` : '') + `<div class="${HOLY_CLASS}-ring"></div>`;
        // После портрета: оригинал остаётся первым в слое; «позади» обеспечивает z-index
        layer.append(back);
        if (radiant) {
            const front = document.createElement('div');
            front.className = `${HOLY_CLASS} ${HOLY_CLASS}-front`;
            layer.append(front);
        }
        layer.dataset.holyFx = fx;
    }

    static _clearHoly(layer) {
        layer.querySelectorAll(`:scope > .${HOLY_CLASS}`).forEach(el => el.remove());
        delete layer.dataset.holyFx;
    }

    /**
     * Осколки — копии `<img class="vn-character-img">` с clip-path: класс общий, поэтому вход/выход, расфокус
     * неактивного, зеркало и «скрытый силуэт» применяются к ним теми же правилами, что и к самому портрету.
     * Оригинал остаётся первым в слое (на него завязан остальной код) и прячется через [data-shards].
     */
    static _buildShards(layer, img) {
        const key = absUrl(img.src);
        if (layer.dataset.shardSrc === key && layer.querySelector(`:scope > .${SHARD_CLASS}`)) return;
        VNCharFx._clearShards(layer);

        const shards = glassShards(key);
        const pose = s => `clip-path: ${s.clip}; --origin: ${s.origin}; --t0: ${s.t0}; --t1: ${s.t1}; `
            + `--dur: ${s.dur.toFixed(1)}s; --delay: ${s.delay.toFixed(1)}s;`;
        for (const s of shards) {
            const el = document.createElement('img');
            el.className = `vn-character-img ${SHARD_CLASS}`;
            el.src = img.src;
            el.alt = '';
            el.draggable = false;
            el.style.cssText = pose(s);
            layer.append(el);
        }
        // Блик и грань — отдельный слой на каждый осколок, с той же формой, позой и покачиванием: свет идёт по
        // осколкам, а не по исходному силуэту. Слои блика — поверх всех осколков, чтобы соседний осколок их не закрыл
        for (const s of shards) {
            const gloss = document.createElement('div');
            gloss.className = `${SHARD_CLASS} ${GLOSS_CLASS}`;
            gloss.style.cssText = `${pose(s)} --facet: ${s.facet};`;
            layer.append(gloss);
        }
        layer.dataset.shardSrc = key;
        layer.toggleAttribute('data-shards', true);
    }

    static _clearShards(layer) {
        layer.querySelectorAll(`:scope > .${SHARD_CLASS}`).forEach(el => el.remove());
        layer.removeAttribute('data-shards');
        delete layer.dataset.shardSrc;
    }
}

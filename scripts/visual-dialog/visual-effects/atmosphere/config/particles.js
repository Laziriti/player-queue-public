// ============================================================
// config/particles.js — Конфигурации генераторов частиц
// ============================================================

import { R, RD } from '../utils.js';

/**
 * Формат конфигурации:
 * {
 *   className: string,        — CSS-классы элемента
 *   count: number,            — количество частиц
 *   sizeMin: number,          — минимальный размер (px)
 *   sizeRange: number,        — диапазон размера (px)
 *   style: (size) => string   — генератор inline-стилей
 * }
 *
 * Для эффектов со специальной генерацией (rain) style = null,
 * они обрабатываются отдельными фабриками в ParticleSystem.
 */
export const PARTICLE_CONFIGS = {
    particles: {
        className: 'vn-particle',
        count: 25,
        sizeMin: 2,
        sizeRange: 4,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;bottom:-5%;animation-delay:${R(20)}s;animation-duration:${12 + R(18)}s;--drift:${RD(60)}px;opacity:0`,
    },

    snow: {
        className: 'vn-particle vn-particle-snow',
        count: 40,
        sizeMin: 2,
        sizeRange: 6,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:-5%;animation-delay:${R(15)}s;animation-duration:${8 + R(12)}s;--drift:${RD(80)}px;opacity:0`,
    },

    rain: {
        className: 'vn-particle vn-particle-rain',
        count: 80,
        sizeMin: 0,
        sizeRange: 0,
        style: null, // Специальная фабрика
    },

    embers: {
        className: 'vn-particle vn-particle-ember',
        count: 30,
        sizeMin: 1,
        sizeRange: 3,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;bottom:-5%;animation-delay:${R(15)}s;animation-duration:${5 + R(10)}s;--drift:${RD(100)}px;opacity:0`,
    },

    fireflies: {
        className: 'vn-particle vn-particle-firefly',
        count: 15,
        sizeMin: 3,
        sizeRange: 4,
        style: (s) => `width:${s}px;height:${s}px;left:${10 + R(80)}%;top:${10 + R(70)}%;animation-delay:${R(10)}s;animation-duration:${6 + R(8)}s;--drift:${RD(120)}px;--drift-y:${RD(80)}px;opacity:0`,
    },

    divine_motes: {
        className: 'vn-particle vn-particle-divine',
        count: 35,
        sizeMin: 2,
        sizeRange: 5,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${-5 + R(20)}%;animation-delay:${R(12)}s;animation-duration:${8 + R(14)}s;--drift:${RD(40)}px;opacity:0`,
    },

    eldritch_spores: {
        className: 'vn-particle vn-particle-eldritch',
        count: 20,
        sizeMin: 2,
        sizeRange: 4,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(15)}s;animation-duration:${10 + R(20)}s;--drift:${RD(160)}px;--drift-y:${RD(120)}px;opacity:0`,
    },

    bubbles: {
        className: 'vn-particle vn-particle-bubble',
        count: 25,
        sizeMin: 4,
        sizeRange: 10,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;bottom:-5%;animation-delay:${R(15)}s;animation-duration:${8 + R(12)}s;--drift:${RD(60)}px;opacity:0`,
    },

    dream_orbs: {
        className: 'vn-particle vn-particle-dream',
        count: 12,
        sizeMin: 8,
        sizeRange: 20,
        style: (s) => `width:${s}px;height:${s}px;left:${5 + R(90)}%;top:${5 + R(85)}%;animation-delay:${R(12)}s;animation-duration:${12 + R(16)}s;--drift:${RD(80)}px;--drift-y:${RD(60)}px;opacity:0`,
    },

    ash: {
        className: 'vn-particle vn-particle-ash',
        count: 35,
        sizeMin: 1,
        sizeRange: 3,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:-5%;animation-delay:${R(20)}s;animation-duration:${6 + R(10)}s;--drift:${RD(80)}px;opacity:0`,
    },

    sakura: {
        className: 'vn-particle vn-particle-sakura',
        count: 20,
        sizeMin: 6,
        sizeRange: 8,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:-5%;animation-delay:${R(18)}s;animation-duration:${8 + R(12)}s;--drift:${RD(120)}px;--rotation:${R(720) - 360}deg;opacity:0`,
    },

    sparks: {
        className: 'vn-particle vn-particle-spark',
        count: 40,
        sizeMin: 1,
        sizeRange: 2,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;bottom:-5%;animation-delay:${R(8)}s;animation-duration:${2 + R(4)}s;--drift:${RD(80)}px;opacity:0`,
    },

    bokeh: {
        className: 'vn-particle vn-particle-bokeh',
        count: 15,
        sizeMin: 15,
        sizeRange: 40,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(15)}s;animation-duration:${10 + R(15)}s;--drift:${RD(40)}px;--drift-y:${RD(30)}px;opacity:0`,
    },
    apocalypse_debris: {
        className: 'vn-particle vn-particle-debris',
        count: 50,
        sizeMin: 2,
        sizeRange: 8,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(12)}s;animation-duration:${3 + R(6)}s;--drift:${RD(200)}px;--drift-y:${RD(150)}px;--rotation:${R(720) - 360}deg;opacity:0`,
    },

    ether_wisps: {
        className: 'vn-particle vn-particle-ether',
        count: 18,
        sizeMin: 10,
        sizeRange: 30,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(15)}s;animation-duration:${12 + R(18)}s;--drift:${RD(100)}px;--drift-y:${RD(80)}px;opacity:0`,
    },

    blood_motes: {
        className: 'vn-particle vn-particle-blood',
        count: 30,
        sizeMin: 2,
        sizeRange: 5,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:-5%;animation-delay:${R(15)}s;animation-duration:${6 + R(10)}s;--drift:${RD(60)}px;opacity:0`,
    },

    shadow_wisps: {
        className: 'vn-particle vn-particle-shadow-wisp',
        count: 22,
        sizeMin: 3,
        sizeRange: 8,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;bottom:${R(50)}%;animation-delay:${R(28)}s;animation-duration:${20 + R(22)}s;--drift:${RD(70)}px;opacity:0`,
    },

    glass_dust: {
        className: 'vn-particle vn-particle-glass-dust',
        count: 25,
        sizeMin: 1,
        sizeRange: 3,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(14)}s;animation-duration:${5 + R(9)}s;--drift:${RD(80)}px;--drift-y:${RD(60)}px;opacity:0`,
    },

    void_shards: {
        className: 'vn-particle vn-particle-void-shard',
        count: 30,
        sizeMin: 2,
        sizeRange: 6,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(16)}s;animation-duration:${6 + R(10)}s;--drift:${RD(120)}px;--drift-y:${RD(100)}px;--rotation:${R(720) - 360}deg;opacity:0`,
    },

    cosmic_dust: {
        className: 'vn-particle vn-particle-cosmic',
        count: 35,
        sizeMin: 1,
        sizeRange: 4,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;top:${R(100)}%;animation-delay:${R(20)}s;animation-duration:${10 + R(15)}s;--drift:${RD(60)}px;--drift-y:${RD(50)}px;opacity:0`,
    },

    abyss_bubbles: {
        className: 'vn-particle vn-particle-abyss',
        count: 20,
        sizeMin: 3,
        sizeRange: 8,
        style: (s) => `width:${s}px;height:${s}px;left:${R(100)}%;bottom:-5%;animation-delay:${R(18)}s;animation-duration:${10 + R(14)}s;--drift:${RD(40)}px;opacity:0`,
    },

    sand_grains: {
        className: 'vn-particle vn-particle-sand',
        count: 60,
        sizeMin: 1,
        sizeRange: 2,
        style: (s) => `width:${s * 3}px;height:${s}px;left:-5%;top:${15 + R(70)}%;animation-delay:${R(5)}s;animation-duration:${1.2 + R(2.5)}s;--drift-y:${RD(25)}px;opacity:0`,
    },

    // Конфетти — фабрика в particle-system.js, здесь только count
    confetti: { count: 55 },

    // Призраки — фабрика в particle-system.js, здесь только count
    ghosts: { count: 50 },
};

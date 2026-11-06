// ============================================================
// config/particles.js — Конфигурации генераторов частиц
// ============================================================

import { R, RD } from '../utils.js';

/**
 * Формат конфигурации (где и как быстро частицы стартуют; как они выглядят и движутся — config/particle-canvas.js):
 * {
 *   count: number,            — количество частиц при интенсивности 1
 *   sizeMin: number,          — минимальный размер (px)
 *   sizeRange: number,        — диапазон размера (px)
 *   spawn: (size) => {…}      — параметры старта частицы: left, top|bottom (% контейнера), delay, duration (с), drift, driftY (px),
 *                                rotation (градусы), rise (vh), w/h (если не size×size)
 *   images?: string[],        — опционально: 1+ путей к картинкам; каждая частица берёт одну случайную и рисуется ею
 *   variants?: { [id]: {…} }  — поля, которые вариант переопределяет у базового типа (см. PARTICLE_VARIANTS в config/particle-types.js)
 * }
 *
 * Дождь (drop — диапазоны), конфетти (mode) и призраки (count, images) строятся отдельно в ParticleSystem.
 */
const PARTICLES_PATH = 'modules/player-queue/assets/effects/particles';

// Раздельные пулы спрайтов для перьев и обрывков страниц — используются
// и в общем (смешанном) массиве images, и в variants (см. PARTICLE_VARIANTS
// в config/particle-types.js) для сужения до одной палитры.
const featherBlackImages = [1, 2, 3, 4].map(n => `${PARTICLES_PATH}/feathers/black_feather_${n}.webp`);
const featherWhiteImages = [1, 2, 3, 4].map(n => `${PARTICLES_PATH}/feathers/white_feather_${n}.webp`);
const pageFragmentImages = [1, 2, 3, 4].map(n => `${PARTICLES_PATH}/page_fragments/page_fragment_${n}.webp`);
const parchmentScrapImages = [1, 2, 3, 4].map(n => `${PARTICLES_PATH}/parchment_scraps/parchment_scrap_${n}.webp`);
const snowflakeImages = [1, 2, 3].map(n => `${PARTICLES_PATH}/snowflakes/snowflake_${n}.webp`);
const leafImages = [1, 2, 3, 4, 5, 6].map(n => `${PARTICLES_PATH}/leaves/leaf_${n}.webp`);
const fluffImages = [1, 2, 3].map(n => `${PARTICLES_PATH}/fluff/fluff_${n}.webp`);

export const PARTICLE_CONFIGS = {
    particles: {
        count: 25,
        sizeMin: 2,
        sizeRange: 4,
        spawn: () => ({ left: R(100), bottom: -5, delay: R(20), duration: 12 + R(18), drift: RD(60) }),
        variants: {
            // Пыль не поднимается, а медленно оседает
            settle: {
                count: 32,
                sizeMin: 1.5,
                sizeRange: 2.5,
                spawn: () => ({ left: R(100), top: -5, delay: R(14), duration: 22 + R(16), drift: RD(40) }),
            },
            // Звёзды не летят, а мерцают на месте по всему кадру
            stars: {
                count: 60,
                sizeMin: 1,
                sizeRange: 2.5,
                spawn: () => ({ left: R(100), top: R(100), delay: R(8), duration: 3 + R(5), drift: RD(24), driftY: RD(24) }),
            },
            // Тёплые пылинки парят по всему кадру и мерцают
            motes: {
                count: 60,
                sizeMin: 2,
                sizeRange: 3,
                spawn: () => ({ left: R(100), top: R(100), delay: R(8), duration: 12 + R(12), drift: RD(50), driftY: RD(36) }),
            },
        },
    },

    snow: {
        count: 40,
        sizeMin: 2,
        sizeRange: 6,
        spawn: () => ({ left: R(100), top: -5, delay: R(15), duration: 8 + R(12), drift: RD(80) }),
        variants: {
            heavy: {
                count: 95,
                sizeMin: 2,
                sizeRange: 5,
                spawn: () => ({ left: R(100), top: -5, delay: R(8), duration: 5 + R(6), drift: RD(60) }),
            },
            // Ветер сносит снег вправо: хлопья стартуют левее экрана и летят косо
            flurry: {
                count: 100,
                sizeMin: 2,
                sizeRange: 4,
                spawn: () => ({ left: R(130) - 25, top: -5, delay: R(5), duration: 1.8 + R(2.4), drift: 280 + R(360) }),
            },
            dust: {
                count: 80,
                sizeMin: 1,
                sizeRange: 1.8,
                spawn: () => ({ left: R(100), top: -5, delay: R(12), duration: 14 + R(14), drift: RD(36) }),
            },
            flakes: {
                count: 16,
                sizeMin: 9,
                sizeRange: 9,
                spawn: () => ({ left: R(100), top: -5, delay: R(18), duration: 14 + R(10), drift: RD(120) }),
            },
            // Буран: мелкая быстрая крупа почти отвесно; снос и наклон даёт ветер сцены (у вьюги наклон зашит в траекторию)
            blizzard: {
                count: 170,
                spawn: () => { const s = 0.9 + R(1.3); return { w: s, h: s * 4.5, left: R(100), top: -5, delay: R(4), duration: 1.1 + R(1.3), drift: RD(50) }; },
            },
            // Редкие крупные снежинки-кристаллы: медленно кружатся
            crystals: {
                count: 14,
                sizeMin: 11,
                sizeRange: 10,
                spawn: () => ({ left: R(100), top: -5, delay: R(14), duration: 14 + R(10), drift: RD(100), rotation: RD(360) }),
                images: snowflakeImages,
            },
        },
    },

    // Дождь строит ParticleSystem._rainParams; drop — диапазоны [мин, макс]: ширина и высота капли (px),
    // длительность падения (с), снос --drift (px); skew — капли стартуют левее экрана (косой дождь)
    rain: {
        count: 80,
        drop: { width: [1, 2], height: [8, 20], duration: [0.5, 1.3], drift: [-5, 5], skew: false },
        variants: {
            downpour: { count: 190, drop: { width: [1, 2.2], height: [16, 30], duration: [0.32, 0.7], drift: [-50, -20], skew: false } },
            drizzle:  { count: 55,  drop: { width: [0.8, 1.1], height: [4, 9], duration: [0.9, 1.7], drift: [-4, 4], skew: false } },
            slanted:  { count: 120, drop: { width: [1, 2], height: [10, 22], duration: [0.4, 0.9], drift: [230, 330], skew: true } },
            blood:    { count: 90,  drop: { width: [1.2, 2.4], height: [10, 22], duration: [0.5, 1.2], drift: [-8, 8], skew: false } },
        },
    },

    // Град строит ParticleSystem._rainParams, как дождь: короткие плотные частые крупинки, падают быстро и круто
    hail: {
        count: 120,
        drop: { width: [2.2, 3.4], height: [7, 13], duration: [0.26, 0.5], drift: [-24, -8], skew: false },
    },

    // Лист падает покачиваясь и кувыркаясь: rotation — полный угол поворота за жизнь (градусы)
    leaves: {
        count: 22,
        sizeMin: 24,
        sizeRange: 18,
        spawn: () => ({ left: R(100), top: -5, delay: R(14), duration: 9 + R(9), drift: RD(150), rotation: R(720) - 360 }),
        images: leafImages,
        variants: {
            // Листья на ветру: летят косо и быстро, больше вращения
            gale: {
                count: 34,
                spawn: () => ({ left: R(130) - 25, top: -5, delay: R(8), duration: 3.5 + R(4), drift: 260 + R(380), rotation: R(1440) - 720 }),
            },
        },
    },

    // Пух и пыльца парят: почти не падают, чуть поднимаются, качаются и медленно поворачиваются
    fluff: {
        count: 18,
        sizeMin: 34,
        sizeRange: 26,
        spawn: () => ({ left: R(100), top: 10 + R(90), delay: R(20), duration: 16 + R(14), drift: RD(180), driftY: RD(60), rotation: RD(80) }),
        images: fluffImages,
    },

    // Дым: крупные клубы поднимаются, растут и тают; форму каждому даёт шум (sprite.noise в particle-canvas.js)
    smoke: {
        count: 30,
        sizeMin: 90,
        sizeRange: 110,
        spawn: () => ({ left: R(100), bottom: -12, delay: R(14), duration: 12 + R(10), drift: RD(160), rotation: RD(120) }),
        variants: {
            steam: {
                count: 28,
                sizeMin: 80,
                sizeRange: 90,
                spawn: () => ({ left: R(100), bottom: -12, delay: R(8), duration: 6 + R(6), drift: RD(120), rotation: RD(160) }),
            },
        },
    },

    // Пылинки висят в воздухе и мерцают: хороши в лучах света
    embers: {
        count: 30,
        sizeMin: 1,
        sizeRange: 3,
        spawn: () => ({ left: R(100), bottom: -5, delay: R(15), duration: 5 + R(10), drift: RD(100) }),
        variants: {
            // Столб искр над костром: из середины кадра, ветер сносит вправо
            bonfire: {
                count: 46,
                sizeMin: 1.5,
                sizeRange: 3,
                spawn: () => ({ left: 34 + R(32), bottom: -5, delay: R(8), duration: 3.5 + R(5), drift: 60 + R(180) }),
            },
            // Редкие крупные тусклые угольки
            smolder: {
                count: 16,
                sizeMin: 4,
                sizeRange: 5,
                spawn: () => ({ left: R(100), bottom: -5, delay: R(14), duration: 10 + R(10), drift: RD(70) }),
            },
        },
    },

    fireflies: {
        count: 15,
        sizeMin: 3,
        sizeRange: 4,
        spawn: () => ({ left: 10 + R(80), top: 10 + R(70), delay: R(10), duration: 6 + R(8), drift: RD(120), driftY: RD(80) }),
        // Те же светлячки другого цвета: оттенок задаёт sprite варианта в config/particle-canvas.js
        variants: { blue: {}, amber: {} },
    },

    divine_motes: {
        count: 35,
        sizeMin: 2,
        sizeRange: 5,
        spawn: () => ({ left: R(100), top: -5 + R(20), delay: R(12), duration: 8 + R(14), drift: RD(40) }),
        variants: {
            rise: {
                count: 35,
                spawn: () => ({ left: R(100), bottom: -5, delay: R(12), duration: 8 + R(12), drift: RD(50) }),
            },
            twinkle: {
                count: 40,
                spawn: () => ({ left: R(100), top: R(100), delay: R(8), duration: 4 + R(6), drift: RD(30), driftY: RD(30) }),
            },
        },
    },

    eldritch_spores: {
        count: 20,
        sizeMin: 2,
        sizeRange: 4,
        spawn: () => ({ left: R(100), top: R(100), delay: R(15), duration: 10 + R(20), drift: RD(160), driftY: RD(120) }),
    },

    bubbles: {
        count: 25,
        sizeMin: 4,
        sizeRange: 10,
        spawn: () => ({ left: R(100), bottom: -5, delay: R(15), duration: 8 + R(12), drift: RD(60) }),
        variants: {
            champagne: {
                count: 60,
                sizeMin: 2,
                sizeRange: 3.5,
                spawn: () => ({ left: R(100), bottom: -5, delay: R(6), duration: 4 + R(5), drift: RD(24) }),
            },
            // Пузыри быстро поднимаются со дна и лопаются на полпути (vnBubbleBoil)
            boil: {
                count: 55,
                sizeMin: 3,
                sizeRange: 7,
                spawn: () => ({ left: R(100), bottom: -5, delay: R(4), duration: 1.8 + R(2.4), drift: RD(30), rise: 35 + R(55) }),
            },
        },
    },

    dream_orbs: {
        count: 12,
        sizeMin: 8,
        sizeRange: 20,
        spawn: () => ({ left: 5 + R(90), top: 5 + R(85), delay: R(12), duration: 12 + R(16), drift: RD(80), driftY: RD(60) }),
    },

    ash: {
        count: 26,
        sizeMin: 18,
        sizeRange: 20,
        spawn: () => ({ left: R(100), top: -5, delay: R(20), duration: 6 + R(10), drift: RD(80) }),
        images: [1, 2, 3, 4].map(n => `${PARTICLES_PATH}/ash/ash_${n}.webp`),
        variants: {
            heavy: {
                count: 60,
                sizeMin: 10,
                sizeRange: 10,
                spawn: () => ({ left: R(100), top: -5, delay: R(10), duration: 4 + R(6), drift: RD(110) }),
            },
            big: {
                count: 12,
                sizeMin: 36,
                sizeRange: 22,
                spawn: () => ({ left: R(100), top: -5, delay: R(16), duration: 12 + R(10), drift: RD(60) }),
            },
        },
    },

    sakura: {
        count: 20,
        sizeMin: 16,
        sizeRange: 16,
        spawn: () => ({ left: R(100), top: -5, delay: R(18), duration: 8 + R(12), drift: RD(120), rotation: R(720) - 360 }),
        images: [1, 2].map(n => `${PARTICLES_PATH}/sakura_petals/sakura_petal_${n}.webp`),
    },

    sparks: {
        count: 40,
        sizeMin: 1,
        sizeRange: 2,
        spawn: () => ({ left: R(100), bottom: -5, delay: R(8), duration: 2 + R(4), drift: RD(80) }),
        variants: {
            // Бьёт из одной точки внизу: взлетает дугой (--rise — высота подъёма) и падает обратно
            fountain: {
                count: 50,
                sizeMin: 1.5,
                sizeRange: 2.5,
                spawn: () => ({ left: 40 + R(20), bottom: -3, delay: R(4), duration: 1.6 + R(1.8), drift: RD(340), rise: 40 + R(45) }),
            },
            // Искры сыплются сверху (болгарка, оборванный провод)
            falling: {
                count: 45,
                sizeMin: 1,
                sizeRange: 2.5,
                spawn: () => ({ left: R(100), top: -5, delay: R(6), duration: 1.3 + R(2.2), drift: RD(120) }),
            },
            electric: {
                count: 50,
                sizeMin: 1,
                sizeRange: 2,
                spawn: () => ({ left: R(100), bottom: -5, delay: R(6), duration: 0.8 + R(1.6), drift: RD(260) }),
            },
        },
    },

    bokeh: {
        count: 15,
        sizeMin: 15,
        sizeRange: 40,
        spawn: () => ({ left: R(100), top: R(100), delay: R(15), duration: 10 + R(15), drift: RD(40), driftY: RD(30) }),
        // Те же круги другого цвета: оттенок задаёт sprite варианта в config/particle-canvas.js
        variants: { cool: {}, neon: {} },
    },
    apocalypse_debris: {
        count: 50,
        sizeMin: 14,
        sizeRange: 18,
        spawn: () => ({ left: R(100), top: R(100), delay: R(12), duration: 3 + R(6), drift: RD(200), driftY: RD(150), rotation: R(720) - 360 }),
        images: [1, 2, 3].map(n => `${PARTICLES_PATH}/debris_apocalypse/debris_apocalypse_${n}.webp`),
    },

    ether_wisps: {
        count: 18,
        sizeMin: 10,
        sizeRange: 30,
        spawn: () => ({ left: R(100), top: R(100), delay: R(15), duration: 12 + R(18), drift: RD(100), driftY: RD(80) }),
    },

    blood_motes: {
        count: 30,
        sizeMin: 16,
        sizeRange: 14,
        spawn: () => ({ left: R(100), top: -5, delay: R(15), duration: 6 + R(10), drift: RD(60) }),
        images: [1, 2].map(n => `${PARTICLES_PATH}/blood_motes/blood_mote_${n}.webp`),
    },

    shadow_wisps: {
        count: 22,
        sizeMin: 3,
        sizeRange: 8,
        spawn: () => ({ left: R(100), bottom: R(50), delay: R(28), duration: 20 + R(22), drift: RD(70) }),
    },

    glass_dust: {
        count: 25,
        sizeMin: 13,
        sizeRange: 14,
        spawn: () => ({ left: R(100), top: R(100), delay: R(14), duration: 5 + R(9), drift: RD(80), driftY: RD(60) }),
        images: [1, 2].map(n => `${PARTICLES_PATH}/glass_dust/glass_dust_${n}.webp`),
    },

    void_shards: {
        count: 30,
        sizeMin: 28,
        sizeRange: 28,
        spawn: () => ({ left: R(100), top: R(100), delay: R(16), duration: 6 + R(10), drift: RD(120), driftY: RD(100), rotation: R(720) - 360 }),
        images: [1, 2, 3, 4].map(n => `${PARTICLES_PATH}/void_shards/void_shard_${n}.webp`),
    },

    cosmic_dust: {
        count: 35,
        sizeMin: 1,
        sizeRange: 4,
        spawn: () => ({ left: R(100), top: R(100), delay: R(20), duration: 10 + R(15), drift: RD(60), driftY: RD(50) }),
    },

    abyss_bubbles: {
        count: 20,
        sizeMin: 3,
        sizeRange: 8,
        spawn: () => ({ left: R(100), bottom: -5, delay: R(18), duration: 10 + R(14), drift: RD(40) }),
    },

    sand_grains: {
        count: 60,
        sizeMin: 1,
        sizeRange: 2,
        spawn: (s) => ({ w: s * 3, h: s, left: -5, top: 15 + R(70), delay: R(5), duration: 1.2 + R(2.5), driftY: RD(25) }),
        variants: {
            // Позёмка: песок стелется низко над землёй, длинными быстрыми штрихами
            ground: {
                count: 80,
                sizeMin: 1,
                sizeRange: 1.2,
                spawn: (s) => ({ w: s * 7, h: s, left: -5, top: 80 + R(16), delay: R(4), duration: 0.8 + R(1.6), driftY: RD(10) }),
            },
        },
    },

    // Конфетти — ParticleSystem._confettiParams, здесь count и картинки кусочков
    // (серпантин — цветная полоска без картинки)
    confetti: {
        count: 55,
        // mode: 'streamers' — только серпантин, 'pieces' — только кусочки; без mode ~четверть серпантина
        variants: {
            pieces: { mode: 'pieces' },
            ribbon: { mode: 'streamers', count: 40 },
        },
        images: Array.from({ length: 15 }, (_, i) => `${PARTICLES_PATH}/confetti/confetti_${i + 1}.webp`),
    },

    // Призраки — ParticleSystem._fillGhosts, здесь число душ и картинки для головы
    // (хвост и туман рисует canvas/ghosts.js)
    ghosts: {
        count: 42,
        images: [1, 2].map(n => `${PARTICLES_PATH}/ghosts/ghost_${n}.webp`),
    },

    feathers: {
        count: 14,
        sizeMin: 40,
        sizeRange: 38,
        spawn: () => ({ left: R(100), top: -5, delay: R(22), duration: 14 + R(16), drift: RD(160), rotation: R(360) - 180 }),
        images: [...featherBlackImages, ...featherWhiteImages],
        variants: {
            black: { images: featherBlackImages },
            white: { images: featherWhiteImages },
        },
    },

    page_scraps: {
        count: 16,
        sizeMin: 36,
        sizeRange: 34,
        spawn: () => ({ left: R(100), top: -5, delay: R(20), duration: 10 + R(14), drift: RD(180), rotation: R(720) - 360 }),
        images: [...pageFragmentImages, ...parchmentScrapImages],
        variants: {
            pages: { images: pageFragmentImages },
            parchment: { images: parchmentScrapImages },
        },
    },

    // Воздушные шарики — единственный тип с паттерном "float up"
    // (поднимаются вверх с покачиванием, а не падают вниз)
    balloons: {
        count: 9,
        sizeMin: 34,
        sizeRange: 26,
        spawn: (s) => ({ w: s, h: s * 1.25, left: R(100), bottom: -10, delay: R(18), duration: 16 + R(14), drift: RD(120) }),
        images: [1, 2, 3, 4, 5, 6].map(n => `${PARTICLES_PATH}/balloons/balloon_${n}.webp`),
    },

    // Кометы — летят по диагонали вниз-влево. Хвост нарисован в самой
    // картинке (comet_with_trail_to_right), поворот спрайта считается
    // через atan2 от того же --drift/--drift-y, что и движение, — угол
    // гарантированно совпадает с траекторией (не подбирается вручную).
    comets: {
        count: 16,
        sizeMin: 60,
        sizeRange: 50,
        spawn: (s) => {
            const dx = -(900 + R(600));
            const dy = 650 + R(400);
            const rotation = Math.atan2(dy, dx) * 180 / Math.PI;
            return { w: s, h: s * 0.45, left: 45 + R(55), top: -8 + R(12), delay: R(9), duration: 1.2 + R(1), drift: dx, driftY: dy, rotation };
        },
        images: [1, 2].map(n => `${PARTICLES_PATH}/comets/comet_with_trail_to_right_${n}.webp`),
    },

    // Падающие звёзды — то же самое, но летят вниз-вправо (хвост
    // star_with_trail_to_left нарисован в другую сторону).
    shooting_stars: {
        count: 16,
        sizeMin: 60,
        sizeRange: 50,
        spawn: (s) => {
            const dx = 900 + R(600);
            const dy = 650 + R(400);
            const rotation = Math.atan2(dy, dx) * 180 / Math.PI - 180;
            return { w: s, h: s * 0.45, left: R(55), top: -8 + R(12), delay: R(9), duration: 1.2 + R(1), drift: dx, driftY: dy, rotation };
        },
        images: [1, 2, 3].map(n => `${PARTICLES_PATH}/stars/star_with_trail_to_left_${n}.webp`),
    },
};

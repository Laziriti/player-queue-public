// ============================================================
// config/particle-canvas.js — как рисуются на канвасе частицы: внешний вид (sprite) и движение (motion)
//
// Сколько частиц, откуда и с какой скоростью они стартуют — config/particles.js (spawn / drop), а здесь то, как они выглядят и движутся.
// Числа перенесены из бывших CSS-правил типов и @keyframes (vn-particles.css удалён; в истории git его можно найти).
//
// sprite:  gradient — { type: 'radial', shape: 'circle'|'ellipse', at: [x, y], stops } | { type: 'linear', stops } (сверху вниз),
//          stops: [[позиция 0…1, 'css-цвет'], …]; border — { width, color } (внутри размера, как box-sizing: border-box);
//          blur — filter: blur(px); glow — box-shadow: 0 0 {blur}px {color} (один или список); round: false / radius — форма;
//          unit: [w, h] — запечь одну заготовку и растягивать (вытянутые капли); palette — несколько sprite, по номеру частицы
//          в слое (как :nth-child); stages — [{ u, blur, hue }]: фильтр меняется по ходу пути (берётся ближайшая стадия).
//          У типов с картинками (images в particles.js) sprite нет: рисуется сама картинка, вписанная в w×h (contain).
// Флаги типа: depth: false — без глубины (всё на одном плане); wind — доля ветра (по умолчанию 1, 0 — ветер не сносит);
//          windTilt: true — вытянутая частица (капля) наклоняется по ветру.
// motion:  дорожки x, y (px), r (градусы), s (масштаб), sx (scaleX), ry (rotateY, градусы), o (прозрачность):
//          [[u, значение, ease?], …] по доле пути u 0…1, между кадрами линейно (ease — cubic-bezier кадра).
//          Значение — число или { drift, driftY, rot, rise, vh, vw, px }:
//          drift·--drift + driftY·--drift-y + rot·--rotation + rise·--rise(vh) + vh·1vh + vw·1vw + px.
//          flight — дополнение к дорожкам для отдельных типов (смещение, поворот, ширина или яркость по фазе).
//          Как в CSS: у `transform` отсутствующая в кадре функция равна нейтральной (scale 1), у отдельных свойств
//          (translate / rotate / scale) промежуточные кадры интерполируются мимо.
// ============================================================

const radial = (stops, opts = {}) => ({ type: 'radial', shape: 'circle', stops, ...opts });
const solid = color => ({ type: 'linear', stops: [[0, color], [1, color]] });
const rainSprite = (top, bottom) => ({ round: false, unit: [2, 64], gradient: { type: 'linear', stops: [[0, top], [1, bottom]] } });

const DRIFT_X = [[0, 0], [1, { drift: 1 }]];
const FALL = { x: DRIFT_X, y: [[0, 0], [1, { vh: 110 }]] };
const RISE = { x: DRIFT_X, y: [[0, 0], [1, { vh: -110 }]] };
const SAND_DRIFT = {
    x: [[0, 0], [1, { vw: 115 }]],
    o: [[0, 0], [0.08, 0.65], [0.92, 0.35], [1, 0]],
};
// Плавный дрейф к (drift, driftY) с промежуточными долями — споры, эфир
const drift = (...fr) => fr.map(f => [f, { drift: f }]);
const driftY = (...fr) => fr.map(f => [f, { driftY: f }]);

export const CANVAS_PARTICLES = {
    // ── Базовые ──────────────────────────────────────────────
    particles: {
        sprite: { gradient: radial([[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(136,192,208,0.4)']]), blur: 0.5 },
        motion: { ...RISE, o: [[0, 0], [0.1, 0.6], [0.9, 0.3], [1, 0]] },
        variants: {
            cosmic: {
                wind: 0,
                sprite: {
                    gradient: radial([[0, '#fff2ff'], [0.35, '#e4bbff'], [0.68, 'rgba(163,113,255,0.55)'], [1, 'transparent']]),
                    glow: { blur: 3, color: 'rgba(171,116,255,0.65)' },
                },
                motion: {
                    x: [[0, 0], [0.4, { drift: 0.3 }], [0.6, { drift: 0.6 }], [1, { drift: 1 }]],
                    y: [[0, 0], [0.4, { driftY: 0.3 }], [0.6, { driftY: 0.6 }], [1, { driftY: 1 }]],
                    s: [[0, 0.5], [0.2, 0.9], [0.6, 1.1], [0.8, 0.8], [1, 0.3]],
                    o: [[0, 0], [0.16, 0.85], [0.38, 0.6], [0.62, 1], [0.86, 0.65], [1, 0]],
                },
            },

            // Пыль не поднимается, а медленно оседает
            settle: { motion: { ...FALL, o: [[0, 0], [0.12, 0.55], [0.88, 0.3], [1, 0]] } },
            // Звёзды мерцают на месте
            stars: {
                sprite: { gradient: radial([[0, '#fff'], [0.4, 'rgba(190,215,255,0.7)'], [1, 'transparent']]), glow: { blur: 5, color: 'rgba(200,220,255,0.9)' } },
                motion: {
                    x: [[0, 0], [0.2, { drift: 0.25 }], [0.6, { drift: 0.6 }], [1, { drift: 1 }]],
                    y: [[0, 0], [0.2, { driftY: 0.25 }], [0.6, { driftY: 0.6 }], [1, { driftY: 1 }]],
                    s: [[0, 0.4], [0.2, 1], [0.6, 1.2], [1, 0.4]],
                    o: [[0, 0], [0.2, 1], [0.4, 0.25], [0.6, 1], [0.8, 0.3], [1, 0]],
                },
            },
            // Тёплые пылинки: парят и мерцают, ветер почти не сносит
            motes: {
                wind: 0.4,
                sprite: { gradient: radial([[0, 'rgba(255,245,215,1)'], [0.5, 'rgba(255,228,170,0.75)'], [1, 'transparent']]), glow: { blur: 6, color: 'rgba(255,225,160,0.8)' }, blur: 0.3 },
                motion: {
                    x: drift(0, 0.3, 0.6, 1), y: driftY(0, 0.3, 0.6, 1),
                    s: [[0, 0.7], [0.5, 1.1], [1, 0.7]],
                    o: [[0, 0], [0.12, 1], [0.25, 0.4], [0.4, 1], [0.55, 0.45], [0.7, 1], [0.85, 0.5], [1, 0]],
                },
            },
        },
    },

    snow: {
        sprite: { gradient: radial([[0, 'rgba(255,255,255,0.9)'], [0.6, 'rgba(200,220,255,0.4)'], [1, 'transparent']]), blur: 0.3 },
        motion: { ...FALL, o: [[0, 0], [0.1, 0.8], [0.9, 0.4], [1, 0]] },
        variants: {
            // Ледяная пыль: с лёгким свечением, мерцает на лету
            dust: {
                sprite: {
                    gradient: radial([[0, '#fff'], [0.45, 'rgba(200,230,255,0.6)'], [1, 'transparent']]),
                    glow: { blur: 4, color: 'rgba(210,235,255,0.9)' },
                    blur: 0.3,
                },
                motion: { ...FALL, o: [[0, 0], [0.1, 0.9], [0.2, 0.2], [0.32, 1], [0.46, 0.25], [0.6, 0.9], [0.74, 0.2], [0.88, 0.8], [1, 0]] },
            },
            // Крупные хлопья покачиваются на лету
            flakes: {
                sprite: { gradient: radial([[0, 'rgba(255,255,255,0.85)'], [0.55, 'rgba(225,238,255,0.5)'], [1, 'transparent']]), blur: 1.2 },
                motion: {
                    x: [[0, 0], [1, { drift: 1 }]],
                    sway: { amp: 22, cycles: 2 },
                    y: [[0, 0], [0.25, { vh: 27 }], [0.5, { vh: 55 }], [0.75, { vh: 82 }], [1, { vh: 110 }]],
                    o: [[0, 0], [0.1, 0.85], [0.9, 0.5], [1, 0]],
                },
            },
            // Буран: вытянутая крупа; сносит и кладёт её ветер сцены, сильнее остальных (wind 1.6)
            blizzard: {
                wind: 1.6,
                windTilt: true,
                sprite: { unit: [3, 14], gradient: radial([[0, 'rgba(255,255,255,0.95)'], [0.6, 'rgba(225,238,255,0.55)'], [1, 'transparent']], { shape: 'ellipse' }) },
                motion: { ...FALL, o: [[0, 0], [0.06, 0.8], [0.94, 0.5], [1, 0]] },
            },
            // Снежинки-кристаллы (картинки): покачиваются и кружатся
            crystals: {
                motion: {
                    x: [[0, 0], [1, { drift: 1 }]],
                    sway: { amp: 26, cycles: 1.5 },
                    y: [[0, 0], [1, { vh: 110 }]],
                    r: [[0, 0], [1, { rot: 1 }]],
                    o: [[0, 0], [0.1, 0.9], [0.9, 0.6], [1, 0]],
                },
            },
        },
    },

    rain: {
        windTilt: true,
        sprite: rainSprite('rgba(180,200,255,0.6)', 'rgba(150,180,240,0.2)'),
        motion: { ...FALL, o: [[0, 0], [0.05, 0.6], [0.95, 0.3], [1, 0]] },
        variants: {
            drizzle: { sprite: rainSprite('rgba(200,220,255,0.6)', 'rgba(170,195,245,0.18)') },
            downpour: { sprite: rainSprite('rgba(175,200,255,0.75)', 'rgba(140,170,235,0.22)') },
            // Kept for scenes saved before this variant was removed from the picker.
            blood: { sprite: rainSprite('rgba(225,40,50,0.85)', 'rgba(150,10,25,0.3)') },
        },
    },

    // Град: короткие плотные крупинки, падают быстрее дождя; строится как дождь (ParticleSystem._rainParams)
    hail: {
        windTilt: true,
        sprite: { round: false, radius: 1.5, unit: [3, 24], gradient: { type: 'linear', stops: [[0, 'rgba(255,255,255,0.95)'], [1, 'rgba(190,220,255,0.55)']] } },
        motion: { ...FALL, o: [[0, 0], [0.04, 0.85], [0.96, 0.6], [1, 0]] },
    },

    // Лист (картинка) падает покачиваясь: поворот rot за жизнь и «переворот» через scaleX
    leaves: {
        wind: 1.5,
        motion: {
            x: [[0, 0], [1, { drift: 1 }]],
            sway: { amp: 38, cycles: 2.5 },
            y: [[0, 0], [1, { vh: 112 }]],
            r: [[0, 0], [1, { rot: 1 }]],
            flip: { min: 0.4, cycles: 3 },
            o: [[0, 0], [0.06, 0.95], [0.92, 0.85], [1, 0]],
        },
        variants: {
            gale: {
                wind: 1.8,
                motion: {
                    x: [[0, 0], [1, { drift: 1 }]],
                    sway: { amp: 60, cycles: 2 },
                    y: [[0, 0], [0.3, { vh: 28, px: -30 }], [0.6, { vh: 60 }], [1, { vh: 112 }]],
                    r: [[0, 0], [1, { rot: 1 }]],
                    flip: { min: 0.4, cycles: 5 },
                    o: [[0, 0], [0.05, 0.95], [0.93, 0.85], [1, 0]],
                },
            },
        },
    },

    // Пух и пыльца: парят, качаются, медленно поворачиваются и чуть поднимаются
    fluff: {
        wind: 1.3,
        motion: {
            x: [[0, 0], [1, { drift: 1 }]],
            sway: { amp: 26, cycles: 2 },
            y: [[0, 0], [0.5, { driftY: 0.5, vh: -8 }], [1, { driftY: 1, vh: -16 }]],
            r: [[0, 0], [1, { rot: 1 }]],
            s: [[0, 0.8], [0.5, 1], [1, 0.85]],
            o: [[0, 0], [0.15, 0.9], [0.85, 0.8], [1, 0]],
        },
    },

    // Дым и пар: клубы меняют форму по кадрам общего атласа, с разной фазой и скоростью.
    smoke: {
        depth: false,
        sprite: { puff: { color: [114, 106, 99], alpha: 0.8, frequency: 1.55, threshold: 0.29, softness: 0.32, curl: 0.98, period: 3.2 } },
        motion: {
            x: [[0, 0], [1, { drift: 1 }]],
            sway: { amp: 30, cycles: 0.5 },
            y: [[0, 0], [1, { vh: -75 }]],
            r: [[0, 0], [1, { rot: 1 }]],
            s: [[0, 0.55], [1, 2.3]],
            o: [[0, 0], [0.18, 0.55], [0.6, 0.4], [1, 0]],
        },
        variants: {
            steam: {
                sprite: { puff: { color: [218, 230, 243], alpha: 0.62, frequency: 1.85, threshold: 0.37, softness: 0.3, curl: 1.22, period: 2.15 } },
                motion: {
                    x: [[0, 0], [1, { drift: 1 }]],
                    sway: { amp: 20, cycles: 0.5 },
                    y: [[0, 0], [1, { vh: -85 }]],
                    r: [[0, 0], [1, { rot: 1 }]],
                    s: [[0, 0.55], [0.55, 1.7], [1, 2.45]],
                    o: [[0, 0], [0.13, 0.62], [0.4, 0.34], [0.75, 0.12], [1, 0]],
                },
            },
        },
    },

    // Пылинки: висят и дрейфуют, мерцают
    // ── Огонь и свет ─────────────────────────────────────────
    embers: {
        sprite: {
            gradient: radial([[0, 'rgba(255,200,50,1)'], [0.5, 'rgba(255,120,20,0.7)'], [0.8, 'rgba(200,50,0,0.3)'], [1, 'transparent']]),
            glow: { blur: 4, color: 'rgba(255,150,30,0.8)' }, blur: 0.5,
        },
        motion: {
            x: DRIFT_X,
            flight: { type: 'updraft', height: 75, range: 46, lift: 0.64, current: 17 },
            s: [[0, 1], [0.45, 0.76], [1, 0.3]],
            o: [[0, 0], [0.08, 0.9], [0.44, 0.65], [1, 0]],
        },
        variants: {
            bonfire: {
                motion: {
                    x: DRIFT_X,
                    flight: { type: 'updraft', height: 75, range: 40, lift: 0.76, current: 26 },
                    s: [[0, 1], [0.4, 0.78], [1, 0.3]],
                    o: [[0, 0], [0.08, 1], [0.42, 0.7], [1, 0]],
                },
            },
            smolder: {
                sprite: {
                    gradient: radial([[0, 'rgba(255,150,50,0.85)'], [0.55, 'rgba(200,70,10,0.5)'], [1, 'transparent']]),
                    glow: { blur: 9, color: 'rgba(255,110,20,0.5)' }, blur: 0.8,
                },
                motion: {
                    x: DRIFT_X,
                    flight: { type: 'updraft', height: 53, range: 31, lift: 0.42, current: 11 },
                    s: [[0, 1], [1, 0.44]],
                    o: [[0, 0], [0.14, 0.72], [0.55, 0.47], [1, 0]],
                },
            },
        },
    },

    sparks: {
        sprite: {
            gradient: radial([[0, 'rgb(255,220,150)'], [0.5, 'rgba(255,160,50,0.7)'], [1, 'transparent']]),
            glow: { blur: 4, color: 'rgba(255,180,80,0.9)' }, blur: 0.5,
        },
        motion: { ...RISE, o: [[0, 0], [0.05, 1], [0.5, 0.6], [1, 0]] },
        variants: {
            // Фонтан: взлетает дугой (замедляется к вершине) и падает обратно
            fountain: {
                motion: {
                    x: [[0, 0, [0.2, 0.7, 0.4, 1]], [0.4, { drift: 0.6 }, [0.5, 0, 0.8, 0.4]], [1, { drift: 1 }]],
                    y: [[0, 0, [0.2, 0.7, 0.4, 1]], [0.4, { rise: -1 }, [0.5, 0, 0.8, 0.4]], [1, { vh: 12 }]],
                    o: [[0, 0, [0.2, 0.7, 0.4, 1]], [0.06, 1], [0.4, 0.9, [0.5, 0, 0.8, 0.4]], [1, 0]],
                },
            },
            // Сыплются сверху и ускоряются
            falling: {
                motion: {
                    x: [[0, 0, [0.4, 0, 0.9, 0.6]], [1, { drift: 1 }]],
                    y: [[0, 0, [0.4, 0, 0.9, 0.6]], [1, { vh: 110 }]],
                    o: [[0, 0, [0.4, 0, 0.9, 0.6]], [0.05, 1], [0.6, 0.7], [1, 0]],
                },
            },
            // Электрические: зигзаг вверх
            electric: {
                sprite: {
                    gradient: radial([[0, '#fff'], [0.45, 'rgba(150,200,255,0.9)'], [1, 'transparent']]),
                    glow: { blur: 6, color: 'rgba(120,180,255,0.95)' }, blur: 0.5,
                },
                motion: {
                    x: [[0, 0], [0.2, { drift: 0.35 }], [0.38, { drift: -0.1 }], [0.55, { drift: 0.55 }], [0.75, { drift: 0.2 }], [1, { drift: 1 }]],
                    y: [[0, 0], [0.2, { vh: -22 }], [0.38, { vh: -41 }], [0.55, { vh: -62 }], [0.75, { vh: -84 }], [1, { vh: -110 }]],
                    o: [[0, 0], [0.05, 1], [0.38, 0.4], [0.55, 1], [0.75, 0.5], [1, 0]],
                },
            },
        },
    },

    fireflies: {
        wind: 0.12,
        sprite: {
            gradient: radial([[0, 'rgba(200,255,100,1)'], [0.5, 'rgba(150,220,50,0.5)'], [1, 'transparent']]),
            glow: { blur: 8, color: 'rgba(180,255,80,0.8)' }, blur: 0.5,
        },
        motion: {
            flight: { type: 'firefly' },
            o: [[0, 0], [0.12, 0.94], [0.87, 0.94], [1, 0]],
        },
        // Saved scenes can still use these original palettes.
        variants: {
            blue: {
                sprite: {
                    gradient: radial([[0, 'rgba(170,235,255,1)'], [0.5, 'rgba(80,170,240,0.5)'], [1, 'transparent']]),
                    glow: { blur: 8, color: 'rgba(110,200,255,0.85)' }, blur: 0.5,
                },
            },
            amber: {
                sprite: {
                    gradient: radial([[0, 'rgba(255,228,140,1)'], [0.5, 'rgba(255,170,50,0.5)'], [1, 'transparent']]),
                    glow: { blur: 8, color: 'rgba(255,190,70,0.85)' }, blur: 0.5,
                },
            },
        },
    },

    divine_motes: {
        sprite: {
            gradient: radial([[0, 'rgba(255,255,220,1)'], [0.4, 'rgba(255,215,100,0.8)'], [0.7, 'rgba(255,180,60,0.3)'], [1, 'transparent']]),
            glow: [{ blur: 8, color: 'rgba(255,215,100,0.9)' }, { blur: 20, color: 'rgba(255,180,60,0.4)' }], blur: 0.5,
        },
        motion: {
            x: [[0, 0], [0.15, { drift: 0.2 }], [1, { drift: 1 }]],
            y: [[0, 0], [0.15, { vh: -15 }], [1, { vh: 110 }]],
            s: [[0, 0.5], [0.15, 1], [1, 0.3]],
            o: [[0, 0], [0.15, 0.9], [0.85, 0.5], [1, 0]],
        },
        variants: {
            rise: { motion: {
                x: [[0, 0], [0.15, { drift: 0.2 }], [1, { drift: 1 }]],
                y: [[0, 0], [0.15, { vh: -15 }], [1, { vh: -110 }]],
                s: [[0, 0.5], [0.15, 1], [1, 0.3]],
                o: [[0, 0], [0.15, 0.9], [0.85, 0.5], [1, 0]],
            } },
            twinkle: { motion: {
                x: [[0, 0], [0.25, { drift: 0.3 }], [0.65, { drift: 0.7 }], [1, { drift: 1 }]],
                y: [[0, 0], [0.25, { driftY: 0.3 }], [0.65, { driftY: 0.7 }], [1, { driftY: 1 }]],
                s: [[0, 0.3], [0.25, 1.2], [0.65, 1], [1, 0.3]],
                o: [[0, 0], [0.25, 1], [0.45, 0.3], [0.65, 0.9], [1, 0]],
            } },
        },
    },

    // ── Вода и пузыри ────────────────────────────────────────
    bubbles: {
        wind: 0,
        sprite: {
            gradient: radial([[0, 'rgba(200,240,255,0.4)'], [0.4, 'rgba(100,200,255,0.15)'], [0.7, 'rgba(60,160,220,0.08)'], [1, 'transparent']], { at: [0.3, 0.3] }),
            border: { width: 1, color: 'rgba(150,220,255,0.15)' }, blur: 0.5,
        },
        motion: {
            x: DRIFT_X,
            y: [[0, 0, [0.35, 0.18, 0.64, 0.62]], [1, { vh: -110 }]],
            flight: { type: 'bubble', wobble: 24 },
            s: [[0, 0.8], [1, 1.1]],
            o: [[0, 0], [0.1, 0.6], [0.85, 0.3], [1, 0]],
        },
        variants: {
            abyss: {
                wind: 0,
                // Тень в оригинале пульсирует (10 → 16 → 8 px); здесь она постоянная
                sprite: {
                    gradient: radial([[0, 'rgba(80,230,255,0.6)'], [0.3, 'rgba(0,170,220,0.35)'], [0.6, 'rgba(0,90,140,0.15)'], [1, 'transparent']], { at: [0.35, 0.35] }),
                    border: { width: 1, color: 'rgba(80,220,255,0.35)' }, glow: { blur: 10, color: 'rgba(0,180,220,0.35)' }, blur: 0.5,
                },
                motion: {
                    x: [[0, 0], [0.35, { drift: 0.2 }], [0.55, { drift: 0.5 }], [0.75, { drift: 0.7 }], [1, { drift: 1 }]],
                    y: [[0, 0], [0.35, { vh: -25 }], [0.55, { vh: -50 }], [0.75, { vh: -70 }], [1, { vh: -100 }]],
                    flight: { type: 'bubble', wobble: 32 },
                    s: [[0, 0.5], [0.15, 0.7], [0.55, 1], [1, 0.6]],
                    o: [[0, 0], [0.15, 0.75], [0.35, 0.9], [0.55, 0.8], [0.75, 0.55], [1, 0]],
                },
            },

            champagne: {
                sprite: {
                    gradient: radial([[0, 'rgba(255,245,200,0.55)'], [0.45, 'rgba(255,220,130,0.22)'], [0.75, 'rgba(255,200,90,0.08)'], [1, 'transparent']], { at: [0.3, 0.3] }),
                    border: { width: 1, color: 'rgba(255,230,160,0.3)' }, blur: 0.5,
                },
            },
            // Быстро всплывают со дна и лопаются (растут и гаснут)
            boil: {
                motion: {
                    x: [[0, 0], [0.88, { drift: 1 }], [1, { drift: 1 }]],
                    y: [[0, 0], [0.88, { rise: -1 }], [1, { rise: -1, vh: -2 }]],
                    flight: { type: 'bubble', wobble: 17 },
                    s: [[0, 0.7], [0.88, 1], [1, 1.7]],
                    o: [[0, 0], [0.12, 0.65], [0.88, 0.5], [1, 0]],
                },
            },
        },
    },

    // ── Магия и мистика ──────────────────────────────────────
    eldritch_spores: {
        sprite: {
            gradient: radial([[0, 'rgba(100,255,180,0.9)'], [0.4, 'rgba(0,200,100,0.5)'], [0.7, 'rgba(0,100,60,0.2)'], [1, 'transparent']]),
            glow: { blur: 6, color: 'rgba(0,200,100,0.7)' }, blur: 0.5,
        },
        motion: {
            x: drift(0, 0.5, 1), y: driftY(0, 0.5, 1),
            s: [[0, 0.8], [0.5, 1.2], [1, 0.6]],
            o: [[0, 0], [0.2, 0.7], [0.5, 0.5], [0.8, 0.6], [1, 0]],
        },
    },

    bokeh: {
        sprite: bokehSprite(
            [[0, 'rgba(255,225,160,0.7)'], [0.45, 'rgba(255,195,110,0.4)'], [0.7, 'rgba(255,170,80,0.12)'], [1, 'transparent']],
            'rgba(255,210,140,0.25)', 'rgba(255,195,110,0.5)'),
        motion: {
            x: drift(0, 1), y: driftY(0, 1),
            s: [[0, 0.8], [1, 1.2]],
            o: [[0, 0], [0.25, 0.85], [0.75, 0.6], [1, 0]],
        },
        variants: {
            ether: {
                sprite: {
                    gradient: radial([[0, 'rgba(200,220,255,0.75)'], [0.3, 'rgba(170,120,255,0.45)'], [0.6, 'rgba(110,220,220,0.2)'], [1, 'transparent']]),
                    border: { width: 1, color: 'rgba(200,220,255,0.2)' },
                    glow: [{ blur: 12, color: 'rgba(170,120,255,0.5)' }, { blur: 24, color: 'rgba(110,220,220,0.25)' }],
                    // blur 1.5 → 2 → 2.5 и hue-rotate 0 → 60 → 120 по ходу пути
                    stages: [0, 0.25, 0.5, 0.75, 1].map(u => ({ u, blur: 1.5 + u, hue: 120 * u })),
                },
                motion: {
                    x: drift(0, 0.2, 0.5, 0.8, 1), y: driftY(0, 0.2, 0.5, 0.8, 1),
                    s: [[0, 0.5], [0.2, 0.8], [0.5, 1.2], [0.8, 0.9], [1, 0.4]],
                    o: [[0, 0], [0.2, 0.85], [0.5, 1], [0.8, 0.7], [1, 0]],
                },
            },

            dream: {
                sprite: {
                    gradient: radial([[0, 'rgba(225,195,255,0.85)'], [0.4, 'rgba(190,140,255,0.5)'], [0.7, 'rgba(150,100,220,0.18)'], [1, 'transparent']]),
                    border: { width: 1, color: 'rgba(220,190,255,0.3)' },
                    glow: [{ blur: 10, color: 'rgba(190,140,255,0.6)' }, { blur: 22, color: 'rgba(150,100,220,0.3)' }], blur: 1,
                },
                motion: {
                    x: drift(0, 1), y: driftY(0, 1),
                    s: [[0, 0.6], [1, 1.3]],
                    o: [[0, 0], [0.3, 0.9], [0.7, 0.75], [1, 0]],
                },
            },

            cool: {
                sprite: bokehSprite(
                    [[0, 'rgba(185,215,255,0.7)'], [0.45, 'rgba(120,165,240,0.4)'], [0.7, 'rgba(100,130,230,0.12)'], [1, 'transparent']],
                    'rgba(170,200,255,0.28)', 'rgba(120,165,240,0.5)'),
            },
            // Розовые и бирюзовые круги вперемешку (чётные — бирюзовые, как :nth-child(2n))
            neon: {
                sprite: {
                    palette: [
                        bokehSprite(
                            [[0, 'rgba(255,110,215,0.75)'], [0.45, 'rgba(230,40,180,0.42)'], [0.7, 'rgba(190,20,150,0.12)'], [1, 'transparent']],
                            'rgba(255,130,220,0.3)', 'rgba(240,50,190,0.55)'),
                        bokehSprite(
                            [[0, 'rgba(110,245,255,0.75)'], [0.45, 'rgba(30,205,240,0.42)'], [0.7, 'rgba(20,150,220,0.12)'], [1, 'transparent']],
                            'rgba(130,240,255,0.3)', 'rgba(40,215,245,0.55)'),
                    ],
                },
            },
        },
    },

    // ── Песок ────────────────────────────────────────────────
    sand_grains: {
        sprite: { gradient: solid('rgba(210,155,70,0.8)'), round: false, radius: 1, blur: 0.5 },
        motion: {
            ...SAND_DRIFT,
            flight: { type: 'sandGust', shift: 10, lift: 2.1 },
        },
        variants: {
            ground: {
                motion: { ...SAND_DRIFT, flight: { type: 'sandGust', shift: 8, lift: 0.6 } },
            },
        },
    },

    // ── Частицы-картинки (рисуется сама картинка, вписанная в w×h) ──
    ash: {
        motion: {
            x: DRIFT_X,
            flight: { type: 'ash' },
            o: [[0, 0], [0.1, 0.65], [0.9, 0.45], [1, 0]],
        },
    },

    sakura: {
        motion: {
            x: DRIFT_X,
            r: [[0, 0], [1, { rot: 0.55 }]],
            flight: { type: 'flutter', distance: 110, cycles: 2.1, span: 19, brake: 0.47, tilt: 21, edge: 0.43 },
            s: [[0, 0.8], [0.5, 1], [1, 0.6]], // в кадре 50% функции scale нет — для transform это scale(1)
            o: [[0, 0], [0.1, 0.8], [0.9, 0.5], [1, 0]],
        },
    },

    apocalypse_debris: {
        motion: {
            x: drift(0, 0.3, 0.6, 1), y: driftY(0, 0.3, 0.6, 1),
            r: [[0, 0], [0.3, { rot: 0.3 }], [0.6, { rot: 0.6 }], [1, { rot: 1 }]],
            s: [[0, 1], [0.3, 0.9], [0.6, 0.7], [1, 0.3]],
            o: [[0, 0], [0.05, 0.8], [0.6, 0.5], [1, 0]],
        },
    },

    glass_dust: {
        motion: {
            x: [[0, 0], [0.5, { drift: 0.5 }], [1, { drift: 1 }]], y: [[0, 0], [0.5, { driftY: 1 }], [1, { driftY: 2 }]],
            r: [[0, 0], [0.5, 120], [1, 240]],
            s: [[0, 1], [0.5, 0.7], [1, 0.3]],
            o: [[0, 0], [0.08, 0.8], [0.5, 0.5], [0.9, 0.3], [1, 0]],
        },
    },

    void_shards: {
        wind: 0,
        motion: {
            x: drift(0, 1), y: driftY(0, 1),
            r: [[0, 0], [1, { rot: 1 }]],
            s: [[0, 0.3], [0.15, 0.8], [1, 0.2]],
            o: [[0, 0], [0.15, 0.6], [0.4, 0.5], [0.7, 0.35], [1, 0]],
        },
    },

    feathers: {
        motion: {
            x: DRIFT_X,
            r: [[0, { rot: 0.18 }], [1, { rot: 0.45 }]],
            flight: { type: 'flutter', distance: 112, cycles: 2.4, span: 43, brake: 0.92, tilt: 38, edge: 0.21 },
            o: [[0, 0], [0.08, 0.9], [0.5, 0.8], [0.92, 0.5], [1, 0]],
        },
    },

    page_scraps: {
        motion: {
            x: DRIFT_X,
            r: [[0, 0], [1, { rot: 0.78 }]],
            flight: { type: 'flutter', distance: 112, cycles: 2.9, span: 30, brake: 0.73, tilt: 28, edge: 0.12 },
            s: [[0, 0.85], [0.45, 1], [1, 0.7]],
            o: [[0, 0], [0.1, 0.85], [0.45, 0.65], [0.8, 0.4], [1, 0]],
        },
    },

    balloons: {
        depth: false, wind: 0.5,
        motion: {
            x: DRIFT_X,
            y: [[0, 0], [1, { vh: -115 }]],
            flight: { type: 'balloon', span: 28, cycles: 1.5, tilt: 4 },
            s: [[0, 0.85], [0.3, 0.95], [0.55, 1], [0.8, 1.02], [1, 1]],
            o: [[0, 0], [0.1, 0.95], [0.55, 0.9], [0.8, 0.65], [1, 0]],
        },
    },

    // Хвост нарисован в картинке; поворот (--rotation) задан вместе с направлением полёта
    meteors: { depth: false, wind: 0, motion: starStreak() },

    confetti: {
        depth: false, wind: 0.5,
        parts: {
            // Кусочки кувыркаются и на мгновение становятся ребром к зрителю.
            piece: {
                motion: {
                    x: DRIFT_X,
                    r: [[0, 0], [1, { rot: 1 }]],
                    flight: { type: 'flutter', distance: 112, cycles: 4.6, span: 15, brake: 0.39, tilt: 24, edge: 0.06 },
                    o: [[0, 0], [0.1, 0.92], [0.5, 0.75], [0.9, 0.55], [1, 0]],
                },
            },
            // Серпантин — цветная полоска; цвет по номеру среди частиц слоя (8 цветов, :nth-child(8n+k))
            streamer: {
                sprite: {
                    palette: [
                        'rgba(255,55,55,0.92)', 'rgba(255,215,0,0.92)', 'rgba(50,170,255,0.92)', 'rgba(34,210,68,0.92)',
                        'rgba(255,50,200,0.92)', 'rgba(255,140,0,0.92)', 'rgba(160,50,255,0.92)', 'rgba(0,210,200,0.92)',
                    ].map(color => ({ gradient: solid(color), round: false, radius: 2, blur: 0.5 })),
                },
                motion: {
                    x: DRIFT_X,
                    r: [[0, 0], [1, { rot: 0.7 }]],
                    flight: { type: 'flutter', distance: 112, cycles: 3.8, span: 23, brake: 0.34, tilt: 36, edge: 0.29 },
                    o: [[0, 0], [0.1, 0.85], [0.6, 0.65], [0.85, 0.4], [1, 0]],
                },
            },
        },
    },
};

// При падении осколки ускоряются и на долю оборота разворачиваются ребром.
const GLASS_FALL_MOTION = {
    x: [[0, 0], [0.35, { drift: 0.55 }], [1, { drift: 1 }]],
    y: [[0, 0], [0.25, { vh: 15 }], [0.5, { vh: 41 }], [0.75, { vh: 76 }], [1, { vh: 120 }]],
    r: [[0, { rot: 0.15 }], [1, { rot: 1 }]],
    ry: [[0, 0], [1, { rot: 1.2 }]],
    o: [[0, 0], [0.12, 0.9], [0.9, 0.8], [1, 0]],
};

// The original movement is kept independently of sprite/variant selection.
const CLASSIC_MOTIONS = {
    sakura: {
        x: [[0, 0], [0.5, { drift: 0.6 }], [1, { drift: 1 }]],
        y: [[0, 0], [0.5, { vh: 55 }], [1, { vh: 110 }]],
        r: [[0, 0], [0.5, { rot: 0.5 }], [1, { rot: 1 }]],
    },
    feathers: {
        x: [[0, 0], [0.25, { drift: 0.3 }], [0.5, { drift: -0.15 }], [0.75, { drift: 0.6 }], [1, { drift: 1 }]],
        y: [[0, 0], [0.25, { vh: 22 }], [0.5, { vh: 52 }], [0.75, { vh: 82 }], [1, { vh: 112 }]],
        r: [[0, 0], [0.25, { rot: 0.3 }], [0.5, { rot: 0.55 }], [0.75, { rot: 0.8 }], [1, { rot: 1 }]],
    },
    page_scraps: {
        x: [[0, 0], [0.45, { drift: 0.45 }], [1, { drift: 1 }]],
        y: [[0, 0], [0.45, { vh: 50 }], [1, { vh: 112 }]],
        r: [[0, 0], [0.45, { rot: 0.5 }], [1, { rot: 1 }]],
    },
};
const CLASSIC_CONFETTI = {
    piece: {
        x: [[0, 0], [0.5, { drift: 0.5 }], [1, { drift: 1 }]],
        y: [[0, 0], [0.5, { vh: 55 }], [1, { vh: 112 }]],
        r: [[0, 0], [0.5, { rot: 0.5 }], [1, { rot: 1 }]],
        ry: [[0, 0], [0.5, 180], [1, 360]],
    },
    streamer: {
        x: [[0, 0], [0.3, { drift: 0.22 }], [0.6, { drift: 0.6 }], [0.85, { drift: 0.88 }], [1, { drift: 1 }]],
        y: [[0, 0], [0.3, { vh: 28 }], [0.6, { vh: 62 }], [0.85, { vh: 90 }], [1, { vh: 112 }]],
        r: [[0, 0], [0.3, { rot: 0.28 }], [0.6, { rot: 0.65 }], [0.85, { rot: 0.9 }], [1, { rot: 1 }]],
        sx: [[0, 1], [0.3, 0.6], [0.6, 1.2], [0.85, 0.72], [1, 0.85]],
    },
};

function classicMotion(spec, tracks) {
    const { flight, ...motion } = spec.motion;
    return { ...spec, motion: { ...motion, ...tracks } };
}

function bokehSprite(stops, borderColor, glowColor) {
    return { gradient: radial(stops), border: { width: 1, color: borderColor }, glow: { blur: 14, color: glowColor }, blur: 0.5 };
}

function starStreak() {
    return {
        x: [[0, 0], [1, { drift: 1 }]], y: [[0, 0], [1, { driftY: 1 }]],
        r: [[0, { rot: 1 }], [1, { rot: 1 }]],
        s: [[0, 0.7], [1, 0.85]],
        o: [[0, 0], [0.08, 1], [0.75, 0.85], [1, 0]],
    };
}

/** Описание вида частиц (тип + вариант) или null, если тип ещё рисуется через DOM */
export function resolveCanvasSpec(type, variant, movement = 'classic') {
    const base = CANVAS_PARTICLES[type];
    if (!base) return null;
    const override = variant && variant !== 'all' ? base.variants?.[variant] : null;
    const spec = override ? { ...base, ...override } : base;
    if (type === 'glass_dust' && movement === 'fall') return { ...spec, motion: GLASS_FALL_MOTION };
    if (movement === 'flutter') return spec;
    if (type === 'confetti') {
        const parts = Object.fromEntries(Object.entries(spec.parts).map(([id, part]) =>
            [id, classicMotion(part, CLASSIC_CONFETTI[id])]));
        return { ...spec, parts };
    }
    return Object.hasOwn(CLASSIC_MOTIONS, type) ? classicMotion(spec, CLASSIC_MOTIONS[type]) : spec;
}

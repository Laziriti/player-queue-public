// ============================================================
// fx-performance.js — тонкая настройка эффектов на этом клиенте
//
// Клиентские настройки (то, что рисует именно ЭТОТ компьютер; состояние сцены, рассылка и ведущий не затрагиваются —
// так же, как у «Лёгкого режима»):
//   fxDisabled  — массив "вид:id" эффектов, которые не рисуются (вид: visual | particle | charfx)
//   particleIntensityMax — потолок «интенсивности частиц» (1–20, как ползунок ведущего; 20 = без ограничения)
// Файл без импортов намеренно: его читают и атмосфера, и эффекты портретов, а меню настроек собирает из реестров.
// ============================================================

const MODULE_ID = 'player-queue';

export const FX_KINDS = ['visual', 'particle', 'charfx'];
export const FX_TIERS = ['heavy', 'medium', 'light'];

/**
 * Группы по нагрузке. Оценка по приёмам, которые использует эффект, а не по замерам:
 *   heavy  — SVG-фильтры на фоне, анимация фильтра на слое фона, много крупных анимируемых слоёв, трещины и осколки
 *            из отдельных элементов, туман с размытием из десятков узлов
 *   medium — несколько анимируемых слоёв на весь экран, режимы смешивания, размытые копии, много светящихся частиц
 *   light  — статичная цветокоррекция и один-два слоя, простые частицы без размытия
 * Идентификатор, которого здесь нет, считается medium (см. tierOf). Меняйте группы здесь — меню подхватит само.
 */
export const FX_PERF = {
    visual: {
        heavy:  ['underwater', 'dream', 'eldritch', 'kaleidoscope', 'void_breach', 'earthquake', 'glass_shatter', 'cosmic_horror', 'ghosts', 'ethereal', 'apocalypse'],
        medium: ['divine', 'sacred', 'abyss', 'fire', 'blood_moon', 'corruption', 'shadow_intrigue', 'storm', 'hologram', 'neon', 'vhs', 'sandstorm', 'frost'],
        light:  ['warm', 'cold', 'moonlight', 'dark', 'carnival', 'noir', 'memory'],
    },
    particle: {
        heavy:  ['ghosts', 'shadow_wisps', 'ether_wisps', 'dream_orbs', 'bokeh'],
        medium: ['sakura', 'embers', 'fireflies', 'sparks', 'divine_motes', 'eldritch_spores', 'blood_motes', 'apocalypse_debris', 'void_shards', 'cosmic_dust', 'abyss_bubbles', 'glass_dust', 'comets', 'shooting_stars', 'confetti'],
        light:  ['particles', 'snow', 'rain', 'bubbles', 'ash', 'sand_grains', 'feathers', 'page_scraps', 'balloons'],
    },
    charfx: {
        heavy:  ['vhs', 'glass', 'fire', 'possessed'],
        medium: ['hologram', 'glitch', 'ghost', 'shadow', 'ice', 'noir', 'drunk', 'rage', 'holy', 'holy_radiant', 'memory', 'dream', 'neon', 'xray', 'gold'],
        light:  ['stone', 'cracked', 'invisible'],
    },
};

export function tierOf(kind, id) {
    for (const tier of FX_TIERS) if (FX_PERF[kind]?.[tier]?.includes(id)) return tier;
    return 'medium';
}

function readSetting(key, fallback) {
    try { return game.settings.get(MODULE_ID, key) ?? fallback; }
    catch { return fallback; }
}

/** Отключён ли эффект на этом клиенте. Вариант («feathers:black», «noir:blinds») отбрасывается: отключается весь тип. */
export function isFxDisabled(kind, id) {
    if (!id || id === 'none') return false;
    const base = String(id).split(':')[0];
    const off = readSetting('fxDisabled', []);
    return Array.isArray(off) && off.includes(`${kind}:${base}`);
}

/** Потолок интенсивности частиц (1–20): выше него этот клиент не рисует, что бы ни поставил ведущий. 20 — без ограничения. */
export function particleIntensityCap() {
    const n = Number(readSetting('particleIntensityMax', 20));
    return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 20) : 20;
}

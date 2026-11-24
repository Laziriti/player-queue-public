// ============================================================
// fx-performance.js — тонкая настройка эффектов на этом клиенте
//
// Клиентские настройки (то, что рисует именно ЭТОТ компьютер; состояние сцены, рассылка и ведущий не затрагиваются —
// так же, как у «Лёгкого режима»):
//   fxDisabled  — массив "вид:id" эффектов, которые не рисуются (вид: visual | particle | charfx)
//   particleIntensityMax — потолок «интенсивности частиц» (1–20, как ползунок ведущего; 20 = без ограничения)
// Файл без импортов намеренно: его читают и атмосфера, и эффекты портретов, а меню настроек собирает из реестров.
// ============================================================

import { normalizeParticleEffect, normalizeParticleFilterId } from './atmosphere/config/particle-types.js';
import { normalizeVisualEffect } from './atmosphere/config/visual-types.js';

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
        heavy:  ['underwater', 'dream', 'eldritch_depths', 'kaleidoscope', 'cubes', 'void_breach', 'earthquake', 'glass_shatter', 'cosmic_horror', 'ghosts', 'ethereal', 'catastrophe'],
        medium: ['divine', 'sacred', 'fire', 'darkness', 'storm', 'rain_glass', 'hologram', 'neon', 'vhs', 'sandstorm', 'ice', 'fog', 'drunk', 'firelight', 'window_scene', 'heat', 'paper_map', 'warmth'],
        light:  ['sky', 'monochrome', 'noir', 'memory', 'forest', 'cave'],
    },
    particle: {
        heavy:  ['ghosts', 'bokeh', 'smoke'],
        medium: ['sakura', 'embers', 'fireflies', 'sparks', 'divine_motes', 'eldritch_spores', 'apocalypse_debris', 'void_shards', 'particles:cosmic', 'bubbles:abyss', 'glass_dust', 'meteors', 'confetti'],
        light:  ['particles', 'snow', 'rain', 'bubbles', 'ash', 'sand_grains', 'feathers', 'page_scraps', 'balloons', 'hail', 'leaves', 'fluff'],
    },
    charfx: {
        heavy:  ['vhs', 'glass', 'fire', 'possessed'],
        medium: ['hologram', 'glitch', 'ghost', 'shadow', 'ice', 'noir', 'drunk', 'rage', 'holy', 'memory', 'dream', 'neon', 'xray', 'gold', 'arcane', 'archmage', 'orbs', 'psionic', 'reality_rift', 'marionette'],
        light:  ['stone', 'cracked', 'invisible', 'living_engraving'],
    },
};

export function tierOf(kind, id) {
    if (kind === 'visual') id = normalizeVisualEffect(id);
    for (const tier of FX_TIERS) if (FX_PERF[kind]?.[tier]?.includes(id)) return tier;
    const [base, variant] = id.split(':');
    if (variant) return tierOf(kind, base);
    return 'medium';
}

function readSetting(key, fallback) {
    try { return game.settings.get(MODULE_ID, key) ?? fallback; }
    catch { return fallback; }
}

// Вариант, который хранится самостоятельным id, но в меню настроек входит в базовый тип
const BASE_ALIASES = { charfx: { holy_radiant: 'holy' } };

export function normalizeFxFilterKey(key) {
    if (typeof key === 'string' && key.startsWith('visual:')) {
        const id = normalizeVisualEffect(key.slice('visual:'.length));
        return id === 'none' ? null : `visual:${id.split(':')[0]}`;
    }
    if (typeof key !== 'string' || !key.startsWith('particle:')) return key;
    const id = normalizeParticleFilterId(key.slice('particle:'.length));
    return id === 'none' ? null : `particle:${id}`;
}

/** Базовый фильтр отключает всё семейство. Бывшие отдельные частицы также фильтруются по варианту. */
export function isFxDisabled(kind, id) {
    if (!id || id === 'none') return false;
    const off = readSetting('fxDisabled', []);
    if (!Array.isArray(off)) return false;
    if (kind === 'particle') {
        const [base, variant = 'all'] = normalizeParticleEffect(id).split(':');
        return off.some(key => {
            const normalized = normalizeFxFilterKey(key);
            return normalized === `particle:${base}` || normalized === `particle:${base}:${variant}`;
        });
    }
    if (kind === 'visual') {
        const [base] = normalizeVisualEffect(String(id)).split(':');
        return off.some(key => normalizeFxFilterKey(key) === `visual:${base}`);
    }
    let base = String(id).split(':')[0];
    base = BASE_ALIASES[kind]?.[base] ?? base;
    return off.includes(`${kind}:${base}`);
}

/** Потолок интенсивности частиц (1–20): выше него этот клиент не рисует, что бы ни поставил ведущий. 20 — без ограничения. */
export function particleIntensityCap() {
    const n = Number(readSetting('particleIntensityMax', 20));
    return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 20) : 20;
}

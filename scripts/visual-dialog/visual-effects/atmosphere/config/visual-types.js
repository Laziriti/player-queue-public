// ============================================================
// config/visual-types.js — Реестр визуальных пост-эффектов (независимая ось)
// ============================================================

/**
 * Группы визуальных эффектов для UI (грид-пикер)
 */
export const VISUAL_GROUPS = [
    { id: 'basic',   label: 'vn.atmosphere.groups.basic',   types: ['none', 'warm', 'cold'] },
    { id: 'nature',  label: 'vn.atmosphere.groups.nature',  types: ['storm', 'underwater', 'moonlight', 'sandstorm'] },
    { id: 'magic',   label: 'vn.atmosphere.groups.magic',   types: ['divine', 'sacred', 'dream', 'ethereal'] },
    { id: 'dark',    label: 'vn.atmosphere.groups.dark',    types: ['eldritch', 'dark', 'corruption', 'abyss', 'shadow_intrigue'] },
    { id: 'chaos',   label: 'vn.atmosphere.groups.chaos',   types: ['fire', 'apocalypse', 'blood_moon', 'cosmic_horror', 'void_breach', 'glass_shatter'] },
    { id: 'special', label: 'vn.atmosphere.groups.special', types: ['carnival', 'ghosts'] },
];

/**
 * Список всех визуальных типов (ID). 'none' — выключено.
 */
export const VISUAL_TYPES = VISUAL_GROUPS.flatMap(g => g.types);

/**
 * Человекочитаемые названия
 */
export const VISUAL_LABELS = {
    none:            'vn.atmosphere.visual.none',
    divine:          'vn.atmosphere.visual.divine',
    eldritch:        'vn.atmosphere.visual.eldritch',
    dark:            'vn.atmosphere.visual.dark',
    warm:            'vn.atmosphere.visual.warm',
    cold:            'vn.atmosphere.visual.cold',
    storm:           'vn.atmosphere.visual.storm',
    dream:           'vn.atmosphere.visual.dream',
    underwater:      'vn.atmosphere.visual.underwater',
    fire:            'vn.atmosphere.visual.fire',
    sacred:          'vn.atmosphere.visual.sacred',
    corruption:      'vn.atmosphere.visual.corruption',
    moonlight:       'vn.atmosphere.visual.moonlight',
    apocalypse:      'vn.atmosphere.visual.apocalypse',
    ethereal:        'vn.atmosphere.visual.ethereal',
    blood_moon:      'vn.atmosphere.visual.blood_moon',
    void_breach:     'vn.atmosphere.visual.void_breach',
    cosmic_horror:   'vn.atmosphere.visual.cosmic_horror',
    abyss:           'vn.atmosphere.visual.abyss',
    shadow_intrigue: 'vn.atmosphere.visual.shadow_intrigue',
    glass_shatter:   'vn.atmosphere.visual.glass_shatter',
    sandstorm:       'vn.atmosphere.visual.sandstorm',
    carnival:        'vn.atmosphere.visual.carnival',
    ghosts:          'vn.atmosphere.visual.ghosts',
};

/**
 * FontAwesome иконки для UI
 */
export const VISUAL_ICONS = {
    none: 'fa-ban',
    divine: 'fa-sun',
    eldritch: 'fa-eye',
    dark: 'fa-circle-half-stroke',
    warm: 'fa-mug-hot',
    cold: 'fa-icicles',
    storm: 'fa-bolt',
    dream: 'fa-cloud-moon',
    underwater: 'fa-water',
    fire: 'fa-fire-flame-curved',
    sacred: 'fa-dove',
    corruption: 'fa-skull',
    moonlight: 'fa-moon',
    apocalypse: 'fa-explosion',
    ethereal: 'fa-hat-wizard',
    blood_moon: 'fa-droplet',
    void_breach: 'fa-burst',
    cosmic_horror: 'fa-hurricane',
    abyss: 'fa-anchor',
    shadow_intrigue: 'fa-user-secret',
    glass_shatter: 'fa-window-restore',
    sandstorm: 'fa-wind',
    carnival: 'fa-champagne-glasses',
    ghosts: 'fa-ghost',
};

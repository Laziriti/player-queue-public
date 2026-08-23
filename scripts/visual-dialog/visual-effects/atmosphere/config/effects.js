// ============================================================
// config/effects.js — Реестр эффектов, метаданные и пресеты
// ============================================================

/**
 * Группы эффектов для UI (picker + optgroup в select)
 */
export const EFFECT_GROUPS = [
    { id: 'basic',   label: 'vn.atmosphere.groups.basic',   effects: ['none', 'particles', 'snow', 'rain', 'embers', 'fireflies'] },
    { id: 'nature',  label: 'vn.atmosphere.groups.nature',  effects: ['storm', 'underwater', 'moonlit', 'sakura', 'sandstorm', 'ash_wasteland'] },
    { id: 'magic',   label: 'vn.atmosphere.groups.magic',   effects: ['divine', 'sacred', 'warm', 'dream', 'ethereal_plane', 'frozen'] },
    { id: 'dark',    label: 'vn.atmosphere.groups.dark',    effects: ['dark_ritual', 'eldritch', 'corruption', 'abyss', 'shadow_intrigue'] },
    { id: 'chaos',   label: 'vn.atmosphere.groups.chaos',   effects: ['inferno', 'apocalypse', 'blood_moon', 'cosmic_horror', 'void_breach', 'glass_shatter'] },
    { id: 'special', label: 'vn.atmosphere.groups.special', effects: ['carnival', 'ghosts'] },
];

/**
 * Список всех доступных эффектов (ID)
 */
export const EFFECTS = [
    'none', 'particles', 'snow', 'rain', 'embers', 'fireflies',
    'divine', 'eldritch', 'dark_ritual', 'warm', 'frozen',
    'storm', 'dream', 'underwater', 'inferno', 'sacred',
    'corruption', 'moonlit', 'sakura', 'ash_wasteland',
    'apocalypse', 'ethereal_plane', 'blood_moon',
    'void_breach', 'cosmic_horror', 'abyss',
    'shadow_intrigue', 'glass_shatter',
    'sandstorm', 'carnival', 'ghosts',
];

/**
 * Человекочитаемые названия эффектов
 */
export const EFFECT_LABELS = {
    none:            'vn.atmosphere.effects.none',
    particles:       'vn.atmosphere.effects.particles',
    snow:            'vn.atmosphere.effects.snow',
    rain:            'vn.atmosphere.effects.rain',
    embers:          'vn.atmosphere.effects.embers',
    fireflies:       'vn.atmosphere.effects.fireflies',
    divine:          'vn.atmosphere.effects.divine',
    eldritch:        'vn.atmosphere.effects.eldritch',
    dark_ritual:     'vn.atmosphere.effects.dark_ritual',
    warm:            'vn.atmosphere.effects.warm',
    frozen:          'vn.atmosphere.effects.frozen',
    storm:           'vn.atmosphere.effects.storm',
    dream:           'vn.atmosphere.effects.dream',
    underwater:      'vn.atmosphere.effects.underwater',
    inferno:         'vn.atmosphere.effects.inferno',
    sacred:          'vn.atmosphere.effects.sacred',
    corruption:      'vn.atmosphere.effects.corruption',
    moonlit:         'vn.atmosphere.effects.moonlit',
    sakura:          'vn.atmosphere.effects.sakura',
    ash_wasteland:   'vn.atmosphere.effects.ash_wasteland',
    apocalypse:      'vn.atmosphere.effects.apocalypse',
    ethereal_plane:  'vn.atmosphere.effects.ethereal_plane',
    blood_moon:      'vn.atmosphere.effects.blood_moon',
    void_breach:     'vn.atmosphere.effects.void_breach',
    cosmic_horror:   'vn.atmosphere.effects.cosmic_horror',
    abyss:           'vn.atmosphere.effects.abyss',
    shadow_intrigue: 'vn.atmosphere.effects.shadow_intrigue',
    glass_shatter:   'vn.atmosphere.effects.glass_shatter',
    sandstorm:       'vn.atmosphere.effects.sandstorm',
    carnival:        'vn.atmosphere.effects.carnival',
    ghosts:          'vn.atmosphere.effects.ghosts',
};

/**
 * FontAwesome иконки для UI
 */
export const EFFECT_ICONS = {
    none: 'fa-ban',
    particles: 'fa-circle',
    snow: 'fa-snowflake',
    rain: 'fa-cloud-rain',
    embers: 'fa-fire',
    fireflies: 'fa-star',
    divine: 'fa-sun',
    eldritch: 'fa-eye',
    dark_ritual: 'fa-moon',
    warm: 'fa-mug-hot',
    frozen: 'fa-icicles',
    storm: 'fa-bolt',
    dream: 'fa-cloud-moon',
    underwater: 'fa-water',
    inferno: 'fa-fire-flame-curved',
    sacred: 'fa-dove',
    corruption: 'fa-skull',
    moonlit: 'fa-moon',
    sakura: 'fa-fan',
    ash_wasteland: 'fa-smog',
    apocalypse: 'fa-explosion',
    ethereal_plane: 'fa-hat-wizard',
    blood_moon: 'fa-circle',
    void_breach: 'fa-burst',
    cosmic_horror: 'fa-hurricane',
    abyss: 'fa-water',
    shadow_intrigue: 'fa-user-secret',
    glass_shatter:   'fa-window-restore',
    sandstorm:       'fa-wind',
    carnival:        'fa-champagne-glasses',
    ghosts:          'fa-ghost',
};

/**
 * Пресеты: маппинг effect ID → { particles, visual }
 * particles — тип системы частиц
 * visual — тип визуального пост-эффекта
 */
export const PRESETS = {
    none:          { particles: 'none',            visual: 'none' },
    particles:     { particles: 'particles',       visual: 'none' },
    snow:          { particles: 'snow',            visual: 'none' },
    rain:          { particles: 'rain',            visual: 'none' },
    embers:        { particles: 'embers',          visual: 'none' },
    fireflies:     { particles: 'fireflies',       visual: 'none' },
    divine:        { particles: 'divine_motes',    visual: 'divine' },
    eldritch:      { particles: 'eldritch_spores', visual: 'eldritch' },
    dark_ritual:   { particles: 'embers',          visual: 'dark' },
    warm:          { particles: 'bokeh',           visual: 'warm' },
    frozen:        { particles: 'snow',            visual: 'cold' },
    storm:         { particles: 'rain',            visual: 'storm' },
    dream:         { particles: 'dream_orbs',      visual: 'dream' },
    underwater:    { particles: 'bubbles',         visual: 'underwater' },
    inferno:       { particles: 'embers',          visual: 'fire' },
    sacred:        { particles: 'divine_motes',    visual: 'sacred' },
    corruption:    { particles: 'eldritch_spores', visual: 'corruption' },
    moonlit:       { particles: 'fireflies',       visual: 'moonlight' },
    sakura:        { particles: 'sakura',          visual: 'warm' },
    ash_wasteland: { particles: 'ash',             visual: 'dark' },
    apocalypse:      { particles: 'apocalypse_debris', visual: 'apocalypse' },
    ethereal_plane:  { particles: 'ether_wisps',       visual: 'ethereal' },
    blood_moon:      { particles: 'blood_motes',       visual: 'blood_moon' },
    void_breach:   { particles: 'void_shards',    visual: 'void_breach' },
    cosmic_horror: { particles: 'cosmic_dust',    visual: 'cosmic_horror' },
    abyss:            { particles: 'abyss_bubbles',   visual: 'abyss' },
    shadow_intrigue:  { particles: 'shadow_wisps',    visual: 'shadow_intrigue' },
    glass_shatter:    { particles: 'glass_dust',      visual: 'glass_shatter' },
    sandstorm:        { particles: 'sand_grains',     visual: 'sandstorm' },
    carnival:         { particles: 'confetti',        visual: 'carnival'  },
    ghosts:           { particles: 'ghosts',          visual: 'ghosts'    },
};

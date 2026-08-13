// ============================================================
// config/effects.js — Реестр эффектов, метаданные и пресеты
// ============================================================

/**
 * Группы эффектов для UI (picker + optgroup в select)
 */
export const EFFECT_GROUPS = [
    { id: 'basic',   label: 'Базовые',   effects: ['none', 'particles', 'snow', 'rain', 'embers', 'fireflies'] },
    { id: 'nature',  label: 'Природа',   effects: ['storm', 'underwater', 'moonlit', 'sakura', 'sandstorm', 'ash_wasteland'] },
    { id: 'magic',   label: 'Магия',     effects: ['divine', 'sacred', 'warm', 'dream', 'ethereal_plane', 'frozen'] },
    { id: 'dark',    label: 'Тьма',      effects: ['dark_ritual', 'eldritch', 'corruption', 'abyss', 'shadow_intrigue'] },
    { id: 'chaos',   label: 'Хаос',      effects: ['inferno', 'apocalypse', 'blood_moon', 'cosmic_horror', 'void_breach', 'glass_shatter'] },
    { id: 'special', label: 'Особые',    effects: ['carnival', 'ghosts'] },
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
    none: 'Выкл',
    particles: 'Частицы',
    snow: 'Снег',
    rain: 'Дождь',
    embers: 'Угли',
    fireflies: 'Светлячки',
    divine: '✨ Божественное',
    eldritch: '🐙 Элдритч',
    dark_ritual: '🌑 Тёмный ритуал',
    warm: '🔥 Тёплая атмосфера',
    frozen: '❄️ Мороз',
    storm: '⛈️ Гроза',
    dream: '💫 Сон',
    underwater: '🌊 Под водой',
    inferno: '🔥 Инферно',
    sacred: '🕊️ Священное',
    corruption: '💀 Порча',
    moonlit: '🌙 Лунный свет',
    sakura: '🌸 Сакура',
    ash_wasteland: '💨 Пепелище',
    apocalypse: '🌋 Апокалипсис',
    ethereal_plane: '🔮 Эфирный план',
    blood_moon: '🩸 Кровавая луна',
    void_breach: '🕳️ Разрыв Пустоты',
    cosmic_horror: '🌌 Космический Ужас',
    abyss: '🌊 Бездна',
    shadow_intrigue: '🕵️ Тени и интриги',
    glass_shatter:   '🪟 Разбитое стекло',
    sandstorm:       '🏜️ Песчаная буря',
    carnival:        '🎉 Праздник',
    ghosts:          '👻 Призраки',
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

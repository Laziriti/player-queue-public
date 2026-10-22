// ============================================================
// config/particle-types.js — Реестр типов частиц (независимая ось)
// ============================================================

/**
 * Группы типов частиц для UI (грид-пикер)
 */
export const PARTICLE_GROUPS = [
    { id: 'basic',   label: 'vn.atmosphere.groups.basic',   types: ['none', 'particles', 'snow', 'rain', 'embers', 'fireflies', 'sparks'] },
    { id: 'nature',  label: 'vn.atmosphere.groups.nature',  types: ['bubbles', 'ash', 'sakura', 'dream_orbs', 'sand_grains', 'bokeh'] },
    { id: 'magic',   label: 'vn.atmosphere.groups.magic',   types: ['divine_motes', 'ether_wisps'] },
    { id: 'dark',    label: 'vn.atmosphere.groups.dark',    types: ['eldritch_spores', 'blood_motes', 'shadow_wisps', 'glass_dust'] },
    { id: 'chaos',   label: 'vn.atmosphere.groups.chaos',   types: ['apocalypse_debris', 'void_shards', 'cosmic_dust', 'abyss_bubbles'] },
    { id: 'special', label: 'vn.atmosphere.groups.special', types: ['confetti', 'ghosts', 'feathers', 'page_scraps', 'balloons', 'comets', 'shooting_stars'] },
];

/**
 * Список всех типов частиц (ID). 'none' — выключено.
 */
export const PARTICLE_TYPES = PARTICLE_GROUPS.flatMap(g => g.types);

/**
 * Человекочитаемые названия
 */
export const PARTICLE_LABELS = {
    none:               'vn.atmosphere.particles.none',
    particles:          'vn.atmosphere.particles.particles',
    snow:               'vn.atmosphere.particles.snow',
    rain:               'vn.atmosphere.particles.rain',
    embers:             'vn.atmosphere.particles.embers',
    fireflies:          'vn.atmosphere.particles.fireflies',
    sparks:             'vn.atmosphere.particles.sparks',
    bubbles:            'vn.atmosphere.particles.bubbles',
    ash:                'vn.atmosphere.particles.ash',
    sakura:             'vn.atmosphere.particles.sakura',
    dream_orbs:         'vn.atmosphere.particles.dream_orbs',
    sand_grains:        'vn.atmosphere.particles.sand_grains',
    bokeh:              'vn.atmosphere.particles.bokeh',
    divine_motes:       'vn.atmosphere.particles.divine_motes',
    ether_wisps:        'vn.atmosphere.particles.ether_wisps',
    eldritch_spores:    'vn.atmosphere.particles.eldritch_spores',
    blood_motes:        'vn.atmosphere.particles.blood_motes',
    shadow_wisps:       'vn.atmosphere.particles.shadow_wisps',
    glass_dust:         'vn.atmosphere.particles.glass_dust',
    apocalypse_debris:  'vn.atmosphere.particles.apocalypse_debris',
    void_shards:        'vn.atmosphere.particles.void_shards',
    cosmic_dust:        'vn.atmosphere.particles.cosmic_dust',
    abyss_bubbles:      'vn.atmosphere.particles.abyss_bubbles',
    confetti:           'vn.atmosphere.particles.confetti',
    ghosts:             'vn.atmosphere.particles.ghosts',
    feathers:           'vn.atmosphere.particles.feathers',
    page_scraps:        'vn.atmosphere.particles.page_scraps',
    balloons:           'vn.atmosphere.particles.balloons',
    comets:             'vn.atmosphere.particles.comets',
    shooting_stars:     'vn.atmosphere.particles.shooting_stars',
};

/**
 * FontAwesome иконки для UI
 */
/**
 * Заранее созданные подварианты для отдельных типов частиц —
 * позволяют сузить смешанный пул спрайтов (например «перья» —
 * чёрные+белые) до одной палитры без создания отдельного типа
 * частицы. Значение particleEffect кодируется как "type:variant"
 * (например "feathers:black"); отсутствие суффикса == 'all'.
 */
export const PARTICLE_VARIANTS = {
    feathers: [
        { id: 'all',   label: 'vn.atmosphere.particleVariants.all' },
        { id: 'black', label: 'vn.atmosphere.particleVariants.black' },
        { id: 'white', label: 'vn.atmosphere.particleVariants.white' },
    ],
    page_scraps: [
        { id: 'all',       label: 'vn.atmosphere.particleVariants.all' },
        { id: 'pages',     label: 'vn.atmosphere.particleVariants.pages' },
        { id: 'parchment', label: 'vn.atmosphere.particleVariants.parchment' },
    ],
};

export const PARTICLE_ICONS = {
    none: 'fa-ban',
    particles: 'fa-circle',
    snow: 'fa-snowflake',
    rain: 'fa-cloud-rain',
    embers: 'fa-fire',
    fireflies: 'fa-bug',
    sparks: 'fa-bolt',
    bubbles: 'fa-water',
    ash: 'fa-smog',
    sakura: 'fa-fan',
    dream_orbs: 'fa-cloud-moon',
    sand_grains: 'fa-wind',
    bokeh: 'fa-circle-dot',
    divine_motes: 'fa-sun',
    ether_wisps: 'fa-hat-wizard',
    eldritch_spores: 'fa-eye',
    blood_motes: 'fa-droplet',
    shadow_wisps: 'fa-user-secret',
    glass_dust: 'fa-window-restore',
    apocalypse_debris: 'fa-explosion',
    void_shards: 'fa-burst',
    cosmic_dust: 'fa-hurricane',
    abyss_bubbles: 'fa-circle-notch',
    confetti: 'fa-champagne-glasses',
    ghosts: 'fa-ghost',
    feathers: 'fa-feather',
    page_scraps: 'fa-scroll',
    balloons: 'fa-gift',
    comets: 'fa-meteor',
    shooting_stars: 'fa-star',
};

// ============================================================
// config/particle-types.js — Реестр типов частиц (независимая ось)
// ============================================================

/**
 * Группы типов частиц для UI (грид-пикер)
 */
export const PARTICLE_GROUPS = [
    { id: 'basic',   label: 'vn.atmosphere.groups.basic',   types: ['none', 'particles', 'snow', 'rain', 'embers', 'fireflies', 'sparks'] },
    { id: 'nature',  label: 'vn.atmosphere.groups.nature',  types: ['bubbles', 'ash', 'sakura', 'dream_orbs', 'sand_grains', 'bokeh', 'hail', 'leaves', 'fluff', 'smoke'] },
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
    hail:               'vn.atmosphere.particles.hail',
    leaves:             'vn.atmosphere.particles.leaves',
    fluff:              'vn.atmosphere.particles.fluff',
    smoke:              'vn.atmosphere.particles.smoke',
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
    // Дальше — варианты без новых картинок: другие размеры, количество, траектория или цвет (см. variants в config/particles.js)
    rain: [
        { id: 'all',      label: 'vn.atmosphere.particleVariants.rain' },
        { id: 'downpour', label: 'vn.atmosphere.particleVariants.downpour' },
        { id: 'drizzle',  label: 'vn.atmosphere.particleVariants.drizzle' },
        { id: 'slanted',  label: 'vn.atmosphere.particleVariants.slanted' },
        { id: 'blood',    label: 'vn.atmosphere.particleVariants.bloodRain' },
    ],
    snow: [
        { id: 'all',    label: 'vn.atmosphere.particleVariants.snow' },
        { id: 'heavy',  label: 'vn.atmosphere.particleVariants.snowfall' },
        { id: 'flurry', label: 'vn.atmosphere.particleVariants.flurry' },
        { id: 'dust',   label: 'vn.atmosphere.particleVariants.iceDust' },
        { id: 'flakes', label: 'vn.atmosphere.particleVariants.bigFlakes' },
        { id: 'blizzard', label: 'vn.atmosphere.particleVariants.blizzard' },
        { id: 'crystals', label: 'vn.atmosphere.particleVariants.crystals' },
    ],
    particles: [
        { id: 'all',    label: 'vn.atmosphere.particleVariants.risingMotes' },
        { id: 'settle', label: 'vn.atmosphere.particleVariants.settlingDust' },
        { id: 'stars',  label: 'vn.atmosphere.particleVariants.starDust' },
        { id: 'motes',  label: 'vn.atmosphere.particleVariants.warmMotes' },
    ],
    sparks: [
        { id: 'all',      label: 'vn.atmosphere.particleVariants.sparks' },
        { id: 'fountain', label: 'vn.atmosphere.particleVariants.sparkFountain' },
        { id: 'falling',  label: 'vn.atmosphere.particleVariants.fallingSparks' },
        { id: 'electric', label: 'vn.atmosphere.particleVariants.electric' },
    ],
    embers: [
        { id: 'all',     label: 'vn.atmosphere.particleVariants.embers' },
        { id: 'bonfire', label: 'vn.atmosphere.particleVariants.bonfire' },
        { id: 'smolder', label: 'vn.atmosphere.particleVariants.smolder' },
    ],
    bokeh: [
        { id: 'all',  label: 'vn.atmosphere.particleVariants.warmBokeh' },
        { id: 'cool', label: 'vn.atmosphere.particleVariants.coolBokeh' },
        { id: 'neon', label: 'vn.atmosphere.particleVariants.neonBokeh' },
    ],
    bubbles: [
        { id: 'all',       label: 'vn.atmosphere.particleVariants.bubbles' },
        { id: 'champagne', label: 'vn.atmosphere.particleVariants.champagne' },
        { id: 'boil',      label: 'vn.atmosphere.particleVariants.boiling' },
    ],
    ash: [
        { id: 'all',   label: 'vn.atmosphere.particleVariants.ash' },
        { id: 'heavy', label: 'vn.atmosphere.particleVariants.ashfall' },
        { id: 'big',   label: 'vn.atmosphere.particleVariants.ashFlakes' },
    ],
    sand_grains: [
        { id: 'all',    label: 'vn.atmosphere.particleVariants.sandStorm' },
        { id: 'ground', label: 'vn.atmosphere.particleVariants.groundDrift' },
    ],
    confetti: [
        { id: 'all',    label: 'vn.atmosphere.particleVariants.confettiRibbons' },
        { id: 'pieces', label: 'vn.atmosphere.particleVariants.confettiOnly' },
        { id: 'ribbon', label: 'vn.atmosphere.particleVariants.ribbonsOnly' },
    ],
    divine_motes: [
        { id: 'all',     label: 'vn.atmosphere.particleVariants.fallingMotes' },
        { id: 'rise',    label: 'vn.atmosphere.particleVariants.ascendingMotes' },
        { id: 'twinkle', label: 'vn.atmosphere.particleVariants.twinklingMotes' },
    ],
    smoke: [
        { id: 'all',   label: 'vn.atmosphere.particleVariants.smoke' },
        { id: 'steam', label: 'vn.atmosphere.particleVariants.steam' },
    ],
    leaves: [
        { id: 'all',  label: 'vn.atmosphere.particleVariants.fallingLeaves' },
        { id: 'gale', label: 'vn.atmosphere.particleVariants.windblownLeaves' },
    ],
    fireflies: [
        { id: 'all',   label: 'vn.atmosphere.particleVariants.greenFireflies' },
        { id: 'blue',  label: 'vn.atmosphere.particleVariants.blueFireflies' },
        { id: 'amber', label: 'vn.atmosphere.particleVariants.amberFireflies' },
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
    hail: 'fa-cloud-meatball',
    leaves: 'fa-leaf',
    fluff: 'fa-seedling',
    smoke: 'fa-cloud',
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

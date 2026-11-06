// ============================================================
// config/visual-types.js — Реестр визуальных пост-эффектов (независимая ось)
// ============================================================

/**
 * Группы визуальных эффектов для UI (грид-пикер)
 */
export const VISUAL_GROUPS = [
    { id: 'basic',   label: 'vn.atmosphere.groups.basic',   types: ['none', 'warm', 'cold'] },
    { id: 'time',    label: 'vn.atmosphere.groups.time',    types: ['dawn', 'day', 'sunset', 'dusk', 'overcast'] },
    { id: 'places',  label: 'vn.atmosphere.groups.places',  types: ['candlelit', 'torchlit', 'windowlight', 'forest', 'cave'] },
    { id: 'nature',  label: 'vn.atmosphere.groups.nature',  types: ['storm', 'underwater', 'moonlight', 'sandstorm', 'frost', 'fog', 'heat', 'earthquake'] },
    { id: 'magic',   label: 'vn.atmosphere.groups.magic',   types: ['divine', 'sacred', 'dream', 'ethereal'] },
    { id: 'dark',    label: 'vn.atmosphere.groups.dark',    types: ['eldritch', 'dark', 'corruption', 'abyss', 'shadow_intrigue'] },
    { id: 'chaos',   label: 'vn.atmosphere.groups.chaos',   types: ['fire', 'apocalypse', 'blood_moon', 'cosmic_horror', 'void_breach', 'glass_shatter'] },
    { id: 'special', label: 'vn.atmosphere.groups.special', types: ['carnival', 'drunk', 'ghosts', 'hologram', 'kaleidoscope', 'cubes'] },
    { id: 'cinema',  label: 'vn.atmosphere.groups.cinema',  types: ['noir', 'memory', 'neon', 'vhs'] },
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
    hologram:        'vn.atmosphere.visual.hologram',
    kaleidoscope:    'vn.atmosphere.visual.kaleidoscope',
    drunk:           'vn.atmosphere.visual.drunk',
    cubes:           'vn.atmosphere.visual.cubes',
    frost:          'vn.atmosphere.visual.frost',
    fog:             'vn.atmosphere.visual.fog',
    earthquake:      'vn.atmosphere.visual.earthquake',
    noir:            'vn.atmosphere.visual.noir',
    memory:          'vn.atmosphere.visual.memory',
    neon:            'vn.atmosphere.visual.neon',
    vhs:             'vn.atmosphere.visual.vhs',
    dawn:            'vn.atmosphere.visual.dawn',
    day:             'vn.atmosphere.visual.day',
    sunset:          'vn.atmosphere.visual.sunset',
    dusk:            'vn.atmosphere.visual.dusk',
    overcast:        'vn.atmosphere.visual.overcast',
    candlelit:       'vn.atmosphere.visual.candlelit',
    torchlit:        'vn.atmosphere.visual.torchlit',
    windowlight:     'vn.atmosphere.visual.windowlight',
    forest:          'vn.atmosphere.visual.forest',
    cave:            'vn.atmosphere.visual.cave',
    heat:            'vn.atmosphere.visual.heat',
};

/**
 * Подварианты визуальных эффектов — так же, как PARTICLE_VARIANTS у частиц: значение visualEffect
 * кодируется как "type:variant" (например "noir:blinds"); отсутствие суффикса == 'all' — базовый вид эффекта
 * (первый пункт списка). VisualFXSystem вешает на overlay и vn-vfx-<type>, и vn-vfx-<type>-<variant>.
 */
export const VISUAL_VARIANTS = {
    noir: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.classic' },
        { id: 'blinds', label: 'vn.atmosphere.visualVariants.blinds' },
        { id: 'smoke',  label: 'vn.atmosphere.visualVariants.smoky' },
    ],
    storm: [
        { id: 'all',     label: 'vn.atmosphere.visualVariants.thunderstorm' },
        { id: 'distant', label: 'vn.atmosphere.visualVariants.distantStorm' },
        { id: 'gale',    label: 'vn.atmosphere.visualVariants.nightGale' },
    ],
    fire: [
        { id: 'all',  label: 'vn.atmosphere.visualVariants.inferno' },
        { id: 'room', label: 'vn.atmosphere.visualVariants.roomFire' },
    ],
    frost: [
        { id: 'all',       label: 'vn.atmosphere.visualVariants.rime' },
        { id: 'blizzard',  label: 'vn.atmosphere.visualVariants.blizzard' },
        { id: 'hoarfrost', label: 'vn.atmosphere.visualVariants.hoarfrost' },
    ],
    // Базовый вид — прежний «Густой туман»; `light` реже и прозрачнее, `dense` — сплошная пелена, `ground` — только понизу
    fog: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.fogMedium' },
        { id: 'light',  label: 'vn.atmosphere.visualVariants.fogLight' },
        { id: 'dense',  label: 'vn.atmosphere.visualVariants.fogDense' },
        { id: 'ground', label: 'vn.atmosphere.visualVariants.fogGround' },
    ],
    dream: [
        { id: 'all',       label: 'vn.atmosphere.visualVariants.lucid' },
        { id: 'nightmare', label: 'vn.atmosphere.visualVariants.nightmare' },
        { id: 'doze',      label: 'vn.atmosphere.visualVariants.doze' },
    ],
    vhs: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.tape' },
        { id: 'night',  label: 'vn.atmosphere.visualVariants.nightCam' },
        { id: 'chewed', label: 'vn.atmosphere.visualVariants.chewed' },
    ],
    memory: [
        { id: 'all',   label: 'vn.atmosphere.visualVariants.warmSepia' },
        { id: 'heavy', label: 'vn.atmosphere.visualVariants.heavyMemory' },
        { id: 'faded', label: 'vn.atmosphere.visualVariants.fadedFrame' },
    ],
    neon: [
        { id: 'all',  label: 'vn.atmosphere.visualVariants.cyberpunk' },
        { id: 'club', label: 'vn.atmosphere.visualVariants.club' },
        { id: 'wet',  label: 'vn.atmosphere.visualVariants.wetStreets' },
    ],
    divine: [
        { id: 'all',       label: 'vn.atmosphere.visualVariants.radiance' },
        { id: 'cathedral', label: 'vn.atmosphere.visualVariants.cathedral' },
        { id: 'mist',      label: 'vn.atmosphere.visualVariants.goldenMist' },
    ],
    sacred: [
        { id: 'all',   label: 'vn.atmosphere.visualVariants.purity' },
        { id: 'lunar', label: 'vn.atmosphere.visualVariants.lunar' },
    ],
    ghosts: [
        { id: 'all',     label: 'vn.atmosphere.visualVariants.graveyard' },
        { id: 'lights',  label: 'vn.atmosphere.visualVariants.fadingLights' },
        { id: 'shadows', label: 'vn.atmosphere.visualVariants.shadowWhispers' },
    ],
    cosmic_horror: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.eyeSpiral' },
        { id: 'eye',    label: 'vn.atmosphere.visualVariants.eye' },
        { id: 'spiral', label: 'vn.atmosphere.visualVariants.spiral' },
    ],
    glass_shatter: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.shardsFrame' },
        { id: 'center', label: 'vn.atmosphere.visualVariants.crackCenter' },
    ],
    // Базовый вид — «Пьяный»: середина лестницы, как у портретного эффекта drunk
    drunk: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.drunk' },
        { id: 'tipsy',  label: 'vn.atmosphere.visualVariants.tipsy' },
        { id: 'wasted', label: 'vn.atmosphere.visualVariants.wasted' },
    ],
    // Базовый вид — отдельные кубы, выдвигающиеся из плоской стены; `full` — вся сцена нарезана на кубы
    cubes: [
        { id: 'all',  label: 'vn.atmosphere.visualVariants.cubesSingle' },
        { id: 'full', label: 'vn.atmosphere.visualVariants.cubesFull' },
    ],
    // Базовый вид — случайные толчки: ближайший к прежнему поведению (серии толчков с паузами)
    earthquake: [
        { id: 'all',      label: 'vn.atmosphere.visualVariants.shocks' },
        { id: 'constant', label: 'vn.atmosphere.visualVariants.constant' },
    ],
    // Базовый вид — прежние цветные разрывы
    void_breach: [
        { id: 'all',     label: 'vn.atmosphere.visualVariants.nebula' },
        { id: 'dark',    label: 'vn.atmosphere.visualVariants.blackRifts' },
        { id: 'fissure', label: 'vn.atmosphere.visualVariants.fissures' },
        { id: 'planes',  label: 'vn.atmosphere.visualVariants.planes' },
    ],
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
    hologram: 'fa-cube',
    kaleidoscope: 'fa-snowflake',
    drunk: 'fa-beer-mug-empty',
    cubes: 'fa-cubes',
    frost: 'fa-temperature-low',
    fog: 'fa-smog',
    earthquake: 'fa-house-crack',
    noir: 'fa-film',
    memory: 'fa-clock-rotate-left',
    neon: 'fa-city',
    vhs: 'fa-tape',
    dawn: 'fa-cloud-sun',
    day: 'fa-sun',
    sunset: 'fa-mountain-sun',
    dusk: 'fa-star',
    overcast: 'fa-cloud',
    candlelit: 'fa-fire-flame-simple',
    torchlit: 'fa-dungeon',
    windowlight: 'fa-window-maximize',
    forest: 'fa-tree',
    cave: 'fa-mountain',
    heat: 'fa-temperature-high',
};

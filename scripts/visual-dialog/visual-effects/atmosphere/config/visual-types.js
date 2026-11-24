// ============================================================
// config/visual-types.js — Реестр визуальных пост-эффектов (независимая ось)
// ============================================================

/**
 * Группы визуальных эффектов для UI (грид-пикер)
 */
export const VISUAL_GROUPS = [
    { id: 'basic',   label: 'vn.atmosphere.groups.basic',   types: ['none'] },
    { id: 'time',    label: 'vn.atmosphere.groups.time',    types: ['sky'] },
    { id: 'places',  label: 'vn.atmosphere.groups.places',  types: ['firelight', 'window_scene', 'forest', 'cave'] },
    { id: 'nature',  label: 'vn.atmosphere.groups.nature',  types: ['storm', 'rain_glass', 'underwater', 'flood', 'eclipse', 'sandstorm', 'ice', 'fog', 'heat', 'earthquake'] },
    { id: 'magic',   label: 'vn.atmosphere.groups.magic',   types: ['divine', 'sacred', 'dream', 'ethereal', 'mirror_world'] },
    { id: 'dark',    label: 'vn.atmosphere.groups.dark',    types: ['darkness', 'eldritch_depths'] },
    { id: 'chaos',   label: 'vn.atmosphere.groups.chaos',   types: ['fire', 'catastrophe', 'cosmic_horror', 'void_breach', 'glass_shatter'] },
    { id: 'special', label: 'vn.atmosphere.groups.special', types: ['warmth', 'drunk', 'ghosts', 'hologram', 'kaleidoscope', 'cubes'] },
    { id: 'cinema',  label: 'vn.atmosphere.groups.cinema',  types: ['monochrome', 'noir', 'memory', 'paper_map', 'neon', 'vhs'] },
];

/**
 * Список всех визуальных типов (ID). 'none' — выключено.
 */
export const VISUAL_TYPES = VISUAL_GROUPS.flatMap(g => g.types);

// The former effect IDs remain the CSS/controller identities for each new family variant.
const VISUAL_STYLE_EFFECTS = {
    firelight: 'candlelit',
    'firelight:torchlit': 'torchlit',
    window_scene: 'windowlight',
    'window_scene:stained_glass': 'stained_glass',
    ice: 'frost',
    'ice:cold': 'cold',
    'ice:blizzard': 'frost:blizzard',
    'ice:hoarfrost': 'frost:hoarfrost',
    sky: 'day',
    'sky:dawn': 'dawn',
    'sky:sunset': 'sunset',
    'sky:dusk': 'dusk',
    'sky:overcast': 'overcast',
    'sky:moonlight': 'moonlight',
    darkness: 'dark',
    'darkness:corruption': 'corruption',
    'darkness:shadow_intrigue': 'shadow_intrigue',
    eldritch_depths: 'eldritch',
    'eldritch_depths:abyss': 'abyss',
    catastrophe: 'apocalypse',
    'catastrophe:blood_moon': 'blood_moon',
    warmth: 'warm',
    'warmth:carnival': 'carnival',
};

const VISUAL_ALIASES = new Map([
    ...Object.entries(VISUAL_STYLE_EFFECTS).map(([effect, style]) => [style, effect]),
    ['void_breach:opening', 'void_breach'],
    ['glass_shatter:center', 'glass_shatter'],
]);

export function normalizeVisualEffect(effect) {
    if (typeof effect !== 'string') return effect;
    const id = effect.endsWith(':all') ? effect.slice(0, -4) : effect;
    return VISUAL_ALIASES.get(id) ?? id;
}

export function resolveVisualStyleEffect(effect) {
    const normalized = normalizeVisualEffect(effect);
    return Object.hasOwn(VISUAL_STYLE_EFFECTS, normalized) ? VISUAL_STYLE_EFFECTS[normalized] : normalized;
}

/**
 * Человекочитаемые названия
 */
export const VISUAL_LABELS = {
    none:            'vn.atmosphere.visual.none',
    firelight:       'vn.atmosphere.visual.firelightFamily',
    window_scene:    'vn.atmosphere.visual.windowFamily',
    ice:             'vn.atmosphere.visual.iceFamily',
    sky:             'vn.atmosphere.visual.skyFamily',
    darkness:        'vn.atmosphere.visual.darknessFamily',
    eldritch_depths: 'vn.atmosphere.visual.eldritchFamily',
    catastrophe:     'vn.atmosphere.visual.catastropheFamily',
    warmth:          'vn.atmosphere.visual.warmthFamily',
    divine:          'vn.atmosphere.visual.divine',
    storm:           'vn.atmosphere.visual.storm',
    dream:           'vn.atmosphere.visual.dream',
    underwater:      'vn.atmosphere.visual.underwater',
    flood:           'vn.atmosphere.visual.flood',
    rain_glass:      'vn.atmosphere.visual.rainGlass',
    mirror_world:    'vn.atmosphere.visual.mirrorWorld',
    eclipse:         'vn.atmosphere.visual.eclipse',
    fire:            'vn.atmosphere.visual.fire',
    sacred:          'vn.atmosphere.visual.sacred',
    ethereal:        'vn.atmosphere.visual.ethereal',
    void_breach:     'vn.atmosphere.visual.void_breach',
    cosmic_horror:   'vn.atmosphere.visual.cosmic_horror',
    glass_shatter:   'vn.atmosphere.visual.glass_shatter',
    sandstorm:       'vn.atmosphere.visual.sandstorm',
    ghosts:          'vn.atmosphere.visual.ghosts',
    hologram:        'vn.atmosphere.visual.hologram',
    kaleidoscope:    'vn.atmosphere.visual.kaleidoscope',
    drunk:           'vn.atmosphere.visual.drunk',
    cubes:           'vn.atmosphere.visual.cubes',
    fog:             'vn.atmosphere.visual.fog',
    earthquake:      'vn.atmosphere.visual.earthquake',
    monochrome:      'vn.atmosphere.visual.monochrome',
    noir:            'vn.atmosphere.visual.noir',
    memory:          'vn.atmosphere.visual.memory',
    paper_map:       'vn.atmosphere.visual.paperMap',
    neon:            'vn.atmosphere.visual.neon',
    vhs:             'vn.atmosphere.visual.vhs',
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
    firelight: [
        { id: 'all', label: 'vn.atmosphere.visual.candlelit' },
        { id: 'torchlit', label: 'vn.atmosphere.visual.torchlit' },
    ],
    window_scene: [
        { id: 'all', label: 'vn.atmosphere.visual.windowlight' },
        { id: 'stained_glass', label: 'vn.atmosphere.visual.stainedGlass' },
    ],
    ice: [
        { id: 'all',       label: 'vn.atmosphere.visual.frost' },
        { id: 'cold',      label: 'vn.atmosphere.visual.cold' },
        { id: 'blizzard',  label: 'vn.atmosphere.visualVariants.blizzard' },
        { id: 'hoarfrost', label: 'vn.atmosphere.visualVariants.hoarfrost' },
    ],
    sky: [
        { id: 'all',      label: 'vn.atmosphere.visual.day' },
        { id: 'dawn',     label: 'vn.atmosphere.visual.dawn' },
        { id: 'sunset',   label: 'vn.atmosphere.visual.sunset' },
        { id: 'dusk',     label: 'vn.atmosphere.visual.dusk' },
        { id: 'overcast', label: 'vn.atmosphere.visual.overcast' },
        { id: 'moonlight',label: 'vn.atmosphere.visual.moonlight' },
    ],
    darkness: [
        { id: 'all',             label: 'vn.atmosphere.visual.dark' },
        { id: 'corruption',      label: 'vn.atmosphere.visual.corruption' },
        { id: 'shadow_intrigue', label: 'vn.atmosphere.visual.shadow_intrigue' },
    ],
    eldritch_depths: [
        { id: 'all',   label: 'vn.atmosphere.visual.eldritch' },
        { id: 'abyss', label: 'vn.atmosphere.visual.abyss' },
    ],
    catastrophe: [
        { id: 'all',       label: 'vn.atmosphere.visual.apocalypse' },
        { id: 'blood_moon',label: 'vn.atmosphere.visual.blood_moon' },
    ],
    warmth: [
        { id: 'all',      label: 'vn.atmosphere.visual.warm' },
        { id: 'carnival', label: 'vn.atmosphere.visual.carnival' },
    ],
    eclipse: [
        { id: 'all', label: 'vn.atmosphere.visualVariants.eclipseShadow' },
        { id: 'sun', label: 'vn.atmosphere.visualVariants.eclipseSun' },
        { id: 'phase', label: 'vn.atmosphere.visualVariants.eclipsePhase' },
    ],
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
        { id: 'eye',    label: 'vn.atmosphere.visualVariants.entity' },
        { id: 'spiral', label: 'vn.atmosphere.visualVariants.spiral' },
    ],
    glass_shatter: [
        { id: 'all',    label: 'vn.atmosphere.visualVariants.glassCrack' },
        { id: 'shards', label: 'vn.atmosphere.visualVariants.glassShards' },
        { id: 'background', label: 'vn.atmosphere.visualVariants.glassBackground' },
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
    firelight: 'fa-fire-flame-simple',
    window_scene: 'fa-window-maximize',
    ice: 'fa-temperature-low',
    sky: 'fa-cloud-sun',
    darkness: 'fa-circle-half-stroke',
    eldritch_depths: 'fa-eye',
    catastrophe: 'fa-explosion',
    warmth: 'fa-mug-hot',
    divine: 'fa-sun',
    storm: 'fa-bolt',
    rain_glass: 'fa-cloud-rain',
    mirror_world: 'fa-water',
    eclipse: 'fa-circle-half-stroke',
    dream: 'fa-cloud-moon',
    underwater: 'fa-water',
    flood: 'fa-water',
    fire: 'fa-fire-flame-curved',
    sacred: 'fa-dove',
    ethereal: 'fa-hat-wizard',
    void_breach: 'fa-burst',
    cosmic_horror: 'fa-hurricane',
    glass_shatter: 'fa-window-restore',
    sandstorm: 'fa-wind',
    ghosts: 'fa-ghost',
    hologram: 'fa-cube',
    kaleidoscope: 'fa-snowflake',
    drunk: 'fa-beer-mug-empty',
    cubes: 'fa-cubes',
    fog: 'fa-smog',
    earthquake: 'fa-house-crack',
    monochrome: 'fa-circle-half-stroke',
    noir: 'fa-film',
    memory: 'fa-clock-rotate-left',
    paper_map: 'fa-map',
    neon: 'fa-city',
    vhs: 'fa-tape',
    forest: 'fa-tree',
    cave: 'fa-mountain',
    heat: 'fa-temperature-high',
};

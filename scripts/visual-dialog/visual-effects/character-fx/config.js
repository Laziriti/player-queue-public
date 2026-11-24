// Portrait effect registry and data normalization; no rendering dependencies.
/** Groups in the portrait picker. Performance tiers come from fx-performance.js. */
export const CHAR_FX_GROUPS = [
    {
        id: 'stylization',
        fx: [
            'none', 'hologram', 'shadow', 'ghost', 'glitch',
            'fire', 'ice', 'gold', 'stone', 'cracked', 'glass', 'xray', 'memory', 'dream',
            'noir', 'neon', 'invisible', 'rage', 'possessed', 'drunk', 'holy', 'arcane',
            'archmage', 'orbs', 'psionic', 'reality_rift', 'marionette', 'living_engraving',
        ],
    },
    { id: 'signal', fx: ['vhs'] },
];

/**
 * Подварианты эффекта — в меню выбора тип раскрывается списком (как подтемы частиц и визуальных эффектов).
 * Каждый вариант — самостоятельный id эффекта (так он и хранится в state.charFx); первый — сам базовый тип.
 */
export const CHAR_FX_VARIANTS = {
    orbs: [
        { id: 'orbs', label: 'vn.charFx.variants.mana' },
        { id: 'orbs:elements', label: 'vn.charFx.variants.elements' },
        { id: 'orbs:void', label: 'vn.charFx.variants.void' },
    ],
    arcane: [
        { id: 'arcane', label: 'vn.charFx.variants.rotating' },
        { id: 'arcane:floating', label: 'vn.charFx.variants.floating' },
    ],
    fire: [
        { id: 'fire', label: 'vn.charFx.variants.normal' },
        { id: 'fire:embers', label: 'vn.charFx.variants.embers' },
        { id: 'fire:charred', label: 'vn.charFx.variants.charred' },
    ],
    ice: [
        { id: 'ice', label: 'vn.charFx.variants.normal' },
        { id: 'ice:frozen', label: 'vn.charFx.variants.frozen' },
        { id: 'ice:crystal', label: 'vn.charFx.variants.crystal' },
    ],
    stone: [
        { id: 'stone', label: 'vn.charFx.variants.normal' },
        { id: 'stone:mossy', label: 'vn.charFx.variants.mossy' },
        { id: 'stone:polished', label: 'vn.charFx.variants.polished' },
    ],
    hologram: [
        { id: 'hologram', label: 'vn.charFx.variants.normal' },
        { id: 'hologram:terminal', label: 'vn.charFx.variants.terminal' },
        { id: 'hologram:stable', label: 'vn.charFx.variants.stable' },
    ],
    shadow: [
        { id: 'shadow', label: 'vn.charFx.variants.normal' },
        { id: 'shadow:smoke', label: 'vn.charFx.variants.smoke' },
    ],
    ghost: [
        { id: 'ghost', label: 'vn.charFx.variants.normal' },
        { id: 'ghost:trail', label: 'vn.charFx.variants.trail' },
    ],
    drunk: [
        { id: 'drunk', label: 'vn.charFx.variants.normal' },
        { id: 'drunk:tipsy', label: 'vn.charFx.variants.tipsy' },
        { id: 'drunk:wasted', label: 'vn.charFx.variants.wasted' },
    ],
    neon: [
        { id: 'neon', label: 'vn.charFx.variants.normal' },
        { id: 'neon:cyan', label: 'vn.charFx.variants.cyan' },
        { id: 'neon:acid', label: 'vn.charFx.variants.acid' },
    ],
    glass: [
        { id: 'glass', label: 'vn.charFx.variants.normal' },
        { id: 'glass:large', label: 'vn.charFx.variants.large' },
        { id: 'glass:fine', label: 'vn.charFx.variants.fine' },
    ],
    holy: [
        { id: 'holy',         label: 'vn.charFx.variants.normal' },
        { id: 'holy_radiant', label: 'vn.charFx.variants.exalted' },
    ],
};

export const CHAR_FX = CHAR_FX_GROUPS.flatMap(g => g.fx.flatMap(id => CHAR_FX_VARIANTS[id]?.map(v => v.id) ?? [id]));

/** Базовый тип для варианта ('holy_radiant' → 'holy'); не вариант — сам id. */
export function charFxBase(fx) {
    return Object.keys(CHAR_FX_VARIANTS).find(base => CHAR_FX_VARIANTS[base].some(v => v.id === fx)) ?? fx;
}

/** Ключ перевода для названия эффекта или варианта: у варианта — его подпись, у обычного id — vn.charFx.<id>. */
export function charFxLabelKey(fx) {
    for (const list of Object.values(CHAR_FX_VARIANTS)) {
        const v = list.find(x => x.id === fx);
        if (v && fx.includes(':')) return v.label;
    }
    return `vn.charFx.${fx}`;
}

export const CHAR_FX_ICONS = {
    none: 'fa-wand-magic-sparkles',
    hologram: 'fa-cube',
    shadow: 'fa-moon',
    ghost: 'fa-ghost',
    glitch: 'fa-bolt',
    fire: 'fa-fire',
    ice: 'fa-snowflake',
    gold: 'fa-crown',
    stone: 'fa-mountain',
    cracked: 'fa-hammer',
    glass: 'fa-gem',
    xray: 'fa-x-ray',
    memory: 'fa-clock-rotate-left',
    dream: 'fa-cloud',
    noir: 'fa-film',
    neon: 'fa-lightbulb',
    invisible: 'fa-eye-slash',
    rage: 'fa-face-angry',
    possessed: 'fa-skull',
    drunk: 'fa-wine-bottle',
    holy: 'fa-hands-praying',
    arcane: 'fa-cubes',
    archmage: 'fa-hat-wizard',
    orbs: 'fa-circle',
    psionic: 'fa-brain',
    reality_rift: 'fa-circle-notch',
    marionette: 'fa-diagram-project',
    living_engraving: 'fa-pen-nib',
    holy_radiant: 'fa-sun',
    vhs: 'fa-tape',
};

export function normalizeCharFx(map) {
    const out = {};
    if (!map || typeof map !== 'object') return out;
    for (const [tokenId, fx] of Object.entries(map)) {
        if (fx !== 'none' && CHAR_FX.includes(fx)) out[tokenId] = fx;
    }
    return out;
}

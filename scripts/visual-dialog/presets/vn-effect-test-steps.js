import { stripEmoji } from '../../utils/text.js';
import { CAST_FIELDS, PARTICLE_SETTINGS_FIELDS, SCALE_LIMITS, SCENE_POSITIONS, VISUAL_SETTINGS_DEFAULTS } from '../scene/vn-scene-contract.js';
import { PARTICLE_TYPES, PARTICLE_LABELS, PARTICLE_VARIANTS } from '../visual-effects/atmosphere/config/particle-types.js';
import { VISUAL_TYPES, VISUAL_LABELS, VISUAL_VARIANTS } from '../visual-effects/atmosphere/config/visual-types.js';
import { CHAR_FX_GROUPS, CHAR_FX_VARIANTS } from '../visual-effects/character-fx/config.js';

function effectEntries(types, labels, variants) {
    return types.filter(type => type !== 'none').flatMap(type =>
        (variants[type] ?? [{ id: 'all' }]).map(({ id, label }) => ({
            id: id === 'all' ? type : `${type}:${id}`,
            label: labels[type],
            variant: label,
        })));
}

function effectName({ label, variant }, localize) {
    const name = stripEmoji(localize(label));
    const detail = variant ? stripEmoji(localize(variant)) : name;
    return name === detail ? name : `${name} (${detail})`;
}

export function buildEffectTestSteps(state, localize, format) {
    const effectSettings = ['particleEffectSettings', ...PARTICLE_SETTINGS_FIELDS, ...Object.keys(VISUAL_SETTINGS_DEFAULTS)];
    const base = {
        ...Object.fromEntries(effectSettings.map(field => [field, state[field]])),
        background: state.background === 'none' ? null : state.background,
        portraitImages: state.portraitImages,
        portraitNames: state.portraitNames,
        portraitScale: state.portraitScale,
        flipped: state.flipped,
        backgroundOverlay: state.backgroundOverlay,
        vignette: state.vignette,
        groundFog: state.groundFog,
        particleEffect: 'none',
        visualEffect: 'none',
    };
    const cast = Object.fromEntries(CAST_FIELDS.map(field => [field, state[field]]));
    const scene = { ...base, ...cast, speakers: state.speakers, portraitScales: state.portraitScales, visibility: state.visibility };
    const particles = effectEntries(PARTICLE_TYPES, PARTICLE_LABELS, PARTICLE_VARIANTS)
        .map(effect => ({ ...scene, particleEffect: effect.id, title: format('vn.sequence.testParticle', { effect: effectName(effect, localize) }) }));
    const visuals = effectEntries(VISUAL_TYPES, VISUAL_LABELS, VISUAL_VARIANTS)
        .map(effect => ({ ...scene, visualEffect: effect.id, title: format('vn.sequence.testVisual', { effect: effectName(effect, localize) }) }));

    // Prefer each section's active speaker, then fill empty sections with remaining portraits.
    const selected = CAST_FIELDS.map((field, i) => {
        const speaker = state.speakers?.[SCENE_POSITIONS[i]];
        return state[field].includes(speaker) ? speaker : state[field][0];
    });
    const remaining = [...new Set(CAST_FIELDS.flatMap(field => state[field]))].filter(id => !selected.includes(id));
    const slots = selected.map(id => id ?? remaining.shift());
    const actors = slots.filter(Boolean);
    if (!actors.length) return [...particles, ...visuals];

    const portraitStage = {
        ...base,
        ...Object.fromEntries(CAST_FIELDS.map((field, i) => [field, slots[i] ? [slots[i]] : []])),
        speakers: Object.fromEntries(SCENE_POSITIONS.map((position, i) => [position, slots[i] ?? null])),
        portraitScales: Object.fromEntries(actors.map(id => [id, SCALE_LIMITS.MAX])),
    };
    const portraitEffects = CHAR_FX_GROUPS.flatMap(group => group.fx).filter(id => id !== 'none').flatMap(baseId =>
        (CHAR_FX_VARIANTS[baseId] ?? [{ id: baseId }]).map(({ id, label }) => ({
            id, label: `vn.charFx.${baseId}`, variant: id === baseId ? undefined : label,
        })));
    const portraits = [];
    for (let i = 0; i < portraitEffects.length; i += actors.length) {
        const group = portraitEffects.slice(i, i + actors.length);
        const effects = actors.map((_, j) => group[j] ?? portraitEffects[j]);
        portraits.push({
            ...portraitStage,
            charFx: Object.fromEntries(actors.map((id, j) => [id, effects[j].id])),
            title: effects.map(effect => effectName(effect, localize)).join(' / '),
        });
    }
    return [...particles, ...visuals, ...portraits];
}

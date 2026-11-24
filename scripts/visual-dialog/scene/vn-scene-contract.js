// Scene data shared by storage, sockets, forms and the runtime. No DOM or Foundry reads.
import { isRecord, isString, isBoolean, isNumber, arrayOf, recordOf, optionalFields } from '../../utils/validation.js';
import { clamp } from '../../utils/math.js';
import { normalizeParticleEffect, PARTICLE_TYPES, PARTICLE_VARIANTS } from '../visual-effects/atmosphere/config/particle-types.js';
import { particleMotionModes } from '../visual-effects/atmosphere/config/particle-effect-settings.js';
import { DEFAULT_ENTRANCE, resolveEntrance } from '../visual-effects/vn-transition-config.js';
import { normalizeCharFx } from '../visual-effects/character-fx/config.js';
import { isCaptionStyle, normalizeCaptionStyle } from '../overlay/vn-caption.js';
import { VISUAL_EFFECT_SETTINGS } from '../visual-effects/atmosphere/config/visual-effect-settings.js';
import { normalizeVisualEffect, VISUAL_TYPES, VISUAL_VARIANTS } from '../visual-effects/atmosphere/config/visual-types.js';

export { isRecord, isString, isBoolean, isNumber, arrayOf, recordOf, optionalFields } from '../../utils/validation.js';

export function resolveVisualAngle(value) {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(Math.round(n), 0, 360) : 0;
}

export const SCENE_POSITIONS = ['left', 'center', 'right'];
export const SCALE_LIMITS = { MIN: 0.5, MAX: 2.0 };
export const PARTICLE_TEMPO_LIMITS = { MIN: 0.5, MAX: 2 };
export const PARTICLE_LAYERS = ['back', 'front', 'mix'];
export const PARTICLE_LAYER_ICONS = { back: 'fa-arrow-down', mix: 'fa-shuffle', front: 'fa-arrow-up' };
export const PARTICLE_DEPTHS = ['flat', 'soft', 'deep'];
export const PARTICLE_DEPTH_ICONS = { flat: 'fa-minus', soft: 'fa-layer-group', deep: 'fa-cubes-stacked' };
export const WIND_MAX = 10;
export const resolveParticleDepth = v => PARTICLE_DEPTHS.includes(v) ? v : 'flat';
export const resolveParticleWind = v => clamp(Math.round(Number(v) || 0), -WIND_MAX, WIND_MAX);
export function resolveParticlesLayer(p) {
    return PARTICLE_LAYERS.includes(p?.particlesLayer) ? p.particlesLayer : p?.particlesForeground ? 'front' : 'back';
}

const isTintColor = value => isString(value) && /^#[\da-f]{6}$/i.test(value);

const bounded = (min, max, round = v => v) => v => clamp(round(v), min, max);
const field = (value, check, normalize = v => v) => ({ value, check, normalize });
const tintColor = (initial = '#ffffff') => field(initial, isTintColor, value => value.toLowerCase());
const visualControls = {
    range: ({ initial }) => field(initial, isNumber, bounded(0, 100, Math.round)),
    color: ({ initial }) => tintColor(initial),
    select: ({ initial, choices }) => field(initial, value => isString(value) && Object.hasOwn(choices, value)),
};
const strings = () => field([], arrayOf(isString));
const map = (check, normalize) => field({}, recordOf(check), normalize);
const isParticleEffectSettings = value => isRecord(value) && Object.entries(value).every(([type, options]) =>
    isRecord(options) && Object.keys(options).length === 1
    && Object.hasOwn(options, 'motion') && particleMotionModes(type).includes(options.motion));

// The only list of persisted scene fields. Defaults are cloned for every scene.
export const SCENE_FIELDS = {
    leftIds: strings(), centerIds: strings(), rightIds: strings(), presetActors: strings(),
    background: field(null, isString),
    backgroundOverlay: field(true, isBoolean), vignette: field(true, isBoolean), groundFog: field(true, isBoolean),
    portraitScale: field(1, isNumber, bounded(SCALE_LIMITS.MIN, SCALE_LIMITS.MAX)),
    initialEntrance: field(DEFAULT_ENTRANCE, isString, resolveEntrance),
    characterEntrance: field(DEFAULT_ENTRANCE, isString, resolveEntrance),
    particleEffect: field('particles', isString, normalizeParticleEffect), visualEffect: field('none', isString, normalizeVisualEffect),
    particleEffectSettings: field({}, isParticleEffectSettings),
    visualAngle: field(0, isNumber, resolveVisualAngle),
    visualLayerStrength: field(100, isNumber, bounded(0, 100, Math.round)),
    visualTintColor: tintColor(), visualTintStrength: field(0, isNumber, bounded(0, 100, Math.round)),
    visualBackground: field(true, isBoolean), visualForeground: field(false, isBoolean),
    ...Object.fromEntries(Object.entries(VISUAL_EFFECT_SETTINGS).map(([key, definition]) =>
        [key, visualControls[definition.control](definition)])),
    particlesLayer: field('back', isString, v => resolveParticlesLayer({ particlesLayer: v })),
    particleIntensity: field(1, isNumber, bounded(1, 20, Math.round)),
    particleScale: field(1, isNumber, bounded(SCALE_LIMITS.MIN, SCALE_LIMITS.MAX)),
    particleOpacity: field(100, isNumber, bounded(0, 100, Math.round)),
    particleSolidTexture: field(false, isBoolean),
    particleTempo: field(1, isNumber, bounded(PARTICLE_TEMPO_LIMITS.MIN, PARTICLE_TEMPO_LIMITS.MAX)),
    particleTintColor: tintColor(),
    particleTintStrength: field(0, isNumber, bounded(0, 100, Math.round)),
    particleDepth: field('flat', isString, resolveParticleDepth),
    particleWind: field(0, isNumber, resolveParticleWind), particleGusts: field(true, isBoolean),
    particleWrap: field(true, isBoolean),
    speakers: field({ left: null, center: null, right: null }, recordOf(v => v === null || isString(v)),
        v => Object.fromEntries(SCENE_POSITIONS.map(pos => [pos, v[pos] ?? null]))),
    flipped: map(isBoolean), visibility: map(isString), charFx: map(isString, normalizeCharFx),
    musicUuid: field(null, isString),
    soundCues: field([], arrayOf(v => isRecord(v) && isString(v.uuid)
        && optionalFields(v, { id: isString, label: isString }))),
    caption: field('', isString), captionStyle: field({}, isCaptionStyle, normalizeCaptionStyle),
    portraitImages: map(isString), portraitNames: map(isString), portraitScales: map(isNumber),
};
export const SCENE_CHECKS = Object.fromEntries(Object.entries(SCENE_FIELDS).map(([key, f]) => [key, f.check]));
export const PARTICLE_SETTINGS_FIELDS = [
    'particlesLayer', 'particleIntensity', 'particleScale', 'particleOpacity', 'particleSolidTexture', 'particleTempo',
    'particleTintColor', 'particleTintStrength',
    'particleDepth', 'particleWind', 'particleGusts', 'particleWrap',
];
export const PARTICLE_SETTINGS_DEFAULTS = Object.freeze(Object.fromEntries(
    PARTICLE_SETTINGS_FIELDS.map(key => [key, SCENE_FIELDS[key].value])
));
export const isParticleSettingsPatch = value => isRecord(value) && Object.entries(value)
    .every(([key, setting]) => (key === 'particleEffectSettings' || PARTICLE_SETTINGS_FIELDS.includes(key))
        && SCENE_FIELDS[key].check(setting));
const VISUAL_SETTINGS_FIELDS = [
    'visualLayerStrength', 'visualTintColor', 'visualTintStrength', 'visualBackground', 'visualForeground', 'visualAngle',
    ...Object.keys(VISUAL_EFFECT_SETTINGS),
];
export const VISUAL_SETTINGS_DEFAULTS = Object.freeze(Object.fromEntries(
    VISUAL_SETTINGS_FIELDS.map(key => [key, SCENE_FIELDS[key].value])
));
export const isVisualSettingsPatch = value => isRecord(value) && Object.entries(value)
    .every(([key, setting]) => VISUAL_SETTINGS_FIELDS.includes(key) && SCENE_FIELDS[key].check(setting));
export const LEGACY_SCENE_CHECKS = {
    atmosphereEffect: isString, particlesForeground: isBoolean, hidden: recordOf(isBoolean),
};
export const CAST_FIELDS = ['leftIds', 'centerIds', 'rightIds'];
export const STAGE_FIELDS = [...CAST_FIELDS, 'portraitImages', 'portraitNames', 'portraitScales', 'flipped', 'visibility', 'charFx'];
export const LAYOUT_FIELDS = Object.keys(SCENE_FIELDS).filter(k => !['portraitScale', 'musicUuid', 'soundCues'].includes(k));

export function isScenePayload(value) {
    return isRecord(value) && optionalFields(value, SCENE_CHECKS) && optionalFields(value, LEGACY_SCENE_CHECKS);
}

export function sceneDefaults() {
    return Object.fromEntries(Object.entries(SCENE_FIELDS).map(([key, f]) => [key, structuredClone(f.value)]));
}

export function sceneSnapshot(state) {
    return Object.fromEntries(Object.keys(SCENE_FIELDS).map(key => [key, structuredClone(state[key])]));
}

function assertScene(value) {
    if (!isScenePayload(value)) throw new TypeError('Invalid VN scene payload');
}

function isSupportedEffect(effect, types, variants) {
    if (!isString(effect)) return false;
    const separator = effect.indexOf(':');
    if (separator === -1) return types.includes(effect);
    const type = effect.slice(0, separator);
    const variant = effect.slice(separator + 1);
    return types.includes(type) && variants[type]?.some(({ id }) => id === variant);
}

export const isSupportedParticleEffect = effect => isSupportedEffect(effect, PARTICLE_TYPES, PARTICLE_VARIANTS);
export const isSupportedVisualEffect = effect => isSupportedEffect(effect, VISUAL_TYPES, VISUAL_VARIANTS);

function disableUnavailableEffects(source, result) {
    // Some removed particles normalize to 'none' for older clients and settings.
    const removedParticle = result.particleEffect === 'none' && source.particleEffect !== 'none';
    if (source.atmosphereEffect != null || removedParticle
        || (result.particleEffect != null && !isSupportedParticleEffect(result.particleEffect))
        || (result.visualEffect != null && !isSupportedVisualEffect(result.visualEffect))) {
        result.particleEffect = 'none';
        result.visualEffect = 'none';
    }
}

/** Full snapshot: omitted/null fields get defaults; legacy fields are converted. */
export function readSceneSnapshot(source) {
    assertScene(source);
    const result = sceneDefaults();
    for (const [key, f] of Object.entries(SCENE_FIELDS)) {
        if (source[key] != null) result[key] = structuredClone(f.normalize(source[key]));
    }
    disableUnavailableEffects(source, result);
    if (source.particleEffect == null) result.particleEffect = 'none';
    result.particlesLayer = resolveParticlesLayer(source);
    if (!source.visibility && source.hidden) {
        result.visibility = Object.fromEntries(Object.entries(source.hidden).filter(([, v]) => v === true).map(([id]) => [id, 'hidden']));
    }
    return result;
}

/** Update: cast defaults to empty; other absent/null fields retain their old values.
 * Explicit null music stops playback; null presetActors clears the off-stage cast;
 * null entrances reset to their default. These differ deliberately from a snapshot.
 */
export function readScenePatch(source) {
    assertScene(source);
    const result = {};
    for (const [key, f] of Object.entries(SCENE_FIELDS)) {
        if (source[key] != null) result[key] = structuredClone(f.normalize(source[key]));
    }
    disableUnavailableEffects(source, result);
    for (const key of CAST_FIELDS) result[key] ??= [];
    if (source.presetActors === null) result.presetActors = [];
    if (source.musicUuid === null) result.musicUuid = null;
    for (const key of ['initialEntrance', 'characterEntrance']) {
        if (source[key] === null) result[key] = SCENE_FIELDS[key].value;
    }
    if (source.particlesLayer != null || source.particlesForeground != null) result.particlesLayer = resolveParticlesLayer(source);
    return result;
}

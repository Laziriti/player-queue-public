// Structural checks at the import boundary. Missing/null fields retain their legacy defaults;
// malformed fields reject the whole preset, including any malformed sequence step.

import { isRecord, isString, isBoolean, isNumber, arrayOf, optionalFields } from '../../utils/validation.js';
import { SCENE_CHECKS, LEGACY_SCENE_CHECKS } from '../scene/vn-scene-contract.js';

const SCENE_FIELDS = { ...SCENE_CHECKS, ...LEGACY_SCENE_CHECKS, thumbnailData: isString };

const STEP_FIELDS = {
    ...SCENE_FIELDS,
    id: isString,
    title: isString,
    autoAdvance: value => isNumber(value) && value >= 0,
    inheritActors: isBoolean,
    transition: isString,
};

const PRESET_FIELDS = {
    ...SCENE_FIELDS,
    version: isString,
    type: isString,
    createdAt: isNumber,
    updatedAt: isNumber,
    savedAt: isNumber,
    folderId: isString,
    sceneId: isString,
    sceneName: isString,
    scenes: arrayOf(value => isRecord(value) && optionalFields(value, { id: isString, name: isString })),
    tags: arrayOf(isString),
    transition: isString,
    transitionSpeed: isString,
    preload: isBoolean,
};

export function isValidImportedPreset(preset) {
    if (!isRecord(preset) || !optionalFields(preset, PRESET_FIELDS)) return false;
    if (preset.type === 'sequence' || preset.steps != null) {
        return Array.isArray(preset.steps) && preset.steps.every(step => isRecord(step)
            && !Object.hasOwn(step, 'steps') && step.type !== 'sequence'
            && optionalFields(step, STEP_FIELDS));
    }
    return true;
}

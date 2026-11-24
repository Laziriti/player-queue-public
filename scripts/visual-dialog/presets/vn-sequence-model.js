// Sequence data operations shared by the editor and runtime; no playback, DOM or Foundry reads.
import { STAGE_FIELDS, CAST_FIELDS } from '../scene/vn-scene-contract.js';
export { STAGE_FIELDS } from '../scene/vn-scene-contract.js';

export function hasActors(step) {
    return CAST_FIELDS.some(key => step?.[key]?.length);
}

export function sameCast(a, b) {
    return CAST_FIELDS.every(key => JSON.stringify(a?.[key] ?? []) === JSON.stringify(b?.[key] ?? []));
}

export function clearStage(step) {
    for (const key of STAGE_FIELDS) step[key] = CAST_FIELDS.includes(key) ? [] : {};
    return step;
}

/** Empty inheriting steps take the stage from the previous effective step.
 * An explicit empty step is a barrier. The requested step retains its own music/caption/settings.
 */
export function resolveStep(steps, index) {
    const step = steps[index];
    if (!step?.inheritActors || hasActors(step) || index <= 0) return step;
    let sourceIndex = index - 1;
    while (sourceIndex > 0 && steps[sourceIndex]?.inheritActors && !hasActors(steps[sourceIndex])) sourceIndex--;
    const source = steps[sourceIndex];
    if (!hasActors(source)) return step;
    const merged = { ...step };
    for (const key of STAGE_FIELDS) merged[key] = structuredClone(source[key]);
    return merged;
}

/** Empty music means the latest explicit track before this step. */
export function inheritedMusic(steps, index) {
    for (let i = index - 1; i >= 0; i--) if (steps[i]?.musicUuid) return steps[i].musicUuid;
    return null;
}

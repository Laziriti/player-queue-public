/**
 * Scenes a preset is linked to: [{ id, name }]. Presets saved before 14.15.0 still carry the single pair
 * sceneId / sceneName (until the migration runs), so both shapes are read here.
 */
export function presetScenes(p) {
    if (Array.isArray(p?.scenes)) return p.scenes.filter(s => s && (s.id || s.name));
    return p?.sceneId || p?.sceneName ? [{ id: p.sceneId ?? null, name: p.sceneName ?? '' }] : [];
}

/** Distinct, non-empty scene names of a preset, alphabetically. */
export function presetSceneNames(p) {
    return [...new Set(presetScenes(p).map(s => String(s.name ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Groups presets by scene name, sorted alphabetically with the "no scene" group last.
// A preset linked to several scenes is listed in each of their groups; with `unique` only in the first one
// (alphabetically), for lists where a preset must be ticked once (export).
// Shared by VNPresetsManager and VNAdventureIOManager, whose scene-group rendering differs
// but whose grouping/sorting logic must not.
export function groupPresetsByScene(presets, { unique = false } = {}) {
    const groups = new Map();
    for (const p of presets) {
        const names = presetSceneNames(p);
        for (const key of names.length ? (unique ? names.slice(0, 1) : names) : ['']) {
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
        }
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b);
    });
    return sortedKeys.map(key => ({ key, presets: groups.get(key) }));
}

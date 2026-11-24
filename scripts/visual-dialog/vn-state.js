// Compatibility exports for macros and older integrations. Runtime code imports the focused modules.
export { MODULE_ID } from './vn-constants.js';
export { VNSceneState } from './scene/vn-scene-state.js';
export { VNPresets } from './presets/vn-presets.js';
export { VNFolders } from './presets/vn-folders.js';
export { VNStore } from './presets/vn-store.js';
export { windLabel } from './effect-controls/vn-scene-labels.js';
export { PARTICLE_LAYERS, PARTICLE_LAYER_ICONS, PARTICLE_DEPTHS, PARTICLE_DEPTH_ICONS,
    WIND_MAX, resolveParticleDepth, resolveParticleWind, resolveParticlesLayer } from './scene/vn-scene-contract.js';

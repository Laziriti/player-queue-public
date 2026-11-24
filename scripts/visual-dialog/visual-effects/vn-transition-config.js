// Data constraints shared by the scene model and transition renderer.
export const ENTER_TYPES = ['none', 'auto', 'fade', 'left', 'right', 'rise', 'drop', 'pop', 'dramatic', 'shadow'];
export const DEFAULT_ENTRANCE = 'fade';
export const resolveEntrance = value => ENTER_TYPES.includes(value) ? value : DEFAULT_ENTRANCE;
export const TRANSITION_TYPES = ['dissolve', 'zoom', 'blur', 'flash', 'black', 'sweep', 'orbit', 'teleport', 'cut'];
export const TRANSITION_SPEEDS = { fast: 0.6, normal: 1, slow: 1.6 };

export const VISUAL_EFFECT_SETTINGS = {
    monochromeAmount: { effect: 'monochrome', control: 'range', initial: 100, label: 'vn.atmosphere.visualSettings.monochromeAmount', icon: 'fa-circle-half-stroke' },
    floodLevel: { effect: 'flood', control: 'range', initial: 35, label: 'vn.atmosphere.visualSettings.floodLevel', icon: 'fa-water' },
    floodColor: { effect: 'flood', control: 'color', initial: '#359eaf', label: 'vn.atmosphere.visualSettings.floodColor', icon: 'fa-palette' },
    mirrorWorldColor: { effect: 'mirror_world', control: 'color', initial: '#78cfff', label: 'vn.atmosphere.visualSettings.mirrorWorldColor', icon: 'fa-palette' },
    hologramScanColor: { effect: 'hologram', control: 'color', initial: '#96faff', label: 'vn.atmosphere.visualSettings.hologramScanColor', icon: 'fa-palette' },
    eclipsePhase: { effect: 'eclipse:phase', control: 'range', initial: 25, label: 'vn.atmosphere.visualSettings.eclipsePhase', icon: 'fa-moon' },
    snowDepth: { effect: 'ice:blizzard', control: 'range', initial: 0, label: 'vn.atmosphere.visualSettings.snowDepth', icon: 'fa-snowflake' },
    glassCrackSize: { effect: 'glass_shatter', control: 'range', initial: 50, label: 'vn.atmosphere.visualSettings.glassCrackSize', icon: 'fa-expand' },
    glassShardSize: { effect: 'glass_shatter:background', control: 'select', initial: 'medium',
        label: 'vn.atmosphere.visualSettings.glassShardSize', icon: 'fa-shapes', choices: {
            small: 'vn.atmosphere.visualSettings.glassShardSmall',
            medium: 'vn.atmosphere.visualSettings.glassShardMedium',
            large: 'vn.atmosphere.visualSettings.glassShardLarge',
        } },
    cosmicEntity: { effect: 'cosmic_horror:eye', control: 'select', initial: 'eye', label: 'vn.atmosphere.visualSettings.cosmicEntity',
        icon: 'fa-eye', choices: {
            eye: 'vn.atmosphere.visualSettings.entityEye',
            mouth: 'vn.atmosphere.visualSettings.entityMouth',
            eye_mouth: 'vn.atmosphere.visualSettings.entityEyeMouth',
        } },
};

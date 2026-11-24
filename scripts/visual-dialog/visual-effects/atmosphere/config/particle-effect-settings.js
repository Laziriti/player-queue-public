const FLUTTER_MODES = ['classic', 'flutter'];
const MOTION_MODES = {
    feathers: FLUTTER_MODES,
    page_scraps: FLUTTER_MODES,
    confetti: FLUTTER_MODES,
    sakura: FLUTTER_MODES,
    glass_dust: ['classic', 'fall'],
};

export function particleMotionModes(type) {
    return Object.hasOwn(MOTION_MODES, type) ? MOTION_MODES[type] : [];
}

export function configurableParticle(effect) {
    const type = (effect ?? '').split(':')[0];
    return Object.hasOwn(MOTION_MODES, type) ? type : null;
}

export function particleMotion(effect, settings) {
    const type = configurableParticle(effect);
    const motion = settings?.[type]?.motion;
    return particleMotionModes(type).includes(motion) ? motion : 'classic';
}

export function withParticleMotion(settings, effect, motion) {
    const type = configurableParticle(effect);
    if (!particleMotionModes(type).includes(motion)) return settings;
    if ((settings?.[type]?.motion ?? 'classic') === motion) return settings;
    const next = { ...settings };
    if (motion !== 'classic') next[type] = { motion };
    else delete next[type];
    return next;
}

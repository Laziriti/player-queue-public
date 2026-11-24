import { PixiBackgroundEffect } from './background/pixi-background-effect.js';
import { cubicBezier } from '../../../easing.js';
import { EffectProgress } from './effect-progress.js';
import { VISUAL_EFFECT_SETTINGS } from '../../config/visual-effect-settings.js';

export const COLOR_GRADE_EFFECTS = [
    'warm', 'cold', 'dawn', 'day', 'sunset', 'dusk', 'overcast', 'heat',
    'candlelit', 'torchlit', 'windowlight', 'forest', 'cave',
    'moonlight', 'sandstorm', 'frost', 'fog', 'dark', 'abyss',
    'noir', 'memory', 'neon', 'carnival', 'blood_moon', 'sacred:lunar',
    'fire', 'apocalypse', 'hologram', 'storm', 'dream', 'underwater', 'eldritch',
    'ethereal', 'corruption', 'shadow_intrigue', 'cosmic_horror', 'ghosts',
    'void_breach', 'earthquake'
];

const gradeAnimations = new Set(['vnCosmicBgWarp', 'vnCorruptionDistort', 'vnIntrigueBgBreath', 'vnEtherealBg',
    'vnGhostsBgBreath', 'vnGhostsShadowsBg', 'vnVoidBgSlow']);
const usesTime = new Set(['heat', 'dream', 'underwater', 'eldritch', 'ethereal', 'corruption', 'shadow_intrigue',
    'cosmic_horror', 'ghosts', 'void_breach']);
const easeInOut = [0.42, 0, 0.58, 1];

export class PixiColorGradeEffect {
    start(overlay, variant, type, { snowDepth = VISUAL_EFFECT_SETTINGS.snowDepth.initial } = {}) {
        this.snowDepth = type === 'frost' && variant === 'blizzard' ? new EffectProgress(snowDepth) : null;
        const heat = type === 'heat' ? 'ground' : type === 'fire' && variant === 'room' ? 'room' : null;
        const continuous = usesTime.has(type) || heat === 'room';
        const flash = overlay.querySelector('.vn-fx-flash');
        const storm = type === 'storm';
        let describeGrade;
        this.effect = new PixiBackgroundEffect({
            load: async () => {
                const shader = await import('./color-grade-pixi-mesh.js');
                describeGrade = shader.describeGrade;
                return shader.ColorGradePixiMesh;
            },
            canvasClass: 'vn-grade-pixi',
            prepare: (_layout, layer) => ({ layer }),
            animate: (mesh, now, start, state) => {
                if (this.snowDepth) mesh.uniforms.uSnowDepth = this.snowDepth.at(now);
                const time = Math.max(0, now - start) / 1000;
                const { layer } = state;
                if (!state.grade || type === 'eldritch') {
                    const style = getComputedStyle(layer);
                    const css = style.getPropertyValue('--vn-bg-color-grade').trim();
                    const distortion = style.getPropertyValue('--vn-bg-distortion').trim();
                    if (css !== state.css || distortion !== state.distortion) {
                        state.grade = { ...describeGrade(css), distortion, heat };
                        state.css = css;
                        state.distortion = distortion;
                    }
                }
                if (storm && flash?.classList.contains('vn-lightning-active')) {
                    state.lightning ??= describeGrade(getComputedStyle(overlay).getPropertyValue('--vn-storm-flash-grade').trim());
                    mesh.render(time, state.lightning);
                    return;
                }
                const current = state.animation?.playState;
                if (current !== 'running' && current !== 'paused' && continuous && !heat && now >= (state.findAfter ?? 0)) {
                    state.findAfter = now + 200;
                    state.animation = layer.getAnimations().find(a => gradeAnimations.has(a.animationName));
                    state.keys = state.animation?.effect.getKeyframes().map(({ computedOffset, filter }) =>
                        ({ at: computedOffset, grade: describeGrade(filter) }));
                }
                const phase = state.animation?.effect.getComputedTiming().progress;
                if (phase != null && state.keys?.length > 1) {
                    const index = state.keys.findIndex(key => key.at >= phase);
                    const a = state.keys[Math.max(0, index - 1)], b = state.keys[Math.max(1, index)];
                    mesh.render(time, a.grade, b.grade, cubicBezier(easeInOut, (phase - a.at) / (b.at - a.at)));
                } else mesh.render(time, state.grade);
            },
            continuous
        });
        if (storm && flash) {
            this.observer = new MutationObserver(() => this.effect.drawFor(40));
            this.observer.observe(flash, { attributes: true, attributeFilter: ['class'] });
        }
        this.effect.start(overlay);
    }

    setSettings({ snowDepth = VISUAL_EFFECT_SETTINGS.snowDepth.initial }) {
        const duration = this.snowDepth?.set(snowDepth);
        if (duration !== undefined) this.effect.drawFor(duration + 100);
    }

    stop() {
        this.observer?.disconnect();
        this.effect?.stop();
    }
}

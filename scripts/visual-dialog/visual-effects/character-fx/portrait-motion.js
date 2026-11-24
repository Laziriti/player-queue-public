import { cubicBezier } from '../easing.js';
import { lerp } from '../../../utils/math.js';

const EASE = [0.25, 0.1, 0.25, 1];
const DROP = [0.22, 0.61, 0.36, 1];
const EASE_OUT = [0, 0, 0.58, 1];
const EXIT = [0.55, 0, 1, 0.45];

export function motionPadding(type, width, height) {
    switch (type) {
        case 'left':
        case 'right': return [60, 0, 4];
        case 'drop': return [0, 80, 4];
        case 'rise': return [0, 0, 80];
        case 'dramatic': return [Math.ceil(width * 0.09), Math.ceil(height * 0.18) + 6, Math.ceil(height * 0.18) + 32];
        case 'shadow': return [0, 0, 24];
        case 'exit': return [0, 0, 10];
        default: return [0, 0, 4];
    }
}

export function portraitPose(type, t, active, flip) {
    const restY = active ? 0 : 4;
    const restScale = active ? 1 : 0.97;
    let x = 0, y = restY, scale = restScale, alpha;
    const ease = fraction => cubicBezier(EASE, fraction);
    const p = ease(t);
    alpha = p;
    switch (type) {
        case 'left':
        case 'right':
            x = lerp(type === 'left' ? -60 : 60, 0, p);
            y = lerp(0, restY, p);
            break;
        case 'drop':
            alpha = cubicBezier(DROP, t);
            y = lerp(-80, restY, alpha);
            break;
        case 'rise':
            y = lerp(80, restY, p);
            break;
        case 'pop':
            alpha = cubicBezier(DROP, t);
            scale = lerp(0.8, restScale, alpha);
            break;
        case 'dramatic': {
            const settling = t >= 0.72;
            const k = ease(settling ? (t - 0.72) / 0.28 : t / 0.72);
            y = settling ? lerp(restY - 6, restY, k) : lerp(32, restY - 6, k);
            scale = settling ? lerp(restScale * 0.98, restScale, k) : lerp(1.18, restScale * 0.98, k);
            alpha = ease(Math.min(1, t / 0.25));
            break;
        }
        case 'shadow':
            y = lerp(restY + 20, restY, cubicBezier(EASE_OUT, t));
            alpha = cubicBezier(EASE_OUT, Math.min(1, t / 0.25));
            break;
        case 'exit': {
            const k = cubicBezier(EXIT, t);
            y = lerp(restY, 10, k);
            alpha = 1 - k;
            break;
        }
    }
    return { x, y, scaleX: scale * flip, scaleY: scale, alpha };
}

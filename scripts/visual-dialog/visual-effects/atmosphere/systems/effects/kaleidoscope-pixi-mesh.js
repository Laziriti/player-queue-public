import { PixiBackgroundQuad } from './background/pixi-background-quad.js';
import { cubicBezier } from '../../../easing.js';

// Чётное число: нечётные сегменты зеркальные, при нечётном шов на 360° не сойдётся
const KALEIDO_SEGMENTS = 6;
const KALEIDO_SWAY_DEG = 6;   // амплитуда качания картинки в клине
const KALEIDO_SWAY_SEC = 32;  // полный цикл качания
const KALEIDO_SPIN_SEC = 60;  // полный оборот всего калейдоскопа

function kaleidoZoom(w, h) {
    const half = Math.PI / KALEIDO_SEGMENTS;
    const sway = KALEIDO_SWAY_DEG * Math.PI / 180;
    const hw = w / 2, hh = h / 2;
    const reach = Math.hypot(hw, hh);
    const samples = 24;
    let need = 1;

    for (let i = 0; i <= samples; i++) {
        const a = -half + 2 * half * i / samples;
        for (const s of [sway, -sway]) {
            const px = reach * Math.cos(a), py = reach * Math.sin(a);
            const ix = px * Math.cos(s) + py * Math.sin(s);
            const iy = -px * Math.sin(s) + py * Math.cos(s);
            need = Math.max(need, Math.abs(ix) / hw, Math.abs(iy) / hh);
        }
    }
    return Math.max(1.05, need * 1.06);
}

const TAU = 2 * Math.PI;
const SWAY = KALEIDO_SWAY_DEG * Math.PI / 180;
const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform float uZoom;
    uniform float uSpin;
    uniform float uSway;
    out vec4 color;
    void main() {
        const float segment = ${TAU / KALEIDO_SEGMENTS};
        vec2 polarPoint = vPoint - uSize * 0.5;
        float angle = atan(polarPoint.y, polarPoint.x) - uSpin;
        float wedge = floor(angle / segment + 0.5);
        float localAngle = angle - wedge * segment;
        // Consecutive wedges sample the same edge from opposite directions.
        localAngle = (mod(wedge, 2.0) < 1.0 ? localAngle : -localAngle) - uSway;
        vec2 p = uSize * 0.5 + length(polarPoint) / uZoom * vec2(cos(localAngle), sin(localAngle));
        color = texture(uTexture, (p - uCover.xy) * uCover.zw);
    }
`;

const swayCurve = [0.42, 0, 0.58, 1];

export class KaleidoscopePixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-kaleidoscope',
            uniforms: {
                uZoom: { value: 1, type: 'f32' },
                uSpin: { value: 0, type: 'f32' },
                uSway: { value: 0, type: 'f32' }
            }
        });
    }

    resize(layout) {
        super.resize(layout);
        this.uniforms.uZoom = kaleidoZoom(layout.width, layout.height);
    }

    render(now) {
        const swayPhase = now % KALEIDO_SWAY_SEC / KALEIDO_SWAY_SEC;
        const swing = 1 - Math.abs(2 * swayPhase - 1);
        this.uniforms.uSpin = now % KALEIDO_SPIN_SEC / KALEIDO_SPIN_SEC * TAU;
        this.uniforms.uSway = SWAY * (2 * cubicBezier(swayCurve, swing) - 1);
        super.render();
    }
}

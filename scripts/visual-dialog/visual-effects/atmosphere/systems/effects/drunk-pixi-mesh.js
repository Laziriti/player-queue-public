import { PixiBackgroundQuad } from './background/pixi-background-quad.js';
import { cubicBezier } from '../../../easing.js';

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform vec3 uGhostA;
    uniform vec3 uGhostB;
    uniform float uBlur;
    out vec4 color;

    vec4 samplePhoto(vec2 p) {
        if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, uSize))) return vec4(0.0);
        return texture(uTexture, (p - uCover.xy) * uCover.zw);
    }
    vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
    void main() {
        vec4 base = samplePhoto(vPoint);
        vec4 a = samplePhoto(vPoint - uGhostA.xy) * uGhostA.z;
        vec2 p = vPoint - uGhostB.xy;
        float radius = uBlur * 1.414213562;
        vec4 b = samplePhoto(p) * 0.25;
        b += 0.125 * (samplePhoto(p + vec2(radius, 0.0)) + samplePhoto(p - vec2(radius, 0.0))
            + samplePhoto(p + vec2(0.0, radius)) + samplePhoto(p - vec2(0.0, radius)));
        b += 0.0625 * (samplePhoto(p + vec2(radius, radius)) + samplePhoto(p - vec2(radius, radius))
            + samplePhoto(p + vec2(radius, -radius)) + samplePhoto(p + vec2(-radius, radius)));
        vec4 result = over(b * uGhostB.z, over(a, base));
        vec3 rgb = result.rgb / max(result.a, 0.0001);
        rgb = clamp(mix(vec3(dot(rgb, vec3(0.213, 0.715, 0.072))), rgb, 1.1), 0.0, 1.0);
        rgb = clamp((rgb - 0.5) * 1.04 + 0.5, 0.0, 1.0);
        color = vec4(rgb * result.a, result.a);
    }
`;

const ease = [0.42, 0, 0.58, 1];
const ghostA = [[0, 0, 0, 0], [0.25, -1, 0.4, 1], [0.5, 0.6, -0.5, 0.6], [0.75, 1, 0.3, 1], [1, 0, 0, 0]];
const ghostB = [[0, 0, 0, 0], [0.3, 0.8, -0.6, 1.2], [0.55, -1.2, 0.5, 0.5], [0.8, 0.4, 0, 1.2], [1, 0, 0, 0]];

function ghostAt(output, phase, keys, amplitudes) {
    const next = keys.findIndex(key => phase < key[0]);
    const a = keys[next - 1], b = keys[next];
    const t = cubicBezier(ease, (phase - a[0]) / (b[0] - a[0]));
    for (let i = 0; i < 3; i++) output[i] = amplitudes[i] * (a[i + 1] + (b[i + 1] - a[i + 1]) * t);
}

export class DrunkPixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-drunk',
            uniforms: {
                uGhostA: { value: new Float32Array(3), type: 'vec3<f32>' },
                uGhostB: { value: new Float32Array(3), type: 'vec3<f32>' },
                uBlur: { value: 0, type: 'f32' }
            }
        });
    }

    resize(layout, params) {
        super.resize(layout);
        this.amplitudes = params;
        this.uniforms.uBlur = params[3];
    }

    render(time) {
        ghostAt(this.uniforms.uGhostA, time % 8.3 / 8.3, ghostA, this.amplitudes);
        ghostAt(this.uniforms.uGhostB, time % 11.9 / 11.9, ghostB, this.amplitudes);
        super.render();
    }
}

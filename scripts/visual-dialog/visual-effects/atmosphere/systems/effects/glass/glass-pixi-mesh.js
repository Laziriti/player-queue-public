import { Buffer, BufferUsage, Geometry } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { GlassSurface } from './glass-surface.js';
import { makeGlassLayout } from './glass-layout.js';

const vertex = `#version 300 es
    in vec2 aPosition;
    in vec4 aColor;
    in vec2 aOrigin;
    in vec4 aFlight;
    in float aGrowth;
    uniform vec2 uSize;
    uniform vec3 uImpact;
    uniform float uTime;
    out vec4 vColor;
    out float vGrowth;

    void main() {
        vec2 position = aPosition;
        float alpha = aColor.a;
        float life = aFlight.w;
        if (life > 0.0) {
            float age = clamp(uTime / life, 0.0, 1.0);
            float spin = aFlight.z * age;
            vec2 local = position - aOrigin;
            position = aOrigin + mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * local;
            position += aFlight.xy * age + vec2(0.0, uImpact.z * 0.16 * age * age);
            alpha *= smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.32, 1.0, age));
            alpha *= 0.54 + 0.46 * abs(cos(spin + life * 9.0));
        } else if (life < 0.0) {
            alpha *= smoothstep(0.0, 0.035, uTime) * (1.0 - smoothstep(0.035, 0.22, uTime));
        } else {
            float reach = min(3.0, length(position - uImpact.xy) / uImpact.z);
            alpha *= smoothstep(reach * 0.105, reach * 0.105 + 0.075, uTime);
        }
        vColor = vec4(aColor.rgb * alpha, alpha);
        vGrowth = aGrowth;
        gl_Position = vec4(position / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
    }
`;

const fragment = `#version 300 es
    in vec4 vColor;
    in float vGrowth;
    uniform float uCrackReach;
    out vec4 color;
    void main() {
        float tip = 1.0 - smoothstep(uCrackReach - 0.075, uCrackReach, vGrowth);
        color = vColor * tip;
    }
`;

function unitNormal(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length };
}

function buildCrack(width, height, { uImpact }) {
    const { impact, span, cracks, faces, chips } = makeGlassLayout(width, height);
    const vertices = [], indices = [];
    const growthAt = p => Math.hypot(p.x - impact.x, p.y - impact.y) / span;
    const add = (point, color, growth = 0, flight = [0, 0, 0, 0], origin = impact) => {
        const index = vertices.length / 13;
        vertices.push(point.x, point.y, ...color, origin.x, origin.y, ...flight, growth);
        return index;
    };
    const scale = Math.max(0.65, Math.min(1.65, span / 720));

    for (const { points, light, cool, inner } of faces) {
        const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }),
            { x: 0, y: 0 });
        const tint = cool ? [0.57, 0.81, 0.97] : [0.97, 0.78, 0.58];
        const middle = add(center, inner ? [0.017, 0.04, 0.065, 0.72] : [...tint, 0.035 * light], growthAt(center));
        const rim = points.map((p, i) => {
            if (inner && i === 0) return add(p, [0.012, 0.028, 0.05, 0.83]);
            const shine = (i % 3 === 1 ? 0.19 : 0.028) * light;
            return add(p, [...tint, inner ? 0.75 * light : shine], growthAt(p));
        });
        for (let i = 0; i < rim.length; i++) indices.push(middle, rim[i], rim[(i + 1) % rim.length]);
    }

    for (const { points, width: widthFactor, light, tip, growth } of cracks) {
        // Cross section of a fracture: cool bloom, dark groove and a narrow lit bevel.
        const normals = points.slice(1).map((b, i) => unitNormal(points[i], b));
        const profile = [
            [-4.2, [0.36, 0.66, 1.0], 0.00],
            [-1.5, [0.44, 0.73, 1.0], 0.13],
            [-0.83, [0.17, 0.32, 0.50], 0.53],
            [-0.34, [0.02, 0.05, 0.09], 0.85],
            [0.18, [0.39, 0.61, 0.76], 0.54],
            [0.60, [0.90, 0.97, 1.0], 1.0],
            [1.04, [0.59, 0.81, 0.98], 0.47],
            [1.60, [0.47, 0.74, 0.98], 0.10],
            [3.8, [0.36, 0.66, 1.0], 0.00]
        ];

        points.forEach((p, i) => {
            const a = normals[Math.max(0, i - 1)];
            const b = normals[Math.min(i, normals.length - 1)];
            const join = Math.max(0.62, 1 + a.x * b.x + a.y * b.y);
            const distance = growthAt(p);
            const end = i === points.length - 1 ? tip : 1;
            const taper = 0.53 + 0.47 * Math.exp(-4.2 * distance);
            const size = Math.max(0.78, scale * widthFactor * taper) * (0.06 + 0.94 * end);
            const lighting = 0.60 + 0.40 * Math.abs(b.x * 0.52 - b.y * 0.85);
            const row = profile.map(([offset, color, alpha]) => {
                const d = offset * size / join;
                return add({ x: p.x + (a.x + b.x) * d, y: p.y + (a.y + b.y) * d },
                    [...color, Math.min(1, alpha * light * lighting * end)], growth?.[i] ?? distance);
            });
            if (i === 0) return;
            for (let j = 1; j < row.length; j++) {
                const left = row[j - 1], right = row[j], stride = row.length;
                indices.push(left - stride, right - stride, left, left, right - stride, right);
            }
        });
    }

    // The crushed glass catches a brief local flash.
    const flash = add(impact, [0.89, 0.96, 1.0, 0.84], 0, [0, 0, 0, -1]);
    const halo = Array.from({ length: 24 }, (_, i) => {
        const angle = i / 24 * Math.PI * 2;
        return add({ x: impact.x + Math.cos(angle) * span * 0.13, y: impact.y + Math.sin(angle) * span * 0.09 },
            [0.43, 0.72, 1.0, 0], 0, [0, 0, 0, -1]);
    });
    halo.forEach((p, i) => indices.push(flash, p, halo[(i + 1) % halo.length]));

    for (const { origin, shape, velocity, spin, life, light, cool } of chips) {
        const flight = [...velocity, spin, life];
        const edge = cool ? [0.85, 0.96, 1.0, light] : [1.0, 0.89, 0.71, light];
        const mid = add(origin, [0.28, 0.51, 0.72, light * 0.10], 0, flight, origin);
        const rim = shape.map((p, i) => add(p, i === 2 ? [0.43, 0.68, 0.84, light * 0.64] : edge, 0, flight, origin));
        for (let i = 0; i < rim.length; i++) indices.push(mid, rim[i], rim[(i + 1) % rim.length]);
    }

    const buffer = new Buffer({ data: new Float32Array(vertices), usage: BufferUsage.VERTEX });
    const attribute = (format, offset) => ({ buffer, format, stride: 52, offset });
    uImpact.set([impact.x, impact.y, span]);
    return new Geometry({
        attributes: {
            aPosition: attribute('float32x2', 0),
            aColor: attribute('float32x4', 8),
            aOrigin: attribute('float32x2', 24),
            aFlight: attribute('float32x4', 32),
            aGrowth: attribute('float32', 48)
        },
        indexBuffer: new Uint16Array(indices)
    });
}

export class GlassCrackSurface extends GlassSurface {
    constructor() {
        super({ vertex, fragment, name: 'vn-glass-crack' }, {
            uImpact: { value: new Float32Array(3), type: 'vec3<f32>' },
            uCrackReach: { value: 1, type: 'f32' }
        }, buildCrack);
    }

    setAppearance(size) {
        const reach = size <= 50 ? 0.13 + 0.87 * size / 50 : 1 + 0.66 * (size - 50) / 50;
        this.uniforms.uCrackReach.value = reach;
        if (this.values) this.values.uCrackReach = reach;
    }
}

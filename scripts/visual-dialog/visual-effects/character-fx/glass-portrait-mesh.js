import { Buffer, BufferUsage, Geometry, Mesh, Shader } from '../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { PortraitTexture, portraitMotionUniforms } from './portrait-surface.js';
import { seededRandom } from '../../../utils/seeded-random.js';

const SHAPES = {
    default: { rays: 6, inner: [9, 5], outer: [24, 9], amplitude: 1 },
    large:   { rays: 4, inner: [12, 5], outer: [34, 10], amplitude: 1.3 },
    fine:    { rays: 10, inner: [6, 3], outer: [15, 6], amplitude: 0.75 }
};
const radians = degrees => degrees * Math.PI / 180;
const centerOf = points => [0, 1].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length);

function shardGeometry(key, variant) {
    const random = seededRandom(`glass|${key}`);
    const [cx, cy] = [40 + random() * 20, 24 + random() * 22];
    const { rays, inner, outer, amplitude } = SHAPES[variant] ?? SHAPES.default;
    const ring = (radius, jitter) => Array.from({ length: rays }, (_, i) => {
        const angle = (i + (random() - 0.5) * jitter) * 2 * Math.PI / rays;
        return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 1.6];
    });
    const innerRadius = inner[0] + random() * inner[1];
    const outerRadius = outer[0] + random() * outer[1];
    const rings = [ring(innerRadius, 0.6), ring(outerRadius, 0.5), ring(160, 0.4)];
    const polygons = [rings[0]];
    for (let r = 0; r < 2; r++) {
        for (let i = 0; i < rays; i++) {
            const j = (i + 1) % rays;
            const [a, b, c, d] = [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]];
            if (r === 0 && random() < 0.35) polygons.push([a, b, c], [a, c, d]);
            else polygons.push([a, b, c, d]);
        }
    }

    const shards = polygons.map(points => {
        const [x, y] = centerOf(points);
        // Inset each shared edge slightly so the divisions read even at rest.
        const inset = points.map(([px, py]) => {
            const distance = Math.hypot(px - x, py - y);
            const scale = Math.max(0, 1 - 0.8 / distance);
            return [x + (px - x) * scale, y + (py - y) * scale];
        });
        const center = centerOf(inset);
        const [gx, gy] = center;
        const amp = (0.6 + Math.min(1, Math.hypot(gx - cx, (gy - cy) / 1.6) / 60) * 1.8) * amplitude;
        const pose = multiplier => [
            (random() - 0.5) * 0.018 * amp * multiplier,
            (random() - 0.5) * 0.011 * amp * multiplier,
            radians((random() - 0.5) * 11 * amp),
            radians((random() - 0.5) * 11 * amp),
            radians((random() - 0.5) * 2.6 * amp)
        ];
        return { inset, center, from: pose(1), to: pose(1.6), duration: 7 + random() * 7, delay: -random() * 12 };
    });

    const vertices = [];
    for (const { inset, center, from, to, duration, delay } of shards) {
        const light = random() < 0.7;
        const tint = light ? [1, 1, 1, 0.03 + random() * 0.16] : [10 / 255, 40 / 255, 70 / 255, 0.04 + random() * 0.12];
        // Each triangle carries the outer edge that bounds it. The shader draws its
        // rim in portrait pixels, with the same perspective as the sampled image.
        for (let i = 0; i < inset.length; i++) {
            const a = inset[i], b = inset[(i + 1) % inset.length];
            const edge = [...a, ...b].map(value => value / 100);
            for (const [x, y] of [center, a, b]) {
                vertices.push(x / 100, y / 100, center[0] / 100, center[1] / 100, ...edge,
                    ...from.slice(0, 4), ...to.slice(0, 4), from[4], to[4], duration, delay, ...tint);
            }
        }
    }
    const stride = 24 * Float32Array.BYTES_PER_ELEMENT;
    const buffer = new Buffer({ data: new Float32Array(vertices), usage: BufferUsage.VERTEX });
    const attribute = (format, offset) => ({ buffer, format, stride, offset });
    return new Geometry({ attributes: {
        aPosition: attribute('float32x2', 0), aCenter: attribute('float32x2', 8),
        aEdge: attribute('float32x4', 16), aFrom: attribute('float32x4', 32),
        aTo: attribute('float32x4', 48), aMotion: attribute('float32x4', 64),
        aTint: attribute('float32x4', 80)
    } });
}

const vertex = `#version 300 es
    in vec2 aPosition;
    in vec2 aCenter;
    in vec4 aEdge;
    in vec4 aFrom;
    in vec4 aTo;
    in vec4 aMotion; // start angle, end angle, duration, delay
    in vec4 aTint;
    uniform vec2 uSize;
    uniform vec2 uSurface;
    uniform float uPadding;
    uniform float uWobbleTime;
    uniform vec4 uPlacement;
    out vec2 vPoint;
    flat out vec4 vEdge;
    flat out vec4 vTint;

    vec2 rotate(vec2 point, float angle) {
        float c = cos(angle), s = sin(angle);
        return vec2(c * point.x - s * point.y, s * point.x + c * point.y);
    }
    void main() {
        float phase = fract((uWobbleTime - aMotion.w) / aMotion.z);
        float progress = uWobbleTime < 0.0 ? 0.0 : smoothstep(0.0, 1.0, 1.0 - abs(2.0 * phase - 1.0));
        vec4 pose = mix(aFrom, aTo, progress);
        vec2 center = aCenter * uSize;
        vec3 point = vec3(aPosition * uSize - center, 0.0);
        point.xy = rotate(point.xy, mix(aMotion.x, aMotion.y, progress));
        point.xz = rotate(point.xz, -pose.w);
        point.yz = rotate(point.yz, pose.z);
        float w = 1.0 - point.z / 900.0;
        vec2 offset = center + pose.xy * uSize + uPadding - 0.5 * uSurface;
        vec2 clip = (point.xy + w * offset) * vec2(2.0, -2.0) / uSurface;
        gl_Position = vec4(clip * uPlacement.xy + w * uPlacement.zw, 0.0, w);
        vPoint = aPosition * uSize;
        vEdge = aEdge * vec4(uSize, uSize);
        vTint = aTint;
    }
`;

const GLINT_SKEW = Math.tan(radians(22));
const fragment = `#version 300 es
    in vec2 vPoint;
    flat in vec4 vEdge;
    flat in vec4 vTint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uImage;
    uniform float uGlint;
    uniform float uOpacity;
    out vec4 color;

    void main() {
        vec2 uv = (vPoint - uImage.xy) / uImage.zw;
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
        vec4 sampleColor = texture(uTexture, uv);
        float glintPosition = (vPoint.x + ${GLINT_SKEW} * (vPoint.y - uSize.y * 0.5)) / uSize.x;
        float glint = 0.6 * max(0.0, 1.0 - abs(glintPosition - 0.5 - uGlint) / 0.17);
        vec2 edgeDirection = normalize(vEdge.zw - vEdge.xy);
        float edgeDistance = abs(dot(vPoint - vEdge.xy, vec2(-edgeDirection.y, edgeDirection.x)));
        float rim = 0.6 * (1.0 - smoothstep(0.0, 0.9, edgeDistance));
        // Paint the gloss and rim at the sampled alpha, including translucent portrait edges.
        vec3 lit = mix(sampleColor.rgb, vec3(sampleColor.a), glint);
        lit = mix(lit, vTint.rgb * sampleColor.a, vTint.a);
        lit = mix(lit, vec3(0.922, 0.973, 1.0) * sampleColor.a, rim);
        color = vec4(lit, sampleColor.a) * uOpacity;
    }
`;

export class GlassPortraitMesh {
    constructor(image, key, variant) {
        this.texture = new PortraitTexture(image);
        this.shader = Shader.from({
            gl: { vertex, fragment, name: 'vn-portrait-glass', preferredFragmentPrecision: 'highp' },
            resources: {
                uTexture: this.texture.source,
                glass: {
                    uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
                    uSurface: { value: new Float32Array(2), type: 'vec2<f32>' },
                    uImage: { value: new Float32Array(4), type: 'vec4<f32>' },
                    uPadding: { value: 0, type: 'f32' },
                    uWobbleTime: { value: -1, type: 'f32' },
                    uGlint: { value: -1.8, type: 'f32' },
                    ...portraitMotionUniforms(),
                }
            }
        });
        this.uniforms = this.shader.resources.glass.uniforms;
        this.root = new Mesh({ geometry: shardGeometry(key, variant), shader: this.shader });
    }

    resize(layout) {
        const { width, height, padX } = layout;
        this.texture.resize(layout, this.uniforms.uImage);
        this.uniforms.uSize.set([width, height]);
        this.uniforms.uPadding = padX;
    }

    padding(width, height) {
        const pad = Math.ceil(Math.max(width, height) * 0.1);
        return [pad, pad];
    }

    update({ seconds, motion, active, transitioning, width, height, now, dirty }) {
        const wobble = motion && active && !transitioning;
        if (wobble) this.wobbleStart ??= now;
        else this.wobbleStart = null;
        const glint = motion ? glassGlint(seconds, active, width, height) : { offset: -100, visible: false };
        const repaint = dirty || wobble || this.wasWobbling || glint.visible || this.glintVisible;
        this.uniforms.uWobbleTime = wobble ? (now - this.wobbleStart) / 1000 : -1;
        this.uniforms.uGlint = glint.offset;
        this.wasWobbling = wobble;
        this.glintVisible = glint.visible;
        return repaint;
    }

    destroy() {
        this.root.geometry.destroy(true);
        this.root.destroy();
        this.shader.destroy();
        this.texture.destroy();
    }
}

export function glassGlint(time, active, width, height) {
    const phase = time % (active ? 6 : 10.8);
    const fraction = Math.min(1, phase / (active ? 2.7 : 4.86));
    const eased = fraction * fraction * (3 - 2 * fraction);
    const offset = -1.8 + 3.6 * eased;
    const extent = 0.67 + GLINT_SKEW * height / (2 * width);
    return { offset, visible: Math.abs(offset) < extent };
}

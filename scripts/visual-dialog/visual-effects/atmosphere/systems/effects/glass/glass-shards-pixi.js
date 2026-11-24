import { Buffer, BufferUsage, Geometry, Mesh } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { seededRandom } from '../../../../../../utils/seeded-random.js';
import { PixiBackgroundMesh } from '../background/pixi-background-mesh.js';
import { GlassSurface } from './glass-surface.js';

const vertex = defines => `#version 300 es
    ${defines}
    in vec2 aPosition;
    in vec2 aCenter;
    in vec4 aMotion;
    in vec3 aSurface;
    uniform vec2 uSize;
    uniform float uTime;
    uniform float uStill;
    out vec2 vLocal;
    out vec3 vSurface;
    out float vOpacity;
    flat out vec3 vNormal;
    flat out float vSeed;
    flat out float vDistance;
    #ifdef GLASS_BACKGROUND
        out vec2 vPoint;
    #endif

    mat2 turn(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }

    void main() {
        float span = min(uSize.x, uSize.y);
        vec2 impact = uSize * 0.5;
        vSeed = aMotion.z;
        vLocal = (aPosition - aCenter) / span;
        vDistance = length(aCenter - impact) / span;
        #ifdef GLASS_BACKGROUND
            vPoint = aPosition;
            if (vSeed < -1.5) {
                vSurface = vec3(0.0);
                vNormal = vec3(0.0, 0.0, 1.0);
                vOpacity = 1.0;
                gl_Position = vec4(aPosition / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
                return;
            }
        #endif
        if (vSeed < 0.0) {
            vSurface = vec3(0.0);
            vNormal = vec3(0.0, 0.0, 1.0);
            vOpacity = 0.0;
            vec2 p = impact + (aPosition - impact) * mix(0.40, 1.0, clamp(uTime * 4.0, 0.0, 1.0));
            gl_Position = uTime < 0.28
                ? vec4(p / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0)
                : vec4(2.0, 2.0, 0.0, 1.0);
            return;
        }
        float phase = vSeed * 97.0;
        float age = max(0.0, uTime - vDistance * 0.22);
        float push = 1.0 - exp(-3.7 * age);
        float driftTime = mix(uTime, 0.0, uStill);
        float slow = driftTime * (0.49 + vSeed * 0.45) + phase;
        float roll = push * (sin(phase + 0.9) * 0.22 + sin(slow) * 0.061);
        float tilt = push * (cos(phase + 1.1) * 0.45 + cos(slow * 0.87) * 0.12);
        float yaw = push * (sin(phase * 0.79) * 0.56 + sin(slow * 1.12) * 0.10);
        vec3 p = vec3(aPosition - aCenter, 0.0);
        vec3 n = vec3(0.0, 0.0, 1.0);
        p.xy = turn(roll) * p.xy;
        p.yz = turn(tilt) * p.yz;
        p.xz = turn(yaw) * p.xz;
        n.yz = turn(tilt) * n.yz;
        n.xz = turn(yaw) * n.xz;

        vec2 sway = vec2(sin(slow * 0.81), cos(slow)) * span * 0.010 * (0.54 + vSeed);
        float scale = 1.0 / (1.0 - (p.z / span + aMotion.w * push) * 0.61);
        vec2 position = aCenter + p.xy * scale + (aMotion.xy + sway) * push;
        vNormal = n;
        vSurface = aSurface;
        vOpacity = smoothstep(0.035, 0.39, push);
        vec2 screen = position / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
        #ifdef GLASS_BACKGROUND
            // Recover the original media coordinates through the tilted plane.
            gl_Position = vec4(screen / scale, 0.0, 1.0 / scale);
        #else
            gl_Position = vec4(screen, 0.0, 1.0);
        #endif
    }
`;

const fragment = defines => `#version 300 es
    ${defines}
    in vec2 vLocal;
    in vec3 vSurface;
    in float vOpacity;
    flat in vec3 vNormal;
    flat in float vSeed;
    flat in float vDistance;
    uniform float uTime;
    out vec4 color;
    #ifdef GLASS_BACKGROUND
        in vec2 vPoint;
        uniform sampler2D uTexture;
        uniform vec4 uCover;
        vec3 mediaColor() { return texture(uTexture, (vPoint - uCover.xy) * uCover.zw).rgb; }
    #endif

    void main() {
        #ifdef GLASS_BACKGROUND
            if (vSeed < -1.5) {
                float d = length(vLocal);
                float open = smoothstep(0.08, 0.48, uTime - d * 0.25);
                vec3 gap = mix(vec3(0.007, 0.011, 0.025), vec3(0.026, 0.042, 0.070), exp(-d * d * 7.0));
                color = vec4(mix(mediaColor(), gap, open), 1.0);
                return;
            }
        #endif
        if (vSeed < 0.0) {
            float d = length(vLocal) * 5.5;
            float flash = smoothstep(0.0, 0.032, uTime) * (1.0 - smoothstep(0.035, 0.28, uTime));
            float alpha = exp(-d * d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d)) * flash * 0.85;
            color = vec4(vec3(0.73, 0.89, 1.0) * alpha, alpha);
            return;
        }
        // Two broad studio reflections and a fine chromatic line move with each facet's tilt.
        vec3 n = normalize(vNormal);
        float plane = dot(vLocal, vec2(0.48, -0.88)) + n.x * 0.34 + n.y * 0.22 + vSeed * 0.31;
        float soft = 1.0 - smoothstep(0.01, 0.14, abs(plane - 0.01));
        float blue = 1.0 - smoothstep(0.0, 0.075, abs(plane + 0.185));
        float spectral = 1.0 - smoothstep(0.002, 0.014, abs(plane - 0.103));
        float graze = 1.0 - n.z;
        float light = min(1.0, soft * 0.75 + blue * 0.42 + graze);
        vec3 ice = mix(vec3(0.32, 0.64, 0.75), vec3(0.59, 0.58, 0.90), vSeed);
        vec3 tint = mix(vec3(0.015, 0.047, 0.09), ice, light);
        tint = mix(tint, vec3(1.0, 0.77, 0.55), spectral * (0.22 + vSeed * 0.44));

        float bevel = vSurface.x;
        float cut = smoothstep(0.01, 0.70, bevel);
        float ridge = cut * (1.0 - smoothstep(0.86, 1.0, bevel));
        float edgeLight = vSurface.y * (0.44 + 0.46 * soft + 0.55 * spectral);
        float surge = exp(-22.0 * abs(vDistance - uTime * 1.65)) * (1.0 - smoothstep(0.18, 0.58, uTime)) * 0.63;
        vec3 silver = mix(ice, vec3(0.95, 0.98, 1.0), min(1.0, edgeLight + 0.28 + surge));
        vec3 edge = mix(vec3(0.043, 0.095, 0.14), silver, clamp(ridge + edgeLight * 0.23, 0.0, 1.0));
        #ifdef GLASS_BACKGROUND
            vec3 picture = mediaColor() * (0.83 + n.z * 0.17);
            tint = mix(picture + ice * (soft * 0.10 + blue * 0.035 + spectral * 0.065), edge, cut * 0.79);
            float alpha = 1.0;
        #else
            tint = mix(tint, edge, cut);
            float bodyAlpha = 0.18 + light * 0.22 + spectral * 0.08;
            float alpha = mix(bodyAlpha, 0.26 + ridge * (0.43 + 0.27 * edgeLight + surge), cut);
        #endif
        alpha = clamp(alpha, 0.0, 1.0) * vSurface.z * vOpacity;
        color = vec4(tint * alpha, alpha);
    }
`;

const polar = (center, angle, radius) => ({
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius
});
const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

const mediumAngles = [-3.11, -2.76, -2.40, -1.91, -1.45, -1.10, -0.57, -0.08, 0.31, 0.84, 1.27, 1.81, 2.20, 2.65];
const shardPatterns = {
    // Interior ring radii as fractions of the short side, with a cap relative to the edge on each ray.
    small: { rays: 24, separation: 0.73, rings: [[0.035, 0.075, 0.22], [0.12, 0.19, 0.40], [0.23, 0.32, 0.65], [0.35, 0.44, 0.86]] },
    medium: { separation: 1, rings: [[0.045, 0.113, 1], [0.20, 0.40, 0.72]] },
    large: { rays: 7, separation: 1.07, rings: [[0.09, 0.17, 0.45]] }
};

function buildShards(width, height, texturedSize = null) {
    const textured = texturedSize !== null;
    const { rays: rayCount, separation, rings } = shardPatterns[texturedSize ?? 'medium'];
    const random = seededRandom('scene-shattered-glass');
    const range = (low, high) => low + (high - low) * random();
    const span = Math.min(width, height);
    const impact = { x: width * 0.5, y: height * 0.5 };
    const vertices = [], indices = [];

    function quad(radiusX, radiusY, marker) {
        const first = vertices.length / 11;
        for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            vertices.push(impact.x + x * radiusX, impact.y + y * radiusY, impact.x, impact.y, 0, 0, marker, 0, 0, 0, 0);
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
    if (textured) quad(impact.x, impact.y, -2);

    function shard(points, kind) {
        const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }),
            { x: 0, y: 0 });
        const direction = Math.atan2(center.y - impact.y, center.x - impact.x);
        const reach = span * (kind === 'dust' ? range(0.07, 0.22)
            : kind === 'core' ? range(0.10, 0.21) : range(0.026, 0.095)) * separation;
        const throwTo = polar(center, direction + range(-0.30, 0.30), reach);
        const motion = [throwTo.x - center.x, throwTo.y - center.y, random(), range(-0.14, 0.17)];
        const normals = points.map((a, i) => {
            const b = points[(i + 1) % points.length];
            const d = Math.max(0.001, length(a, b));
            return { x: (a.y - b.y) / d, y: (b.x - a.x) / d };
        });
        const bevel = Math.min(2.25, ...normals.map((n, i) =>
            Math.abs(n.x * (center.x - points[i].x) + n.y * (center.y - points[i].y)) * 0.62));
        const joins = normals.map((n, i) => {
            const prev = normals[(i + normals.length - 1) % normals.length];
            const miter = Math.max(0.22, 1 + n.x * prev.x + n.y * prev.y);
            return { x: (n.x + prev.x) / miter, y: (n.y + prev.y) / miter };
        });
        const inset = points.map((p, i) => ({ x: p.x + joins[i].x * bevel, y: p.y + joins[i].y * bevel }));
        const halo = points.map((p, i) => ({ x: p.x - joins[i].x * 1.45, y: p.y - joins[i].y * 1.45 }));
        const add = (p, edge, highlight, coverage) => {
            const index = vertices.length / 11;
            vertices.push(p.x, p.y, center.x, center.y, ...motion, edge, highlight, coverage);
            return index;
        };
        const middle = add(center, 0, 0, 1);
        for (let i = 0; i < points.length; i++) {
            const next = (i + 1) % points.length;
            const a = points[i], b = points[next];
            const dx = b.x - a.x, dy = b.y - a.y;
            const lit = Math.abs(dx * 0.84 + dy * 0.54) / Math.max(0.001, Math.hypot(dx, dy));
            const insideA = add(inset[i], 0, lit, 1), insideB = add(inset[next], 0, lit, 1);
            const rimA = add(a, 0.78, lit, 1), rimB = add(b, 0.78, lit, 1);
            const fadeA = add(halo[i], 1, lit, 0), fadeB = add(halo[next], 1, lit, 0);
            indices.push(middle, insideA, insideB, insideA, rimA, insideB, insideB, rimA, rimB,
                rimA, fadeA, rimB, rimB, fadeA, fadeB);
        }
    }

    let angles = mediumAngles;
    if (rayCount) {
        const sector = Math.PI * 2 / rayCount;
        angles = Array.from({ length: rayCount }, (_, i) => -Math.PI + (i + range(0.15, 0.79)) * sector);
    }
    if (textured) {
        // Place vertices at the four corners so the pieces cut up the entire original frame.
        const corner = Math.atan2(height, width);
        const corners = [corner - Math.PI, -corner, corner, Math.PI - corner];
        angles = [...angles.filter(angle => corners.every(c => Math.abs(c - angle) > 0.12)), ...corners].sort((a, b) => a - b);
    }
    const rays = angles.map(angle => {
        const dx = Math.abs(Math.cos(angle)), dy = Math.abs(Math.sin(angle));
        const edge = Math.min(impact.x / dx, impact.y / dy);
        const interior = rings.map(([min, max, cap], i) => {
            const wobble = texturedSize === 'small' ? 0.047 : i === 0 ? 0.08 : 0.10;
            return polar(impact, angle + range(-wobble, wobble), Math.min(edge * cap, span * range(min, max)));
        });
        const boundary = textured ? polar(impact, angle, edge)
            : polar(impact, angle + range(-0.035, 0.035), edge * range(0.88, 1.13));
        return [...interior, boundary];
    });
    for (let i = 0; i < rays.length; i++) {
        const a = rays[i], b = rays[(i + 1) % rays.length];
        shard([impact, a[0], b[0]], 'core');
        for (let ring = 1; ring < a.length; ring++) {
            const innerA = a[ring - 1], innerB = b[ring - 1], outerA = a[ring], outerB = b[ring];
            const whole = texturedSize === 'large' ? i % 4 !== 1 : (ring + i) % 3 === 0;
            if (whole) shard([innerA, outerA, outerB, innerB], 'pane');
            else if (i % 2 === 0) {
                shard([innerA, outerA, outerB], 'pane');
                shard([innerA, outerB, innerB], 'pane');
            } else {
                shard([innerA, outerA, innerB], 'pane');
                shard([innerB, outerA, outerB], 'pane');
            }
        }
    }

    for (let i = 0; i < 24; i++) {
        const angle = range(0, Math.PI * 2);
        const center = polar(impact, angle, span * range(0.008, 0.12));
        const size = span * range(0.004, 0.019);
        shard([
            polar(center, angle, size),
            polar(center, angle + 2.73, size * range(0.56, 0.91)),
            polar(center, angle - 1.9, size * range(0.18, 0.62))
        ], 'dust');
    }

    quad(span * 0.18, span * 0.18, -1);

    const buffer = new Buffer({ data: new Float32Array(vertices), usage: BufferUsage.VERTEX });
    const attribute = (format, offset) => ({ buffer, format, stride: 44, offset });
    return new Geometry({
        attributes: {
            aPosition: attribute('float32x2', 0), aCenter: attribute('float32x2', 8),
            aMotion: attribute('float32x4', 16), aSurface: attribute('float32x3', 32)
        },
        indexBuffer: new Uint16Array(indices)
    });
}

function shardProgram(textured) {
    const defines = textured ? '#define GLASS_BACKGROUND' : '';
    return { vertex: vertex(defines), fragment: fragment(defines),
        name: textured ? 'vn-glass-background' : 'vn-glass-shards', preferredFragmentPrecision: 'highp' };
}

export class GlassShardsSurface extends GlassSurface {
    constructor() {
        super(shardProgram(false), {
            uStill: { value: 0, type: 'f32' }
        }, (width, height) => buildShards(width, height));
    }

    setAppearance(_size, reduced) {
        const still = reduced ? 1 : 0;
        this.uniforms.uStill.value = still;
        if (this.values) this.values.uStill = still;
    }
}

export class GlassBackgroundMesh extends PixiBackgroundMesh {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            ...shardProgram(true),
            uniforms: {
                uTime: { value: 0, type: 'f32' },
                uStill: { value: 0, type: 'f32' }
            }
        });
    }

    resize(layout) {
        super.resize(layout);
        this.layout = layout;
        this.meshLayout = null;
    }

    render(now, reduced, shardSize) {
        if (this.meshLayout !== this.layout || this.shardSize !== shardSize) {
            const { width, height } = this.layout;
            const geometry = buildShards(width, height, shardSize);
            this.clearGeometry();
            this.stage.addChild(new Mesh({ geometry, shader: this.shader }));
            this.meshLayout = this.layout;
            this.shardSize = shardSize;
        }
        this.started ??= now;
        this.uniforms.uTime = reduced ? 1.35 : Math.max(0, now - this.started) / 1000;
        this.uniforms.uStill = reduced ? 1 : 0;
        super.render();
    }
}

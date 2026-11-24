import { Geometry, Mesh } from '../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { PixiBackgroundMesh } from './background/pixi-background-mesh.js';

const beadSpacing = [48, 45];
const runSpacing = [132, 156];
const bendRate = 0.061;
const bendWidth = 2.8;

const vertex = `#version 300 es
    in vec2 aCorner;
    in vec3 aCell;
    uniform vec2 uSize;
    uniform float uTime;
    out vec2 vPoint;
    out vec2 vLocal;
    flat out vec4 vDrop;
    flat out float vBend;

    vec3 hash(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
    }

    void main() {
        bool runs = aCell.z > 0.5;
        vec3 seed = hash(aCell + 8.71);
        float clock = uTime / mix(7.0, 13.0, seed.x) + seed.y;
        float age = fract(clock);
        vec3 random = hash(aCell + vec3(seed.z, 13.24, floor(clock)));
        vec2 spacing = runs ? vec2(${runSpacing.join(', ')}) : vec2(${beadSpacing.join(', ')});
        vec2 center = uSize * 0.5 + (aCell.xy + (random.xy - 0.5) * 0.9) * spacing;
        float opacity = smoothstep(0.03, 0.20, age) * (1.0 - smoothstep(0.77, 0.98, age));
        float radius = mix(2.0, 5.3, random.z * random.z) * mix(0.72, 1.0, smoothstep(0.0, 0.75, age));
        float height = radius * mix(1.0, 1.30, seed.z);
        float tail = 0.0;
        float bend = 0.0;
        if (runs) {
            float progress = smoothstep(0.12, 0.91, age);
            float fall = mix(116.0, 220.0, seed.z) * (progress - 0.5);
            bend = seed.x * 6.283 + fall * ${bendRate};
            center += vec2(sin(bend) * ${bendWidth}, fall);
            opacity = smoothstep(0.10, 0.24, age) * (1.0 - smoothstep(0.73, 0.93, age));
            radius = mix(4.4, 8.2, random.z);
            height = radius * mix(1.38, 1.7, seed.y);
            tail = mix(23.0, 61.0, seed.x) * smoothstep(0.14, 0.46, age);
        }
        vDrop = vec4(radius, height, tail, opacity);
        vBend = bend;
        float halfWidth = max(radius + 2.0, step(0.01, tail) * (${2 * bendWidth} + radius * 0.33 + 0.65));
        vLocal = vec2(aCorner.x * halfWidth,
            mix(-max(height + 2.0, tail), height + 2.0, aCorner.y));
        vPoint = center + vLocal;
        gl_Position = vec4(vPoint / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
    }
`;

const fragment = `#version 300 es
    in vec2 vPoint;
    in vec2 vLocal;
    flat in vec4 vDrop;
    flat in float vBend;
    uniform sampler2D uTexture;
    uniform vec4 uCover;
    out vec4 color;

    vec4 photo(vec2 point) {
        return texture(uTexture, (point - uCover.xy) * uCover.zw);
    }

    void main() {
        float radius = vDrop.x;
        float height = vDrop.y;
        float tail = vDrop.z;
        // The lower half of a running drop bulges as the upper half pulls into the trail.
        vec2 lens = vLocal / vec2(radius, height);
        lens.x /= 1.0 + step(0.01, tail) * 0.32 * clamp(lens.y, -1.0, 1.0);
        float edge = length(lens);
        float feather = 0.70 / radius;
        float mask = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, edge);
        float trail = 0.0;
        float trailX = 0.0;
        if (tail > 0.0 && vLocal.y < 0.0) {
            float along = clamp(-vLocal.y / tail, 0.0, 1.0);
            float bend = sin(vBend + vLocal.y * ${bendRate}) - sin(vBend);
            trailX = vLocal.x - bend * ${bendWidth};
            float width = mix(radius * 0.33, 0.45, along);
            trail = (1.0 - smoothstep(width * 0.37, width + 0.65, abs(trailX)))
                * (1.0 - smoothstep(0.14, 1.0, along)) * 0.74 * (1.0 - mask);
        }
        if (mask + trail < 0.004 || vDrop.w < 0.004) discard;

        // Sample the actual scene through a curved lens. Opposite rims catch light and shade.
        float dome = sqrt(max(0.0, 1.0 - edge * edge));
        vec2 displacement = -lens * radius * (0.80 + 2.65 * dome);
        float rim = smoothstep(0.67, 1.0, edge);
        float light = dot(lens, vec2(-0.58, -0.81));
        float glint = 1.0 - smoothstep(0.03, 0.27, length((lens - vec2(-0.30, -0.54)) * vec2(1.0, 1.55)));
        vec4 throughDrop = photo(vPoint + displacement);
        vec3 highlight = vec3(0.70, 0.82, 0.95)
            * (0.28 * glint + 0.25 * rim * max(light, 0.0));
        throughDrop.rgb = throughDrop.rgb * (0.92 - 0.35 * rim * max(-light, 0.0)) + highlight;
        throughDrop.a += (1.0 - throughDrop.a) * highlight.b;

        color = throughDrop * mask * 0.94;
        if (trail > 0.004) {
            vec4 throughTrail = photo(vPoint + vec2(-trailX * 2.1, 0.8));
            float sheen = 1.0 - smoothstep(0.0, 1.2, abs(trailX + 0.6));
            throughTrail.rgb = throughTrail.rgb * 0.83 + vec3(0.12, 0.17, 0.21) * sheen;
            throughTrail.a += (1.0 - throughTrail.a) * 0.21 * sheen;
            color += throughTrail * trail;
        }
        color *= vDrop.w;
    }
`;

// Rasterize only the droplets and their trails. The space between them is the original DOM background.
function dropGeometry(width, height) {
    const corners = [], cells = [], indices = [];
    for (const [kind, [pitchX, pitchY]] of [beadSpacing, runSpacing].entries()) {
        const columns = Math.ceil(width / (2 * pitchX));
        const rows = Math.ceil(height / (2 * pitchY)) + kind;
        for (let y = -rows; y <= rows; y++) {
            for (let x = -columns; x <= columns; x++) {
                const start = cells.length / 3;
                corners.push(-1, 0, 1, 0, 1, 1, -1, 1);
                cells.push(x, y, kind, x, y, kind, x, y, kind, x, y, kind);
                indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
            }
        }
    }
    return new Geometry({
        attributes: {
            aCorner: { buffer: new Float32Array(corners), format: 'float32x2' },
            aCell: { buffer: new Float32Array(cells), format: 'float32x3' }
        },
        indexBuffer: new Uint32Array(indices)
    });
}

export class RainGlassPixiMesh extends PixiBackgroundMesh {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            vertex, fragment, name: 'vn-rain-glass',
            uniforms: { uTime: { value: 0, type: 'f32' } }
        });
    }

    resize(layout) {
        super.resize(layout);
        this.clearGeometry();
        this.stage.addChild(new Mesh({ geometry: dropGeometry(layout.width, layout.height), shader: this.shader }));
    }

    render(time) {
        this.uniforms.uTime = time;
        super.render();
    }
}

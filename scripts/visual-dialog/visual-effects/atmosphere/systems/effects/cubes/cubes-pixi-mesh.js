import { Buffer, BufferUsage, Geometry, Mesh, State } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { PixiBackgroundMesh } from '../background/pixi-background-mesh.js';

const PERSPECTIVE = 1100;
const SHADOW_MARGIN = 50;

const vertex = `#version 300 es
    in vec2 aPosition;
    in vec4 aFace; // peak depth, delay, front/back vertex, material
    in vec2 aLocal;
    in vec3 aColor;
    in float aPeriod;
    uniform vec2 uSize;
    uniform vec2 uOrigin;
    uniform float uTime;
    out vec2 vPoint;
    out vec2 vLocal;
    out vec3 vColor;
    out float vHole;
    flat out float vMaterial;

    float bezier(float t, vec2 control) {
        float s = 1.0 - t;
        return 3.0 * s * t * (s * control.x + t * control.y) + t * t * t;
    }
    float ease(float x, vec4 curve) {
        float lo = 0.0, hi = 1.0;
        for (int i = 0; i < 10; i++) {
            float t = (lo + hi) * 0.5;
            if (bezier(t, curve.xz) < x) lo = t;
            else hi = t;
        }
        return bezier((lo + hi) * 0.5, curve.yw);
    }
    void main() {
        float phase = fract(max(0.0, uTime - aFace.y) / aPeriod);
        float push = 0.0;
        vHole = 0.0;
        if (phase >= 0.16 && phase < 0.34) {
            float rise = (phase - 0.16) / 0.18;
            push = ease(rise, vec4(0.25, 1.2, 0.4, 1.0));
            vHole = ease(rise, vec4(0.0, 0.0, 0.58, 1.0));
        } else if (phase >= 0.34 && phase < 0.84) {
            push = 1.0;
            if (phase > 0.64) push -= ease((phase - 0.64) / 0.20, vec4(0.42, 0.0, 0.58, 1.0));
            vHole = push;
        }
        float depth = aFace.z * mix(0.1, aFace.x, push);
        // CSS perspective is a scale about the mouse-controlled origin. Clip W also
        // makes the depth interpolation of intersecting side faces perspective-correct.
        float w = 1.0 - depth / ${PERSPECTIVE.toFixed(1)};
        vec2 point = aPosition - uOrigin * (1.0 - w);
        gl_Position = vec4(point.x / uSize.x * 2.0 - w, w - point.y / uSize.y * 2.0, -depth / 250.0, w);
        vPoint = aPosition;
        vLocal = aLocal;
        vColor = aColor;
        vMaterial = aFace.w;
    }
`;

const fragment = `#version 300 es
    in vec2 vPoint;
    in vec2 vLocal;
    in vec3 vColor;
    in float vHole;
    flat in float vMaterial;
    uniform sampler2D uTexture;
    uniform vec4 uCover;
    uniform float uCell;
    out vec4 color;
    void main() {
        if (vMaterial == 1.0) {
            vec2 edge = min(vLocal, uCell - vLocal);
            float distance = length(max(-edge, 0.0));
            float shadow = 0.7 * (1.0 - smoothstep(0.0, ${SHADOW_MARGIN.toFixed(1)}, distance));
            float inside = smoothstep(-0.5, 0.5, min(edge.x, edge.y));
            float alpha = vHole * mix(shadow, 1.0, inside);
            color = vec4(vec3(0.024, 0.020, 0.016) * alpha, alpha);
        } else if (vMaterial == 2.0) {
            color = vec4(vColor, 1.0);
        } else {
            color = texture(uTexture, (vPoint - uCover.xy) * uCover.zw);
        }
    }
`;

function rectangle(x, y, width, height) {
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
}

function buildGeometry(grid, cells, video) {
    const underlay = [], faces = [];
    const { size, ox, top, width, height } = grid;
    const margins = rectangle(-SHADOW_MARGIN, -SHADOW_MARGIN, size + 2 * SHADOW_MARGIN, size + 2 * SHADOW_MARGIN);
    const black = [0, 0, 0];
    const dark = [[11, 9, 7], [8, 6, 5], [6, 5, 4], [8, 6, 5]];
    const light = [[74, 65, 54], [56, 47, 39], [36, 30, 24], [56, 47, 39]];
    const quad = (target, points, local, peak, delay, duration, front, material, colors) => {
        for (let i = 0; i < points.length; i++) {
            target.push(...points[i], peak, delay, front[i], material, ...local[i], ...colors[i].map(c => c / 255), duration);
        }
    };
    const flat = [0, 0, 0, 0], raised = [1, 1, 1, 1], side = [0, 0, 1, 1];
    const unlit = [black, black, black, black];
    if (video) {
        // The exposed wall and its moving faces sample the exact same uploaded frame.
        const base = rectangle(0, 0, width, height);
        quad(underlay, base, base, 0, 0, 1, flat, 0, unlit);
    }
    const local = rectangle(0, 0, size, size);
    for (const { col, row, push, delay, duration } of cells) {
        const x = ox + col * size, y = top + row * size;
        const peak = Math.round(push);
        const points = rectangle(x, y, size, size);
        const shadow = margins.map(([dx, dy]) => [x + dx, y + dy]);
        quad(underlay, shadow, margins, peak, delay, duration, flat, 1, unlit);
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            quad(faces, [a, b, b, a], local, peak, delay, duration, side, 2, [dark[i], dark[i], light[i], light[i]]);
        }
        quad(faces, points, local, peak, delay, duration, raised, 0, unlit);
    }
    return [makeGeometry(underlay), makeGeometry(faces)];
}

function makeGeometry(vertices) {
    const floatsPerVertex = 12;
    const stride = floatsPerVertex * Float32Array.BYTES_PER_ELEMENT;
    const buffer = new Buffer({ data: new Float32Array(vertices), usage: BufferUsage.VERTEX });
    const indices = new Uint16Array(vertices.length / (floatsPerVertex * 4) * 6);
    for (let i = 0; i < indices.length / 6; i++) {
        const v = i * 4;
        indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    const attribute = (format, offset) => ({ buffer, format, stride, offset });
    return new Geometry({ attributes: {
        aPosition: attribute('float32x2', 0),
        aFace: attribute('float32x4', 8),
        aLocal: attribute('float32x2', 24),
        aColor: attribute('float32x3', 32),
        aPeriod: attribute('float32', 44)
    }, indexBuffer: indices });
}

export class CubesPixiMesh extends PixiBackgroundMesh {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            vertex, fragment, name: 'vn-cubes', depth: true,
            uniforms: {
                uOrigin: { value: new Float32Array(2), type: 'vec2<f32>' },
                uCell: { value: 0, type: 'f32' },
                uTime: { value: 0, type: 'f32' }
            }
        });
        this.depthState = State.for2d();
        this.depthState.depthTest = true;
        this.depthState.depthMask = true;
    }

    resize(grid, cells) {
        super.resize(grid);
        this.uniforms.uCell = grid.size;
        this.clearGeometry();
        const [underlay, faces] = buildGeometry(grid, cells, Boolean(this.video));
        this.stage.addChild(
            new Mesh({ geometry: underlay, shader: this.shader }),
            new Mesh({ geometry: faces, shader: this.shader, state: this.depthState })
        );
    }

    render(time, x, y) {
        this.uniforms.uTime = time;
        this.uniforms.uOrigin[0] = this.uniforms.uSize[0] * x;
        this.uniforms.uOrigin[1] = this.uniforms.uSize[1] * y;
        super.render();
    }
}

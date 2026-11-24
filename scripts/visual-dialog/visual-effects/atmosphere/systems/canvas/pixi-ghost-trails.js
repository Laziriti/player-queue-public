export const GHOST_TRAIL_POINTS = 17;

const vertex = `#version 300 es
    in vec2 aPosition;
    in vec2 aTrail;
    in float aAlpha;
    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    out vec2 vTrail;
    out float vAlpha;

    void main() {
        vec3 projected = uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0);
        gl_Position = vec4(projected.xy, 0.0, 1.0);
        vTrail = aTrail;
        vAlpha = aAlpha;
    }
`;

const fragment = `#version 300 es
    precision mediump float;
    in vec2 vTrail;
    in float vAlpha;
    out vec4 color;

    void main() {
        float age = vTrail.x;
        float wave = sin(age * 23.0) * 0.16 * age;
        float across = abs(vTrail.y - wave);
        float veil = 1.0 - smoothstep(0.03, 0.92, across);
        float core = 1.0 - smoothstep(0.02, 0.35, across);
        float fade = (1.0 - age) * (1.0 - age);
        float alpha = (veil * 0.33 + core * 0.45) * fade * vAlpha;
        vec3 tint = mix(vec3(0.36, 0.64, 0.76), vec3(0.84, 0.95, 1.0), core);
        color = vec4(tint * alpha, alpha);
    }
`;

const stride = 5;
const verticesPerTrail = GHOST_TRAIL_POINTS * 2;
const floatsPerTrail = verticesPerTrail * stride;
const indicesPerTrail = (GHOST_TRAIL_POINTS - 1) * 6;

/** One dynamic mesh for all the trails on a particle layer. Heads stay in the sprite batch. */
export class PixiGhostTrails {
    constructor(pixi, capacity) {
        const { Buffer, BufferUsage, Geometry, Mesh, Shader } = pixi;
        this.used = 0;
        this.data = new Float32Array(capacity * floatsPerTrail);
        this.indices = new Uint16Array(capacity * indicesPerTrail);
        for (let trail = 0; trail < capacity; trail++) {
            for (let point = 0; point < GHOST_TRAIL_POINTS - 1; point++) {
                const i = trail * verticesPerTrail + point * 2;
                this.indices.set([i, i + 1, i + 2, i + 1, i + 3, i + 2], trail * indicesPerTrail + point * 6);
            }
        }
        this.vertices = new Buffer({ data: this.data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
        const field = (format, offset) => ({ buffer: this.vertices, format, offset: offset * 4, stride: stride * 4 });
        this.geometry = new Geometry({
            attributes: {
                aPosition: field('float32x2', 0),
                aTrail: field('float32x2', 2),
                aAlpha: field('float32', 4),
            },
            indexBuffer: this.indices,
        });
        this.shader = Shader.from({
            gl: { vertex, fragment, name: 'vn-ghost-trails' },
        });
        this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    }

    add() {
        const offset = this.used;
        this.used += floatsPerTrail;
        return offset;
    }

    upload() {
        this.mesh.visible = this.used > 0;
        if (!this.used) return;
        const indexCount = this.used / floatsPerTrail * indicesPerTrail;
        const indexBuffer = this.geometry.indexBuffer;
        if (indexBuffer.data.length !== indexCount) indexBuffer.data = this.indices.subarray(0, indexCount);
        this.vertices.setDataWithSize(this.data, this.used, true);
    }

    destroy() {
        this.mesh.removeFromParent();
        this.mesh.destroy();
        this.geometry.destroy(true);
        this.shader.destroy();
    }
}

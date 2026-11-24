const vertex = `#version 300 es
    in vec2 aPosition;
    in vec2 aOrigin;
    in vec4 aAxes;
    in vec4 aFrames;
    in vec2 aBlend;
    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform vec2 uTile;
    out vec2 vFirst;
    out vec2 vNext;
    flat out vec2 vBlend;

    void main() {
        vec2 point = aOrigin + aPosition.x * aAxes.xy + aPosition.y * aAxes.zw;
        vec3 projected = uProjectionMatrix * uWorldTransformMatrix * vec3(point, 1.0);
        gl_Position = vec4(projected.xy, 0.0, 1.0);
        vec2 local = aPosition * uTile;
        vFirst = aFrames.xy + local;
        vNext = aFrames.zw + local;
        vBlend = aBlend;
    }
`;

const fragment = `#version 300 es
    precision mediump float;
    uniform sampler2D uAtlas;
    in vec2 vFirst;
    in vec2 vNext;
    flat in vec2 vBlend;
    out vec4 color;

    void main() {
        // Atlas texels are premultiplied. Blend color and coverage together before compositing the puff.
        color = mix(texture(uAtlas, vFirst), texture(uAtlas, vNext), vBlend.x) * vBlend.y;
    }
`;

const instanceSize = 12;
const floatBytes = Float32Array.BYTES_PER_ELEMENT;

/** One instanced mesh per atlas and particle layer. The simulation still owns motion and opacity. */
export class PixiPuffBatch {
    constructor(pixi, source, frame) {
        const { Buffer, BufferUsage, Geometry, Mesh, Shader } = pixi;
        this.count = 0;
        this.data = new Float32Array(instanceSize * 32);
        this.instances = new Buffer({ data: this.data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
        const attr = (format, offset) => ({
            buffer: this.instances, format, offset: offset * floatBytes, stride: instanceSize * floatBytes, instance: true,
        });
        this.geometry = new Geometry({
            attributes: {
                aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' },
                aOrigin: attr('float32x2', 0),
                aAxes: attr('float32x4', 2),
                aFrames: attr('float32x4', 6),
                aBlend: attr('float32x2', 10),
            },
            indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
        });
        this.uvX = 1 / source.width;
        this.uvY = 1 / source.height;
        this.shader = Shader.from({
            gl: { vertex, fragment, name: 'vn-puff-blend' },
            resources: {
                uAtlas: source,
                puff: {
                    uTile: { value: new Float32Array([(frame.width - 1) * this.uvX, (frame.height - 1) * this.uvY]), type: 'vec2<f32>' },
                },
            },
        });
        this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    }

    add(transform, alpha, first, next, blend, x, y, width, height) {
        const offset = this.count++ * instanceSize;
        if (offset === this.data.length) {
            const larger = new Float32Array(this.data.length * 2);
            larger.set(this.data);
            this.data = larger;
        }
        const { a, b, c, d, tx, ty } = transform;
        const data = this.data;
        data[offset] = tx + a * x + c * y;
        data[offset + 1] = ty + b * x + d * y;
        data[offset + 2] = a * width;
        data[offset + 3] = b * width;
        data[offset + 4] = c * height;
        data[offset + 5] = d * height;
        data[offset + 6] = (first.x + 0.5) * this.uvX;
        data[offset + 7] = (first.y + 0.5) * this.uvY;
        data[offset + 8] = (next.x + 0.5) * this.uvX;
        data[offset + 9] = (next.y + 0.5) * this.uvY;
        data[offset + 10] = blend;
        data[offset + 11] = alpha;
    }

    upload() {
        this.mesh.visible = this.count > 0;
        if (!this.count) return;
        this.geometry.instanceCount = this.count;
        this.instances.setDataWithSize(this.data, this.count * instanceSize, true);
    }

    destroy() {
        this.mesh.removeFromParent();
        this.mesh.destroy();
        this.geometry.destroy(true);
        this.shader.destroy();
    }
}

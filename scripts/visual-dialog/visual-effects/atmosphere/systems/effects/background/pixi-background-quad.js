import { Geometry, Mesh } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { PixiBackgroundMesh } from './pixi-background-mesh.js';

export const backgroundQuadVertex = `#version 300 es
    in vec2 aPosition;
    uniform vec2 uSize;
    out vec2 vPoint;
    void main() {
        vPoint = aPosition * uSize;
        gl_Position = vec4(aPosition.x * 2.0 - 1.0, 1.0 - aPosition.y * 2.0, 0.0, 1.0);
    }
`;

export function backgroundQuadGeometry() {
    return new Geometry({
        attributes: {
            aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' }
        },
        indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3])
    });
}

export class PixiBackgroundQuad extends PixiBackgroundMesh {
    async init(canvas, resource, kind, { fragment, name, uniforms }) {
        await super.init(canvas, resource, kind, { vertex: backgroundQuadVertex, fragment, name, uniforms });
        this.stage.addChild(new Mesh({ geometry: backgroundQuadGeometry(), shader: this.shader }));
    }
}

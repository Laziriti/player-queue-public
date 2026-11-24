import { Mesh, Shader } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { PixiSceneSurface } from '../scene-layers/pixi-scene-surface.js';

export class GlassSurface extends PixiSceneSurface {
    constructor(program, uniforms, build) {
        super();
        this.program = program;
        this.uniforms = {
            uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
            uTime: { value: 0, type: 'f32' },
            ...uniforms
        };
        this.build = build;
    }

    resize(width, height) {
        if (this.renderer.width === Math.max(1, width) && this.renderer.height === Math.max(1, height)
            && this.meshWidth === this.width && this.meshHeight === this.height) return;
        super.resize(width, height);
        if (this.time !== undefined) this.draw(this.time);
    }

    draw(time) {
        this.time = time;
        if (!this.width || !this.height) return;
        if (this.meshWidth !== this.width || this.meshHeight !== this.height) this.#layout();
        this.values.uTime = time;
        this.present();
    }

    #layout() {
        const { width, height } = this;
        this.#clearMesh();
        this.shader ??= Shader.from({ gl: this.program, resources: { glass: this.uniforms } });
        this.values = this.shader.resources.glass.uniforms;
        this.values.uSize.set([width, height]);
        this.mesh = new Mesh({ geometry: this.build(width, height, this.values), shader: this.shader });
        this.stage.addChild(this.mesh);
        this.meshWidth = width;
        this.meshHeight = height;
    }

    #clearMesh() {
        if (!this.mesh) return;
        this.stage.removeChild(this.mesh);
        this.mesh.geometry.destroy(true);
        this.mesh.destroy();
        this.mesh = null;
    }

    destroy() {
        this.#clearMesh();
        this.shader?.destroy();
        this.shader = null;
        super.destroy();
    }
}

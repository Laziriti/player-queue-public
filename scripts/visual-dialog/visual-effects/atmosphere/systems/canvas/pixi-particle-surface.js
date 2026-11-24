import { PixiPuffBatch } from './pixi-puff-batch.js';
import { PixiGhostTrails } from './pixi-ghost-trails.js';
import { solidParticleTexture } from './sprites.js';

const inWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
const pixi = inWorker
    ? await import('../../../../../../assets/vendor/pixi-8.23.0/webworker.min.mjs')
    : await import('../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs');
const { CanvasSource, Container, Filter, GlProgram, ImageSource, Matrix, Rectangle, Sprite, Texture, UniformGroup,
    WebGLRenderer, defaultFilterVert } = pixi;

if (inWorker) pixi.DOMAdapter.set(pixi.WebWorkerAdapter);

const TINT_FRAGMENT = `
    in vec2 vTextureCoord;
    uniform sampler2D uTexture;
    uniform vec4 uTint;
    out vec4 finalColor;

    void main() {
        vec4 source = texture(uTexture, vTextureCoord);
        // The texture is premultiplied, so the peak channel already includes alpha.
        float value = max(max(source.r, source.g), source.b);
        finalColor = vec4(mix(source.rgb, value * uTint.rgb, uTint.a), source.a);
    }
`;

// Pixi batches the simulation's transformed sprites into WebGL draws.
export class PixiParticleSurface {
    constructor(solidTexture = false) {
        this.transform = new Matrix();
        this.spriteTransform = new Matrix();
        this.sprites = [];
        this.textures = new Map();
        this.puffs = new Map();
        this.solidTexture = solidTexture;
        this.globalAlpha = 1;
        this.used = 0;
    }

    async init(canvas, onContextLost) {
        const context = canvas.getContext('webgl2', { alpha: true, depth: false, stencil: true, antialias: false });
        if (!context) throw new Error('WebGL 2 unavailable for particles');
        this.context = context;
        this.renderer = new WebGLRenderer();
        await this.renderer.init({ canvas, context, backgroundAlpha: 0 });
        this.stage = new Container();
        // Instanced puffs have unit geometry, so their bounds cannot size the filter target.
        this.stage.filterArea = new Rectangle(0, 0, this.renderer.width, this.renderer.height);
        this.abort = new AbortController();
        canvas.addEventListener('webglcontextlost', onContextLost, { signal: this.abort.signal });
    }

    resize(width, height) {
        this.renderer.resize(Math.max(1, width), Math.max(1, height));
        this.stage.filterArea.width = this.renderer.width;
        this.stage.filterArea.height = this.renderer.height;
    }

    clearRect() {
        this.used = 0;
        if (this.ghostTrails) this.ghostTrails.used = 0;
        for (const batch of this.puffs.values()) batch.count = 0;
    }
    setGhostTrailCapacity(capacity) {
        this.ghostTrails?.destroy();
        this.ghostTrails = capacity ? new PixiGhostTrails(pixi, capacity) : null;
        if (this.ghostTrails) this.stage.addChildAt(this.ghostTrails.mesh, 0);
    }

    setTransform(...args) { this.transform.set(...args); }

    translate(x, y) {
        const { a, b, c, d } = this.transform;
        this.transform.tx += a * x + c * y;
        this.transform.ty += b * x + d * y;
    }

    rotate(angle) {
        const { a, b, c, d, tx, ty } = this.transform;
        const sin = Math.sin(angle), cos = Math.cos(angle);
        this.transform.set(a * cos + c * sin, b * cos + d * sin,
            c * cos - a * sin, d * cos - b * sin, tx, ty);
    }

    scale(x, y) {
        this.transform.a *= x;
        this.transform.b *= x;
        this.transform.c *= y;
        this.transform.d *= y;
    }

    #textureFor(image) {
        let texture = this.textures.get(image);
        if (!texture) {
            const resource = this.solidTexture ? solidParticleTexture(image) : image;
            const Source = typeof resource.getContext === 'function' ? CanvasSource : ImageSource;
            texture = new Texture({ source: new Source({ resource }) });
            this.textures.set(image, texture);
        }
        return texture;
    }

    setSolidTexture(enabled) {
        if (this.solidTexture === enabled) return;
        this.solidTexture = enabled;
        this.resetTextures();
    }

    setTint(color, strength) {
        if (!strength) {
            if (this.tintFilter) this.stage.filters = null;
            return;
        }
        if (!this.tintFilter) {
            this.tintUniforms = new UniformGroup({ uTint: { value: new Float32Array(4), type: 'vec4<f32>' } });
            this.tintFilter = new Filter({
                glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: TINT_FRAGMENT, name: 'vn-particle-tint' }),
                resources: { tintUniforms: this.tintUniforms },
            });
        }
        this.tintUniforms.uniforms.uTint.set([
            parseInt(color.slice(1, 3), 16) / 255,
            parseInt(color.slice(3, 5), 16) / 255,
            parseInt(color.slice(5, 7), 16) / 255,
            strength / 100,
        ]);
        if (!this.stage.filters) this.stage.filters = [this.tintFilter];
    }

    drawImage(image, x, y, width = image.width, height = image.height) {
        this.#drawTexture(this.#textureFor(image), x, y, width, height);
    }

    drawPuff(image, first, next, blend, x, y, width, height) {
        let batch = this.puffs.get(image);
        if (!batch) {
            batch = new PixiPuffBatch(pixi, this.#textureFor(image).source, first);
            this.puffs.set(image, batch);
            this.stage.addChild(batch.mesh);
        }
        batch.add(this.transform, this.globalAlpha, first, next, blend, x, y, width, height);
    }

    #drawTexture(texture, x, y, width, height) {
        let sprite = this.sprites[this.used];
        if (!sprite) {
            sprite = new Sprite();
            this.sprites.push(sprite);
            this.stage.addChild(sprite);
        }
        this.used++;
        sprite.visible = true;
        sprite.texture = texture;
        sprite.alpha = this.globalAlpha;
        const { a, b, c, d, tx, ty } = this.transform;
        const sx = width / texture.width, sy = height / texture.height;
        this.spriteTransform.set(a * sx, b * sx, c * sy, d * sy,
            tx + a * x + c * y, ty + b * x + d * y);
        sprite.setFromMatrix(this.spriteTransform);
    }

    present() {
        for (let i = this.used; i < this.sprites.length; i++) this.sprites[i].visible = false;
        this.ghostTrails?.upload();
        for (const batch of this.puffs.values()) batch.upload();
        this.renderer.render({ container: this.stage });
    }

    resetTextures() {
        for (const sprite of this.sprites) sprite.texture = Texture.EMPTY;
        for (const batch of this.puffs.values()) batch.destroy();
        this.puffs.clear();
        for (const texture of this.textures.values()) texture.destroy(true);
        this.textures.clear();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.abort?.abort();
        this.ghostTrails?.destroy();
        this.resetTextures();
        this.stage?.destroy({ children: true });
        this.tintFilter?.destroy();
        if (this.renderer?.gl) this.renderer.destroy();
        else this.context?.getExtension('WEBGL_lose_context')?.loseContext();
    }
}

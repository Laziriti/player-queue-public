import { CanvasSource, Container, Sprite, Texture, WebGLRenderer } from '../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';

export const portraitMotionUniforms = () => ({
    uPlacement: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
    uOpacity: { value: 1, type: 'f32' },
});

/** Rasterize SVGs as well as images, at the displayed size instead of the original upload size. */
export class PortraitTexture {
    constructor(image, mipmaps = false) {
        this.image = image;
        this.raster = new OffscreenCanvas(1, 1);
        this.source = new CanvasSource({ resource: this.raster, autoGenerateMipmaps: mipmaps });
    }

    resize({ width, height, padX, padY, scaleX, scaleY }, rect) {
        const { naturalWidth, naturalHeight } = this.image;
        const scale = Math.min(width / naturalWidth, height / naturalHeight);
        const w = naturalWidth * scale, h = naturalHeight * scale;
        // Match the render target's pixel grid so a stationary portrait is filtered only once.
        const left = Math.round((padX + (width - w) / 2) * scaleX);
        const top = Math.round((padY + height - h) * scaleY);
        const right = Math.round((padX + (width + w) / 2) * scaleX);
        const bottom = Math.round((padY + height) * scaleY);
        const rasterWidth = Math.max(1, right - left), rasterHeight = Math.max(1, bottom - top);
        if (!this.rasterized || this.raster.width !== rasterWidth || this.raster.height !== rasterHeight) {
            this.source.resize(rasterWidth, rasterHeight);
            const context = this.raster.getContext('2d');
            context.clearRect(0, 0, rasterWidth, rasterHeight);
            context.drawImage(this.image, 0, 0, rasterWidth, rasterHeight);
            this.source.update();
            this.rasterized = true;
        }
        rect.set([left / scaleX - padX, top / scaleY - padY, rasterWidth / scaleX, rasterHeight / scaleY]);
    }

    destroy() { this.source.destroy(); }
}

/** Temporary source for a portrait that has no material effect. */
export class PlainPortrait {
    constructor(image) {
        this.raster = new PortraitTexture(image);
        this.texture = new Texture({ source: this.raster.source });
        this.rect = new Float32Array(4);
    }

    padding() { return [0, 0]; }
    resize(layout) { this.raster.resize(layout, this.rect); }
    update({ dirty }) { return dirty; }
    destroy() { this.texture.destroy(); this.raster.destroy(); }
}

/** Share one context while keeping each portrait bitmap in the scene's DOM paint order. */
export class PortraitRenderer {
    static async create(onContextLost) {
        const surface = new OffscreenCanvas(1, 1);
        const gl = surface.getContext('webgl2', { alpha: true, depth: false, stencil: true, antialias: true });
        if (!gl) throw new Error('WebGL 2 unavailable for portrait effects');
        const renderer = new WebGLRenderer();
        try {
            await renderer.init({ canvas: surface, context: gl, antialias: true, backgroundAlpha: 0, textureGCActive: false });
            if (gl.isContextLost()) throw new Error('Portrait effect context lost during setup');
            return new PortraitRenderer(surface, renderer, onContextLost);
        } catch (error) {
            if (renderer.gl) renderer.destroy();
            else gl.getExtension('WEBGL_lose_context')?.loseContext();
            throw error;
        }
    }

    constructor(surface, renderer, onContextLost) {
        this.surface = surface;
        this.renderer = renderer;
        const { gl } = renderer;
        this.maxBitmapEdge = Math.min(4096, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
        this.abort = new AbortController();
        surface.addEventListener('webglcontextlost', onContextLost, { signal: this.abort.signal });
    }

    draw(portrait, target, width, height, resolution, checkUpload, motion) {
        const outputWidth = width + 2 * (motion?.padX ?? 0);
        const outputHeight = height + (motion ? motion.padY + motion.padBottom : 0);
        const size = `${outputWidth},${outputHeight},${resolution}`;
        if (this.size !== size) {
            this.renderer.resize(outputWidth, outputHeight, resolution);
            this.size = size;
        }
        const container = portrait instanceof PlainPortrait ? this.plainFrame(portrait, motion) : portrait.root;
        if (portrait.uniforms) {
            const uniforms = portrait.uniforms;
            uniforms.uSurface.set([width, height]);
            if (motion) {
                const { x, y, scaleX, scaleY, alpha, padX, padY, pivotX, pivotY } = motion;
                const centerX = padX + pivotX + x + (width / 2 - pivotX) * scaleX;
                const centerY = padY + pivotY + y + (height / 2 - pivotY) * scaleY;
                uniforms.uPlacement.set([scaleX * width / outputWidth, scaleY * height / outputHeight,
                    2 * centerX / outputWidth - 1, 1 - 2 * centerY / outputHeight]);
                uniforms.uOpacity = alpha;
            } else {
                uniforms.uPlacement.set([1, 1, 0, 0]);
                uniforms.uOpacity = 1;
            }
        }
        this.renderer.render({ container, clear: true });
        const gl = this.renderer.gl;
        if (gl.isContextLost() || (checkUpload && gl.getError() !== gl.NO_ERROR)) {
            throw new Error('Pixi could not render the portrait effect');
        }
        const bitmap = this.surface.transferToImageBitmap();
        try { target.transferFromImageBitmap(bitmap); }
        finally { bitmap.close(); }
    }

    plainFrame(portrait, motion) {
        if (!this.motionStage) {
            this.motionStage = new Container();
            this.motionSprite = new Sprite();
            this.motionStage.addChild(this.motionSprite);
        }
        const sprite = this.motionSprite;
        const [left, top, sourceWidth, sourceHeight] = portrait.rect;
        sprite.texture = portrait.texture;
        const { x, y, scaleX, scaleY, alpha, padX, padY, pivotX, pivotY } = motion;
        sprite.position.set(padX + pivotX + x + (left - pivotX) * scaleX,
            padY + pivotY + y + (top - pivotY) * scaleY);
        sprite.scale.set(scaleX * sourceWidth / sprite.texture.width, scaleY * sourceHeight / sprite.texture.height);
        sprite.alpha = alpha;
        return this.motionStage;
    }

    destroy() {
        this.abort.abort();
        this.motionStage?.destroy({ children: true });
        this.renderer.destroy();
    }
}

import { CanvasSource, Container, ImageSource, Shader, VideoSource, WebGLRenderer } from '../../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';

export class PixiBackgroundMesh {
    async init(canvas, resource, kind, { vertex, fragment, name, uniforms, depth = false }) {
        this.depth = depth;
        const context = canvas.getContext('webgl2', { alpha: true, depth, stencil: true, antialias: false });
        this.context = context;
        if (!context || (depth && !context.getContextAttributes()?.depth)) {
            throw new Error('Required WebGL 2 capabilities are unavailable');
        }
        this.renderer = new WebGLRenderer();
        await this.renderer.init({ canvas, context, backgroundAlpha: 0, depth, resolution: window.devicePixelRatio });
        this.stage = new Container();
        if (kind === 'video') {
            // Keep media lifecycle in VNSceneBackground and dirty the texture on decoded frames.
            this.video = resource;
            this.source = new VideoSource({ resource, autoLoad: false, autoPlay: false });
            this.source.autoUpdate = false;
        } else if (kind === 'svg') {
            // SVGs without intrinsic dimensions need a raster surface for WebGL.
            this.svg = resource;
            this.source = new CanvasSource({ resource: document.createElement('canvas') });
        } else {
            this.source = new ImageSource({ resource });
        }
        this.shader = Shader.from({
            gl: { vertex, fragment, name, preferredFragmentPrecision: 'highp' },
            resources: {
                uTexture: this.source,
                scene: {
                    uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
                    uCover: { value: new Float32Array(4), type: 'vec4<f32>' },
                    ...uniforms
                }
            }
        });
        this.uniforms = this.shader.resources.scene.uniforms;
    }

    resize({ width, height }) {
        const dpr = window.devicePixelRatio;
        this.renderer.resize(width, height, dpr);
        this.uniforms.uSize.set([width, height]);
        const sourceWidth = this.svg?.naturalWidth ?? this.source.width;
        const sourceHeight = this.svg?.naturalHeight ?? this.source.height;
        const scale = Math.max(width / sourceWidth, height / sourceHeight);
        const w = sourceWidth * scale, h = sourceHeight * scale;
        if (this.svg) {
            const raster = this.source.resource;
            this.source.resize(Math.ceil(w * dpr), Math.ceil(h * dpr));
            raster.getContext('2d').drawImage(this.svg, 0, 0, raster.width, raster.height);
            this.source.update();
        }
        this.uniforms.uCover.set([(width - w) / 2, (height - h) / 2, 1 / w, 1 / h]);
    }

    render() {
        if (this.video?.readyState >= 2 && !this.video.requestVideoFrameCallback && this.video.currentTime !== this.videoTime) {
            this.videoTime = this.video.currentTime;
            this.source.update();
        }
        if (this.present) this.present(this.renderer, this.stage);
        else this.renderer.render({ container: this.stage });
    }

    checkUpload() {
        const gl = this.renderer.gl;
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`Background texture upload failed (WebGL ${error})`);
    }

    watchVideo(onFrame) {
        if (!this.video?.requestVideoFrameCallback) return;
        const update = () => {
            this.source.update();
            onFrame?.();
            if (!this.source.destroyed) this.frameRequest = this.video.requestVideoFrameCallback(update);
        };
        this.frameRequest = this.video.requestVideoFrameCallback(update);
    }

    clearGeometry() {
        for (const mesh of this.stage?.removeChildren() ?? []) {
            mesh.geometry?.destroy(true);
            mesh.destroy();
        }
    }

    destroy() {
        if (this.frameRequest != null) this.video.cancelVideoFrameCallback(this.frameRequest);
        this.clearGeometry();
        this.stage?.destroy();
        this.shader?.destroy();
        // Destroy the texture without clearing src on the scene's video.
        if (this.video) this.source.resource = null;
        this.source?.destroy();
        if (this.renderer?.gl) this.renderer.destroy();
        else this.context?.getExtension('WEBGL_lose_context')?.loseContext();
    }
}

import { CanvasSource, Container, Graphics, Mesh, RenderTarget, Shader } from '../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { VNPreloader } from '../media/vn-preload.js';
import { mediaExtension } from '../media/vn-media-utils.js';
import { VNStageTransition } from './vn-stage-transition.js';
import { cubicBezier } from './easing.js';
import { PixiSceneSurface } from './atmosphere/systems/effects/scene-layers/pixi-scene-surface.js';
import { backgroundSurfaces, imageURL } from './atmosphere/systems/effects/background/pixi-background-effect.js';
import { PixiBackgroundQuad, backgroundQuadGeometry, backgroundQuadVertex } from './atmosphere/systems/effects/background/pixi-background-quad.js';
import { clamp, lerp as mix } from '../../utils/math.js';

const ease = p => cubicBezier([0.25, 0.1, 0.25, 1], p);
const easeSweep = p => cubicBezier([0.65, 0, 0.35, 1], p);
const TELEPORT_MAX_DIMENSION = 1280;
const TELEPORT_COVERED = .27;
const TELEPORT_HANDOFF = .82;

function play(ms, signal, draw) {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const start = performance.now();
        let frame;
        const cleanup = () => {
            cancelAnimationFrame(frame);
            clearTimeout(timeout);
            signal.removeEventListener('abort', finish);
        };
        const finish = () => {
            cleanup();
            resolve();
        };
        const tick = now => {
            const progress = clamp((now - start) / ms, 0, 1);
            try {
                if (draw(progress, now) === false || progress === 1) finish();
                else frame = requestAnimationFrame(tick);
            } catch (error) {
                cleanup();
                reject(error);
            }
        };
        const timeout = setTimeout(() => tick(start + ms), ms + 50);
        signal.addEventListener('abort', finish, { once: true });
        tick(start);
    });
}

const teleportFragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uOutgoing;
    uniform sampler2D uIncoming;
    uniform float uProgress;
    uniform float uDirection;
    out vec4 color;

    vec3 streaks(sampler2D scene, vec2 p, float zoom, float stretch, float travel) {
        if (stretch <= .001) return texture(scene, .5 + p / zoom).rgb;
        float r = length(p);
        vec2 ray = p / max(r, 0.0001);
        float angle = atan(ray.y, ray.x + 0.0001);
        float bend = stretch * uDirection * (.23 + .11 * sin(angle * 3.0 + travel - r * 6.0));
        ray = mat2(cos(bend), sin(bend), -sin(bend), cos(bend)) * ray;

        // Each ray pulls a band of actual background pixels out in depth.
        float flow = .73 + .17 * sin(angle * 7.0 + travel) + .10 * sin(angle * 19.0 - travel * 1.6);
        float depth = r / zoom + stretch * flow * (1.0 - exp(-r * 10.0)) * .22;
        float smear = stretch * flow * smoothstep(0.0, .19, r) * .32;
        vec3 sum = vec3(0.0);
        for (int i = 0; i < 7; i++) {
            float step = float(i) / 6.0;
            vec2 uv = .5 + ray * max(0.0, depth + (step - .5) * smear);
            sum += texture(scene, clamp(uv, .001, .999)).rgb;
        }
        return sum / 7.0;
    }

    void main() {
        float t = uProgress;
        vec2 p = vPoint - .5;
        float dive = smoothstep(.13, .53, t);
        float through = smoothstep(.39, .80, t);
        float arrival = smoothstep(.44, .92, t);
        float reach = mix(-.20, .93, arrival);
        float distanceFromCenter = length(p * vec2(1.0, .92));
        float reveal = 1.0 - smoothstep(reach - .15, reach + .19, distanceFromCenter);
        vec3 from = vec3(0.0);
        if (reveal < 1.0) {
            from = streaks(uOutgoing, p, 1.0 + 4.4 * dive * dive + 2.0 * through, dive, 3.2 * dive + 3.6 * through);
        }
        float settling = smoothstep(.51, .89, t);
        vec3 to = vec3(0.0);
        if (reveal > 0.0) {
            to = streaks(uIncoming, p, mix(.37, 1.0, settling), (1.0 - settling) * .88, 4.4 + settling * 2.6);
        }
        color = vec4(mix(from, to, reveal), 1.0);
    }
`;

function captureBackground(media, width, height, dim) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, TELEPORT_MAX_DIMENSION / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (media) {
        const w = media.videoWidth ?? media.naturalWidth;
        const h = media.videoHeight ?? media.naturalHeight;
        const fit = Math.max(canvas.width / w, canvas.height / h);
        const drawnWidth = w * fit, drawnHeight = h * fit;
        ctx.fillStyle = '#080911';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(media, (canvas.width - drawnWidth) / 2, (canvas.height - drawnHeight) / 2, drawnWidth, drawnHeight);
    } else {
        const gradient = ctx.createRadialGradient(canvas.width * .5, canvas.height * .8, 0,
            canvas.width * .5, canvas.height * .8, Math.max(canvas.width, canvas.height) * .7);
        gradient.addColorStop(0, '#141828');
        gradient.addColorStop(1, '#05050c');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (media && dim) {
        ctx.save();
        ctx.scale(canvas.width / 2, canvas.height / 2);
        const shade = ctx.createRadialGradient(1, 1, 0, 1, 1, Math.SQRT2);
        shade.addColorStop(0, 'rgba(0,0,0,0.35)');
        shade.addColorStop(1, 'rgba(0,0,0,0.65)');
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, 2, 2);
        ctx.restore();
    }
    return new CanvasSource({ resource: canvas });
}

/** A single Pixi pass bends the backgrounds in depth while the DOM cast fades independently. */
export async function playPixiTeleport(overlay, timing, { url, video, dim }, swap, signal) {
    const layer = overlay.querySelector('.vn-bg-layer');
    const oldVideo = layer?.querySelector('.vn-bg-video');
    const oldUrl = imageURL(layer?.style.backgroundImage ?? '');
    const incomingVideo = video ?? (oldVideo?.getAttribute('src') === url ? oldVideo : null);
    const load = async (imageUrl, clip) => {
        if (clip) {
            if (clip.readyState < 2) throw new Error('Background video has no decoded frame');
            return clip;
        }
        if (!VNPreloader.isPreloadable(imageUrl)) return null;
        await VNPreloader.ready(imageUrl);
        const image = VNPreloader.decodedImage(imageUrl);
        if (!image) throw new Error('Background image has no decoded frame');
        return image;
    };
    const [from, to] = await Promise.all([load(oldUrl, oldVideo), load(url, incomingVideo)]);
    if (signal.aborted || !overlay.isConnected) return;

    const surface = new PixiSceneSurface();
    let outgoing, incoming, shader, geometry;
    try {
        if (!await surface.mount(overlay, 'vn-pixi-transition-cover vn-pixi-teleport', signal, null, TELEPORT_MAX_DIMENSION)) return;
        surface.canvas.style.visibility = 'hidden';
        outgoing = captureBackground(from, surface.width, surface.height, !!overlay.querySelector('.vn-background-overlay'));
        incoming = captureBackground(to, surface.width, surface.height, dim);
        geometry = backgroundQuadGeometry();
        shader = Shader.from({
            gl: { vertex: backgroundQuadVertex, fragment: teleportFragment, name: 'vn-teleport', preferredFragmentPrecision: 'highp' },
            resources: {
                uOutgoing: outgoing,
                uIncoming: incoming,
                scene: {
                    uSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
                    uProgress: { value: 0, type: 'f32' },
                    uDirection: { value: timing.direction, type: 'f32' }
                }
            }
        });
        surface.stage.addChild(new Mesh({ geometry, shader }));
        surface.renderer.render({ container: surface.stage });
        const gl = surface.context;
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('Teleport texture upload failed');
        const easeBetween = (start, end, t) => {
            const unit = clamp((t - start) / (end - start), 0, 1);
            return unit * unit * (3 - 2 * unit);
        };
        await VNStageTransition.teleport(overlay, surface.canvas, swap, signal, (style, animationSignal) =>
            play(timing.bg, animationSignal, t => {
                if (gl.isContextLost()) throw new Error('Teleport WebGL context lost');
                style.setProperty('--vn-teleport-background-out', t < TELEPORT_COVERED ? 1 : 0);
                style.setProperty('--vn-teleport-cast-out', 1 - easeBetween(0, .20, t));
                style.setProperty('--vn-teleport-cast-in', easeBetween(.83, 1, t));
                style.setProperty('--vn-teleport-warp', easeBetween(.08, TELEPORT_COVERED, t) * (1 - easeBetween(TELEPORT_HANDOFF, .99, t)));
                shader.resources.scene.uniforms.uProgress = t;
                surface.renderer.render({ container: surface.stage });
            }));
    } finally {
        surface.destroy();
        geometry?.destroy(true);
        shader?.destroy();
        outgoing?.destroy();
        incoming?.destroy();
    }
}

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform vec4 uLook;
    uniform float uZoom;
    uniform float uWipe;
    uniform float uFlipY;
    out vec4 color;

    vec4 photo(vec2 p) {
        vec2 uv = (p - uCover.xy) * uCover.zw;
        return texture(uTexture, vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFlipY)));
    }

    void main() {
        if (vPoint.x > uSize.x * uWipe) discard;
        vec2 p = (vPoint - 0.5 * uSize) / uZoom + 0.5 * uSize;
        vec4 source = photo(p);
        if (uLook.y > 0.0) {
            vec2 d = vec2(uLook.y * 1.41421356, 0.0);
            source = source * 0.25 + (photo(p + d.xy) + photo(p - d.xy) + photo(p + d.yx) + photo(p - d.yx)) * 0.125
                + (photo(p + d.xx) + photo(p - d.xx) + photo(p + vec2(d.x, -d.x)) + photo(p + vec2(-d.x, d.x))) * 0.0625;
        }
        vec3 rgb = mix(vec3(dot(source.rgb, vec3(0.213, 0.715, 0.072))), source.rgb, uLook.w);
        color = vec4(min(rgb * uLook.z, vec3(source.a)), source.a) * uLook.x;
    }
`;

function backgroundFrame(uniforms, type, t) {
    const p = ease(t);
    const phase = at => ease(t < at ? t / at : (t - at) / (1 - at));
    if (type === 'zoom') {
        uniforms.uZoom = mix(1.15, 1, p);
        uniforms.uLook.set([p, mix(6, 0, p), 1, 1]);
    } else if (type === 'blur') {
        const k = phase(0.4);
        uniforms.uLook.set(t < 0.4 ? [k, mix(25, 8, k), mix(1.3, 1.1, k), 1] : [1, mix(8, 0, k), mix(1.1, 1, k), 1]);
    } else if (type === 'flash') {
        const k = phase(0.18);
        uniforms.uLook.set(t < 0.18 ? [k, 0, mix(4, 3, k), mix(0, 0.2, k)] : [1, 0, mix(3, 1, k), mix(0.2, 1, k)]);
    } else if (type === 'black') {
        const k = phase(0.4);
        uniforms.uLook.set(t < 0.4 ? [k, 0, 0, 1] : [1, 0, k, 1]);
    } else if (type === 'sweep') {
        uniforms.uWipe = easeSweep(t);
    } else {
        uniforms.uLook[0] = p;
    }
}

const lookUniforms = flipY => ({
    uLook: { value: new Float32Array([1, 0, 1, 1]), type: 'vec4<f32>' },
    uZoom: { value: 1, type: 'f32' },
    uWipe: { value: 1, type: 'f32' },
    uFlipY: { value: flipY, type: 'f32' }
});

function backgroundShader(name, source, size, cover, flipY) {
    return Shader.from({
        gl: { vertex: backgroundQuadVertex, fragment, name, preferredFragmentPrecision: 'highp' },
        resources: {
            uTexture: source,
            scene: {
                uSize: { value: size, type: 'vec2<f32>' },
                uCover: { value: cover, type: 'vec4<f32>' },
                ...lookUniforms(flipY)
            }
        }
    });
}

// Reuse the effect's renderer and media texture. Partial effects need the plain background below their geometry.
class BackgroundEffectPass {
    constructor(surface) {
        this.surface = surface;
        const { mesh } = surface;
        const { screen: { width, height }, resolution } = mesh.renderer;
        this.target = new RenderTarget({ width, height, resolution, depth: mesh.depth, colorTextures: 1 });
        this.geometry = backgroundQuadGeometry();
        this.shader = backgroundShader('vn-background-effect-transition', this.target.colorTexture,
            new Float32Array([width, height]), new Float32Array([0, 0, 1 / width, 1 / height]), 1);
        this.uniforms = this.shader.resources.scene.uniforms;
        this.stage = new Container();
        this.stage.addChild(new Mesh({ geometry: this.geometry, shader: this.shader }));
        if (surface.composeBackground) {
            this.baseShader = backgroundShader('vn-background-effect-base', mesh.source, mesh.uniforms.uSize, mesh.uniforms.uCover, 0);
            this.base = new Container();
            this.base.addChild(new Mesh({ geometry: this.geometry, shader: this.baseShader }));
        }
        mesh.present = (renderer, stage) => {
            const { width, height } = renderer.screen;
            if (width !== this.target.width || height !== this.target.height || renderer.resolution !== this.target.resolution) {
                this.target.resize(width, height, renderer.resolution);
                this.uniforms.uSize.set([width, height]);
                this.uniforms.uCover.set([0, 0, 1 / width, 1 / height]);
            }
            if (this.base) renderer.render({ container: this.base, target: this.target, clearColor: [0, 0, 0, 0] });
            renderer.render({ container: stage, target: this.target, clear: !this.base, clearColor: [0, 0, 0, 0] });
            renderer.render({ container: this.stage });
        };
    }

    destroy() {
        this.surface.mesh.present = null;
        this.base?.destroy({ children: true });
        this.baseShader?.destroy();
        this.stage.destroy({ children: true });
        this.geometry.destroy(true);
        this.shader.destroy();
        this.target.destroy();
    }
}

/** Draw the incoming media. The outgoing layer stays live underneath the transparent pass. */
export async function playPixiBackground(layer, url, video, type, ms, signal) {
    const kind = video ? 'video' : mediaExtension(url);
    const foreground = () => [...layer.children].find(child => child.matches('.vn-pixi-background:not(.vn-pixi-transition)'));
    // Keep native playback for animated image formats.
    if (kind === 'gif' || kind === 'apng' || /^data:image\/(?:gif|apng)[;,]/i.test(url)) return;

    const image = video ?? VNPreloader.decodedImage(url);
    if (!image || (video && video.readyState < 2)) throw new Error('Background media is not ready for a Pixi transition');

    const canvas = document.createElement('canvas');
    canvas.className = 'vn-pixi-background vn-pixi-transition';
    canvas.setAttribute('aria-hidden', 'true');
    let mesh, effect;
    let lost = false;
    canvas.addEventListener('webglcontextlost', () => { lost = true; });
    try {
        if (!foreground()) {
            mesh = new PixiBackgroundQuad();
            await mesh.init(canvas, image, kind, { fragment, name: 'vn-background-transition', uniforms: lookUniforms(0) });
        }
        if (signal.aborted) return;
        let width, height, dpr;
        let rendered = false;
        await play(ms, signal, (t, now) => {
            const nextWidth = layer.clientWidth, nextHeight = layer.clientHeight;
            if (!layer.isConnected || !nextWidth || !nextHeight) return false;
            const front = foreground();
            if (front) {
                const surface = backgroundSurfaces.get(front);
                if (!surface || (effect && effect.surface !== surface)) return false;
                const firstFrame = !effect;
                if (firstFrame) {
                    effect = new BackgroundEffectPass(surface);
                    canvas.remove();
                    mesh?.destroy();
                    mesh = null;
                }
                backgroundFrame(effect.uniforms, type, t);
                surface.redraw(now);
                if (firstFrame) {
                    surface.mesh.checkUpload();
                    layer.classList.add('vn-bg-pixi-transition');
                    layer.style.visibility = '';
                }
                return true;
            }
            if (lost) throw new Error('Background transition WebGL context lost');
            if (!mesh) return false;
            if (width !== nextWidth || height !== nextHeight || dpr !== window.devicePixelRatio) {
                width = nextWidth;
                height = nextHeight;
                dpr = window.devicePixelRatio;
                mesh.resize({ width, height });
            }
            backgroundFrame(mesh.uniforms, type, t);
            mesh.render();
            if (!rendered) {
                mesh.checkUpload();
                mesh.watchVideo();
                layer.append(canvas);
                layer.classList.add('vn-bg-pixi-transition');
                layer.style.visibility = '';
                rendered = true;
            }
            return true;
        });
    } finally {
        canvas.remove();
        layer.classList.remove('vn-bg-pixi-transition');
        effect?.destroy();
        mesh?.destroy();
        const surface = backgroundSurfaces.get(foreground());
        if (effect && surface === effect.surface && !surface.mesh.context.isContextLost()) surface.redraw();
    }
}

const sweepVertex = `#version 300 es
    in vec2 aPosition;
    out float vX;
    void main() {
        vX = aPosition.x;
        gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
    }
`;

const sweepFragment = `#version 300 es
    in float vX;
    uniform float uOffset;
    out vec4 color;

    void main() {
        float x = vX - uOffset;
        float alpha = min(smoothstep(-0.12, 0.0, x), 1.0 - smoothstep(1.0, 1.12, x));
        float glow = (1.0 - smoothstep(0.12, 0.23, max(-x, x - 1.0))) * 0.18 * (1.0 - alpha);
        color = vec4(vec3(5, 6, 12) / 255.0 * alpha + vec3(136, 192, 208) / 255.0 * glow, alpha + glow);
    }
`;

/** The curtain is above the stage and below the controls. */
export async function playPixiCover(overlay, type, msIn, msOut, swap, signal) {
    const surface = new PixiSceneSurface();
    let geometry, shader, swapped = false;
    let lost = false, swapping = false;
    try {
        if (!await surface.mount(overlay, 'vn-pixi-transition-cover', signal, () => { lost = true; })) {
            if (signal.aborted || !overlay.isConnected) return;
            throw new Error('Curtain context lost');
        }
        let draw;
        if (type === 'sweep') {
            geometry = backgroundQuadGeometry();
            shader = Shader.from({ gl: { vertex: sweepVertex, fragment: sweepFragment, name: 'vn-sweep-curtain', preferredFragmentPrecision: 'highp' },
                resources: { curtain: { uOffset: { value: 0, type: 'f32' } } }
            });
            surface.stage.addChild(new Mesh({ geometry, shader }));
            draw = (t, closing) => { shader.resources.curtain.uniforms.uOffset = (easeSweep(t) - Number(closing)) * 1.24; };
        } else {
            const color = type === 'flash' ? 0xf6f8ff : 0x000000;
            const curtain = surface.stage.addChild(new Graphics().rect(0, 0, 1, 1).fill(color));
            draw = (t, closing) => {
                curtain.alpha = closing ? cubicBezier([0.42, 0, 1, 1], t) : 1 - cubicBezier([0, 0, 0.58, 1], t);
                curtain.scale.set(surface.canvas.width, surface.canvas.height);
            };
        }
        const phase = closing => play(closing ? msIn : msOut, signal, t => {
            if (lost) throw new Error('Curtain WebGL context lost');
            draw(t, closing);
            surface.renderer.render({ container: surface.stage });
        });
        await phase(true);
        if (signal.aborted) return;
        swapped = swapping = true;
        await swap();
        swapping = false;
        await phase(false);
    } catch (error) {
        if (swapping) throw error;
        if (!signal.aborted) console.error('VN: Pixi curtain failed', error);
    } finally {
        surface.destroy();
        geometry?.destroy(true);
        shader?.destroy();
    }
    if (!swapped && !signal.aborted && overlay.isConnected) await swap();
}

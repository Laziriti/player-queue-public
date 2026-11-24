import { CanvasSource, Container, Mesh, MeshGeometry, Shader } from '../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { generateCrack, outlineOf, pathD } from '../crack-geometry.js';
import { CHAR_FX_VARIANTS } from './config.js';
import { PortraitConstructs, hasConstructs } from './portrait-constructs.js';
import { portraitFragment, portraitVertex } from './portrait-shaders.js';
import { PortraitTexture, portraitMotionUniforms } from './portrait-surface.js';
import { seededRandom } from '../../../utils/seeded-random.js';

const STATIC = new Set(['cracked', 'neon', 'neon:cyan', 'neon:acid', 'stone', 'stone:mossy']);
const QUICK_MOTION = new Set(['glitch', 'vhs', 'rage', 'drunk']);
const ENGRAVING_MS = 520;
const PUPPET_MS = 1800;

/** Find three suspension points on the upper silhouette in normalized image coordinates. */
function findSuspensionPoints(raster) {
    const size = 64;
    const probe = new OffscreenCanvas(size, size).getContext('2d');
    probe.drawImage(raster, 0, 0, size, size);
    const { data } = probe.getImageData(0, 0, size, size);
    const tops = Array(size).fill(size);
    let top = size, bottom = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (data[(y * size + x) * 4 + 3] < 128) continue;
            tops[x] = Math.min(tops[x], y);
            top = Math.min(top, y);
            bottom = y;
        }
    }
    const upperLimit = top + (bottom - top) * .65;
    const columns = tops.map((y, x) => x).filter(x => tops[x] <= upperLimit);
    return [.17, .5, .83].map(fraction => {
        if (!columns.length) return [fraction, .15];
        const desired = columns[0] + fraction * (columns.at(-1) - columns[0]);
        const x = columns.reduce((best, x) => Math.abs(x - desired) < Math.abs(best - desired) ? x : best);
        return [(x + .5) / size, (tops[x] + .5) / size];
    });
}

/** Draw the seeded crack tree once per layout size. The shader masks it by the portrait alpha. */
class CrackTexture {
    constructor(key) {
        const random = seededRandom(`crack|${key}`);
        this.openings = [];
        this.hairs = [];
        const main = 3 + Math.floor(random() * 2);
        for (let i = 0; i < main; i++) {
            const crack = generateCrack(random, {
                x: 20 + random() * 60, y: 14 + random() * 140, angle: random() * Math.PI * 2,
                length: 60 + random() * 60, width: 2.6 + random() * 1.4,
                maxDepth: 2, step: 9, bounds: { w: 100, h: 200 },
            });
            for (const branch of crack.branches) {
                const outline = outlineOf(branch, random);
                if (outline) this.openings.push(outline);
                else this.hairs.push(branch.pts);
            }
        }
        this.canvas = new OffscreenCanvas(1, 1);
        this.source = new CanvasSource({ resource: this.canvas });
    }

    resize(width, height, resolution) {
        this.source.resize(Math.ceil(width * resolution), Math.ceil(height * resolution));
        const context = this.canvas.getContext('2d');
        context.setTransform(resolution, 0, 0, resolution, 0, 0);
        context.clearRect(0, 0, width, height);
        context.lineCap = context.lineJoin = 'round';
        const makePath = (lines, close) => new Path2D(lines.map(points => pathD(
            points.map(({ x, y }) => ({ x: x * width / 100, y: y * height / 200 })), 0, 0, close)).join(''));
        const openings = makePath(this.openings, true);
        const hairs = makePath(this.hairs, false);
        context.lineWidth = 2.4;
        context.strokeStyle = 'rgba(255,255,255,0.35)';
        context.stroke(openings);
        context.stroke(hairs);
        context.lineWidth = 1.1;
        context.fillStyle = context.strokeStyle = 'rgba(8,6,4,0.92)';
        context.stroke(hairs);
        for (const points of this.openings) context.fill(makePath([points], true));
        this.source.update();
    }
}

export class PortraitMesh {
    constructor(image, url, base, variant) {
        const id = variant ? `${base}:${variant}` : base;
        this.base = base === 'holy_radiant' ? 'holy' : base;
        this.animated = !STATIC.has(id) && base !== 'living_engraving' && base !== 'marionette';
        this.frameInterval = QUICK_MOTION.has(base) ? 0 : 28;
        const variantIndex = Math.max(0, CHAR_FX_VARIANTS[this.base]?.findIndex(option => option.id === id) ?? 0);
        this.texture = new PortraitTexture(image, !hasConstructs(base));
        const resources = {
            uTexture: this.texture.source,
            effect: {
                uSurface: { value: new Float32Array(2), type: 'vec2<f32>' },
                uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
                uPadding: { value: new Float32Array(2), type: 'vec2<f32>' },
                uImage: { value: new Float32Array(4), type: 'vec4<f32>' },
                uTime: { value: 0, type: 'f32' },
                uGlow: { value: 1, type: 'f32' },
                uDecorations: { value: 1, type: 'f32' },
                uMotion: { value: 1, type: 'f32' },
                uLite: { value: 0, type: 'f32' },
                uVariant: { value: variantIndex, type: 'f32' },
                ...portraitMotionUniforms(),
            },
        };
        if (base === 'cracked') {
            this.cracks = new CrackTexture(url);
            resources.uCracks = this.cracks.source;
        }
        if (base === 'living_engraving' || base === 'marionette') {
            resources.effect.uCue = { value: 0, type: 'f32' };
        }
        if (base === 'marionette') {
            for (const name of ['uThreadLeft', 'uThreadCenter', 'uThreadRight']) {
                resources.effect[name] = { value: new Float32Array(2), type: 'vec2<f32>' };
            }
        }
        const effect = hasConstructs(base) ? 'plain' : this.base;
        this.shader = Shader.from({
            gl: { vertex: portraitVertex, fragment: portraitFragment(effect), name: `vn-portrait-${effect}`,
                preferredFragmentPrecision: 'highp' },
            resources,
        });
        this.uniforms = this.shader.resources.effect.uniforms;
        this.mesh = new Mesh({
            geometry: new MeshGeometry({ positions: new Float32Array([0,0,1,0,1,1,0,1]),
                indices: new Uint32Array([0,1,2,0,2,3]) }),
            shader: this.shader,
        });
        this.root = new Container();
        if (effect === 'plain') {
            this.constructs = new PortraitConstructs(base, variant);
            this.root.addChild(this.constructs.back, this.mesh, this.constructs.front);
        } else this.root.addChild(this.mesh);
    }

    padding(width, height) {
        if (this.base === 'holy') return [Math.ceil(width * .58), Math.ceil(height * .63)];
        if (this.constructs) return [Math.ceil(width * .23 + 28), Math.ceil(width * .15 + height * .08 + 16)];
        if (this.base === 'ghost' || this.base === 'shadow' || this.base === 'possessed') {
            return [Math.ceil(Math.max(40, width * .22)), Math.ceil(Math.max(60, height * .24))];
        }
        // The strings extend past the top of the stage, even for small portraits.
        if (this.base === 'marionette') return [36, Math.max(36, Math.ceil(window.innerHeight * 1.12 - height)), 16];
        if (this.base === 'living_engraving') return [8, 8];
        const pad = this.base === 'xray' || STATIC.has(this.base) ? 16 : 36;
        return [pad, pad];
    }

    resize(layout) {
        const { width, height, padX, padY, resolution } = layout;
        this.texture.resize(layout, this.uniforms.uImage);
        if (this.base === 'marionette' && !this.suspensionReady) {
            const [left, center, right] = findSuspensionPoints(this.texture.raster);
            this.uniforms.uThreadLeft.set(left);
            this.uniforms.uThreadCenter.set(center);
            this.uniforms.uThreadRight.set(right);
            this.suspensionReady = true;
        }
        this.cracks?.resize(width, height, resolution);
        this.uniforms.uSize.set([width, height]);
        this.uniforms.uPadding.set([padX, padY]);
    }

    update(frame) {
        const { seconds, active, transitioning, motion, dirty, lite } = frame;
        const wasAnimated = this.animated;
        this.uniforms.uTime = seconds / (active ? 1 : 1.8);
        this.uniforms.uGlow = active ? 1 : .45;
        this.uniforms.uDecorations = transitioning ? 0 : 1;
        this.uniforms.uMotion = motion ? 1 : 0;
        this.uniforms.uLite = lite ? 1 : 0;
        this.constructs?.update(frame);
        if (this.base === 'living_engraving') {
            if (this.cueStart == null || (frame.entering && !this.entering)) this.cueStart = frame.now;
            this.entering = frame.entering;
            if (!motion) this.cueStart = frame.now - ENGRAVING_MS;
            this.uniforms.uCue = Math.min(1, (frame.now - this.cueStart) / ENGRAVING_MS);
            this.animated = this.uniforms.uCue < 1;
        }
        if (this.base === 'marionette') {
            const speaking = active && !transitioning;
            if (this.speaking !== speaking) {
                this.cueStart = speaking || this.speaking ? frame.now : frame.now - PUPPET_MS;
                this.speaking = speaking;
            }
            if (!motion || transitioning) this.cueStart = frame.now - PUPPET_MS;
            const duration = speaking ? PUPPET_MS : 240;
            const elapsed = frame.now - this.cueStart;
            this.uniforms.uCue = Math.min(elapsed, duration) / 1000;
            this.animated = elapsed < duration;
        }
        return dirty || (motion && (this.animated || wasAnimated));
    }

    destroy() {
        this.mesh.geometry.destroy(true);
        this.root.destroy({ children: true });
        this.shader.destroy();
        this.cracks?.source.destroy();
        this.texture.destroy();
    }
}

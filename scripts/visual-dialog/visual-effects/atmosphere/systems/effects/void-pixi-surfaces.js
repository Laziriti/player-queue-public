import { CanvasSource, Geometry, Mesh, Shader } from '../../../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';
import { pathD } from '../../../crack-geometry.js';
import { cubicBezier } from '../../../easing.js';

function canvasOf(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    return canvas;
}

function paintTile({ shape, center, colors, width, height }) {
    const canvas = canvasOf(width, height);
    const ctx = canvas.getContext('2d');
    const x = width * center[0], y = height * center[1];
    const dx = Math.max(x, width - x), dy = Math.max(y, height - y);
    const radius = Math.hypot(dx, dy);
    const rx = shape === 'circle' ? radius : Math.SQRT2 * dx;
    const ry = shape === 'circle' ? radius : Math.SQRT2 * dy;
    ctx.setTransform(rx, 0, 0, ry, x, y);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const entry of colors.split(/,(?![^()]*\))/)) {
        const [, color, stops] = entry.trim().match(/^(rgba?\([^)]*\)|transparent)\s+(.*)$/);
        for (const stop of stops.split(/\s+/)) {
            const offset = parseFloat(stop) / (stop.endsWith('px') ? radius : 100);
            gradient.addColorStop(offset, color);
        }
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(-x / rx, -y / ry, width / rx, height / ry);
    return canvas;
}

// Bake the declared repeating nebula gradients once. The shader moves this material inside the polygon mask.
function paintWindow(palette, width, height) {
    const canvas = canvasOf(width * 1.6, height * 1.6);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = palette.inner.match(/#[\da-f]+$/i)[0];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tiles = [...palette.inner.matchAll(/radial-gradient\(((?:[^()]|\([^)]*\))*)\)\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s*\/\s*(\d+)px\s+(\d+)px/g)];
    for (const [, radial, x, y, w, h] of tiles.reverse()) {
        const [, shape, cx, cy, colors] = radial.match(/^(circle|ellipse)(?: at (\d+)% (\d+)%)?,\s*(.*)$/);
        const tile = paintTile({
            shape, center: [(cx ?? 50) / 100, (cy ?? 50) / 100], colors, width: +w, height: +h
        });
        const pattern = ctx.createPattern(tile, 'repeat');
        pattern.setTransform(new DOMMatrix().translate(+x, +y));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return canvas;
}

function paintCrack({ openings, hairs, palette, box }) {
    const { x, y, w, h } = box;
    const glow = canvasOf(w, h);
    const rim = canvasOf(w, h);
    const mask = canvasOf(w, h);
    const soft = glow.getContext('2d');
    const edge = rim.getContext('2d');
    const window = mask.getContext('2d');
    const outlines = openings.map(({ poly }) => pathD(poly, x, y));
    soft.filter = 'blur(2.5px)';
    soft.fillStyle = soft.strokeStyle = palette.glow;
    soft.lineWidth = 3;
    soft.lineJoin = 'round';
    edge.lineJoin = edge.lineCap = 'round';
    for (const outline of outlines) {
        const path = new Path2D(outline);
        soft.fill(path);
        soft.stroke(path);
        edge.strokeStyle = palette.edge;
        edge.lineWidth = 2.8;
        edge.stroke(path);
    }
    for (const hair of hairs) {
        const path = new Path2D(pathD(hair.pts, x, y, false));
        edge.strokeStyle = palette.edge;
        edge.globalAlpha = 0.35;
        edge.lineWidth = 2.6;
        edge.stroke(path);
        edge.strokeStyle = palette.hair;
        edge.globalAlpha = 1;
        edge.lineWidth = 1.1;
        edge.stroke(path);
    }
    window.fill(new Path2D(outlines.join('')));
    return { glow, rim, mask, inner: paintWindow(palette, w, h) };
}

const vertex = `#version 300 es
    in vec2 aPosition;
    uniform vec4 uBox;
    uniform vec2 uScreen;
    out vec2 vUv;
    void main() {
        vec2 ndc = (aPosition * uBox.zw + uBox.xy) / uScreen;
        gl_Position = vec4(ndc.x * 2.0 - 1.0, 1.0 - ndc.y * 2.0, 0.0, 1.0);
        vUv = aPosition;
    }
`;

const fragment = `#version 300 es
    in vec2 vUv;
    uniform sampler2D uGlow;
    uniform sampler2D uRim;
    uniform sampler2D uMask;
    uniform sampler2D uInner;
    uniform vec4 uBox;
    uniform vec2 uImpact;
    uniform vec4 uAnimation; // opening radius, closing radius, glow opacity, background drift
    out vec4 color;
    vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
    void main() {
        float dist = length(vUv * uBox.zw - uImpact);
        float reveal = clamp((uAnimation.x - dist) / 60.0, 0.0, 1.0);
        float heal = clamp((dist - uAnimation.y) / 60.0, 0.0, 1.0);
        vec2 drift = vec2(0.04, 0.03) * (2.0 * uAnimation.w - 1.0);
        vec2 uv = 0.5 + ((vUv - 0.5) / 1.6 - drift) / (1.0 + 0.08 * uAnimation.w);
        vec4 glow = texture(uGlow, vUv) * uAnimation.z;
        vec4 edge = texture(uRim, vUv);
        vec4 opening = texture(uInner, uv) * texture(uMask, vUv).a;
        color = over(opening, over(edge, glow)) * reveal * heal;
    }
`;

const easeInOut = [0.42, 0, 0.58, 1];
const easeGrow = [0.3, 0.05, 0.3, 1];
const easeClose = [0.45, 0, 0.9, 0.6];

export class PixiCrack {
    constructor(model, start) {
        this.model = model;
        this.start = start;
        this.grow = Math.max(1400, Math.min(3500, model.reach * 3.5));
        this.lifetime = 9000 + Math.random() * 7000;
        this.close = 1300 + Math.random() * 600;
        const { box, cx, cy } = model;
        this.sources = Object.values(paintCrack(model)).map(resource => new CanvasSource({ resource }));
        const [uGlow, uRim, uMask, uInner] = this.sources;
        this.shader = Shader.from({
            gl: { vertex, fragment, name: 'vn-void-breach', preferredFragmentPrecision: 'highp' },
            resources: {
                uGlow, uRim, uMask, uInner,
                crack: {
                    uBox: { value: new Float32Array([box.x, box.y, box.w, box.h]), type: 'vec4<f32>' },
                    uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
                    uImpact: { value: new Float32Array([cx - box.x, cy - box.y]), type: 'vec2<f32>' },
                    uAnimation: { value: new Float32Array(4), type: 'vec4<f32>' }
                }
            }
        });
        const geometry = new Geometry({
            attributes: {
                aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' }
            },
            indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3])
        });
        this.mesh = new Mesh({ geometry, shader: this.shader });
    }

    update(now, width, height) {
        const age = now - this.start;
        this.mesh.visible = age >= 0;
        if (age < 0) return true;
        if (age >= this.lifetime + this.close) return false;
        const { reach } = this.model;
        const grow = reach * cubicBezier(easeGrow, Math.min(1, age / this.grow));
        const closing = Math.max(0, (age - this.lifetime) / this.close);
        const heal = -60 + (reach + 60) * cubicBezier(easeClose, closing);
        const glowPhase = 1 - Math.abs(2 * (age % 3200) / 3200 - 1);
        const drift = 1 - Math.abs((age % 22000) / 11000 - 1);
        const { uniforms } = this.shader.resources.crack;
        uniforms.uScreen.set([width, height]);
        uniforms.uAnimation.set([grow, heal, 0.6 + 0.4 * cubicBezier(easeInOut, glowPhase), cubicBezier(easeInOut, drift)]);
        return true;
    }

    destroy() {
        this.mesh.geometry.destroy(true);
        this.mesh.destroy();
        this.shader.destroy();
        for (const source of this.sources) source.destroy();
    }
}

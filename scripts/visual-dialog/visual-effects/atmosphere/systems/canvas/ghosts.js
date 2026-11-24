import { bakeBlurredBody } from './sprites.js';
import { GHOST_TRAIL_POINTS } from './pixi-ghost-trails.js';

// Пути (px от левого верхнего угла сцены); тот же расчёт кривых раньше делал tools/dev/ghost-keyframes.mjs
const PATH_DATA = {
    A: 'M -450 790 C 170 790 890 725 1410 550 C 1840 405 2140 175 2420 30',
    B: 'M -450 745 C 160 770 890 705 1420 520 C 1850 370 2150 160 2420 10',
    C: 'M -450 815 C 190 815 900 755 1430 565 C 1840 418 2150 190 2420 65',
    D: 'M -450 770 C 180 795 910 685 1430 515 C 1840 380 2130 140 2420 -10',
};
const N = 64;
const HEAD_BOX = { w: 48, h: 78, left: -39.84, top: -39 };

const bez = (p, t) => {
    const u = 1 - t;
    return [0, 1].map(i => u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i]);
};

/** Кривая → N+1 равноотстоящих по длине точек (x, y, угол касательной в градусах); тот же расчёт, что в tools/dev/ghost-keyframes.mjs */
function samplePath(d) {
    const n = d.match(/-?[\d.]+/g).map(Number);
    const seg1 = [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]], [n[6], n[7]]];
    const seg2 = [seg1[3], [n[8], n[9]], [n[10], n[11]], [n[12], n[13]]];
    const pts = [];
    for (const seg of [seg1, seg2]) for (let i = 0; i <= 4000; i++) pts.push(bez(seg, i / 4000));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum.at(-1);
    const x = new Float32Array(N + 1), y = new Float32Array(N + 1), ang = new Float32Array(N + 1);
    let j = 0;
    for (let k = 0; k <= N; k++) {
        const target = total * k / N;
        while (j < cum.length - 2 && cum[j + 1] < target) j++;
        const f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
        x[k] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
        y[k] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
        const a = Math.max(j - 20, 0), b = Math.min(j + 21, pts.length - 1);
        ang[k] = Math.atan2(pts[b][1] - pts[a][1], pts[b][0] - pts[a][0]);
    }
    return { x, y, ang };
}

let paths = null;
const getPaths = () => (paths ??= Object.fromEntries(Object.entries(PATH_DATA).map(([k, d]) => [k, samplePath(d)])));

const envelope = u => Math.min(1, u / 0.10, (1 - u) / 0.13);
const fraction = n => n - Math.floor(n);
const trailSeconds = 0.9;
const centerBands = 8;
const out = { x: 0, y: 0, perspective: 1 };

// The original tracks are authored for 1920 × 1080. Scale positions and tangents to the current view.
function distantPath(path, u, lane, view) {
    const f = u * N;
    const i = Math.min(N - 1, Math.floor(f));
    const k = f - i;
    const sx = view.W / 1920, sy = view.H / 1080;
    out.x = (path.x[i] + (path.x[i + 1] - path.x[i]) * k) * sx;
    out.y = (path.y[i] + (path.y[i + 1] - path.y[i]) * k + lane * 1000 - 500) * sy;
    const angle = path.ang[i] + (path.ang[i + 1] - path.ang[i]) * k;
    return Math.atan2(Math.sin(angle) * sy, Math.cos(angle) * sx);
}

// A forward-facing camera at the centre of the orbit sees the far arc nearly side-on.
// Project the ring with x/z. The edges are closer to the camera, so the ghosts grow on either side.
function centerPath(u, lane, orbit, view) {
    const yaw = (u - 0.5) * 2.04;
    const tangent = Math.tan(yaw);
    const secant = Math.hypot(1, tangent);
    const focal = view.W * (0.46 + orbit * 0.07);
    const elevation = (lane - 0.5) * 1.02;
    const bend = 0.19 + orbit * 0.09;
    const swayPhase = u * 6 + orbit * 7;
    out.x = view.W * 0.5 + tangent * focal;
    out.y = view.H * (0.5 + elevation * secant - bend * (secant - 1) + Math.sin(swayPhase) * 0.024);
    out.perspective = secant;
    const dy = view.H * ((elevation - bend) * tangent * secant + Math.cos(swayPhase) * (0.024 * 6 / 2.04));
    return Math.atan2(dy, focal * secant * secant);
}

export class GhostSprites {
    constructor(imageUrls) {
        this.vapor = bakeBlurredBody({
            gradient: {
                type: 'radial', shape: 'ellipse', at: [0.65, 0.5],
                stops: [[0, '#d0d9e261'], [0.35, '#a8b7c534'], [0.73, 'transparent']],
            },
        }, 570, 105, 24, 1);
        this.heads = [];
        this.abort = new AbortController();
        imageUrls.forEach(async (url, i) => {
            try {
                const response = await fetch(url, { signal: this.abort.signal });
                if (!response.ok) return;
                const bitmap = await createImageBitmap(await response.blob());
                if (this.abort.signal.aborted) bitmap.close();
                else this.heads[i] = bitmap;
            } catch {
                // The trail still renders if a head fails to load.
            }
        });
    }

    destroy() {
        this.abort.abort();
        for (const bitmap of this.heads) bitmap?.close();
    }
}

class GhostTrack {
    constructor(n, position, variant) {
        this.inside = variant === 'vortex_center';
        this.lane = fraction(0.44 + n * 0.61803398875);
        this.orbit = fraction(0.71 + n * 0.41421356237);
        this.path = this.inside ? null : getPaths()['ABCD'[(position - 1) % 4]];
    }

    sample(u, view) {
        return this.inside ? centerPath(u, this.lane, this.orbit, view) : distantPath(this.path, u, this.lane, view);
    }
}

export class GhostVapor extends GhostTrack {
    constructor(n, sprites, variant) {
        super(n, n + 1, variant);
        this.sprites = sprites;
        this.duration = 12 + n * 0.35;
        this.phase = 0.35 + n * 0.23;
    }

    draw(ctx, view) {
        const spr = this.sprites.vapor;
        for (let i = 0; i < 2; i++) {
            const u = fraction(view.t / this.duration + this.phase + i * 0.5);
            const angle = this.sample(u, view);
            const scale = view.res * (view.scale ?? 1) * Math.min(view.W / 1920, view.H / 1080) * (this.inside ? out.perspective : 1);
            const c = Math.cos(angle) * scale, s = Math.sin(angle) * scale;
            ctx.setTransform(c, s, -s, c, out.x * view.res, out.y * view.res);
            ctx.globalAlpha = 0.30 * envelope(u);
            ctx.drawImage(spr.canvas, -456 - spr.padX, -52.5 - spr.padY, spr.canvas.width, spr.canvas.height);
        }
    }
}

export class GhostSoul extends GhostTrack {
    constructor(n, position, headIndex, sprites, { variant, count }) {
        super(n, position, variant);
        this.sprites = sprites;
        this.headIndex = headIndex;
        this.phase = fraction(0.37 + n * 0.75487766625);
        this.size = 0.72 + this.orbit * 0.85;
        this.brightness = 0.47 + this.orbit * 0.49;
        this.duration = 12 - this.orbit * 4.5;
        if (this.inside) {
            // Keep jittered slots in each band at the same angular speed so they cannot bunch up.
            // Vary speeds between bands so neighbouring streams keep overtaking each other.
            const band = n % centerBands;
            const slot = Math.floor(n / centerBands);
            const slots = Math.ceil((count - band) / centerBands);
            const offset = (this.orbit - 0.5) * 0.64;
            const height = fraction(0.44 + slot * 0.61803398875 + band * 0.41421356237);
            this.lane = (band + height) / centerBands;
            this.phase = (slot + 0.5 + offset) / slots + band * 0.61803398875;
            this.duration = 4.2 + fraction(0.13 + band * 0.61803398875) * 2.4;
        }
    }

    draw(ctx, view) {
        const u = fraction(view.t / this.duration + this.phase);
        const angle = this.sample(u, view);
        const { x, y } = out;
        const opacity = envelope(u) * this.brightness;
        const screenScale = (view.scale ?? 1) * Math.max(0.6, Math.min(view.W / 1920, view.H / 1080));
        const size = this.size * screenScale * (this.inside ? out.perspective : 1);
        const margin = 90 * size;
        if (x < -margin || opacity < 0.004) return;
        if (x > view.W + margin) {
            this.sample(Math.max(0, u - trailSeconds / this.duration), view);
            if (out.x > view.W + margin) return;
        }

        this.drawTrail(ctx.ghostTrails, view, u, screenScale);
        const img = this.sprites.heads[this.headIndex];
        if (!img) return;
        const res = view.res;
        const c = Math.cos(angle), s = Math.sin(angle);
        const headScale = res * size;
        // The artwork faces up. Turn it into the direction of travel.
        ctx.setTransform(-s * headScale, c * headScale, -c * headScale, -s * headScale,
            (x - (c + s * size) * 15.84) * res, (y + (c * size - s) * 15.84) * res);
        ctx.globalAlpha = opacity;
        const fit = Math.min(HEAD_BOX.w / img.width, HEAD_BOX.h / img.height);
        const w = img.width * fit, h = img.height * fit;
        ctx.drawImage(img, HEAD_BOX.left + (HEAD_BOX.w - w) / 2, HEAD_BOX.top + (HEAD_BOX.h - h) / 2, w, h);
    }

    drawTrail(batch, view, u, screenScale) {
        const { data } = batch;
        const res = view.res;
        let offset = batch.add();
        for (let i = 0; i < GHOST_TRAIL_POINTS; i++) {
            const age = i / (GHOST_TRAIL_POINTS - 1);
            const time = Math.max(0, u - age * trailSeconds / this.duration);
            const angle = this.sample(time, view);
            const size = this.size * screenScale * (this.inside ? out.perspective : 1);
            const halfWidth = (14 + 12 * Math.sin(age * Math.PI) - 11 * age) * size;
            const dx = -Math.sin(angle) * halfWidth, dy = Math.cos(angle) * halfWidth;
            const alpha = envelope(time) * this.brightness;
            for (let side = -1; side <= 1; side += 2) {
                data[offset++] = (out.x + dx * side) * res;
                data[offset++] = (out.y + dy * side) * res;
                data[offset++] = age;
                data[offset++] = side;
                data[offset++] = alpha;
            }
        }
    }
}

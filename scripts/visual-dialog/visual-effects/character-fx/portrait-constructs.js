import { Container, Graphics } from '../../../../assets/vendor/pixi-8.23.0/pixi.min.mjs';

const TAU = Math.PI * 2;
const radians = degrees => degrees * Math.PI / 180;
const orbiting = new Set(['arcane', 'archmage', 'orbs']);
const ROCKS = [
    [-.08, .35, -12, 6, -14], [.12, .14, -8, -10, 12], [.88, .14, 8, -10, -14],
    [1.08, .35, 12, 6, 18], [.88, .64, 10, 14, -9], [.12, .64, -10, 14, 10]
];
const SHARDS = [[-.12, .12, 0, 0], [1.05, .22, 27, 3], [.14, -.08, -28, 6], [.81, -.04, 48, 4]];
const ORBS = {
    mana: [
        [0xd5f8ff, 0x4b9fdb, 0x131e50], [0xece1ff, 0x8d6cdc, 0x251344], [0xd5f8ff, 0x46b8bd, 0x103238]
    ],
    elements: [
        [0xfff0b4, 0xe97632, 0x611724], [0xe2fbff, 0x429dd6, 0x132e62], [0xe6ffbd, 0x71a967, 0x173a32]
    ],
};

export function hasConstructs(base) {
    return orbiting.has(base) || base === 'psionic' || base === 'reality_rift';
}

/** Sample once per resize, then advance each object by distance along the ellipse. */
export function orbitPath(rx, ry) {
    const samples = 256;
    const distances = new Float32Array(samples + 1);
    let x = rx, y = 0;
    for (let i = 1; i <= samples; i++) {
        const angle = i * TAU / samples;
        const nextX = rx * Math.cos(angle), nextY = ry * Math.sin(angle);
        distances[i] = distances[i - 1] + Math.hypot(nextX - x, nextY - y);
        x = nextX;
        y = nextY;
    }
    return phase => {
        const distance = (phase % 1) * distances[samples];
        let from = 0, to = samples;
        while (to - from > 1) {
            const middle = (from + to) >> 1;
            if (distances[middle] <= distance) from = middle;
            else to = middle;
        }
        const angle = (from + (distance - distances[from]) / (distances[to] - distances[from])) * TAU / samples;
        return [Math.cos(angle) * rx, Math.sin(angle) * ry, angle < Math.PI];
    };
}

const cubeVertices = [
    [-.5,-.5,-.5], [.5,-.5,-.5], [.5,.5,-.5], [-.5,.5,-.5],
    [-.5,-.5,.5], [.5,-.5,.5], [.5,.5,.5], [-.5,.5,.5]
];
const cubeFaces = [
    [[0, 3, 2, 1], 0x171c30], [[4, 5, 6, 7], 0x1e2339],
    [[0, 4, 7, 3], 0x11182e], [[1, 2, 6, 5], 0x383b70],
    [[0, 1, 5, 4], 0x645c98], [[3, 7, 6, 2], 0x101329],
];

function drawCube(graphic, size, spin) {
    const [cx, sx] = [Math.cos(.42 + spin), Math.sin(.42 + spin)];
    const [cy, sy] = [Math.cos(.61 + spin * .87), Math.sin(.61 + spin * .87)];
    const [cz, sz] = [Math.cos(.21 + spin * .42), Math.sin(.21 + spin * .42)];
    const points = cubeVertices.map(([x, y, z]) => {
        const vx = x * cy + z * sy, depth = z * cy - x * sy;
        const vy = y * cx - depth * sx, vz = depth * cx + y * sx;
        const perspective = size / (1 - vz * size / 600);
        return [(vx * cz - vy * sz) * perspective, (vy * cz + vx * sz) * perspective, vz];
    });
    graphic.clear();
    for (const [indices, color] of cubeFaces) {
        const [a, b, c, d] = indices.map(index => points[index]);
        const facing = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (facing <= 0) continue;
        graphic.poly([a[0],a[1],b[0],b[1],c[0],c[1],d[0],d[1]])
            .fill(color).stroke({ color: 0xaedaff, width: .9, alpha: .88 });
    }
}

function facets(outline, center, colors) {
    const graphic = new Graphics();
    for (let i = 0; i < outline.length; i++) {
        graphic.poly([...center, ...outline[i], ...outline[(i + 1) % outline.length]]).fill(colors[i]);
    }
    return graphic;
}

function tint(from, to, t) {
    let color = 0;
    for (const shift of [16, 8, 0]) {
        const a = from >> shift & 255, b = to >> shift & 255;
        color |= Math.round(a + (b - a) * t) << shift;
    }
    return color;
}

function orb(index, variant) {
    const graphic = new Graphics();
    if (variant === 'void') {
        graphic.circle(0,0,57).fill({ color: 0x8e6ae3, alpha: .15 });
        graphic.circle(0,0,50).fill(0xe2dcff);
        for (let i = 0; i < 14; i++) {
            graphic.circle(i*.25,i*.25,49-i*1.9).fill(tint(0xb498ec, 0x070914, i/13));
        }
        return graphic;
    }
    const [light, mid, dark] = (ORBS[variant] ?? ORBS.mana)[index];
    graphic.circle(0,0,57).fill({ color: mid, alpha: .17 });
    graphic.circle(0,0,50).fill(0x080c1b);
    for (let i = 1; i <= 22; i++) {
        const t = i / 22;
        const color = t < .46 ? tint(dark,mid,t/.46) : tint(mid,light,(t-.46)/.54);
        graphic.circle(-19*t,-23*t,50-i*2).fill(color);
    }
    graphic.ellipse(-20,-23,8,5).fill({ color: 0xffffff, alpha: .42 });
    return graphic;
}

const GLYPHS = [
    [[-3,-5,0,5,3,-5],[-4,0,4,0]], [[-4,4,-4,-4,4,4,4,-4]],
    [[0,-5,0,5],[-4,-2,0,2,4,-2]], [[-4,0,0,-5,4,0,0,5,-4,0]]
];

function sigil(index) {
    const color = index ? 0xc5abfa : 0xa5ccff;
    const graphic = new Graphics().circle(0,0,94).circle(0,0,70).stroke({ color, width: 1 });
    for (let i = 0; i < 40; i++) {
        const angle = i * TAU / 40;
        graphic.moveTo(65 * Math.cos(angle),65 * Math.sin(angle))
            .arc(0,0,65,angle,angle+.027).stroke({ color, width: 1.6, alpha: .72 });
    }
    for (let i = 0; i < 16; i++) {
        const angle = i * TAU / 16;
        const c = Math.cos(angle), s = Math.sin(angle);
        for (const line of GLYPHS[i % GLYPHS.length]) {
            for (let n = 0; n < line.length; n += 2) {
                const x = line[n], y = line[n + 1] - 82;
                if (n === 0) graphic.moveTo(x*c-y*s,x*s+y*c);
                else graphic.lineTo(x*c-y*s,x*s+y*c);
            }
            graphic.stroke({ color, width: 1.25 });
        }
    }
    // Pixi retains the previous stroke's endpoint, so start the arc on the ring.
    graphic.moveTo(0,-94).arc(0,0,94,-Math.PI/2,0).stroke({ color: 0xeffaff, width: 2.5 });
    return graphic;
}

function aperture() {
    const disk = new Graphics().circle(0,0,104).fill({ color: 0x8e6ae3, alpha: .17 });
    const rim = new Graphics();
    for (let i = 0; i <= 16; i++) {
        disk.circle(i*.16,i*.16,100-i*3.8).fill(tint(0x302444,0x04050c,i/16));
    }
    for (let i = 0; i < 48; i++) {
        const angle = i * TAU / 48;
        const color = tint(0x382653, 0xd5e8ff, Math.pow(.5 + .5*Math.cos(angle*2.0), 2.0));
        rim.arc(0,0,100,angle,angle+TAU/48+.002).stroke({ color, width: 1.35 });
    }
    const ripples = Array.from({ length: 2 }, () =>
        new Graphics().circle(0,0,100).stroke({ color: 0x9f8cc3, width: 1 }));
    return { disk, rim, ripples };
}

export class PortraitConstructs {
    constructor(base, variant) {
        this.base = base;
        this.variant = variant;
        this.back = new Container();
        this.front = new Container();
        this.rings = [];
        if (orbiting.has(base)) {
            this.objects = Array.from({ length: 3 }, (_, i) => {
                if (base === 'arcane') return new Graphics();
                if (base === 'orbs') return orb(i, variant);
                return facets([[0,-55],[28,-5],[9,55],[-13,45],[-28,-8]], [0,-5],
                    [0xd6f4ff, 0x5b82a9, 0x272b62, 0x8b8cd4, 0xb9dcf9]);
            });
            this.back.addChild(...this.objects);
            if (base === 'archmage') {
                this.rings = [sigil(0), sigil(1)].map((ring, index) => {
                    const tilt = new Container({ rotation: radians(index ? 32 : -28) });
                    tilt.scale.y = index ? .50 : .56;
                    tilt.addChild(ring);
                    this.back.addChildAt(tilt, index);
                    return ring;
                });
            }
        } else if (base === 'psionic') {
            this.objects = ROCKS.map((_, index) => {
                const rock = facets([[-33,-47],[20,-50],[48,-20],[33,33],[-9,50],[-50,11]], [-8,-11],
                    [0x777887,0x393c4a,0x232735,0x313343,0x4d505e,0x565b6a]);
                (index === 1 || index === 2 ? this.back : this.front).addChild(rock);
                return rock;
            });
        } else {
            this.rift = aperture();
            this.back.addChild(...this.rift.ripples, this.rift.disk, this.rift.rim);
            this.objects = SHARDS.map(() => facets([[-4,-50],[22,-20],[5,50],[-22,17]], [-4,1],
                [0xac9acf,0x242039,0x100f1f,0x514267]));
            this.back.addChild(...this.objects);
        }
    }

    update({ seconds: t, transitioning, active, width: w, height: h, padX, padY, viewportWidth }) {
        this.back.visible = this.front.visible = !transitioning;
        if (transitioning) return;
        this.back.position.set(padX, padY);
        this.front.position.set(padX, padY);
        this.back.alpha = this.front.alpha = active ? 1 : .72;
        if (orbiting.has(this.base)) this.updateOrbit(t, w, h, viewportWidth);
        else if (this.base === 'psionic') {
            const phase = Math.abs(Math.cos(Math.PI * t / 14));
            const spread = phase * phase;
            const size = Math.min(34, Math.max(18, viewportWidth * .022));
            this.objects.forEach((rock, i) => {
                const [x, y, dx, dy, turn] = ROCKS[i];
                rock.position.set(x*w+dx*spread,y*h+dy*spread);
                rock.scale.set(size/100*(i%2 ? .7 : 1),size/80*(i%2 ? .7 : 1));
                rock.rotation = radians(turn*spread + (i%2 ? 37 : 0));
            });
        } else this.updateRift(t, w, h, viewportWidth);
    }

    updateOrbit(t, w, h, viewportWidth) {
        const cubes = this.base === 'arcane';
        const size = this.base === 'archmage' ? Math.min(29, Math.max(16, viewportWidth*.019))
            : Math.min(42, Math.max(22, viewportWidth*.027));
        if (this.w !== w || this.h !== h) {
            this.orbit = orbitPath(w * (cubes ? .58 : .60), h * (cubes ? .12 : .15));
            this.w = w;
            this.h = h;
        }
        this.objects.forEach((object, i) => {
            const [x, y, near] = this.orbit((t + 2) / 24 + i / 3);
            const parent = near ? this.front : this.back;
            if (object.parent !== parent) parent.addChild(object);
            object.position.set(.5*w+x,(cubes ? .43 : .38)*h+y);
            if (cubes) {
                const length = Math.max(15, size * [1,.79,.65][i]);
                const spin = this.variant === 'floating' ? 0 : (t + 6*i)*TAU/(13+4*i)*(i === 1 ? -1 : 1);
                if (object.spin !== spin || object.length !== length) {
                    drawCube(object, length, spin);
                    object.spin = spin;
                    object.length = length;
                }
            } else {
                object.scale.set(size/100);
                if (this.base === 'archmage') {
                    const sway = Math.cos((t+2.7*i)*TAU/8);
                    object.y -= 3*sway;
                    object.rotation = radians(-8*sway);
                }
            }
        });
        this.rings.forEach((ring,i) => {
            ring.parent.position.set(.5*w,(i ? .13 : .03)*h + .70*w);
            ring.scale.set(w*1.4/200);
            ring.rotation = t * (i ? -TAU/44 : TAU/36);
            ring.alpha = .80;
        });
    }

    updateRift(t, w, h, viewportWidth) {
        const { disk, rim, ripples } = this.rift;
        const x = .5*w, y = -.07*h + .56*w, size = 1.12*w/200;
        disk.position.set(x,y);
        disk.scale.set(size);
        rim.position.set(x,y);
        rim.scale.set(size);
        rim.rotation = t * TAU / 26;
        ripples.forEach((ring,i) => {
            const phase = (t / 10 + i*.5) % 1;
            ring.position.set(x,y);
            ring.scale.set(size * (.95 + .32*phase));
            ring.alpha = .48 * Math.sin(Math.PI * phase) * (1-phase);
        });
        const shardSize = Math.min(28, Math.max(15, viewportWidth*.018));
        this.objects.forEach((shard,i) => {
            const [sx,sy,angle,delay] = SHARDS[i];
            const sway = Math.cos((t+delay)*TAU/9);
            shard.position.set(sx*w,sy*h-3*sway);
            shard.scale.set(shardSize/100);
            shard.rotation = radians(angle-8*sway);
        });
    }
}

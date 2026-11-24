import { PixiBackgroundQuad } from './background/pixi-background-quad.js';

const operations = ['saturate', 'brightness', 'contrast', 'sepia', 'hue-rotate', 'grayscale'];
const maxOperations = 8;
const distortions = { wave: [14, 0.012, 0.008, 3], dream: [8, 0.007, 0.005, 2], eldritch: [18, 0.025, 0.020, 4] };

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform vec4 uDistortion;
    uniform vec2 uDrift;
    uniform float uBlur;
    uniform float uHeatTime;
    uniform float uFireRoom;
    uniform float uSnowDepth;
    uniform vec2 uColorGrade[${maxOperations}];
    out vec4 color;

    vec3 hueRotate(vec3 rgb, float angle) {
        float l = dot(rgb, vec3(0.213, 0.715, 0.072));
        return l + cos(angle) * (rgb - l) + sin(angle) * vec3(
            dot(rgb, vec3(-0.213, -0.715, 0.928)),
            dot(rgb, vec3(0.143, 0.140, -0.283)),
            dot(rgb, vec3(-0.787, 0.715, 0.072))
        );
    }
    vec3 sepia(vec3 rgb) {
        return vec3(dot(rgb, vec3(0.393, 0.769, 0.189)), dot(rgb, vec3(0.349, 0.686, 0.168)),
            dot(rgb, vec3(0.272, 0.534, 0.131)));
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
        vec2 cell = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
            mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), f.x), f.y);
    }
    float turbulence(vec2 p) {
        float sum = 0.0, weight = 0.5;
        for (int octave = 0; octave < 4; octave++) {
            if (float(octave) >= uDistortion.w) break;
            float value = noise(p);
            sum += (uDistortion.w == 4.0 ? abs(value * 2.0 - 1.0) : value) * weight;
            p *= 2.0;
            weight *= 0.5;
        }
        return sum;
    }
    vec2 heatRefraction(vec2 p, float time) {
        vec2 uv = p / uSize;
        float ground = smoothstep(0.14, 0.83, uv.y);
        float sideDistance = min(uv.x, 1.0 - uv.x);
        float edge = smoothstep(0.0, 0.035, min(sideDistance, 1.0 - uv.y));
        vec2 air = p / uSize.y;
        // Mix rising currents at different scales to break up horizontal bands.
        float current = sin(air.x * 25.0 + air.y * 8.0 + time * 1.4);
        float swell = sin(air.y * 126.0 + time * 6.0 + current * 1.6);
        float ripple = sin(air.y * 279.0 + air.x * 31.0 + time * 9.0);
        float lift = sin(air.y * 109.0 + air.x * 43.0 + time * 4.7);
        float strength = ground * min(uSize.y * 0.0093, 10.5);
        if (uFireRoom > 0.0) {
            // Heat rises from the flame strips along the floor and the two walls.
            float floorPlumes = smoothstep(0.43, 0.88, uv.y) * (0.86 + 0.14 * current);
            float wallPlumes = (1.0 - smoothstep(0.04, 0.28, sideDistance))
                * smoothstep(0.12, 0.68, uv.y) * (0.84 + 0.16 * lift);
            strength = max(floorPlumes, wallPlumes) * min(uSize.y * 0.0115, 13.0);
        }
        return vec2(0.68 * swell + 0.22 * ripple + 0.10 * current, lift * 0.26) * edge * strength;
    }
    vec4 photo(vec2 p) { return texture(uTexture, (p - uCover.xy) * uCover.zw); }
    vec4 snowdrifts() {
        vec2 uv = vPoint / uSize;
        float rise = smoothstep(0.0, 0.18, uSnowDepth);
        float ridge = 0.032 * sin(uv.x * 14.0 + 1.4) + 0.022 * sin(uv.x * 24.0 - 1.0);
        float bank = 1.0 - uSnowDepth * 0.86 + ridge * rise;
        float back = smoothstep(-0.003, 0.003, uv.y - bank);
        vec3 distant = mix(vec3(0.82, 0.91, 0.96), vec3(0.44, 0.61, 0.74), smoothstep(0.0, 0.16, uv.y - bank));
        float second = bank + (0.075 + 0.041 * sin(uv.x * 10.0 - 1.5)) * rise;
        float front = smoothstep(-0.002, 0.003, uv.y - second);
        vec3 close = mix(vec3(0.93, 0.98, 1.0), vec3(0.60, 0.74, 0.84), smoothstep(0.0, 0.29, uv.y - second));
        float glint = step(0.992, hash(floor(vPoint)));
        vec3 drifts = min(vec3(1.0), mix(distant, close, front) + glint * 0.10);
        return vec4(drifts, max(back, front));
    }
    void main() {
        vec2 p = vPoint;
        if (uHeatTime >= 0.0) p += heatRefraction(p, uHeatTime);
        if (uDistortion.x > 0.0) {
            vec2 n = (p - uDrift) * uDistortion.yz;
            p += (vec2(turbulence(n), turbulence(n + vec2(42.2, 15.8))) - 0.5) * uDistortion.x;
        }
        vec4 source = photo(p);
        if (uBlur > 0.0) {
            vec2 d = vec2(uBlur * 1.41421356, 0.0);
            source = source * 0.25 + (photo(p + d.xy) + photo(p - d.xy) + photo(p + d.yx) + photo(p - d.yx)) * 0.125
                + (photo(p + d.xx) + photo(p - d.xx) + photo(p + vec2(d.x, -d.x)) + photo(p + vec2(-d.x, d.x))) * 0.0625;
        }
        vec3 rgb = source.rgb / max(source.a, 0.0001);
        for (int i = 0; i < ${maxOperations}; i++) {
            vec2 op = uColorGrade[i];
            if (op.x == 0.0) break;
            if (op.x == 1.0) rgb = mix(vec3(dot(rgb, vec3(0.213, 0.715, 0.072))), rgb, op.y);
            else if (op.x == 2.0) rgb *= op.y;
            else if (op.x == 3.0) rgb = (rgb - 0.5) * op.y + 0.5;
            else if (op.x == 4.0) rgb = mix(rgb, sepia(rgb), op.y);
            else if (op.x == 5.0) rgb = hueRotate(rgb, op.y);
            else rgb = mix(rgb, vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722))), op.y);
            rgb = clamp(rgb, 0.0, 1.0);
        }
        color = vec4(rgb * source.a, source.a);
        if (uSnowDepth > 0.0) {
            vec4 snow = snowdrifts();
            color = vec4(snow.rgb * snow.a, snow.a) + color * (1.0 - snow.a);
        }
    }
`;

export function describeGrade(css) {
    css = css.replace(/\s+/g, ' ').trim();
    const blur = Number(css.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0);
    css = css.replace(/blur\([\d.]+px\)/g, '').trim().replace(/\s+/g, ' ');
    if (css === 'none') css = '';
    const entries = [...css.matchAll(/([a-z-]+)\((-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(deg)?\)/gi)];
    if (entries.length > maxOperations || entries.map(entry => entry[0]).join(' ') !== css) {
        throw new Error(`Unsupported color grade: ${css}`);
    }
    const data = new Float32Array(maxOperations * 2);
    for (let i = 0; i < entries.length; i++) {
        const [, op, value, unit] = entries[i];
        const code = operations.indexOf(op) + 1;
        if (!code || (op === 'hue-rotate') !== Boolean(unit)) throw new Error(`Unsupported color operation: ${op}`);
        data[i * 2] = code;
        data[i * 2 + 1] = Number(value) * (unit ? Math.PI / 180 : 1);
    }
    return { data, blur };
}

const triangle = value => 1 - Math.abs(value % 2 - 1);

export class ColorGradePixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-color-grade',
            uniforms: {
                uColorGrade: { value: new Float32Array(maxOperations * 2), type: 'vec2<f32>', size: maxOperations },
                uDistortion: { value: new Float32Array(4), type: 'vec4<f32>' },
                uDrift: { value: new Float32Array(2), type: 'vec2<f32>' },
                uBlur: { value: 0, type: 'f32' },
                uHeatTime: { value: -1, type: 'f32' },
                uFireRoom: { value: 0, type: 'f32' },
                uSnowDepth: { value: 0, type: 'f32' }
            }
        });
    }

    render(time, grade, next = grade, mix = 0) {
        this.uniforms.uColorGrade.set(grade.data);
        if (mix) {
            for (let i = 1; i < grade.data.length; i += 2) {
                this.uniforms.uColorGrade[i] += (next.data[i] - grade.data[i]) * mix;
            }
        }
        this.uniforms.uDistortion.set(distortions[grade.distortion] ?? [0, 0, 0, 0]);
        this.uniforms.uBlur = grade.blur;
        this.uniforms.uHeatTime = grade.heat ? time : -1;
        this.uniforms.uFireRoom = grade.heat === 'room' ? 1 : 0;
        const drift = this.uniforms.uDrift;
        if (grade.distortion === 'wave') drift.set([256 * triangle(time / 10), 128 * triangle(time / 14)]);
        if (grade.distortion === 'dream') drift.set([150 * triangle(time / 16), 80 * triangle(time / 22)]);
        if (grade.distortion === 'eldritch') drift.set([time * 512 / 22, time * 256 / 30]);
        super.render();
    }
}

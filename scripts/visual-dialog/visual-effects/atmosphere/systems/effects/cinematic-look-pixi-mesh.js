import { PixiBackgroundQuad } from './background/pixi-background-quad.js';

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform float uPhase;
    uniform float uEclipse;
    uniform float uSun;
    uniform float uMode;
    uniform float uTime;
    uniform vec3 uWaterTint;
    uniform vec3 uMirrorTint;
    out vec4 color;

    vec4 photo(vec2 p) { return texture(uTexture, (p - uCover.xy) * uCover.zw); }
    float luminance(vec3 rgb) { return dot(rgb, vec3(0.2126, 0.7152, 0.0722)); }

    vec4 mirrorWorld() {
        vec2 uv = vPoint / uSize;
        float travel = smoothstep(0.0, 1.0, uPhase);
        float wave = sin(uv.y * 9.0 + travel * 5.0) * 0.040 + sin(uv.y * 19.0 - travel * 6.0) * 0.014;
        float distance = uv.x - mix(-0.21, 1.21, travel) + wave + (uv.y - 0.5) * 0.15;
        float width = min(uSize.x, uSize.y) * 0.052;
        float edge = distance * uSize.x / width;
        float turned = 1.0 - smoothstep(-0.22, 0.24, edge);
        float glass = 1.0 - smoothstep(0.0, 1.5, abs(edge));
        vec2 bend = vec2(sin(edge * 2.1), cos(uv.y * 15.0 + travel * 8.0) * 0.35) * glass * width * 0.59;
        vec4 source = photo(vPoint + bend);
        if (turned > 0.0) {
            // A faint, offset second reflection gives hard edges depth in the silver image.
            vec4 ghost = photo(vPoint + bend + vec2(0.44, -0.17) * width);
            float silver = luminance(mix(source.rgb, ghost.rgb, 0.26));
            vec3 reflected = silver * vec3(0.78, 0.96, 1.13) + vec3(0.015, 0.045, 0.074) * source.a;
            source.rgb = mix(source.rgb, reflected * uMirrorTint, turned);
        }
        float seam = 1.0 - smoothstep(0.022, 0.099, abs(edge));
        float echo = 1.0 - smoothstep(0.021, 0.068, abs(edge + 0.45));
        float gleam = 0.70 + 0.30 * sin(uv.y * 13.0 - travel * 7.0);
        source.rgb += vec3(0.47, 0.81, 1.0) * uMirrorTint * (0.48 * seam + 0.16 * echo + 0.15 * glass) * gleam * source.a;
        return source;
    }

    vec3 withSun(vec4 source, float travel) {
        float reveal = uMode == 1.0 ? 1.0 : smoothstep(0.0, 0.12, uPhase);
        vec2 p = (vPoint - uSize * vec2(0.83, 0.21)) / min(uSize.x, uSize.y);
        float r = length(p);
        float radius = 0.092;
        float edge = max(fwidth(r), 0.001);
        float disk = 1.0 - smoothstep(radius - edge, radius + edge, r);
        float crossing = uMode == 1.0 ? travel : smoothstep(0.06, 0.96, travel);
        float moonOffset = mix(2.15 * radius, 0.0, crossing);
        float moon = 1.0 - smoothstep(radius - edge, radius + edge, length(p + vec2(moonOffset, 0.0)) - 0.003);
        float sunlight = 1.0 - smoothstep(0.0, radius, r);
        vec3 solarDisk = mix(vec3(1.0, 0.72, 0.33), vec3(1.0, 0.98, 0.80), sunlight);
        vec3 diskColor = mix(solarDisk, vec3(0.023, 0.026, 0.051), moon);
        vec3 rgb = mix(source.rgb, diskColor * source.a, disk * reveal);

        float corona = smoothstep(0.48, 1.0, crossing);
        float ring = exp(-abs(r - radius) * 310.0);
        float glow = exp(-max(0.0, r - radius) * 25.0) * (1.0 - disk);
        float upperLeft = smoothstep(-0.45, 0.86, dot(p / max(r, 0.0001), vec2(-0.65, -0.76)));
        float halo = mix(0.24, 0.11, corona) + upperLeft * 0.24;
        rgb += vec3(1.0, 0.59, 0.24) * glow * halo * reveal * source.a;
        rgb += vec3(1.0, 0.83, 0.54) * ring * mix(0.25, 0.63 + upperLeft * 0.42, corona) * reveal * source.a;
        return rgb;
    }

    vec4 eclipse() {
        vec2 uv = vPoint / uSize;
        vec4 source = photo(vPoint);
        // Give the sun time to appear and hold before the shadow begins to move.
        float travel = uMode == 1.0 ? uPhase : smoothstep(uSun > 0.0 ? 0.18 : 0.0, 1.0, uPhase);
        float arc = uv.y + uv.x * 0.34 + (uv.x - 0.58) * (uv.x - 0.58) * 0.32;
        float shadow = 1.0 - smoothstep(-0.28, 0.28, arc - mix(-0.3, 1.8, travel));
        float gray = luminance(source.rgb);
        vec3 night = mix(vec3(gray), source.rgb, 0.37) * vec3(0.37, 0.50, 0.72)
            + vec3(0.026, 0.04, 0.081) * source.a;
        source.rgb = mix(source.rgb, night, shadow);

        if (uSun > 0.0) source.rgb = withSun(source, travel);
        return source;
    }

    vec4 flood() {
        vec4 source = photo(vPoint);
        if (uPhase <= 0.0) return source;
        vec2 uv = vPoint / uSize;
        float wave = sin(uv.x * 17.0 + uTime * 1.5) * 0.006
            + sin(uv.x * 39.0 - uTime * 2.1) * 0.002;
        float depth = uv.y - (1.0 - uPhase + wave);
        vec2 ripple = vec2(sin(uv.y * 63.0 + uv.x * 12.0 - uTime * 2.0),
            cos(uv.x * 38.0 + uv.y * 32.0 + uTime * 1.6));
        vec4 submerged = photo(clamp(vPoint + ripple * min(uSize.x, uSize.y) * 0.009, vec2(0.0), uSize));
        float murk = smoothstep(0.0, 0.64, depth);
        float caustics = pow(0.5 + 0.5 * sin(uv.x * 52.0 + uv.y * 18.0 + ripple.x * 1.6), 7.0);
        vec3 waterGrade = vec3(0.35) + uWaterTint * 0.90;
        submerged.rgb = submerged.rgb * waterGrade * mix(1.0, 0.61, murk)
            + uWaterTint * submerged.a * 0.24
            + uWaterTint * caustics * exp(-max(0.0, depth) * 9.0) * submerged.a * 0.16;
        float water = uPhase >= 1.0 ? 1.0 : smoothstep(-0.002, 0.003, depth);
        float edge = exp(-abs(depth) * 430.0) * (1.0 - smoothstep(0.975, 1.0, uPhase)) * smoothstep(0.0, 0.02, uPhase);
        vec4 result = mix(source, submerged, water);
        result.rgb += mix(uWaterTint, vec3(1.0), 0.22) * edge * result.a * (0.43 + 0.25 * ripple.y);
        return result;
    }

    void main() {
        vec4 source = uMode == 2.0 ? flood() : (uEclipse > 0.0 ? eclipse() : mirrorWorld());
        color = vec4(min(source.rgb, vec3(source.a)), source.a);
    }
`;

export class CinematicLookPixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-cinematic-look',
            uniforms: {
                uPhase: { value: 0, type: 'f32' },
                uEclipse: { value: 0, type: 'f32' },
                uSun: { value: 0, type: 'f32' },
                uMode: { value: 0, type: 'f32' },
                uTime: { value: 0, type: 'f32' },
                uWaterTint: { value: new Float32Array(3), type: 'vec3<f32>' },
                uMirrorTint: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' }
            }
        });
    }

    render(phase, eclipse, sun, mirrorTint) {
        this.uniforms.uPhase = phase;
        this.uniforms.uEclipse = eclipse ? 1 : 0;
        this.uniforms.uSun = sun ? 1 : 0;
        if (mirrorTint) this.uniforms.uMirrorTint.set(mirrorTint);
        super.render();
    }

    renderAdjustable(flood, phase, time, tint) {
        this.uniforms.uMode = flood ? 2 : 1;
        this.uniforms.uTime = time;
        if (flood) this.uniforms.uWaterTint.set(tint);
        this.render(phase, !flood, !flood);
    }
}

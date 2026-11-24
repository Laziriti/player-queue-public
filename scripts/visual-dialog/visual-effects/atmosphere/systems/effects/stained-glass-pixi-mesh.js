import { PixiBackgroundQuad } from './background/pixi-background-quad.js';

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform float uTime;
    out vec4 color;

    vec3 paneColor(vec2 pane) {
        float id = mod(pane.x * 2.0 + pane.y * 3.0 + floor((pane.x - pane.y) * 0.5), 7.0);
        if (id < 1.0) return vec3(1.0, 0.10, 0.26);
        if (id < 2.0) return vec3(1.0, 0.56, 0.14);
        if (id < 3.0) return vec3(0.33, 0.25, 1.0);
        if (id < 4.0) return vec3(0.18, 0.73, 1.0);
        if (id < 5.0) return vec3(0.17, 0.86, 0.59);
        if (id < 6.0) return vec3(0.76, 0.23, 0.74);
        return vec3(1.0, 0.83, 0.39);
    }

    void main() {
        vec4 source = texture(uTexture, (vPoint - uCover.xy) * uCover.zw);
        vec2 uv = vPoint / uSize;
        float sway = sin(uTime * 0.25);
        vec2 p = uv - vec2(0.38 + 0.075 * sway, 0.64 + 0.042 * sin(uTime * 0.20));
        p.x *= uSize.x / uSize.y;
        // The bands fan out and flatten toward the foreground.
        p.x = (p.x - 0.64 * p.y) / (1.0 + 0.55 * p.y);
        p.y *= 1.0 - 0.30 * smoothstep(0.55, 1.0, uv.y);
        float beam = 1.0 - smoothstep(0.48, 1.04, length(p / vec2(0.77, 0.66)));

        vec2 ripple = vec2(sin(p.y * 30.0 + p.x * 12.0), sin(p.x * 29.0 - p.y * 17.0)) * 0.015;
        vec2 glass = vec2(p.x + p.y * 1.18, p.x - p.y * 1.18) / 0.235 + ripple;
        vec2 pane = floor(glass);
        vec2 tile = fract(glass);
        vec2 margin = min(tile, 1.0 - tile);
        float lead = min(margin.x, margin.y);
        float softness = mix(0.045, 0.091, smoothstep(0.15, 0.95, uv.y));
        float clearPane = smoothstep(0.012, softness, lead);
        float facets = 0.90 + 0.10 * smoothstep(0.88, 1.06, tile.x + tile.y);

        vec3 tint = paneColor(pane);
        float luma = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(source.a, 0.0001);
        float light = beam * clearPane * facets * (0.27 + 0.35 * luma);
        vec3 rgb = source.rgb * (1.0 + beam * clearPane * 0.10) + tint * light * source.a;
        color = vec4(min(rgb, vec3(source.a)), source.a);
    }
`;

export class StainedGlassPixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-stained-glass',
            uniforms: { uTime: { value: 0, type: 'f32' } }
        });
    }

    render(time) {
        this.uniforms.uTime = time;
        super.render();
    }
}

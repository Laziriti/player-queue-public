import { PixiBackgroundQuad } from './background/pixi-background-quad.js';

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uCover;
    uniform float uPhase;
    out vec4 color;

    const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
    vec4 photo(vec2 p) { return texture(uTexture, (p - uCover.xy) * uCover.zw); }
    float lightAt(vec2 p) {
        vec4 sampleColor = photo(p);
        return dot(sampleColor.rgb, luma) / max(sampleColor.a, 0.0001);
    }
    float hatch(float position, float width) {
        float center = abs(fract(position) - 0.5);
        return 1.0 - smoothstep(width, width + fwidth(position) * 0.6, center);
    }

    void main() {
        vec4 source = photo(vPoint);
        vec3 rgb = source.rgb / max(source.a, 0.0001);
        float light = dot(rgb, luma);
        vec2 uv = vPoint / uSize;
        float stepSize = clamp(uSize.y / 460.0, 1.15, 2.4);
        vec2 d = vec2(stepSize, 0.0);
        vec4 neighbors = vec4(lightAt(vPoint - d.xy), lightAt(vPoint + d.xy),
            lightAt(vPoint - d.yx), lightAt(vPoint + d.yx));
        float tone = mix(light, dot(neighbors, vec4(0.25)), 0.32);
        float gradient = length(neighbors.yw - neighbors.xz);
        float outline = smoothstep(0.022, 0.115, gradient);

        float shadow = 1.0 - smoothstep(0.18, 0.66, tone);
        float spacing = clamp(uSize.y / 120.0, 4.0, 8.5);
        vec2 p = vPoint / spacing;
        float diagonal = hatch(p.x * 0.71 - p.y * 0.71 + sin(p.y * 0.39) * 0.13, 0.09);
        float cross = hatch(p.x * 0.68 + p.y * 0.74 + sin(p.x * 0.63) * 0.10, 0.065);
        float hatchInk = diagonal * shadow * 0.41 + cross * (1.0 - smoothstep(0.07, 0.29, tone)) * 0.29;
        float ink = clamp(outline * 0.74 + hatchInk + shadow * 0.10, 0.0, 0.91);

        vec2 fibers = floor(vPoint * vec2(1.0, 1.7));
        float grain = fract(sin(dot(fibers, vec2(127.1, 311.7))) * 43758.5453) - 0.5;
        float mottling = sin(uv.x * 47.0 + sin(uv.y * 28.0)) * sin(uv.y * 53.0 - uv.x * 36.0);
        float edgeAge = smoothstep(0.31, 0.71, length((uv - 0.5) * vec2(1.06, 1.0)));
        vec3 cream = vec3(0.96, 0.87, 0.70) + grain * 0.042 + mottling * 0.019;
        cream -= vec3(0.10, 0.15, 0.19) * edgeAge;
        vec3 paper = cream * (0.72 + 0.28 * smoothstep(0.10, 0.82, tone));
        vec3 drawing = mix(paper, vec3(0.19, 0.105, 0.058), ink);

        float bleach = smoothstep(0.0, 0.46, uPhase);
        float develop = smoothstep(0.18, 0.90, uPhase);
        vec3 warm = light * vec3(1.13, 0.99, 0.82);
        rgb = mix(mix(rgb, warm, bleach), drawing, develop);
        color = vec4(clamp(rgb, 0.0, 1.0) * source.a, source.a);
    }
`;

export class PaperMapPixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-paper-map',
            uniforms: { uPhase: { value: 0, type: 'f32' } }
        });
    }

    render(phase) {
        this.uniforms.uPhase = phase;
        super.render();
    }
}

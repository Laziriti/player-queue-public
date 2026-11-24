import { PixiBackgroundQuad } from './background/pixi-background-quad.js';

const fragment = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec4 uCover;
    uniform float uShift;
    uniform float uNight;
    out vec4 color;

    vec3 nightVision(vec3 rgb) {
        const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
        float grey = dot(rgb, luma);
        vec3 sepia = grey * vec3(1.351, 1.203, 0.937);
        rgb = clamp(mix(vec3(grey), sepia, 0.9), 0.0, 1.0);
        float l = dot(rgb, vec3(0.213, 0.715, 0.072));
        const float c = 0.309016994, s = 0.951056516; // 72 degrees
        vec3 rotated = l + c * (rgb - l) + s * vec3(
            dot(rgb, vec3(-0.213, -0.715, 0.928)),
            dot(rgb, vec3(0.143, 0.140, -0.283)),
            dot(rgb, vec3(-0.787, 0.715, 0.072))
        );
        rgb = clamp(rotated, 0.0, 1.0);
        rgb = clamp(mix(vec3(dot(rgb, luma)), rgb, 1.7), 0.0, 1.0);
        rgb = clamp(rgb * 1.1, 0.0, 1.0);
        return clamp((rgb - 0.5) * 1.35 + 0.5, 0.0, 1.0);
    }

    void main() {
        vec2 uv = (vPoint - uCover.xy) * uCover.zw;
        if (uNight > 0.5) {
            vec4 source = texture(uTexture, uv);
            color = vec4(nightVision(source.rgb / max(source.a, 0.0001)) * source.a, source.a);
        } else {
            vec2 shift = vec2(uShift * uCover.z, 0.0);
            vec4 red = texture(uTexture, uv - shift);
            vec4 cyan = texture(uTexture, uv + shift);
            color = vec4(red.r, cyan.gb, max(red.a, cyan.a));
        }
    }
`;

export class VhsPixiMesh extends PixiBackgroundQuad {
    async init(canvas, resource, kind) {
        await super.init(canvas, resource, kind, {
            fragment, name: 'vn-vhs',
            uniforms: {
                uShift: { value: 0, type: 'f32' },
                uNight: { value: 0, type: 'f32' }
            }
        });
    }

    resize(layout, variant) {
        super.resize(layout);
        this.variant = variant;
        this.uniforms.uNight = Number(variant === 'night');
    }

    render(now, glitch) {
        const chewed = this.variant === 'chewed';
        const target = glitch ? (chewed ? 14 : 12) : (chewed ? 7 : 3);
        if (this.target !== target) {
            this.from = this.target === undefined ? target : this.uniforms.uShift;
            this.target = target;
            this.shiftedAt = now;
        }
        const progress = Math.min(1, (now - this.shiftedAt) / 50);
        this.uniforms.uShift = this.from + (target - this.from) * progress;
        super.render();
    }
}

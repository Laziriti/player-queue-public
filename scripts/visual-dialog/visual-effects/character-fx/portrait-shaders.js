export const portraitVertex = `#version 300 es
    in vec2 aPosition;
    uniform vec2 uSurface;
    uniform vec2 uPadding;
    uniform vec4 uPlacement;
    out vec2 vPoint;
    void main() {
        vPoint = aPosition * uSurface - uPadding;
        vec2 clip = aPosition * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
        gl_Position = vec4(clip * uPlacement.xy + uPlacement.zw, 0.0, 1.0);
    }
`;

const common = `#version 300 es
    in vec2 vPoint;
    uniform sampler2D uTexture;
    uniform vec2 uSize;
    uniform vec4 uImage;
    uniform float uTime;
    uniform float uGlow;
    uniform float uDecorations;
    uniform float uMotion;
    uniform float uLite;
    uniform float uVariant;
    uniform float uOpacity;
    out vec4 color;

    const float TAU = 6.2831853;
    float wave(float period) { return 0.5 - 0.5 * cos(TAU * uTime / period); }
    vec2 imageUV(vec2 p) { return (p - uImage.xy) / uImage.zw; }
    vec4 portrait(vec2 p) {
        vec2 uv = imageUV(p);
        if (any(lessThan(uv, vec2(0))) || any(greaterThan(uv, vec2(1)))) return vec4(0);
        return texture(uTexture, uv);
    }
    vec3 rgb(vec4 c) { return c.rgb / max(c.a, 0.0001); }
    vec4 paint(vec3 c, float a) {
        a = clamp(a, 0.0, 1.0);
        return vec4(clamp(c, 0.0, 1.0) * a, a);
    }
    vec4 over(vec4 front, vec4 back) { return front + (1.0 - front.a) * back; }
    float lightness(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    vec3 contrast(vec3 c, float amount) { return (c - 0.5) * amount + 0.5; }
    vec3 saturation(vec3 c, float amount) { return mix(vec3(lightness(c)), c, amount); }
    vec3 sepia(vec3 c, float amount) {
        vec3 warm = vec3(dot(c, vec3(.393,.769,.189)), dot(c, vec3(.349,.686,.168)), dot(c, vec3(.272,.534,.131)));
        return mix(c, warm, amount);
    }
    vec3 duotone(vec3 c, vec3 shadow, vec3 highlight) {
        return mix(shadow, highlight, clamp(lightness(c), 0.0, 1.0));
    }
    vec3 screenColor(vec3 c, vec3 light) { return 1.0 - (1.0 - c) * (1.0 - light); }
    vec2 rotate(vec2 p, float a) {
        float s = sin(a), c = cos(a);
        return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }
    float hash(vec2 p) {
        vec3 q = fract(p.xyx * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
    }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + 1.0), f.x), f.y);
    }
    float cloud(vec2 p) { return .59 * noise(p) + .29 * noise(p * 2.08) + .12 * noise(p * 4.31); }
    float ellipse(vec2 p, vec2 center, vec2 radius) {
        return 1.0 - smoothstep(0.0, 1.0, length((p - center) / radius));
    }
    // A padded, downsampled alpha texture would require another render pass.
    // The mip levels of the original provide a smooth silhouette with four taps.
    float softTap(vec2 p, float lod) {
        vec2 uv = imageUV(p);
        vec2 outside = max(-uv, uv - 1.0) * uImage.zw;
        float spread = exp2(lod) / (float(textureSize(uTexture, 0).x) / uImage.z);
        float edge = 1.0 - smoothstep(0.0, spread, max(outside.x, outside.y));
        return textureLod(uTexture, clamp(uv, 0.0, 1.0), lod).a * edge;
    }
    float glow(vec2 p, float radius) {
        float lod = max(0.0, log2(radius * float(textureSize(uTexture, 0).x) / uImage.z));
        vec2 r = vec2(radius * .68, 0);
        return .25 * (softTap(p + r, lod) + softTap(p - r, lod)
                    + softTap(p + r.yx, lod) + softTap(p - r.yx, lod));
    }
    vec4 aura(vec4 figure, vec2 p, vec3 tint, float radius, float strength) {
        return over(figure, paint(tint, glow(p, radius) * strength * uGlow));
    }
`;

// Each effect compiles only its own draw function. Variants share that program.
const effects = {
    plain: `return portrait(p);`,
    hologram: `
        float phase = fract(uTime / 6.0);
        float flicker = (step(.18, phase) - step(.195, phase))
                      + (step(.417, phase) - step(.425, phase))
                      + .55 * (step(.79, phase) - step(.80, phase));
        if (VARIANT == 2) flicker = 0.0;
        p.x += 3.0 * flicker;
        vec4 src = portrait(p);
        vec3 tint = VARIANT == 1 ? vec3(.32, 1, .18) : vec3(.24, .80, 1);
        vec3 c = duotone(contrast(rgb(src), 1.16), tint * .05, tint * 1.54);
        float scan = 1.0 - smoothstep(.18, .36, fract(p.y / 3.0));
        float y = p.y / uSize.y;
        float band = 1.0 - smoothstep(.0, .11, abs(y - mix(-.12, 1.12, fract(uTime / 3.6))));
        c = screenColor(c * (1.0 - .42 * scan * uDecorations), tint * band * .28 * uDecorations);
        return aura(paint(c, src.a * (.94 - .47 * flicker)), p, tint * .78, 11.0, .87);
    `,
    shadow: `
        vec4 src = portrait(p);
        vec3 purple = vec3(.39, .14, .73);
        float pulse = .63 + .32 * wave(5.0);
        vec4 base = paint(purple, glow(p, 20.0) * pulse * 1.28 * uGlow);
        if (VARIANT == 1 && uDecorations > .0) {
            vec2 v = p / uSize;
            float mask = ellipse(v, vec2(.5,.46), vec2(.75,.73));
            vec2 flow = p / vec2(26,56) + vec2(0,uTime * .85);
            float smoke = smoothstep(.28, .72, cloud(flow));
            base = over(paint(purple * .68, mask * smoke * .95 * uGlow), base);
            float darkCore = smoothstep(.52,.84,cloud(flow + .3));
            base = over(paint(purple * .15, mask * darkCore * .8), base);
        }
        return over(paint(vec3(.012,.003,.025), src.a), base);
    `,
    ghost: `
        float lift = wave(7.0);
        p.y += 9.0 * lift;
        vec4 src = portrait(p);
        vec3 frost = vec3(.65,.85,1);
        vec3 c = mix(saturation(rgb(src), .39), duotone(rgb(src), vec3(.06,.16,.20), frost * 1.26), .54);
        vec4 back = paint(frost, glow(p, 15.0) * .46 * uGlow);
        if (uDecorations > .0) {
            if (VARIANT == 1) {
                back = over(paint(frost, glow(p + vec2(0,10), 8.0) * .33 * uGlow), back);
                back = over(paint(frost, glow(p + vec2(0,31), 21.0) * .28 * uGlow), back);
            } else {
                float phase = fract(uTime / 4.5);
                vec2 center = uSize * vec2(.5, .78);
                vec2 echo = center + (p - center + vec2(0,14.0 * phase)) / (1.0 + .08 * phase);
                back = over(paint(frost, glow(echo, 8.0) * sin(phase * 3.14159) * .42), back);
            }
        }
        return over(paint(c, src.a * (.5 + .28 * lift)), back);
    `,
    glitch: `
        float phase = fract(uTime / 3.4);
        float tick = floor(uTime * 26.0);
        float burst = step(.84, phase) * (1.0 - step(.93, phase)) * uDecorations;
        float rows = hash(vec2(floor(p.y / (uSize.y * .14)), tick));
        float slip = burst * (rows - .5) * 28.0;
        vec2 q = p + vec2(slip, .0);
        vec4 src = portrait(q);
        vec2 shift = vec2(1.5 + burst * 4.5, 0);
        vec4 cyan = paint(vec3(0,.88,1), portrait(q + shift).a * (.35 + burst * .45));
        vec4 red = paint(vec3(1,0,.24), portrait(q - shift).a * (.35 + burst * .45));
        vec3 c = mix(rgb(src), rgb(src).bgr, burst * step(.63, rows) * .48);
        return over(paint(c, src.a), over(cyan, red));
    `,
    fire: `
        vec4 src = portrait(p);
        vec3 c = rgb(src);
        vec3 orange = vec3(1,.35,.035);
        float pulse = wave(2.3);
        float rim = glow(p, 4.0), heat = glow(p, 19.0);
        vec4 back = paint(orange, (rim * .5 + heat * .61) * uGlow * (.74 + pulse * .26));
        if (VARIANT == 0) {
            c = saturation(sepia(c,.45),1.53) * vec3(1.13,1.05,.95) * (1.0 + .12 * pulse);
            if (uDecorations > 0.0) {
                float flame = cloud(p / vec2(19,40) + vec2(0, uTime * 2.0));
                float tongues = smoothstep(.46,.76,flame) * clamp(heat - src.a * .78, 0.,1.);
                back = over(paint(vec3(1,.46,.07), tongues * 1.1 * uGlow), back);
                c = screenColor(c, orange * smoothstep(.56, .8, flame) * .29);
            }
        } else {
            bool charred = VARIANT == 2;
            c = charred ? contrast(sepia(c,.4) * .36,1.23)
                        : contrast(saturation(sepia(c,.62),1.42) * .74,1.28);
            if (uDecorations > 0.0) {
                float veins = 1.0 - smoothstep(.009, charred ? .021 : .054, abs(cloud(p / 37.0) - .47));
                float gaps = smoothstep(charred ? .67 : .35, .81, noise(p / 17.0 + 2.0));
                c = screenColor(c, orange * veins * gaps * (.48 + .47 * wave(3.7)));
                if (charred) {
                    float smoke = cloud(p / vec2(24,49) + vec2(.5,uTime * .72));
                    float mask = ellipse(p / uSize, vec2(.5,.45), vec2(.71,.64));
                    back = paint(vec3(.31,.29,.30),mask * smoothstep(.4,.79,smoke) * .62 * uGlow);
                }
            }
            if (charred) back *= .57;
        }
        return over(paint(c,src.a),back);
    `,
    ice: `
        vec4 src = portrait(p);
        vec3 frost = vec3(.59,.85,1);
        vec3 c = duotone(contrast(rgb(src),1.07), vec3(.014,.09,.16), vec3(.64,1.14,1.40));
        float edge = glow(p, 2.3);
        if (VARIANT == 0) {
            c = mix(rgb(src), c, .57);
        } else if (VARIANT == 1) {
            frost = vec3(.72,.89,1);
            float l = lightness(rgb(src));
            c = mix(saturation(rgb(src), .20), vec3(.06,.17,.29) + l * vec3(.72,.86,.94), .82);
            if (src.a > 0.0 && uDecorations > 0.0) {
                float rim = clamp((src.a - glow(p, 7.0)) * 2.0, 0.0, 1.0);
                vec2 grain = rotate(p,.45);
                float rime = cloud(grain / vec2(26,43));
                float frostCover = smoothstep(.43,.78,rime + .29 * rim);
                float needles = noise(grain / vec2(1.4,4.3));
                float iceDust = smoothstep(.51,.90,needles) * frostCover;
                c = mix(c, frost, frostCover * .40 + rim * .26);
                c = screenColor(c, vec3(.80,.94,1) * iceDust * .39);
            }
        } else if (src.a > 0.0) {
            if (uDecorations > 0.0) {
                float scale = max(18.0, min(uImage.z,uImage.w) * .23);
                vec2 tile = rotate((p - uImage.xy) / scale,-.40) / vec2(1.0,1.60);
                vec2 cell = floor(tile), local = fract(tile);
                float nearest = 10.0, second = 10.0;
                vec2 facet = vec2(0), other = vec2(0), id = cell;
                // Jittered sites give each facet a different size and angle.
                for (int y = -1; y <= 1; y++) {
                    for (int x = -1; x <= 1; x++) {
                        vec2 offset = vec2(float(x),float(y));
                        vec2 key = cell + offset;
                        vec2 site = offset + .19 + .62 * vec2(hash(key),hash(key + 19.7));
                        vec2 delta = site - local;
                        float distanceToSite = dot(delta,delta);
                        if (distanceToSite < nearest) {
                            second = nearest; other = facet;
                            nearest = distanceToSite; facet = delta; id = key;
                        } else if (distanceToSite < second) {
                            second = distanceToSite; other = delta;
                        }
                    }
                }
                float boundary = (second - nearest) / max(.01, 2.0 * length(other - facet));
                float face = hash(id + 6.3), angle = TAU * hash(id - 7.2);
                vec2 slant = vec2(cos(angle),sin(angle));
                vec2 refractedUV = imageUV(p + slant * scale * (.04 + .12 * face));
                vec4 refracted = textureLod(uTexture,refractedUV,0.0);
                if (any(lessThan(refractedUV,vec2(0))) || any(greaterThan(refractedUV,vec2(1)))) refracted = src;
                vec3 figure = mix(rgb(src),rgb(refracted),.44 * refracted.a);
                float l = lightness(figure);
                vec3 tint = mix(vec3(.15,.74,.92),vec3(.52,.49,.94),face);
                float plane = .67 + .58 * face - .46 * dot(facet,slant);
                c = (vec3(.035,.09,.22) + l * vec3(.77,1.0,1.09)) * plane;
                c += tint * (.10 + .14 * face);
                float bevel = 1.0 - smoothstep(.012,.080,boundary);
                float glint = pow(max(0.0,dot(slant,vec2(cos(uTime*.48),sin(uTime*.48)))),14.0);
                c = screenColor(c,tint * glint * (.10 + .24 * bevel));
                float lit = smoothstep(-.45,.62,dot(normalize(other - facet),vec2(-.77,-.64)));
                c *= 1.0 - bevel * (1.0 - lit) * .35;
                float line = 1.0 - smoothstep(.003,.023,boundary);
                c = screenColor(c,mix(tint,vec3(.90,.99,1),lit) * (bevel * .18 + line * (.16 + .49 * lit)));
            }
        }
        if (uDecorations > 0.0) {
            float glint = hash(floor(p / 9.0));
            float spark = step(.92, glint) * wave(2.7 + 3.1 * glint)
                        * (1.0 - smoothstep(.04,.19,length(fract(p / 9.0)-.5)));
            c = screenColor(c, frost * spark * (VARIANT == 1 ? .13 : .9));
        }
        float bloom = VARIANT == 2 ? .52 : .76;
        return over(paint(c,src.a), paint(frost, uGlow * (.35 * edge + bloom * glow(p,15.0))));
    `,
    gold: `
        vec4 src = portrait(p);
        vec4 halo = paint(vec3(1,.73,.28), glow(p,8.0) * .22 * uGlow);
        if (src.a <= 0.0) return halo;
        float l = clamp(lightness(rgb(src)),0.0,1.0);
        // Reserve near-white for reflections and keep even the deepest material shadows golden.
        vec3 c = mix(vec3(.26,.135,.023),vec3(.76,.455,.078),smoothstep(0.0,.46,l));
        c = mix(c,vec3(1,.78,.25),smoothstep(.23,.73,l));
        c = mix(c,vec3(1,.88,.49),smoothstep(.65,1.0,l));

        // Sample across the light direction to pick out silhouette and raised details.
        vec2 uv = imageUV(p);
        vec2 tap = .012 * vec2(1,.65 * uImage.z / uImage.w);
        float lod = log2(max(1.0,float(textureSize(uTexture,0).x) * .005));
        vec4 gradient = textureLod(uTexture,uv + tap,lod) - textureLod(uTexture,uv - tap,lod);
        float relief = lightness(gradient.rgb) + .25 * gradient.a;
        float edge = smoothstep(.035,.31,relief);
        float lit = smoothstep(.19,.74,l);
        c = mix(c,vec3(1,.91,.59),edge * (.11 + .19 * lit));

        float reflection = uv.x - .36 * (uv.y - .5) + .15 * (l - .5) + .30 * relief;
        float key = 1.0 - smoothstep(.014,.105,abs(reflection - .36));
        c = mix(c,vec3(1,.95,.72),key * (.10 + .46 * lit));

        float pos = mix(-.45,1.45,smoothstep(.08,.63,fract(uTime / 6.2)));
        float sweep = abs(reflection - pos);
        float shine = (1.0 - smoothstep(.008,.11,sweep)) * (.09 + .20 * lit)
                    + (1.0 - smoothstep(.003,.026,sweep)) * (.06 + .24 * lit + .26 * edge);
        c = mix(c,vec3(1,.98,.83),shine * uDecorations * uMotion);
        return over(paint(c,src.a),halo);
    `,
    stone: `
        vec4 src = portrait(p);
        float l = lightness(rgb(src));
        float grade = VARIANT == 2 ? (l - .5) * 1.12 + .5 : (l - .5) * 1.4 + .5;
        vec3 c = vec3(grade) * (VARIANT == 2 ? 1.14 : .82);
        if (VARIANT == 1) {
            float moss = smoothstep(.44,.69,cloud(p / 27.0)) * clamp(p.y / uSize.y + .17, 0.0, 1.0);
            c = mix(c,vec3(.22,.38,.12),moss * uDecorations);
        }
        if (VARIANT == 2) {
            float pos = mix(-.65,1.7,smoothstep(.0,.45,fract(uTime / 6.5)));
            float glint = 1.0 - smoothstep(.0,.13,abs((p.x - .25 * p.y) / uSize.x - pos));
            c = screenColor(c,vec3((.11 + glint * .61) * uDecorations));
        }
        return aura(paint(c,src.a),p-vec2(0,2),vec3(0),5.0,.66);
    `,
    cracked: `
        vec4 src = portrait(p);
        vec3 c = vec3((lightness(rgb(src)) - .5) * 1.4 + .5) * vec3(.86,.83,.79);
        if (src.a > 0.0 && uDecorations > .0) {
            c += (cloud(p / 8.0) - .5) * .36;
            vec4 cracks = texture(uCracks, p / uSize);
            c = c * (1.0 - cracks.a) + cracks.rgb;
        }
        return aura(paint(c,src.a),p-vec2(0,2),vec3(0),5.0,.66);
    `,
    xray: `
        vec4 src = portrait(p);
        // Match the original CSS negative, including the 165-degree rotation of the sepia tint.
        float exposure = .9 * clamp(1.1 - 1.2 * lightness(rgb(src)),0.0,1.0);
        vec3 tint = clamp(sepia(vec3(exposure),1.0),0.0,1.0);
        mat3 hue = mat3(-.6023,.4558,.2151, 1.2206,.4759,1.5907, .3817,.0683,-.8057);
        vec3 c = saturation(clamp(hue * tint,0.0,1.0),.9);
        vec4 back = paint(vec3(.67,.90,1),uGlow * (.44 * glow(p,4.0) + .75 * glow(p,12.0)));
        return over(paint(c,src.a),back) * (.90 + .10 * wave(5.0));
    `,
    memory: `
        vec4 src = portrait(p);
        vec3 c = contrast(sepia(rgb(src),.9),.9) * 1.10;
        return aura(paint(c,src.a),p,vec3(.96,.80,.48),20.0,(.55 + .22 * wave(6.0)) * uDecorations);
    `,
    dream: `
        vec4 src = portrait(p);
        vec3 c = mix(rgb(src),duotone(rgb(src),vec3(.08,.15,.25),vec3(.67,.97,1.15)),.54) * 1.12;
        return aura(paint(c,src.a),p,vec3(.52,.70,1),22.0,(.62 + .22 * wave(6.8)) * uDecorations);
    `,
    noir: `
        vec4 src = portrait(p);
        float c = ((lightness(rgb(src)) - .5) * 1.65 + .5) * .90;
        float grain = hash(floor(p) + floor(uTime * 12.0) * .37);
        float scratches = step(.994,hash(vec2(floor(p.x),floor(uTime * 4.0))));
        c += ((grain - .5) * .12 + .18 * scratches) * uDecorations;
        return aura(paint(vec3(c),src.a),p,vec3(0),6.0,.9);
    `,
    neon: `
        vec4 src = portrait(p);
        vec3 tint = VARIANT == 0 ? vec3(1,.31,.85) : VARIANT == 1 ? vec3(.243,.91,1) : vec3(.71,1,.23);
        vec3 glowTint = VARIANT == 2 ? vec3(1,.94,.23) : mix(tint,vec3(.24,.65,1),.44);
        vec2 r = vec2(1.8,0);
        float outline = max(max(portrait(p+r).a,portrait(p-r).a),max(portrait(p+r.yx).a,portrait(p-r.yx).a));
        vec2 d = vec2(1.25);
        outline = max(outline, max(max(portrait(p+d).a,portrait(p-d).a),
                                   max(portrait(p+d*vec2(1,-1)).a,portrait(p+d*vec2(-1,1)).a)));
        // An opaque texel at the crop boundary continues off-frame. Suppress its artificial outline.
        vec2 uv = imageUV(p);
        vec2 inset = min(uv,1.0-uv) * uImage.zw;
        float atCrop = 1.0 - smoothstep(0.0,2.5,min(inset.x,inset.y));
        float cropped = atCrop * textureLod(uTexture,clamp(uv,0.0,1.0),0.0).a;
        vec4 rim = paint(tint,outline * (1.0 - cropped));
        vec4 halo = paint(glowTint,glow(p,7.0)*.75*uGlow * (1.0 - cropped));
        return over(paint(contrast(rgb(src)*.14,1.2),src.a),over(rim,halo));
    `,
    invisible: `
        vec4 src = portrait(p);
        vec4 base = aura(paint(contrast(rgb(src)*.7,.85),src.a),p,vec3(.70,.88,1),7.0,.85);
        return base * (.14 + .15 * wave(3.2));
    `,
    rage: `
        float phase = fract(uTime / 4.6);
        float shaking = (step(.17,phase)-step(.24,phase)) + (step(.62,phase)-step(.72,phase));
        shaking *= uDecorations * step(.5,uGlow);
        p += shaking * vec2(sin(uTime*113.0)*4.0,cos(uTime*197.0)*2.0);
        vec4 src = portrait(p);
        float pulse = wave(2.2);
        vec3 c = saturation(rgb(src),1.75+.65*pulse) * vec3(1.20,1.04,.99);
        return aura(paint(c,src.a),p,vec3(1,.12,.045),13.0,.64+.25*pulse);
    `,
    possessed: `
        vec4 src = portrait(p);
        vec3 c = contrast(saturation(rgb(src),.6),1.25) * .61;
        vec4 back = paint(vec3(.24,.001,.02),glow(p,15.0)*uGlow*(.72+.26*wave(5.0)));
        if (uDecorations > 0.0) {
            float smoke = cloud(p/vec2(31,47) + vec2(.2,uTime*.55));
            float mask = ellipse(p/uSize,vec2(.5,.49),vec2(.67,.71));
            back = over(paint(vec3(.47,.013,.041),smoothstep(.30,.71,smoke)*mask*.92*uGlow),back);
        }
        return over(paint(c,src.a),back);
    `,
    drunk: `
        float sway = (2.0 * wave(VARIANT == 2 ? 3.4 : 4.2) - 1.0) * uMotion;
        vec2 anchor = uSize * vec2(.5,1.0);
        float amplitude = VARIANT == 0 ? 1.0 : VARIANT == 1 ? .44 : 1.95;
        p = rotate(p-anchor,-.028*sway*amplitude) + anchor - vec2(4.0*sway*amplitude,0);
        vec4 src = portrait(p);
        vec3 c = saturation(sepia(rgb(src),.15),1.15);
        if (uDecorations == 0.0 || uMotion == 0.0) return paint(c,src.a);
        vec4 echo = portrait(p - vec2(sway * 6.0 * amplitude,uMotion * (VARIANT == 2 ? -sway*2.0 : 0.0)));
        float amount = (VARIANT == 2 ? .51 : .30 * min(1.0,amplitude)) + .08*sway;
        return over(paint(saturation(sepia(rgb(echo),.18),1.17),echo.a * amount),paint(c,src.a));
    `,
    holy: `
        vec4 src = portrait(p);
        if (uDecorations == 0.0 || src.a >= 1.0) return src;
        bool radiant = VARIANT == 1;
        vec3 amber = vec3(1,.66,.25);
        vec3 warm = vec3(1,.85,.55);
        vec3 white = vec3(1,.98,.89);
        vec2 head = p - vec2(uSize.x*.5,uImage.y + uImage.w*.11);
        float angle = atan(head.y,head.x);
        float radius = min(uImage.z,uImage.w*.72) * .185;
        float distanceToRing = length(head) - radius;
        float width = max(1.55,radius*.066);
        float edge = distanceToRing / width;
        float streak = .5 + .5 * cos(2.0*angle + .38);
        float pulse = (.88 + .12 * wave(5.0)) * uGlow;
        float core = exp(-1.9 * edge * edge);
        float shoulder = exp(-.27 * edge * edge);
        float spill = exp(-.033 * edge * edge);

        vec2 uv = p/uSize;
        float shaftWidth = abs(head.x) / (radius * 3.2);
        float shaft = exp(-6.0 * shaftWidth * shaftWidth)
                    * smoothstep(-.63,-.38,uv.y) * (1.0-smoothstep(-.04,.27,head.y/uImage.w));
        vec4 back = paint(white,shaft * (.48 + .13 * wave(9.0)) * uGlow);
        float rays = pow(.5 + .5*cos(9.0*(angle - TAU*uTime/80.0)),3.0);
        float headLight = ellipse(head,vec2(0),vec2(radius*2.55,radius*2.95));
        back = over(paint(warm,headLight * (.26 + .34*rays) * pulse),back);
        back = over(paint(warm,glow(p,radiant ? 20.0 : 12.0) * (radiant ? .67 : .41) * uGlow),back);
        if (radiant) {
            vec2 chest = p - vec2(uSize.x*.5,uImage.y + uImage.w*.40);
            float burst = pow(.5+.5*cos(15.0*(atan(chest.y,chest.x)+TAU*uTime/120.0)),4.0);
            float bloom = ellipse(chest / uSize,vec2(0),vec2(1.05,.59));
            back = over(paint(warm,bloom*(.40+.61*burst)*uGlow),back);
        }
        // A hot core and two falloffs give the ring a lit cross-section.
        back = over(paint(amber,spill * (.26 + .13*streak) * pulse),back);
        back = over(paint(warm,shoulder * (.45 + .24*streak) * pulse),back);
        back = over(paint(white,core * (.83 + .17*streak) * pulse),back);
        return over(src,back);
    `,
    marionette: `
        if (uDecorations == 0.0) return portrait(p);
        float speaking = step(.5, uGlow);
        float taut = mix(1.0 - smoothstep(0.0, .24, uCue), smoothstep(0.0, .15, uCue), speaking);
        if (uMotion == 0.0) taut = speaking;
        float pull = smoothstep(0.0, .19, uCue) * (1.0 - .68 * smoothstep(.19, .70, uCue));
        float swayTime = max(0.0, uCue - .18);
        float sway = sin(swayTime * 9.8) * exp(-swayTime * 2.8)
                   * smoothstep(0.0, .13, swayTime) * (1.0 - smoothstep(1.42, 1.62, swayTime));
        float angle = .019 * sway * speaking * uMotion;
        vec2 pivot = uImage.xy + uImage.zw * uThreadCenter;
        float lift = clamp(uImage.w * .022, 3.0, 9.0) * mix(.32 * taut, pull, speaking);
        vec2 shift = vec2(sway * 2.5 * speaking, -lift) * uMotion;
        vec4 src = portrait(pivot + rotate(p - pivot - shift, -angle));
        if (src.a >= .999) return src;

        float threads = 0.0, shadows = 0.0;
        vec2 anchors[3] = vec2[3](uThreadLeft, uThreadCenter, uThreadRight);
        for (int i = 0; i < 3; i++) {
            vec2 point = uImage.xy + uImage.zw * anchors[i] + vec2(0, 2.0);
            vec2 end = pivot + rotate(point - pivot, angle) + shift;
            float side = float(i) - 1.0;
            float topX = point.x + side * min(22.0, uImage.z * .10);
            float t = clamp((p.y + uPadding.y) / max(1.0, end.y + uPadding.y), 0.0, 1.0);
            float slack = (1.0 - taut) * (i == 1 ? -5.0 : side * 9.0);
            float threadX = mix(topX, end.x, t) + 4.0 * t * (1.0 - t) * slack;
            float distance = abs(p.x - threadX);
            float span = 1.0 - smoothstep(end.y - .35, end.y + 1.2, p.y);
            threads = max(threads, (1.0 - smoothstep(.18, .9, distance)) * span);
            shadows = max(shadows, (1.0 - smoothstep(.5, 1.6, distance)) * span);
        }
        vec4 silk = over(paint(vec3(.89, .81, .68), threads * mix(.69, .93, taut)),
                         paint(vec3(.17, .11, .085), shadows * .70));
        return over(src, silk);
    `,
    living_engraving: `
        vec4 src = portrait(p);
        vec2 uv = imageUV(p);
        float bleed = noise(p * .36);
        float tip = uv.y * .76 + uv.x * .24 + (bleed - .5) * .025;
        float sweep = mix(-.08, 1.13, uCue);
        float reveal = 1.0 - smoothstep(sweep - .025, sweep + .018, tip);

        // The leading stroke follows the actual alpha edge of the figure.
        vec2 d = vec2(mix(.82, 1.6, bleed), 0);
        vec4 left = portrait(p - d), right = portrait(p + d);
        vec4 up = portrait(p - d.yx), down = portrait(p + d.yx);
        float innerAlpha = min(min(left.a, right.a), min(up.a, down.a));
        float outerAlpha = max(max(left.a, right.a), max(up.a, down.a));
        float contour = smoothstep(.08, .88, outerAlpha - innerAlpha);
        float body = 1.0 - smoothstep(sweep - .105, sweep - .025, tip);
        vec3 ink = vec3(.135, .100, .085);
        vec3 inkEdge = mix(ink, vec3(.78, .65, .49), .72 * (1.0 - src.a));
        vec4 outline = paint(inkEdge, contour * reveal * .94);
        if (src.a <= .001) return outline;

        float tone = smoothstep(.045, .88, lightness(rgb(src)));
        float tooth = noise(p * vec2(.30, 1.55)) * .58 + hash(floor(p * 1.6)) * .42;
        vec3 paper = vec3(.956, .907, .797) + (tooth - .5) * mix(.06, .16, tone);
        float warp = (noise(p * .09) - .5) * .95 + (bleed - .5) * .56;
        float diagonals = abs(fract((p.x * .59 + p.y * .81 + warp) / 4.2) - .5);
        float crossings = abs(fract((p.x * -.78 + p.y * .63 + warp) / 5.4) - .5);
        float shadow = 1.0 - tone;
        float hatch = (1.0 - smoothstep(.04 + shadow * .21, .12 + shadow * .21, diagonals))
                    * smoothstep(.10, .51, shadow);
        float crosshatch = (1.0 - smoothstep(.045 + shadow * .12, .13 + shadow * .12, crossings))
                         * smoothstep(.49, .91, shadow);
        float linework = smoothstep(.08, .29, max(abs(lightness(rgb(left)) - lightness(rgb(right))),
                                                  abs(lightness(rgb(up)) - lightness(rgb(down)))))
                       * innerAlpha;
        vec3 printed = mix(paper, ink, shadow * .23);
        printed = mix(printed, ink, max(max(hatch * .79, crosshatch * .74), linework * .56));
        return over(outline, paint(printed, src.a * body));
    `,
    vhs: `
        vec4 src = portrait(p);
        vec3 c = rgb(src);
        if (uLite < .5) {
            float phase = fract(uTime / 5.0);
            float tear = (step(.4,phase)-step(.452,phase)) + .72*(step(.8,phase)-step(.854,phase));
            float row = hash(vec2(floor((p.y - uTime*45.0) / 3.0),7.0));
            float slip = (step(.91,row) - (1.0-step(.085,row))) * (1.2+tear*12.0);
            vec2 q = p + vec2(slip,0);
            vec4 red = portrait(q-vec2(2.5,0)), mid = portrait(q), blue = portrait(q+vec2(2.5,0));
            src.a = max(red.a,max(mid.a,blue.a));
            c = vec3(red.r,mid.g,blue.b)/max(src.a,.0001);
        }
        float streak = 1.0-smoothstep(.0,.077,abs(p.y/uSize.y-mix(-.2,1.2,fract(uTime/2.6))));
        float scan = 1.0-smoothstep(.15,.34,fract(p.y/3.0));
        c = contrast(saturation(c,1.25),1.1)*1.04;
        c = screenColor(c*(1.0-.28*scan*uDecorations),vec3(streak*.2*uDecorations));
        return paint(c,src.a);
    `,
};

export function portraitFragment(effect) {
    const cracks = effect === 'cracked' ? 'uniform sampler2D uCracks;' : '';
    const cue = effect === 'living_engraving' || effect === 'marionette' ? 'uniform float uCue;' : '';
    const threads = effect === 'marionette' ? `
        uniform vec2 uPadding;
        uniform vec2 uThreadLeft, uThreadCenter, uThreadRight;` : '';
    return `${common}\n${cracks}\n${cue}\n${threads}\n#define VARIANT int(uVariant)
        vec4 drawEffect(vec2 p) { ${effects[effect]} }
        void main() { color = drawEffect(vPoint) * uOpacity; }
    `;
}

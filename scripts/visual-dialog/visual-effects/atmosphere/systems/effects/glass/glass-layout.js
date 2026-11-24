import { seededRandom } from '../../../../../../utils/seeded-random.js';

const tau = Math.PI * 2;
const point = (origin, angle, radius) => ({
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius
});
const between = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function makeGlassLayout(width, height) {
    const random = seededRandom('scene-glass');
    const range = (low, high) => low + random() * (high - low);
    const extension = seededRandom('scene-glass-extension');
    const span = Math.min(width, height);
    const impact = { x: width * 0.36, y: height * 0.39 };
    const cracks = [], faces = [];
    const angles = [-3.04, -2.65, -2.02, -1.75, -1.15, -0.39, -0.14, 0.38, 0.91, 1.43, 1.86, 2.58];
    const spokes = angles.map((baseAngle, index) => {
        const angle = baseAngle + range(-0.085, 0.085);
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const edge = Math.min(
            ((dx > 0 ? width : 0) - impact.x) / dx,
            ((dy > 0 ? height : 0) - impact.y) / dy
        );
        const reach = edge * ([1, 4, 6, 9].includes(index) ? range(1.03, 1.14) : range(0.51, 0.90));
        const radii = [range(0.008, 0.024), range(0.050, 0.095), range(0.113, 0.184), range(0.220, 0.305)];
        const nodes = radii.map(radius => point(impact, angle + range(-0.08, 0.08), span * radius));
        const path = [impact, ...nodes];
        const growth = [0, ...radii];
        const start = radii.at(-1) * span;
        const end = Math.max(start + span * 0.075, reach);
        const count = Math.min(28, Math.ceil((end - start) / (span * 0.105)));
        const kink = span * range(-0.055, 0.055);
        const shoulder = span * range(-0.048, 0.048);
        for (let step = 1; step <= count; step++) {
            const progress = step / count;
            const radius = start + (end - start) * progress;
            const bend = kink * progress + shoulder * Math.sin(progress * Math.PI);
            const node = point(impact, angle + (bend + span * range(-0.026, 0.026)) / radius, radius);
            const stage = radii.at(-1) + (1 - radii.at(-1)) * progress;
            if (step < count && (step === 1 || random() < 0.42)) {
                const direction = angle + (random() < 0.5 ? -1 : 1) * range(0.26, 0.65);
                const length = span * range(0.038, 0.123);
                const elbow = point(node, direction, length * 0.53);
                cracks.push({ points: [node, elbow, point(elbow, direction + range(-0.32, 0.32), length * 0.47)],
                    growth: [stage, stage + length / span * 0.53, stage + length / span],
                    width: range(0.7, 1.1), light: range(0.65, 0.91), tip: 0 });
            }
            path.push(node);
            growth.push(stage);
        }
        let endPoint = path.at(-1);
        const previous = path.at(-2);
        let direction = Math.atan2(endPoint.y - previous.y, endPoint.x - previous.x);
        for (let step = 1; step <= 4; step++) {
            direction += (extension() - 0.5) * 0.55;
            endPoint = point(endPoint, direction, span * (0.065 + extension() * 0.045));
            const stage = 1 + step * 0.14;
            path.push(endPoint);
            growth.push(stage);
            if (step % 2 === index % 2) {
                const turn = direction + (extension() < 0.5 ? -1 : 1) * (0.35 + extension() * 0.45);
                const elbow = point(endPoint, turn, span * 0.045);
                cracks.push({
                    points: [endPoint, elbow, point(elbow, turn + 0.23, span * 0.049)],
                    growth: [stage, stage + 0.085, stage + 0.16],
                    width: 0.87, light: 0.74, tip: 0
                });
            }
        }
        cracks.push({ points: path, growth, width: range(1.1, 2.2), light: range(0.80, 1.23), tip: 0 });
        return nodes;
    });

    for (let index = 0; index < spokes.length; index++) {
        const left = spokes[index], right = spokes[(index + 1) % spokes.length];
        let previous;
        for (let ring = 0; ring < left.length; ring++) {
            const a = left[ring], b = right[ring];
            const bend = between(a, b, range(0.32, 0.72));
            const elbow = between(bend, impact, range(-0.19, 0.20));
            if (ring === 3 && [0, 2, 4, 7, 8, 11].includes(index)) {
                const tip = between(elbow, b, range(0.16, 0.67));
                cracks.push({ points: [a, elbow, tip], width: range(0.6, 1.1), light: 0.72, tip: 0 });
                continue;
            }
            const edge = [a, elbow, b];
            cracks.push({ points: edge, width: range(0.72, 1.44), light: range(0.74, 1.25), tip: 1 });
            const polygon = previous ? [...edge, ...previous.toReversed()] : [impact, ...edge];
            faces.push({ points: polygon, light: range(0.40, 1), cool: random() < 0.79, inner: ring === 0 });
            if (ring === 1 || (ring === 2 && index % 3 === 0)) {
                const start = between(a, elbow, range(0.35, 0.86));
                const end = between(previous[1], between(a, right[ring - 1], 0.65), range(0.35, 0.78));
                const knee = between(between(start, end, 0.51), b, range(0.07, 0.31));
                cracks.push({ points: [start, knee, end], width: range(0.52, 0.83), light: 0.98, tip: 0 });
            }
            previous = edge;
        }
    }

    const chips = Array.from({ length: 42 }, (_, index) => {
        const large = index < 9;
        const angle = range(0, tau);
        const origin = point(impact, angle, span * range(0.005, 0.025));
        const radius = span * (large ? range(0.010, 0.026) : range(0.0018, 0.006));
        const shape = [point(origin, angle, radius), point(origin, angle + 2.55, radius * range(0.45, 0.88)),
            point(origin, angle - 1.93, radius * range(0.3, 0.82))];
        const end = point(origin, angle, span * range(0.09, 0.35));
        return { origin, shape, velocity: [end.x - origin.x, end.y - origin.y],
            spin: range(-6, 6), life: range(large ? 0.87 : 0.40, 1.30),
            light: range(large ? 0.66 : 0.34, 0.95), cool: index % 6 !== 0 };
    });
    return { impact, span, cracks, faces, chips };
}

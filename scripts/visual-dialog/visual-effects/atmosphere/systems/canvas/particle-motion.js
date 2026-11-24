const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function flutter({ distance, cycles, span, brake, tilt, edge }, u, p, view, out) {
    const rate = TAU * cycles * (0.75 + p.ph2 * 0.5);
    const start = TAU * p.ph;
    const angle = start + rate * u;
    const swing = Math.sin(angle);
    const face = Math.cos(angle);
    out.x = span * (swing - Math.sin(start));
    // Integrate the vertical speed so each turn naturally slows face-on and falls faster edge-on.
    out.y = distance * view.vh * (u - brake * (Math.sin(2 * angle) - Math.sin(2 * start)) / (2 * rate));
    out.rotation = tilt * DEG * swing;
    out.width = edge + (1 - edge) * face * face;
}

function updraft({ height, range, lift, current }, u, p, view, out) {
    const rate = 1.6;
    const now = rate * view.t + p.left * 0.12;
    const start = now - rate * u * (view.override || p.duration);
    // Nearby embers ride the same moving column of air, with displacement measured from birth.
    out.x = current * (Math.cos(start) - Math.cos(now));
    const rise = (height + range * p.ph2) * (u + lift * u * (1 - u));
    out.y = -view.vh * rise + current * 0.35 * (Math.sin(start) - Math.sin(now));
}

function firefly(_, u, p, _view, out) {
    const itinerary = u * (3 + p.ph2 * 1.5) + p.ph2;
    const leg = Math.floor(itinerary);
    const progress = itinerary - leg;
    const t = Math.min(1, progress / 0.75);
    const travel = t * t * (3 - 2 * t);
    const arch = 4 * travel * (1 - travel);
    // The next leg starts at the previous destination. Both ends ease into a hover.
    const angle = TAU * p.ph + leg * 2.4;
    const x0 = Math.cos(angle), x1 = Math.cos(angle + 2.4);
    const y0 = Math.sin(angle * 1.17), y1 = Math.sin((angle + 2.4) * 1.17);
    out.x = (38 + Math.abs(p.drift) * 0.64) * (x0 + (x1 - x0) * travel - (y1 - y0) * arch * 0.26);
    out.y = (24 + Math.abs(p.driftY) * 0.64) * (y0 + (y1 - y0) * travel + (x1 - x0) * arch * 0.26);
    const flash = Math.max(0, 1 - Math.abs(progress - 0.84) / 0.15);
    out.opacity = 0.37 + 0.63 * flash * flash;
}

function bubble({ wobble }, u, p, _view, out) {
    const size = Math.min(1, p.w / 14);
    const angle = TAU * ((3 + 2 * p.ph2) * u + p.ph);
    out.x = wobble * size * size * Math.min(1, u * 5) * Math.sin(angle);
}

function balloon({ span, cycles, tilt }, u, p, _view, out) {
    const start = TAU * p.ph;
    const angle = start + TAU * cycles * (0.85 + 0.3 * p.ph2) * u;
    out.x = span * (Math.sin(angle) - Math.sin(start));
    out.rotation = tilt * DEG * Math.cos(angle);
}

function sandGust({ shift, lift }, u, p, view, out) {
    // Two fronts accelerate and cross at different heights. Their crests drift in and out of alignment.
    const t = view.t;
    const phase = TAU * (t / 3.71 - u * 0.62 + p.top * 0.013) + 1.25 * Math.sin(t * 0.51 + p.top * 0.019);
    const crossing = TAU * (t / 5.89 - u * 0.73 - p.top * 0.011) + 0.9 * Math.sin(t * 0.67 - p.top * 0.024);
    const wave = 0.68 * Math.cos(phase) + 0.32 * Math.cos(crossing);
    const crest = (0.5 + 0.5 * wave) ** 4;
    const envelope = Math.sin(Math.PI * u);
    out.x = shift * view.vw * envelope * (0.68 * Math.sin(phase) + 0.32 * Math.sin(crossing));

    // Grains near the top and bottom stay visible even as the wave lifts or drops them.
    const liftPx = lift * view.vh;
    const margin = Math.min(p.top, 100 - p.top) * view.H / 100;
    const edge = Math.min(1, margin / (Math.abs(p.driftY) + liftPx));
    out.y = edge * (u * p.driftY + liftPx * envelope * wave);
    out.width = 1 + 0.8 * crest;
    out.opacity = 0.73 + 0.65 * crest;
}

function ash(_, u, p, view, out) {
    const turn = TAU * (p.ph + u * (0.8 + p.ph2 * 2.2));
    const swing = Math.sin(turn);
    const direction = p.ph < 0.5 ? -1 : 1;
    out.x = (13 + 20 * p.ph2) * (swing - Math.sin(TAU * p.ph));
    out.y = view.vh * (110 * u + 2.1 * Math.sin(Math.PI * u) * Math.cos(turn));
    out.rotation = TAU * p.ph + DEG * (direction * (80 + 440 * p.ph2) * u + (27 + 45 * p.ph2) * swing);
    out.width = 0.62 + 0.38 * Math.cos(turn + p.ph2) ** 2;
}

export const PARTICLE_MOTIONS = { flutter, updraft, firefly, bubble, balloon, sandGust, ash };

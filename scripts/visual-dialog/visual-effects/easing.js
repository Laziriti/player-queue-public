// CSS cubic-bezier time curve. Invert x before evaluating y.
export function cubicBezier([x1, y1, x2, y2], x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
        const u = 1 - t;
        const cx = 3 * x1 * u * u * t + 3 * x2 * u * t * t + t * t * t - x;
        const dx = 3 * x1 * u * u + 6 * (x2 - x1) * u * t + 3 * (1 - x2) * t * t;
        if (Math.abs(cx) < 1e-5 || !dx) break;
        t -= cx / dx;
    }
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const u = 1 - t;
    return 3 * y1 * u * u * t + 3 * y2 * u * t * t + t * t * t;
}

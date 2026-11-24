export function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

export function lerp(start, end, progress) {
    return start + (end - start) * progress;
}

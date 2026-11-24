// Retarget from the value currently on screen, including during a reversal.
export class EffectProgress {
    constructor(percent) {
        this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        this.from = this.target = percent / 100;
        this.started = this.duration = 0;
    }

    at(now) {
        if (this.reducedMotion.matches || !this.duration) return this.target;
        const t = Math.min(1, Math.max(0, (now - this.started) / this.duration));
        return this.from + (this.target - this.from) * t * t * (3 - 2 * t);
    }

    set(percent) {
        const target = percent / 100;
        if (target === this.target) return;
        const now = performance.now();
        this.from = this.at(now);
        this.target = target;
        this.started = now;
        this.duration = this.reducedMotion.matches ? 0 : 350 + 2450 * Math.abs(target - this.from);
        return this.duration;
    }
}

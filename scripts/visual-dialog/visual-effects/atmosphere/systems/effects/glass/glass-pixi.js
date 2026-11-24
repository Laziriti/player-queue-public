import { VISUAL_EFFECT_SETTINGS } from '../../../config/visual-effect-settings.js';
import { PixiBackgroundEffect } from '../background/pixi-background-effect.js';

const settledTime = 1.35;

export class PixiGlassEffect {
    start(overlay, variant, _type, settings) {
        this.lifetime = new AbortController();
        this.floating = variant === 'shards';
        this.setSettings(settings);
        this.motion = matchMedia('(prefers-reduced-motion: reduce)');
        this.motion.addEventListener('change', () => this.#requestFrame(), { signal: this.lifetime.signal });
        void this.#mount(overlay, this.lifetime.signal);
    }

    setSettings({ glassCrackSize = VISUAL_EFFECT_SETTINGS.glassCrackSize.initial } = {}) {
        if (this.floating || glassCrackSize === this.size) return;
        this.size = glassCrackSize;
        this.#requestFrame();
    }

    async #mount(overlay, signal) {
        let surface;
        try {
            if (this.floating) {
                const { GlassShardsSurface } = await import('./glass-shards-pixi.js');
                surface = new GlassShardsSurface();
            } else {
                const { GlassCrackSurface } = await import('./glass-pixi-mesh.js');
                surface = new GlassCrackSurface();
            }
            if (signal.aborted || !await surface.mount(overlay, 'vn-glass-pixi', signal, () => {
                if (!signal.aborted) console.error('VN: Pixi glass WebGL context lost');
                this.stop();
            }, 4096)) return;
            this.surface = surface;
            this.started = performance.now();
            this.#draw(this.started);
        } catch (error) {
            if (!signal.aborted) console.error('VN: Pixi glass failed to start', error);
        } finally {
            if (surface && surface !== this.surface) surface.destroy();
        }
    }

    #requestFrame() {
        if (this.surface && this.frame == null) this.frame = requestAnimationFrame(this.#draw);
    }

    #draw = now => {
        this.frame = null;
        try {
            const reduced = this.motion.matches;
            const elapsed = Math.max(0, (now - this.started) / 1000);
            this.surface.setAppearance(this.size, reduced);
            this.surface.draw(reduced ? settledTime : this.floating ? elapsed : Math.min(elapsed, settledTime));
            if (!reduced && (this.floating || elapsed < settledTime)) this.#requestFrame();
        } catch (error) {
            console.error('VN: Pixi glass failed to draw', error);
            this.stop();
        }
    };

    stop() {
        this.lifetime?.abort();
        if (this.frame != null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.surface?.destroy();
        this.surface = null;
    }
}

export class PixiGlassBackgroundEffect extends PixiBackgroundEffect {
    constructor() {
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        super({
            load: async () => (await import('./glass-shards-pixi.js')).GlassBackgroundMesh,
            canvasClass: 'vn-glass-bg-pixi',
            animate: (mesh, now) => mesh.render(now, motion.matches, this.shardSize),
            continuous: !motion.matches
        });
        motion.addEventListener('change', () => {
            this.continuous = !motion.matches;
            this.drawFor(50);
        }, { signal: this.signal });
    }

    start(overlay, _variant, _type, settings) {
        this.setSettings(settings);
        super.start(overlay);
    }

    setSettings({ glassShardSize = VISUAL_EFFECT_SETTINGS.glassShardSize.initial } = {}) {
        if (this.shardSize === glassShardSize) return;
        this.shardSize = glassShardSize;
        this.drawFor(50);
    }
}

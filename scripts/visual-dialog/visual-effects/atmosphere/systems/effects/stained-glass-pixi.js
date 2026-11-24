import { PixiBackgroundEffect } from './background/pixi-background-effect.js';

export class PixiStainedGlassEffect {
    start(overlay) {
        const started = performance.now();
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.effect = new PixiBackgroundEffect({
            load: async () => (await import('./stained-glass-pixi-mesh.js')).StainedGlassPixiMesh,
            canvasClass: 'vn-stained-glass-pixi',
            animate: (mesh, now) => mesh.render(reducedMotion ? 0 : Math.max(0, now - started) / 1000),
            continuous: !reducedMotion
        });
        this.effect.start(overlay);
    }

    stop() { this.effect?.stop(); }
}

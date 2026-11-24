import { PixiBackgroundEffect } from './background/pixi-background-effect.js';

export class PixiVhsEffect {
    start(overlay, variant) {
        let glitch = overlay.classList.contains('vn-glitch-active');
        this.effect = new PixiBackgroundEffect({
            load: async () => (await import('./vhs-pixi-mesh.js')).VhsPixiMesh,
            canvasClass: 'vn-vhs-pixi',
            prepare: () => variant,
            animate: (mesh, now) => mesh.render(now, glitch),
            continuous: false
        });
        this.observer = new MutationObserver(() => {
            const active = overlay.classList.contains('vn-glitch-active');
            if (active === glitch) return;
            glitch = active;
            if (variant !== 'night') this.effect.drawFor(70);
        });
        this.observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        this.effect.start(overlay);
    }

    stop() {
        this.observer?.disconnect();
        this.effect?.stop();
    }
}

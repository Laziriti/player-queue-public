import { PixiBackgroundEffect } from './background/pixi-background-effect.js';

export class PixiDrunkEffect {
    start(overlay) {
        this.effect = new PixiBackgroundEffect({
            load: async () => (await import('./drunk-pixi-mesh.js')).DrunkPixiMesh,
            canvasClass: 'vn-drunk-pixi',
            prepare: (_layout, layer) => {
                const style = getComputedStyle(layer);
                return ['split', 'y', 'ghost', 'blur'].map(key => parseFloat(style.getPropertyValue(`--dr-${key}`)));
            },
            animate: (mesh, now, start) => mesh.render(Math.max(0, now - start) / 1000)
        });
        this.effect.start(overlay);
    }

    stop() { this.effect?.stop(); }
}

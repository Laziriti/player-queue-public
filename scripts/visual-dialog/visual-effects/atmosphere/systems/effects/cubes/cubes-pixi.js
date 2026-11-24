import { CUBES_LOOK_LERP, CUBES_LOOK_PCT, cubeCells, cubesGrid } from './cubes-layout.js';
import { PixiBackgroundEffect } from '../background/pixi-background-effect.js';

export class PixiCubesEffect {
    start(overlay, variant) {
        const full = variant === 'full';
        let x = 0.5, y = 0.5, targetX = 0.5, targetY = 0.5;
        let lastFrame;
        this.effect = new PixiBackgroundEffect({
            load: async () => (await import('./cubes-pixi-mesh.js')).CubesPixiMesh,
            canvasClass: 'vn-cb-pixi',
            composeBackground: true,
            measure: (overlay, layer) => cubesGrid(overlay, layer, full),
            prepare: layout => cubeCells(layout, full),
            animate: (mesh, now, start) => {
                // When two backgrounds coexist in a transition, both share one perspective.
                if (now !== lastFrame) {
                    x += (targetX - x) * CUBES_LOOK_LERP;
                    y += (targetY - y) * CUBES_LOOK_LERP;
                    lastFrame = now;
                }
                mesh.render((now - start) / 1000, x, y);
            }
        });
        document.addEventListener('mousemove', event => {
            targetX = 0.5 + (event.clientX / window.innerWidth - 0.5) * CUBES_LOOK_PCT / 100;
            targetY = 0.5 + (event.clientY / window.innerHeight - 0.5) * CUBES_LOOK_PCT / 100;
        }, { passive: true, signal: this.effect.signal });
        this.effect.start(overlay);
    }

    stop() { this.effect?.stop(); }
}

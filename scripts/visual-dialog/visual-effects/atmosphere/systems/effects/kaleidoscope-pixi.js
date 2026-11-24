import { PixiBackgroundEffect } from './background/pixi-background-effect.js';

export class PixiKaleidoscopeEffect extends PixiBackgroundEffect {
    constructor() {
        super({
            load: async () => (await import('./kaleidoscope-pixi-mesh.js')).KaleidoscopePixiMesh,
            canvasClass: 'vn-kd-pixi'
        });
    }
}

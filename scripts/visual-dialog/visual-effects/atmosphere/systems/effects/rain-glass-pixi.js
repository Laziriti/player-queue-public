import { PixiBackgroundEffect } from './background/pixi-background-effect.js';

export class PixiRainGlassEffect extends PixiBackgroundEffect {
    constructor() {
        super({
            load: async () => (await import('./rain-glass-pixi-mesh.js')).RainGlassPixiMesh,
            canvasClass: 'vn-rain-glass-pixi',
            composeBackground: true
        });
    }
}

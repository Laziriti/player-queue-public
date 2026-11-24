import { PixiParticleSurface } from '../../canvas/pixi-particle-surface.js';

/** A transparent GPU pass at a scene-owned stacking level. */
export class PixiSceneSurface extends PixiParticleSurface {
    async mount(overlay, cssClass, signal, onContextLost, maxDimension = Infinity) {
        const canvas = this.canvas = document.createElement('canvas');
        canvas.className = `vn-pixi-background ${cssClass}`;
        canvas.setAttribute('aria-hidden', 'true');
        await this.init(canvas, onContextLost);
        if (signal.aborted || !overlay.isConnected) return false;
        if (this.context.isContextLost()) throw new Error('Scene surface WebGL context lost during startup');
        (overlay.querySelector(':scope > .vn-orbit-stage') ?? overlay).appendChild(canvas);
        const resize = () => {
            this.width = overlay.clientWidth;
            this.height = overlay.clientHeight;
            this.dpr = Math.min(window.devicePixelRatio, maxDimension / Math.max(1, this.width, this.height));
            this.resize(Math.round(this.width * this.dpr), Math.round(this.height * this.dpr));
        };
        resize();
        this.observer = new ResizeObserver(resize);
        this.observer.observe(overlay);
        return true;
    }

    destroy() {
        this.observer?.disconnect();
        this.canvas?.remove();
        super.destroy();
    }
}

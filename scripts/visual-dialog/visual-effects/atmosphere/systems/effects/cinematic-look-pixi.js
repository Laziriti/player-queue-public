import { PixiBackgroundEffect } from './background/pixi-background-effect.js';
import { EffectProgress } from './effect-progress.js';
import { VISUAL_EFFECT_SETTINGS } from '../../config/visual-effect-settings.js';

const { floodColor, floodLevel, eclipsePhase, mirrorWorldColor } = VISUAL_EFFECT_SETTINGS;

function colorComponents(hex) {
    const color = Number.parseInt(hex.slice(1), 16);
    return [color >> 16, (color >> 8) & 255, color & 255].map(channel => channel / 255);
}

const mirrorBase = colorComponents(mirrorWorldColor.initial);

export class PixiAdjustableLook {
    start(overlay, _variant, type, settings) {
        this.flood = type === 'flood';
        this.level = this.flood ? ['floodLevel', floodLevel.initial] : ['eclipsePhase', eclipsePhase.initial];
        const [key, initial] = this.level;
        this.progress = new EffectProgress(settings[key] ?? initial);
        this.color = settings.floodColor ?? floodColor.initial;
        this.tint = colorComponents(this.color);
        this.effect = new PixiBackgroundEffect({
            load: async () => (await import('./cinematic-look-pixi-mesh.js')).CinematicLookPixiMesh,
            canvasClass: 'vn-grade-pixi vn-adjustable-look-pixi',
            animate: (mesh, now) => mesh.renderAdjustable(this.flood, this.progress.at(now),
                this.progress.reducedMotion.matches ? 0 : now / 1000, this.tint),
            continuous: false
        });
        this.effect.start(overlay);
        this.drawFor(0);
    }

    setSettings(settings) {
        const [key, initial] = this.level;
        const duration = this.progress.set(settings[key] ?? initial);
        const color = settings.floodColor ?? floodColor.initial;
        if (this.flood && color !== this.color) {
            this.color = color;
            this.tint = colorComponents(color);
            this.drawFor(duration ?? 0);
        } else if (duration !== undefined) this.drawFor(duration);
    }

    drawFor(duration) {
        const waves = this.flood && this.progress.target > 0 && !this.progress.reducedMotion.matches;
        this.effect.drawFor(waves ? Infinity : duration + 100);
    }

    stop() { this.effect.stop(); }
}

const settledClass = 'vn-vfx-cinematic-settled';

export class PixiCinematicLook {
    start(overlay, variant, type, settings = {}) {
        const eclipse = type === 'eclipse';
        const sun = eclipse && variant === 'sun';
        const paper = type === 'paper_map';
        const duration = eclipse ? (sun ? 7400 : 6100) : paper ? 3500 : 2500;
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        // One clock for both layers of a dissolve. Replacing or resizing the media keeps the look.
        let started;
        let settled = reducedMotion;
        const settleAfter = () => {
            clearTimeout(this.settle);
            this.settle = setTimeout(() => {
                settled = true;
                overlay.classList.add(settledClass);
            }, duration);
        };
        const play = () => {
            started = performance.now();
            this.effect.drawFor(duration + 100);
            settleAfter();
        };
        this.overlay = overlay;
        this.type = type;
        this.setSettings(settings);
        this.effect = new PixiBackgroundEffect({
            load: async () => paper
                ? (await import('./paper-map-pixi-mesh.js')).PaperMapPixiMesh
                : (await import('./cinematic-look-pixi-mesh.js')).CinematicLookPixiMesh,
            canvasClass: paper ? 'vn-grade-pixi vn-paper-map-pixi' : 'vn-grade-pixi vn-cinematic-pixi',
            animate: (mesh, now) => {
                const elapsed = now - (started ?? now);
                const phase = settled ? 1 : Math.min(1, Math.max(0, elapsed / duration));
                mesh.render(phase, eclipse, sun, this.mirrorTint);
            },
            mount: (canvas, layer) => {
                layer.appendChild(canvas);
                if (started === undefined && !settled) play();
            },
            continuous: false
        });
        if (reducedMotion) {
            overlay.classList.add(settledClass);
        } else if (eclipse || paper) {
            settleAfter();
        } else {
            play();
        }
        this.effect.start(overlay);
    }

    setSettings({ mirrorWorldColor: color = mirrorWorldColor.initial }) {
        if (this.type !== 'mirror_world' || color === this.mirrorColor) return;
        this.mirrorColor = color;
        // Use the wave's original color as the reference for the reflection and its gleam.
        this.mirrorTint = colorComponents(color).map((channel, index) => channel / mirrorBase[index]);
        if (this.overlay.classList.contains(settledClass)) this.effect?.drawFor(100);
    }

    stop() {
        clearTimeout(this.settle);
        this.overlay?.classList.remove(settledClass);
        this.effect?.stop();
    }
}

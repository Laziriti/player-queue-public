// ============================================================
// index.js — VNAtmosphere v3.0 (модульная архитектура)
// ============================================================

import { EFFECTS, EFFECT_LABELS, EFFECT_ICONS, PRESETS, EFFECT_GROUPS } from './config/effects.js';
import { ParticleSystem } from './systems/particle-system.js';
import { VisualFXSystem } from './systems/visual-fx.js';
import { ParallaxSystem } from './systems/parallax.js';
import { VNCameraSystem } from './systems/camera.js';

class VNAtmosphere {
    // ─── Статические данные для внешнего доступа ─────────────
    static EFFECTS = EFFECTS;
    static EFFECT_LABELS = EFFECT_LABELS;
    static EFFECT_ICONS = EFFECT_ICONS;
    static PRESETS = PRESETS;
    static EFFECT_GROUPS = EFFECT_GROUPS;

    constructor() {
        this._active = false;
        this._effect = 'particles';
        this._overlayEl = null;

        // Подсистемы
        this._particles = new ParticleSystem();
        this._visualFX = new VisualFXSystem();
        this._parallax = new ParallaxSystem();
        this._camera = new VNCameraSystem();

        this._parallax.setCameraSystem(this._camera);
    }

    /**
     * Инициализировать атмосферу
     * @param {HTMLElement} overlayEl — корневой overlay-элемент
     * @param {string} effect — ID эффекта из EFFECTS
     * @param {number} particleIntensity — множитель количества частиц (1–20)
     */
    init(overlayEl, effect = 'particles', particleIntensity = 1) {
        if (!overlayEl) return;

        this._active = true;
        this._effect = effect;
        this._overlayEl = overlayEl;

        const preset = PRESETS[effect] || PRESETS.particles;

        // Запуск подсистем
        const particleContainer = overlayEl.querySelector('.vn-particles');
        if (particleContainer) {
            this._particles.fill(particleContainer, preset.particles, particleIntensity);
        }

        this._visualFX.apply(overlayEl, preset.visual);

        const parallaxEnabled = game.settings.get('player-queue', 'parallaxEnabled');
        const parallaxDepth = game.settings.get('player-queue', 'parallaxDepth');
        const cameraEnabled = game.settings.get('player-queue', 'cameraEnabled');
        const kenBurnsDir = game.settings.get('player-queue', 'kenBurnsDirection');

        this._camera.setEnabled(cameraEnabled);
        this._parallax.start(overlayEl, {
            enabled: parallaxEnabled,
            depth: parallaxDepth,
            kenBurns: { enabled: kenBurnsDir !== 'none', direction: kenBurnsDir }
        });
    }

    /**
     * Полная очистка и остановка
     */
    destroy() {
        this._active = false;

        this._particles.clear();
        this._visualFX.destroy();
        this._parallax.stop();
        this._camera.reset();

        this._overlayEl = null;
    }

    /**
     * Уведомить камеру о смене спикера
     * @param {HTMLElement|null} charEl
     */
    onSpeakerChange(charEl) {
        this._camera.onSpeakerChange(charEl);
    }

    /**
     * Сбросить zoom параллакса
     */
    resetZoom() {
        this._parallax.resetZoom();
    }

    /**
     * Текущий эффект
     */
    get effect() {
        return this._effect;
    }

    /**
     * Активна ли атмосфера
     */
    get active() {
        return this._active;
    }
}

export { VNAtmosphere };

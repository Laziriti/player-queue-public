// ============================================================
// index.js — VNAtmosphere v4.0 (независимые оси particle + visual)
// ============================================================

import { EFFECTS, EFFECT_LABELS, EFFECT_ICONS, PRESETS, EFFECT_GROUPS } from './config/effects.js';
import { PARTICLE_TYPES, PARTICLE_LABELS, PARTICLE_ICONS, PARTICLE_GROUPS } from './config/particle-types.js';
import { VISUAL_TYPES, VISUAL_LABELS, VISUAL_ICONS, VISUAL_GROUPS } from './config/visual-types.js';
import { ParticleSystem } from './systems/particle-system.js';
import { VisualFXSystem } from './systems/visual-fx.js';
import { ParallaxSystem } from './systems/parallax.js';
import { VNCameraSystem } from './systems/camera.js';

class VNAtmosphere {
    // ─── Пресеты (для конвертации/обратной совместимости) ────
    static EFFECTS = EFFECTS;
    static EFFECT_LABELS = EFFECT_LABELS;
    static EFFECT_ICONS = EFFECT_ICONS;
    static PRESETS = PRESETS;
    static EFFECT_GROUPS = EFFECT_GROUPS;

    // ─── Независимые оси: частицы ─────────────────────────────
    static PARTICLE_TYPES = PARTICLE_TYPES;
    static PARTICLE_LABELS = PARTICLE_LABELS;
    static PARTICLE_ICONS = PARTICLE_ICONS;
    static PARTICLE_GROUPS = PARTICLE_GROUPS;

    // ─── Независимые оси: визуальный эффект ───────────────────
    static VISUAL_TYPES = VISUAL_TYPES;
    static VISUAL_LABELS = VISUAL_LABELS;
    static VISUAL_ICONS = VISUAL_ICONS;
    static VISUAL_GROUPS = VISUAL_GROUPS;

    constructor() {
        this._active = false;
        this._particle = 'particles';
        this._visual = 'none';
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
     * @param {string} particle — ID типа частиц из PARTICLE_TYPES
     * @param {string} visual — ID визуального эффекта из VISUAL_TYPES
     * @param {number} particleIntensity — множитель количества частиц (1–20)
     */
    init(overlayEl, particle = 'particles', visual = 'none', particleIntensity = 1) {
        if (!overlayEl) return;

        this._active = true;
        this._particle = particle;
        this._visual = visual;
        this._overlayEl = overlayEl;

        // Запуск подсистем — полностью независимо друг от друга
        const particleContainer = overlayEl.querySelector('.vn-particles');
        if (particleContainer) {
            this._particles.fill(particleContainer, particle, particleIntensity);
        }

        this._visualFX.apply(overlayEl, visual);

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
     * Текущий тип частиц
     */
    get particleEffect() {
        return this._particle;
    }

    /**
     * Текущий визуальный эффект
     */
    get visualEffect() {
        return this._visual;
    }

    /**
     * Активна ли атмосфера
     */
    get active() {
        return this._active;
    }
}

export { VNAtmosphere };

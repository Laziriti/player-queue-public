// ============================================================
// index.js — VNAtmosphere v4.0 (независимые оси particle + visual)
// ============================================================

import { EFFECTS, EFFECT_LABELS, EFFECT_ICONS, PRESETS, EFFECT_GROUPS } from './config/effects.js';
import { PARTICLE_TYPES, PARTICLE_LABELS, PARTICLE_ICONS, PARTICLE_GROUPS, PARTICLE_VARIANTS } from './config/particle-types.js';
import { VISUAL_TYPES, VISUAL_LABELS, VISUAL_ICONS, VISUAL_GROUPS, VISUAL_VARIANTS } from './config/visual-types.js';
import { isFxDisabled } from '../fx-performance.js';
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
    static PARTICLE_VARIANTS = PARTICLE_VARIANTS;

    // ─── Независимые оси: визуальный эффект ───────────────────
    static VISUAL_TYPES = VISUAL_TYPES;
    static VISUAL_LABELS = VISUAL_LABELS;
    static VISUAL_ICONS = VISUAL_ICONS;
    static VISUAL_VARIANTS = VISUAL_VARIANTS;
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
     * @param {string} particlesLayer — 'back' | 'front' | 'mix'; при 'mix' часть частиц
     *   случайно создаётся в верхнем контейнере .vn-particles-upper (над персонажами)
     */
    init(overlayEl, particle = 'particles', visual = 'none', particleIntensity = 1, particlesLayer = 'back') {
        if (!overlayEl) return;

        this._active = true;
        this._particle = particle;
        this._visual = visual;
        this._overlayEl = overlayEl;

        // Лёгкий режим (клиентская настройка): без частиц, визуальных эффектов, параллакса и камеры.
        // Состояние сцены (this._particle / this._visual) при этом не меняется — меняется только то, что рисует этот клиент.
        const lite = game.settings.get('player-queue', 'liteMode');

        // Запуск подсистем — полностью независимо друг от друга
        const particleContainer = overlayEl.querySelector('.vn-particles');
        if (particleContainer && !lite && !isFxDisabled('particle', particle)) {
            const upper = particlesLayer === 'mix' ? overlayEl.querySelector('.vn-particles-upper') : null;
            this._particles.fill(particleContainer, particle, particleIntensity, upper);
        }

        this._visualFX.apply(overlayEl, lite || isFxDisabled('visual', visual) ? 'none' : visual);

        const parallaxEnabled = game.settings.get('player-queue', 'parallaxEnabled');
        const parallaxDepth = game.settings.get('player-queue', 'parallaxDepth');
        const cameraEnabled = game.settings.get('player-queue', 'cameraEnabled');
        const kenBurnsDir = game.settings.get('player-queue', 'kenBurnsDirection');

        this._camera.setEnabled(cameraEnabled && !lite);
        // Параллакс — это постоянный цикл requestAnimationFrame, поэтому в лёгком режиме его не запускаем вовсе
        if (lite) return;
        this._parallax.start(overlayEl, {
            enabled: parallaxEnabled,
            depth: parallaxDepth,
            kenBurns: { enabled: kenBurnsDir !== 'none', direction: kenBurnsDir }
        });
    }

    /**
     * Сменить только визуальный эффект. Частицы, параллакс и камера продолжают работать как есть
     * (полный destroy()+init() перезапустил бы падение частиц и дрейф фона).
     */
    setVisual(visual) {
        if (!this._active || !this._overlayEl) return;
        this._visual = visual;
        const lite = game.settings.get('player-queue', 'liteMode');
        this._visualFX.apply(this._overlayEl, lite || isFxDisabled('visual', visual) ? 'none' : visual);
    }

    /**
     * Сменить только частицы (тип, интенсивность или слой 'mix'); визуальный эффект, параллакс и камера не трогаются.
     */
    setParticles(particle, particleIntensity = 1, particlesLayer = 'back') {
        if (!this._active || !this._overlayEl) return;
        this._particle = particle;
        const container = this._overlayEl.querySelector('.vn-particles');
        if (!container) return;
        this._particles.clear();
        if (game.settings.get('player-queue', 'liteMode') || isFxDisabled('particle', particle)) return;
        const upper = particlesLayer === 'mix' ? this._overlayEl.querySelector('.vn-particles-upper') : null;
        this._particles.fill(container, particle, particleIntensity, upper);
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
     * Отложенная очистка при закрытии сцены: гасит атмосферу, только если она всё ещё привязана к этому оверлею
     * (за время затухания могла открыться новая сцена, её трогать нельзя).
     */
    destroyFor(overlayEl) {
        if (this._overlayEl === overlayEl) this.destroy();
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

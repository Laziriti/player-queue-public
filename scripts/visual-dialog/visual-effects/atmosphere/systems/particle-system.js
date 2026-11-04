// ============================================================
// systems/particle-system.js — Создание и управление частицами
// Частицы не DOM-элементы: ParticleSystem выбирает параметры старта (случайные числа берутся здесь, на главном потоке)
// и отдаёт их CanvasParticles (canvas/particle-canvas.js), который рисует всё в воркере. Вид и движение типов — config/particle-canvas.js.
// ============================================================

import { R, RD } from '../utils.js';
import { PARTICLE_CONFIGS } from '../config/particles.js';
import { particleIntensityCap } from '../../fx-performance.js';
import { resolveCanvasSpec } from '../config/particle-canvas.js';
import { CanvasParticles } from './canvas/particle-canvas.js';

export class ParticleSystem {
    constructor() {
        this._container = null;
        this._upperContainer = null;
        this._type = 'none';
        this._engine = null;
    }

    /**
     * Заполнить контейнер частицами указанного типа
     * @param {HTMLElement} container — элемент .vn-particles
     * @param {string} particleType — ключ из PARTICLE_CONFIGS, опционально с
     *   суффиксом варианта через ":" (например "feathers:black") — см.
     *   PARTICLE_VARIANTS в config/particle-types.js
     * @param {number} intensity — множитель количества частиц (1 = базовое, 1–20)
     * @param {HTMLElement|null} upperContainer — элемент .vn-particles-upper; если
     *   передан, часть частиц (случайно) рисуется в нём, а не в основном контейнере
     */
    fill(container, particleType, intensity = 1, upperContainer = null) {
        this._container = container;
        this._upperContainer = upperContainer;
        this._type = particleType;

        this._destroyEngine();
        container.innerHTML = '';
        if (upperContainer) upperContainer.innerHTML = '';
        if (particleType === 'none') return;

        const [type, variant] = particleType.split(':');
        // Интенсивность ведущего (1–20) дополнительно ограничена клиентским потолком — настройка particleIntensityMax
        const safeIntensity = Math.min(Math.max(intensity, 1), 20, particleIntensityCap());

        if (type === 'ghosts') {
            this._fillGhosts(container, upperContainer, safeIntensity);
            return;
        }

        const base = PARTICLE_CONFIGS[type];
        const spec = resolveCanvasSpec(type, variant);
        if (!base || !spec) return;

        // Вариант (config.variants[id]) переопределяет поля базового конфига
        const override = variant && variant !== 'all' ? base.variants?.[variant] : null;
        this._fillSprites(type, variant, spec, override ? { ...base, ...override } : base, container, upperContainer, safeIntensity);
    }

    /**
     * Остановить рисование и очистить контейнеры
     */
    clear() {
        this._destroyEngine();
        if (this._container) {
            this._container.innerHTML = '';
        }
        if (this._upperContainer) {
            this._upperContainer.innerHTML = '';
            this._upperContainer = null;
        }
        this._type = 'none';
    }

    /**
     * Текущий тип частиц
     */
    get type() {
        return this._type;
    }

    // ─── Private ─────────────────────────────────────────────

    _destroyEngine() {
        this._engine?.destroy();
        this._engine = null;
    }

    _newEngine(container, upper) {
        // Эффект сцены «сон» (класс на оверлее) замедляет все частицы до 20 с на круг
        const overlay = container.closest('#vn-scene-overlay');
        return (this._engine = new CanvasParticles(container, upper, { overlay }));
    }

    /** Обычные частицы: у каждой параметры старта (spawn) и, если у типа есть images, номер картинки */
    _fillSprites(type, variant, spec, config, container, upper, intensity) {
        const engine = this._newEngine(container, upper);
        const baseId = `${type}:${variant ?? 'all'}`;
        const count = Math.round((config.count || 80) * intensity);
        const images = config.images;

        for (let i = 0; i < count; i++) {
            let params, kindId = baseId, kindSpec = spec, kindImages = images;
            if (type === 'rain') {
                const d = this._rainParams(config);
                params = { w: d.width, h: d.height, left: d.left, top: -5, delay: d.delay, duration: d.duration, drift: d.dx, rot: d.tilt };
            } else if (type === 'confetti') {
                const d = this._confettiParams(config);
                kindId = `${baseId}:${d.streamer ? 'streamer' : 'piece'}`;
                kindSpec = spec.parts[d.streamer ? 'streamer' : 'piece'];
                kindImages = d.streamer ? null : images;
                params = { w: d.w, h: d.h, left: d.left, top: -5, delay: d.delay, duration: d.duration, drift: d.drift, rotation: d.rotation, img: d.img };
            } else {
                const size = config.sizeMin + Math.random() * config.sizeRange;
                params = { w: size, h: size, ...config.spawn(size) };
                if (images?.length) params.img = Math.floor(Math.random() * images.length);
            }
            engine.addSprite(kindId, kindSpec, params, engine.split && Math.random() < 0.5 ? 'front' : 'back', kindImages);
        }
        engine.start();
    }

    /** Призраки: 8 полос тумана позади и души с хвостом и головой-картинкой (число душ — до 84) */
    _fillGhosts(container, upper, intensity) {
        const config = PARTICLE_CONFIGS.ghosts;
        const engine = this._newEngine(container, upper);
        engine.setGhostImages(config?.images);
        const souls = Math.min(Math.round((config?.count || 42) * intensity), 84);

        for (let n = 0; n < 8; n++) engine.addVapor(n);

        // Номер среди душ слоя определяет путь и глубину (ghosts.js)
        const placed = { back: 0, front: 0 };
        for (let n = 0; n < souls; n++) {
            const head = config?.images?.length ? Math.floor(Math.random() * config.images.length) : -1;
            const layer = engine.split && Math.random() < 0.5 ? 'front' : 'back';
            engine.addSoul(n, ++placed[layer], head, layer);
        }
        engine.start();
    }

    /** Параметры одной капли */
    _rainParams(config) {
        const { width, height, duration, drift, skew } = config.drop;
        const between = ([lo, hi]) => lo + Math.random() * (hi - lo);
        const dx = between(drift);
        // Капля вытянута вдоль траектории: наклон к вертикали = atan(снос / путь по вертикали)
        const tilt = -Math.atan2(dx, window.innerHeight * 1.1) * 180 / Math.PI;
        return {
            dx, tilt,
            width: between(width), height: between(height),
            left: skew ? R(125) - 20 : R(100),
            delay: R(5), duration: between(duration),
        };
    }

    /** Параметры одного конфетти (картинка) или серпантина (цветная полоска) */
    _confettiParams(config) {
        const streamer = config.mode ? config.mode === 'streamers' : Math.random() < 0.25;
        const images = config.images;

        if (streamer) {
            const w = 1.5 + Math.random() * 2;
            const h = 10 + Math.random() * 20;
            return { streamer, w, h, left: R(100), delay: R(20), duration: 5 + R(7), drift: RD(140), rotation: RD(300) };
        }
        const s = 12 + Math.random() * 9;
        const p = { streamer, w: s, h: s, left: R(100), delay: R(20), duration: 5 + R(9), drift: RD(100), rotation: R(720) - 360 };
        if (images?.length) p.img = Math.floor(Math.random() * images.length);
        return p;
    }
}

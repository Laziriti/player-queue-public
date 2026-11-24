// ============================================================
// systems/particle-system.js — Создание и управление частицами
// Частицы не DOM-элементы: ParticleSystem выбирает параметры старта (случайные числа берутся здесь, на главном потоке)
// и отдаёт их CanvasParticles (canvas/particle-canvas.js), который рисует всё в воркере. Вид и движение типов — config/particle-canvas.js.
// ============================================================

import { R, RD } from '../utils.js';
import { PARTICLE_CONFIGS } from '../config/particles.js';
import { normalizeParticleEffect } from '../config/particle-types.js';
import { particleMotion } from '../config/particle-effect-settings.js';
import { particleIntensityCap } from '../../fx-performance.js';
import { resolveCanvasSpec } from '../config/particle-canvas.js';
import { CanvasParticles } from './canvas/particle-canvas.js';
import { resolveParticleWind } from '../../../scene/vn-scene-contract.js';

// Сила глубины по режиму: 0 — все частицы на одном плане, как раньше
const DEPTH_STRENGTH = { flat: 0, soft: 0.6, deep: 1 };
// Порог «близкой» частицы: при раздельных слоях она рисуется над персонажами
const NEAR_DEPTH = 0.72;

/** { depth, wind, gusts } из внешнего мира → допустимые значения (нет или мусор — плоско, штиль, порывы) */
function normalizeLook(look) {
    const depth = Object.hasOwn(DEPTH_STRENGTH, look?.depth) ? look.depth : 'flat';
    const wind = resolveParticleWind(look?.wind);
    return { depth, wind, gusts: look?.gusts !== false, wrap: look?.wrap !== false,
        scale: look?.scale, opacity: look?.opacity, tempo: look?.tempo, solidTexture: look?.solidTexture,
        tintColor: look?.tintColor, tintStrength: look?.tintStrength, effectSettings: look?.effectSettings };
}

/** Прозрачность по глубине: далёкие тусклее, средние ярче всех, ближние не в фокусе и полупрозрачны (не закрывают лица) */
function depthAlpha(d) {
    if (d <= 0.55) return 0.5 + 0.5 * (d / 0.55);
    if (d <= 0.8) return 1 - 0.45 * ((d - 0.55) / 0.25);
    return 0.55;
}

/** Глубина одной частицы d (0 далеко … 1 близко, чаще далёкие) и всё, что из неё следует, с учётом силы режима s */
function depthLook(s) {
    const d = Math.random() ** 2.4;
    const k = full => 1 + s * (full - 1);
    return {
        d,
        size: k(0.55 + 1.15 * d),
        speed: k(0.6 + 0.85 * d),
        alpha: k(depthAlpha(d)),
        blur: s * (d < 0.25 ? 0.6 : d > NEAR_DEPTH ? 3 : 0),
        near: d > NEAR_DEPTH,
    };
}

export class ParticleSystem {
    constructor() {
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
     * @param {{depth?: 'flat'|'soft'|'deep', wind?: number, gusts?: boolean, wrap?: boolean}} [look] — глубина частиц, ветер и перенос через боковые края
     */
    fill(container, particleType, intensity = 1, upperContainer = null, look = null) {
        this.clear();
        this._type = normalizeParticleEffect(particleType);
        if (this._type === 'none') return;
        look = normalizeLook(look);

        const [type, variant] = this._type.split(':');
        // Интенсивность ведущего (1–20) дополнительно ограничена клиентским потолком — настройка particleIntensityMax
        const safeIntensity = Math.min(Math.max(intensity, 1), 20, particleIntensityCap());

        if (type === 'ghosts') {
            this._fillGhosts(container, upperContainer, safeIntensity, variant, look);
            return;
        }

        const base = PARTICLE_CONFIGS[type];
        const movement = particleMotion(type, look.effectSettings);
        const spec = resolveCanvasSpec(type, variant, movement);
        if (!base || !spec) return;

        // Вариант (config.variants[id]) переопределяет поля базового конфига
        const override = variant && variant !== 'all' ? base.variants?.[variant] : null;
        const config = { ...base, ...override };
        config.spawn = config.motionSpawns?.[movement] ?? config.spawn;
        this._fillSprites(type, variant, spec, config, container, upperContainer, safeIntensity, look);
    }

    /** Сменить ветер без пересоздания частиц (-5…5) */
    setWind(level, gusts = true) {
        const look = normalizeLook({ wind: level, gusts });
        this._engine?.setWind(look.wind, look.gusts);
    }

    setAppearance(scale, opacity, tintColor, tintStrength, solidTexture) {
        this._engine?.setAppearance(scale, opacity, tintColor, tintStrength, solidTexture);
    }

    setTempo(tempo) {
        this._engine?.setTempo(tempo);
    }

    /**
     * Остановить рисование и очистить контейнеры
     */
    clear() {
        this._engine?.destroy();
        this._engine = null;
        this._type = 'none';
    }

    /**
     * Текущий тип частиц
     */
    get type() {
        return this._type;
    }

    // ─── Private ─────────────────────────────────────────────

    _newEngine(container, upper, look) {
        // Эффект сцены «сон» (класс на оверлее) замедляет все частицы до 20 с на круг
        const overlay = container.closest('#vn-scene-overlay');
        return (this._engine = new CanvasParticles(container, upper, {
            overlay, wind: look.wind, gusts: look.gusts, wrap: look.wrap, parallax: look.depth !== 'flat',
            scale: look.scale, opacity: look.opacity, tempo: look.tempo, solidTexture: look.solidTexture,
            tintColor: look.tintColor, tintStrength: look.tintStrength,
        }));
    }

    /** Обычные частицы: у каждой параметры старта (spawn), глубина и ветер и, если у типа есть images, номер картинки */
    _fillSprites(type, variant, spec, config, container, upper, intensity, look) {
        const engine = this._newEngine(container, upper, look);
        const baseId = `${type}:${variant ?? 'all'}`;
        const count = Math.round((config.count || 80) * intensity);
        const images = config.images;
        const strength = spec.depth === false ? 0 : DEPTH_STRENGTH[look.depth];
        const windK = spec.wind ?? 1;

        for (let i = 0; i < count; i++) {
            const dp = strength ? depthLook(strength) : null;
            let params, kindId = baseId, kindSpec = spec, kindImages = images;
            if (type === 'rain' || type === 'hail') {
                const d = this._rainParams(config, dp);
                params = { w: d.width, h: d.height, left: d.left, top: -5, delay: d.delay, duration: d.duration, drift: d.dx, rot: d.tilt };
            } else if (type === 'confetti') {
                const d = this._confettiParams(config);
                kindId = `${baseId}:${d.streamer ? 'streamer' : 'piece'}`;
                kindSpec = spec.parts[d.streamer ? 'streamer' : 'piece'];
                kindImages = d.streamer ? null : images;
                params = { w: d.w, h: d.h, left: d.left, top: -5, delay: d.delay, duration: d.duration, drift: d.drift, rotation: d.rotation, img: d.img };
            } else {
                const size = (config.sizeMin + Math.random() * config.sizeRange) * (dp?.size ?? 1);
                params = { w: size, h: size, ...config.spawn(size) };
                if (dp && params.duration) params.duration /= dp.speed;
                if (images?.length) params.img = Math.floor(Math.random() * images.length);
            }
            // Ветер сносит дальние слабее ближних; без глубины все как «средние» (0.5)
            const mid = dp ? 0.5 + (dp.d - 0.5) * strength : 0.5;
            params.wk = windK * (0.6 + 0.9 * mid);
            params.ph = Math.random();
            params.ph2 = Math.random();
            if (dp) Object.assign(params, { alpha: dp.alpha, xb: dp.blur, dd: dp.d, pd: dp.d * strength });
            const layer = !engine.split ? 'back' : dp ? (dp.near ? 'front' : 'back') : (Math.random() < 0.5 ? 'front' : 'back');
            engine.addSprite(kindId, kindSpec, params, layer, kindImages);
        }
        engine.start();
    }

    /** Призраки со своим распределением глубины и траекториями, независимыми от ветра. */
    _fillGhosts(container, upper, intensity, variant, look) {
        const config = PARTICLE_CONFIGS.ghosts;
        const engine = this._newEngine(container, upper, { ...look, depth: 'flat', wind: 0, gusts: true });
        const atTwo = config.count * 2;
        const souls = Math.round(intensity <= 2
            ? config.count * intensity
            : atTwo + (config.maxCount - atTwo) * (intensity - 2) / 18);
        engine.setGhosts(config.images, variant, souls);

        for (let n = 0; n < 8; n++) engine.addVapor(n);

        // Номер среди душ слоя определяет путь и глубину (ghosts.js)
        const placed = { back: 0, front: 0 };
        for (let n = 0; n < souls; n++) {
            const head = Math.floor(Math.random() * config.images.length);
            const layer = engine.split && Math.random() < (variant === 'vortex_center' ? 0.28 : 0.5) ? 'front' : 'back';
            engine.addSoul(n, ++placed[layer], head, layer);
        }
        engine.start();
    }

    /** Параметры одной капли */
    _rainParams(config, dp = null) {
        const { width, height, duration, drift, skew } = config.drop;
        const between = ([lo, hi]) => lo + Math.random() * (hi - lo);
        const dx = between(drift);
        // Капля вытянута вдоль траектории: наклон к вертикали = atan(снос / путь по вертикали)
        const tilt = -Math.atan2(dx, window.innerHeight * 1.1) * 180 / Math.PI;
        return {
            dx, tilt,
            width: between(width) * (dp?.size ?? 1), height: between(height) * (dp?.size ?? 1),
            left: skew ? R(125) - 20 : R(100),
            delay: R(5), duration: between(duration) / (dp?.speed ?? 1),
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

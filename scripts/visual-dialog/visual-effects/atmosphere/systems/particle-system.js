// ============================================================
// systems/particle-system.js — Создание и управление частицами
// ============================================================

import { R, RD } from '../utils.js';
import { PARTICLE_CONFIGS } from '../config/particles.js';

export class ParticleSystem {
    constructor() {
        this._container = null;
        this._type = 'none';
    }

    /**
     * Заполнить контейнер частицами указанного типа
     * @param {HTMLElement} container — элемент .vn-particles
     * @param {string} particleType — ключ из PARTICLE_CONFIGS
     * @param {number} intensity — множитель количества частиц (1 = базовое, 1–20)
     */
    fill(container, particleType, intensity = 1) {
        this._container = container;
        this._type = particleType;

        container.innerHTML = '';
        if (particleType === 'none') return;

        const safeIntensity = Math.min(Math.max(intensity, 1), 20);

        // Призраки — особая структура: souls + vapor, offset-path анимация
        if (particleType === 'ghosts') {
            this._fillGhosts(container, safeIntensity);
            return;
        }

        // Специальные фабрики для нестандартных частиц
        const factory = this._getSpecialFactory(particleType);
        if (factory) {
            this._fillWithFactory(container, factory, safeIntensity);
            return;
        }

        // Стандартная генерация
        const config = PARTICLE_CONFIGS[particleType];
        if (!config) return;

        this._fillFromConfig(container, config, safeIntensity);
    }

    /**
     * Очистить контейнер
     */
    clear() {
        if (this._container) {
            this._container.innerHTML = '';
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

    _fillFromConfig(container, config, intensity = 1) {
        const { className, count, sizeMin, sizeRange, style } = config;
        const actualCount = Math.round(count * intensity);
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < actualCount; i++) {
            const p = document.createElement('span');
            p.className = className;
            const size = sizeMin + Math.random() * sizeRange;
            p.style.cssText = style(size);
            fragment.appendChild(p);
        }

        container.appendChild(fragment);
    }

    _fillWithFactory(container, factory, intensity = 1) {
        const config = PARTICLE_CONFIGS[factory.type];
        const baseCount = config?.count || 80;
        const count = Math.round(baseCount * intensity);
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < count; i++) {
            fragment.appendChild(factory.create());
        }

        container.appendChild(fragment);
    }

    /**
     * Возвращает специальную фабрику для типов частиц,
     * которые не укладываются в стандартный шаблон
     */
    _getSpecialFactory(particleType) {
        switch (particleType) {
            case 'rain':
                return { type: 'rain', create: () => this._createRainDrop() };
            case 'confetti':
                return { type: 'confetti', create: () => this._createConfettiParticle() };
            default:
                return null;
        }
    }

    _fillGhosts(container, intensity) {
        const baseSouls = PARTICLE_CONFIGS.ghosts?.count || 42;
        const soulCount = Math.min(Math.round(baseSouls * intensity), 84);
        const fragment = document.createDocumentFragment();

        // Туман — 8 размытых паров позади душ
        const mist = document.createElement('div');
        mist.className = 'vn-particle-ghost-mist';
        for (let n = 0; n < 8; n++) {
            const vapor = document.createElement('div');
            vapor.className = 'vn-particle-ghost-vapor';
            vapor.style.setProperty('--n', n);
            vapor.appendChild(document.createElement('i'));
            vapor.appendChild(document.createElement('i'));
            mist.appendChild(vapor);
        }
        fragment.appendChild(mist);

        // Обёртка для правильной работы :nth-child на душах
        const soulsEl = document.createElement('div');
        soulsEl.className = 'vn-particle-ghost-souls';

        for (let n = 0; n < soulCount; n++) {
            const soul = document.createElement('div');
            soul.className = 'vn-particle-ghost-soul';
            soul.style.setProperty('--n', n);

            // 13 хвостовых сегментов: CSS :nth-of-type задаёт --t для каждого
            for (let t = 0; t < 13; t++) {
                soul.appendChild(document.createElement('i'));
            }

            // Голова (--t остаётся 0 из CSS)
            const head = document.createElement('b');
            head.className = 'vn-particle-ghost-head';
            soul.appendChild(head);

            soulsEl.appendChild(soul);
        }

        fragment.appendChild(soulsEl);
        container.appendChild(fragment);
    }

    _createRainDrop() {
        const p = document.createElement('span');
        p.className = 'vn-particle vn-particle-rain';
        const w = 1 + Math.random();
        const h = 8 + Math.random() * 12;
        p.style.cssText = `width:${w}px;height:${h}px;left:${R(100)}%;top:-5%;animation-delay:${R(5)}s;animation-duration:${0.5 + R(0.8)}s;--drift:${RD(10)}px;opacity:0`;
        return p;
    }

    _createConfettiParticle() {
        const p = document.createElement('span');
        const isStreamer = Math.random() < 0.25;

        if (isStreamer) {
            const w = 1.5 + Math.random() * 2;
            const h = 10  + Math.random() * 20;
            p.className = 'vn-particle vn-particle-confetti vn-particle-streamer';
            p.style.cssText = `width:${w}px;height:${h}px;left:${R(100)}%;top:-5%;` +
                `animation-delay:${R(20)}s;animation-duration:${5 + R(7)}s;` +
                `--drift:${RD(140)}px;--rotation:${RD(300)}deg;opacity:0`;
        } else {
            const s = 3 + Math.random() * 5;
            const w = s * (0.8 + Math.random() * 0.7);
            p.className = 'vn-particle vn-particle-confetti';
            p.style.cssText = `width:${w}px;height:${s}px;left:${R(100)}%;top:-5%;` +
                `animation-delay:${R(20)}s;animation-duration:${5 + R(9)}s;` +
                `--drift:${RD(100)}px;--rotation:${R(720) - 360}deg;opacity:0`;
        }

        return p;
    }
}

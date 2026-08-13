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
     */
    fill(container, particleType) {
        this._container = container;
        this._type = particleType;

        container.innerHTML = '';
        if (particleType === 'none') return;

        // Специальные фабрики для нестандартных частиц
        const factory = this._getSpecialFactory(particleType);
        if (factory) {
            this._fillWithFactory(container, factory);
            return;
        }

        // Стандартная генерация
        const config = PARTICLE_CONFIGS[particleType];
        if (!config) return;

        this._fillFromConfig(container, config);
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

    _fillFromConfig(container, config) {
        const { className, count, sizeMin, sizeRange, style } = config;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < count; i++) {
            const p = document.createElement('span');
            p.className = className;
            const size = sizeMin + Math.random() * sizeRange;
            p.style.cssText = style(size);
            fragment.appendChild(p);
        }

        container.appendChild(fragment);
    }

    _fillWithFactory(container, factory) {
        const config = PARTICLE_CONFIGS[factory.type];
        const count = config?.count || 80;
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
            case 'ghosts':
                return { type: 'ghosts', create: () => this._createGhostParticle() };
            default:
                return null;
        }
    }

    _createRainDrop() {
        const p = document.createElement('span');
        p.className = 'vn-particle vn-particle-rain';
        const w = 1 + Math.random();
        const h = 8 + Math.random() * 12;
        p.style.cssText = `width:${w}px;height:${h}px;left:${R(100)}%;top:-5%;animation-delay:${R(5)}s;animation-duration:${0.5 + R(0.8)}s;--drift:${RD(10)}px;opacity:0`;
        return p;
    }

    _createGhostParticle() {
        const p = document.createElement('span');
        const roll = Math.random();

        if (roll < 0.28) {
            // Призрачная форма: крупный светящийся орб
            const w = 50 + Math.random() * 45;
            const h = w * (1.1 + Math.random() * 0.5);
            const dur = 28 + Math.random() * 18;
            const delay = Math.random() < 0.5 ? -(Math.random() * dur * 0.75) : R(10);
            p.className = 'vn-particle vn-particle-ghost-form';
            p.style.cssText = `width:${w}px;height:${h}px;` +
                `left:${-5 + R(110)}%;top:${10 + R(75)}%;` +
                `animation-delay:${delay}s;animation-duration:${dur}s;` +
                `--drift:${RD(280)}px;--drift-y:${RD(150)}px;opacity:0`;
        } else if (roll < 0.55) {
            // Энергетический стример: широкий горизонтальный поток
            const w = 100 + Math.random() * 130;
            const h = 8 + Math.random() * 14;
            const dur = 20 + Math.random() * 22;
            const delay = Math.random() < 0.5 ? -(Math.random() * dur * 0.75) : R(8);
            // Однонаправленный дрейф — эффект "реки"
            const drift = (Math.random() < 0.5 ? 1 : -1) * (120 + Math.random() * 200);
            p.className = 'vn-particle vn-particle-ghost-stream';
            p.style.cssText = `width:${w}px;height:${h}px;` +
                `left:${-10 + R(120)}%;top:${18 + R(66)}%;` +
                `animation-delay:${delay}s;animation-duration:${dur}s;` +
                `--drift:${drift}px;--drift-y:${RD(80)}px;opacity:0`;
        } else {
            // Блуждающий огонёк: маленький яркий шар
            const s = 6 + Math.random() * 16;
            const dur = 14 + Math.random() * 20;
            const delay = Math.random() < 0.45 ? -(Math.random() * dur * 0.75) : R(7);
            p.className = 'vn-particle vn-particle-ghost-wisp';
            p.style.cssText = `width:${s}px;height:${s * (0.9 + Math.random() * 0.4)}px;` +
                `left:${R(105)}%;top:${5 + R(88)}%;` +
                `animation-delay:${delay}s;animation-duration:${dur}s;` +
                `--drift:${RD(240)}px;--drift-y:${RD(200)}px;opacity:0`;
        }

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

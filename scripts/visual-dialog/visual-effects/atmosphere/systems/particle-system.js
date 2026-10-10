// ============================================================
// systems/particle-system.js — Создание и управление частицами
// ============================================================

import { R, RD } from '../utils.js';
import { PARTICLE_CONFIGS } from '../config/particles.js';

/**
 * Раскладывает создаваемые элементы по двум контейнерам: основному (под
 * персонажами) и, если он передан, верхнему (над персонажами) — случайно 50/50.
 */
class ParticleSink {
    constructor(back, front = null) {
        this.back = back;
        this.front = front;
        this._backFrag = document.createDocumentFragment();
        this._frontFrag = front ? document.createDocumentFragment() : null;
    }

    get split() { return !!this.front; }

    add(el) {
        (this._frontFrag && Math.random() < 0.5 ? this._frontFrag : this._backFrag).appendChild(el);
    }

    addBack(el) { this._backFrag.appendChild(el); }

    addFront(el) { this._frontFrag?.appendChild(el); }

    flush() {
        this.back.appendChild(this._backFrag);
        this.front?.appendChild(this._frontFrag);
    }
}

export class ParticleSystem {
    constructor() {
        this._container = null;
        this._upperContainer = null;
        this._type = 'none';
    }

    /**
     * Заполнить контейнер частицами указанного типа
     * @param {HTMLElement} container — элемент .vn-particles
     * @param {string} particleType — ключ из PARTICLE_CONFIGS, опционально с
     *   суффиксом варианта через ":" (например "feathers:black") — см.
     *   PARTICLE_VARIANTS в config/particle-types.js
     * @param {number} intensity — множитель количества частиц (1 = базовое, 1–20)
     * @param {HTMLElement|null} upperContainer — элемент .vn-particles-upper; если
     *   передан, часть частиц (случайно) создаётся в нём, а не в основном контейнере
     */
    fill(container, particleType, intensity = 1, upperContainer = null) {
        this._container = container;
        this._upperContainer = upperContainer;
        this._type = particleType;

        container.innerHTML = '';
        if (upperContainer) upperContainer.innerHTML = '';
        if (particleType === 'none') return;

        const [type, variant] = particleType.split(':');
        const safeIntensity = Math.min(Math.max(intensity, 1), 20);
        const sink = new ParticleSink(container, upperContainer);

        // Призраки — особая структура: souls + vapor, offset-path анимация
        if (type === 'ghosts') {
            this._fillGhosts(sink, safeIntensity);
            return;
        }

        // Специальные фабрики для нестандартных частиц
        const factory = this._getSpecialFactory(type);
        if (factory) {
            this._fillWithFactory(sink, factory, safeIntensity);
            return;
        }

        // Стандартная генерация
        const config = PARTICLE_CONFIGS[type];
        if (!config) return;

        const variantImages = variant && config.variants?.[variant]?.images;
        const resolvedConfig = variantImages ? { ...config, images: variantImages } : config;

        this._fillFromConfig(sink, resolvedConfig, safeIntensity);
    }

    /**
     * Очистить контейнеры
     */
    clear() {
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

    _fillFromConfig(sink, config, intensity = 1) {
        const { className, count, sizeMin, sizeRange, style, images } = config;
        const actualCount = Math.round(count * intensity);

        for (let i = 0; i < actualCount; i++) {
            const p = document.createElement('span');
            p.className = className;
            const size = sizeMin + Math.random() * sizeRange;
            let css = style(size);
            if (images?.length) css += `;${this._imageOverrideCss(images)}`;
            p.style.cssText = css;
            sink.add(p);
        }

        sink.flush();
    }

    /**
     * Заменяет CSS-нарисованную форму частицы (градиент/border-radius/
     * clip-path) на растровую картинку. Если images содержит несколько
     * путей, для каждой частицы случайно выбирается одна из них.
     */
    _imageOverrideCss(images) {
        const img = images[Math.floor(Math.random() * images.length)];
        return `background:url('${img}') center/contain no-repeat;`
            + `border:none;border-radius:0;box-shadow:none;clip-path:none;filter:none`;
    }

    _fillWithFactory(sink, factory, intensity = 1) {
        const config = PARTICLE_CONFIGS[factory.type];
        const baseCount = config?.count || 80;
        const count = Math.round(baseCount * intensity);

        for (let i = 0; i < count; i++) {
            sink.add(factory.create());
        }

        sink.flush();
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

    _fillGhosts(sink, intensity) {
        const ghostConfig = PARTICLE_CONFIGS.ghosts;
        const baseSouls = ghostConfig?.count || 42;
        const soulCount = Math.min(Math.round(baseSouls * intensity), 84);
        const images = ghostConfig?.images;

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
        sink.addBack(mist);

        // Обёртка для правильной работы :nth-child на душах
        const soulsEl = document.createElement('div');
        soulsEl.className = 'vn-particle-ghost-souls';
        const soulsFrontEl = sink.split ? soulsEl.cloneNode() : null;

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
            if (images?.length) {
                // Картинка призрака нарисована "головой вверх", а offset-rotate:auto
                // выравнивает бокс по касательной пути (почти горизонтальной) —
                // разворачиваем на 90° заранее, чтобы голова смотрела по направлению полёта.
                head.style.cssText = `width:48px;height:78px;transform-origin:50% 50%;`
                    + `transform:rotate(90deg) scale(var(--size));${this._imageOverrideCss(images)}`;
            }
            soul.appendChild(head);

            (soulsFrontEl && Math.random() < 0.5 ? soulsFrontEl : soulsEl).appendChild(soul);
        }

        sink.addBack(soulsEl);
        if (soulsFrontEl) sink.addFront(soulsFrontEl);
        sink.flush();
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
        const images = PARTICLE_CONFIGS.confetti?.images;

        if (isStreamer) {
            const w = 1.5 + Math.random() * 2;
            const h = 10  + Math.random() * 20;
            p.className = 'vn-particle vn-particle-confetti vn-particle-streamer';
            p.style.cssText = `width:${w}px;height:${h}px;left:${R(100)}%;top:-5%;` +
                `animation-delay:${R(20)}s;animation-duration:${5 + R(7)}s;` +
                `--drift:${RD(140)}px;--rotation:${RD(300)}deg;opacity:0`;
        } else {
            const s = 8 + Math.random() * 6;
            p.className = 'vn-particle vn-particle-confetti';
            let css = `width:${s}px;height:${s}px;left:${R(100)}%;top:-5%;` +
                `animation-delay:${R(20)}s;animation-duration:${5 + R(9)}s;` +
                `--drift:${RD(100)}px;--rotation:${R(720) - 360}deg;opacity:0`;
            if (images?.length) css += `;${this._imageOverrideCss(images)}`;
            p.style.cssText = css;
        }

        return p;
    }

}

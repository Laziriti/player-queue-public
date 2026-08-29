// ============================================================
// systems/parallax.js — Параллакс-эффект и медленный zoom
// ============================================================

export class ParallaxSystem {
    // Дефолтные настройки
    static DEFAULT_SHIFT = 12;      // Максимальное смещение (px) при depth=50
    static BASE_SCALE = 1.03;       // Базовый масштаб
    static MAX_ZOOM_EXTRA = 0.05;   // Дополнительный zoom за время
    static ZOOM_DURATION = 120;     // Время полного zoom (секунды)
    static LERP_FACTOR = 0.03;      // Плавность следования за мышью
    static KB_SPEED = 0.0000006;    // Скорость дрейфа Ken Burns за тик
    static KB_MAX = 0.25;           // Макс. смещение KB (доля maxShift)

    constructor() {
        this._overlayEl = null;
        this._bgLayer = null;
        this._mouseX = 0.5;
        this._mouseY = 0.5;
        this._currentX = 0.5;
        this._currentY = 0.5;
        this._zoomStart = 0;
        this._active = false;
        this._rafId = null;
        this._boundMouseMove = null;
        this._enabled = true;
        this._maxShift = ParallaxSystem.DEFAULT_SHIFT;

        // Camera system
        this._camera = null;

        // Ken Burns drift
        this._kbEnabled = false;
        this._kbDirectionX = 0;
        this._kbDirectionY = 0;
        this._kbOffsetX = 0;
        this._kbOffsetY = 0;
    }

    /**
     * Подключить камеру (вызывается из VNAtmosphere)
     */
    setCameraSystem(camera) {
        this._camera = camera;
    }

    /**
     * Обновить параметры на лету (вызывается из onChange настроек)
     * @param {{ enabled?: boolean, depth?: number, kenBurns?: { enabled: boolean, direction: string } }} options
     */
    setOptions({ enabled, depth, kenBurns } = {}) {
        if (enabled !== undefined) this._enabled = enabled;
        if (depth !== undefined) this._maxShift = depth * 0.24; // 50→12px, 100→24px
        if (kenBurns !== undefined) {
            this._kbEnabled = kenBurns.enabled;
            if (!kenBurns.enabled || kenBurns.direction === 'none') {
                this._kbDirectionX = 0;
                this._kbDirectionY = 0;
            } else if (kenBurns.direction === 'random') {
                this._kbDirectionX = Math.random() > 0.5 ? 1 : -1;
                this._kbDirectionY = (Math.random() - 0.5) * 0.6;
            } else if (kenBurns.direction === 'left') {
                this._kbDirectionX = -1;
                this._kbDirectionY = 0.15;
            } else if (kenBurns.direction === 'right') {
                this._kbDirectionX = 1;
                this._kbDirectionY = -0.15;
            }
            this._kbOffsetX = 0;
            this._kbOffsetY = 0;
        }
    }

    /**
     * Запустить параллакс для overlay
     * @param {HTMLElement} overlayEl — корневой overlay-элемент
     * @param {{ enabled?: boolean, depth?: number }} options
     */
    start(overlayEl, options = {}) {
        this.setOptions(options);
        this._overlayEl = overlayEl;
        this._bgLayer = overlayEl.querySelector('.vn-bg-layer');
        if (!this._bgLayer) return;

        this._active = true;
        this._zoomStart = Date.now();
        this._isAnimated = this._checkAnimatedBg();
        this._lastTransform = '';

        this._boundMouseMove = (e) => {
            this._mouseX = e.clientX / window.innerWidth;
            this._mouseY = e.clientY / window.innerHeight;
        };
        document.addEventListener('mousemove', this._boundMouseMove, { passive: true });

        this._tick();
    }

    /**
     * Остановить параллакс
     */
    stop() {
        this._active = false;

        if (this._boundMouseMove) {
            document.removeEventListener('mousemove', this._boundMouseMove);
            this._boundMouseMove = null;
        }

        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        this._overlayEl = null;
        this._bgLayer = null;
    }

    /**
     * Сбросить zoom (начать заново)
     */
    resetZoom() {
        this._zoomStart = Date.now();
        this._isAnimated = this._checkAnimatedBg();
        this._kbOffsetX = 0;
        this._kbOffsetY = 0;
    }

    /**
     * Активен ли параллакс
     */
    get active() {
        return this._active;
    }

    // ─── Private ─────────────────────────────────────────────

    _checkAnimatedBg() {
        if (!this._bgLayer) return false;
        if (this._bgLayer.querySelector('.vn-bg-video')) return true;
        const bgUrl = this._bgLayer.style.backgroundImage || '';
        return /\.gif(\?|"|$)/i.test(bgUrl);
    }

    _tick() {
        if (!this._active) return;

        if (!this._bgLayer?.parentNode) {
            this._bgLayer = this._overlayEl?.querySelector('.vn-bg-layer:not([class*="vn-bg-transition"])');
            if (!this._bgLayer) {
                this._rafId = requestAnimationFrame(() => this._tick());
                return;
            }
            this._isAnimated = this._checkAnimatedBg();
        }

        if (this._isAnimated || !this._enabled) {
            this._currentX = 0.5;
            this._currentY = 0.5;
            if (this._lastTransform !== '') {
                this._bgLayer.style.transform = '';
                this._lastTransform = '';
            }
        } else {
            const elapsed = (Date.now() - this._zoomStart) / 1000;
            const zoomProgress = Math.min(elapsed / ParallaxSystem.ZOOM_DURATION, 1);
            const scale = ParallaxSystem.BASE_SCALE + zoomProgress * ParallaxSystem.MAX_ZOOM_EXTRA;

            const diffX = this._mouseX - this._currentX;
            const diffY = this._mouseY - this._currentY;
            if (Math.abs(diffX) > 0.0005 || Math.abs(diffY) > 0.0005) {
                this._currentX += diffX * ParallaxSystem.LERP_FACTOR;
                this._currentY += diffY * ParallaxSystem.LERP_FACTOR;
            }

            // Ken Burns drift
            if (this._kbEnabled && this._kbDirectionX) {
                const kbMax = this._maxShift * ParallaxSystem.KB_MAX;
                this._kbOffsetX += this._kbDirectionX * ParallaxSystem.KB_SPEED * this._maxShift;
                this._kbOffsetY += this._kbDirectionY * ParallaxSystem.KB_SPEED * this._maxShift;
                this._kbOffsetX = Math.max(-kbMax, Math.min(kbMax, this._kbOffsetX));
                this._kbOffsetY = Math.max(-kbMax, Math.min(kbMax, this._kbOffsetY));
            }

            // Camera system
            this._camera?.tick();
            const cam = this._camera?.getOffset() ?? { dx: 0, dy: 0, scale: 1.0 };

            const dx = (this._currentX - 0.5) * this._maxShift + cam.dx + this._kbOffsetX;
            const dy = (this._currentY - 0.5) * this._maxShift + cam.dy + this._kbOffsetY;
            const finalScale = scale * cam.scale;
            const t = `translate3d(${-dx.toFixed(2)}px,${-dy.toFixed(2)}px,0) scale(${finalScale.toFixed(4)})`;
            if (t !== this._lastTransform) {
                this._bgLayer.style.transform = t;
                this._lastTransform = t;
            }
        }

        this._rafId = requestAnimationFrame(() => this._tick());
    }
}

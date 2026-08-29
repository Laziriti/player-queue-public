// ============================================================
// systems/camera.js — Виртуальная камера (zoom к спикеру)
// ============================================================

export class VNCameraSystem {
    static LERP_FACTOR = 0.018;
    static MAX_SHIFT = 8;
    static SPEAKER_SCALE_BONUS = 0.015;

    constructor() {
        this._enabled = false;
        this._targetDx = 0;
        this._targetDy = 0;
        this._targetScale = 1.0;
        this._currentDx = 0;
        this._currentDy = 0;
        this._currentScale = 1.0;
    }

    setEnabled(enabled) {
        this._enabled = !!enabled;
        if (!this._enabled) this.reset();
    }

    onSpeakerChange(charEl) {
        if (!this._enabled) return;
        if (!charEl) {
            this._targetDx = 0;
            this._targetDy = 0;
            this._targetScale = 1.0;
            return;
        }
        const rect = charEl.getBoundingClientRect();
        const charCenterX = rect.left + rect.width / 2;
        const charCenterY = rect.top + rect.height * 0.3;
        const normalizedX = (charCenterX - window.innerWidth / 2) / (window.innerWidth / 2);
        const normalizedY = (charCenterY - window.innerHeight / 2) / (window.innerHeight / 2);

        this._targetDx = normalizedX * VNCameraSystem.MAX_SHIFT;
        this._targetDy = normalizedY * VNCameraSystem.MAX_SHIFT * 0.4;
        this._targetScale = 1.0 + VNCameraSystem.SPEAKER_SCALE_BONUS;
    }

    tick() {
        if (!this._enabled) return;
        const f = VNCameraSystem.LERP_FACTOR;
        this._currentDx += (this._targetDx - this._currentDx) * f;
        this._currentDy += (this._targetDy - this._currentDy) * f;
        this._currentScale += (this._targetScale - this._currentScale) * f;
    }

    getOffset() {
        if (!this._enabled) return { dx: 0, dy: 0, scale: 1.0 };
        return { dx: this._currentDx, dy: this._currentDy, scale: this._currentScale };
    }

    reset() {
        this._targetDx = 0;
        this._targetDy = 0;
        this._targetScale = 1.0;
        this._currentDx = 0;
        this._currentDy = 0;
        this._currentScale = 1.0;
    }
}

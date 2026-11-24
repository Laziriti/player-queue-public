import { resolveVisualAngle } from '../scene/vn-scene-contract.js';
import { resolveVisualStyleEffect } from './atmosphere/config/visual-types.js';
import { readSourcePaint } from './atmosphere/systems/effects/scene-layers/scene-layer-material.js';
export { resolveVisualAngle } from '../scene/vn-scene-contract.js';

// Source coordinates in the original composition. All effects share the same perimeter geometry.
const LIGHT_SOURCES = {
    dawn: [25, 90], sunset: [96, 60], moonlight: [70, 10], windowlight: [6, 2],
    divine: [50, -10], 'divine:cathedral': [22, 0], 'sacred:lunar': [78, 7],
};
const lightSource = effect => {
    const key = resolveVisualStyleEffect(String(effect || '')).replace(/:all$/, '');
    return Object.hasOwn(LIGHT_SOURCES, key) ? LIGHT_SOURCES[key] : undefined;
};
export function supportsVisualAngle(effect) { return !!lightSource(effect); }

/** Move around an inset rectangle, then aim the original light towards the centre from its new side. */
export function placeLightSource(source, angle) {
    const rad = angle * Math.PI / 180;
    const dx = source[0] - 50, dy = source[1] - 50;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    const k = Math.max(Math.abs(dx), Math.abs(dy)) / (Math.max(Math.abs(rx), Math.abs(ry)) || 1);
    const x = 50 + rx * k, y = 50 + ry * k;
    return { x, y, turn: angle, c: Math.cos(rad), s: Math.sin(rad) };
}

export function visualAngleControl(value, effect) {
    const angle = resolveVisualAngle(value);
    return `<div class="vn-visual-angle-control" title="${game.i18n.localize('vn.atmosphere.visualAngleHint')}"${supportsVisualAngle(effect) ? '' : ' hidden'}>
        <label><i class="fas fa-compass"></i><span>${game.i18n.localize('vn.atmosphere.visualAngle')}</span>
            <input class="vn-visual-angle" type="range" min="0" max="360" step="1" value="${angle}">
            <output class="vn-visual-angle-value">${angle}°</output></label>
        <button type="button" class="vn-visual-angle-reset" title="${game.i18n.localize('vn.atmosphere.visualAngleReset')}" aria-label="${game.i18n.localize('vn.atmosphere.visualAngleReset')}"><i class="fas fa-rotate-left"></i></button>
    </div>`;
}

// Place sources along the screen edges and orient their light towards the frame.
// This keeps coverage at every angle without allocating enlarged, rotated full-screen textures.
export class VNLightAngle {
    _entries = [];

    set(overlay, effect, angle) {
        if (this._overlay !== overlay || this._effect !== effect) {
            this.destroy();
            this._overlay = overlay;
            this._effect = effect;
        }
        this._angle = resolveVisualAngle(angle) % 360;
        this._source = lightSource(effect);
        const [styleType] = resolveVisualStyleEffect(effect).split(':');
        if (!overlay || !supportsVisualAngle(effect) || !this._angle) {
            this._clear();
            return;
        }
        if (!this._entries.length) {
            readSourcePaint(overlay, () => {
                for (const el of overlay.querySelectorAll('.vn-fx-tint, .vn-fx-rays, .vn-fx-edges, .vn-ambient-light, .vn-vignette, .vn-fx-bloom')) {
                    const cs = getComputedStyle(el);
                    const props = ['--vn-fx-angled-background', 'mask-image', '-webkit-mask-image', 'transform-origin', '--vn-window-transform'];
                    const entry = { el, original: props.map(p => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]),
                        background: cs.backgroundImage, mask: cs.maskImage,
                        conic: styleType === 'divine' && /conic-gradient/.test(cs.backgroundImage) };
                    if (styleType === 'windowlight' && el.classList.contains('vn-fx-rays')) {
                        entry.window = {};
                    }
                    this._entries.push(entry);
                }
            });
            this._resize = new ResizeObserver(() => this._apply());
            this._resize.observe(overlay);
        }
        this._apply();
    }

    _gradient(source, w, h, placement) {
        const { c, s, turn } = placement;
        const directions = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
        return source.replace(/at\s+(-?[\d.]+)%\s+(-?[\d.]+)%/g, (_, x, y) => {
            const dx = Number(x) - this._source[0], dy = Number(y) - this._source[1];
            return `at ${(placement.x + dx * c - dy * h / w * s).toFixed(4)}% ${(placement.y + dx * w / h * s + dy * c).toFixed(4)}%`;
        }).replace(/(conic-gradient\(from\s+)(-?[\d.]+)deg/g, (_, prefix, degrees) => {
            return `${prefix}${Number(degrees) + turn}deg`;
        }).replace(/conic-gradient\((?=at\s)/g, `conic-gradient(from ${turn}deg `)
        .replace(/((?:repeating-)?linear-gradient\()([^,]+),/g, (match, prefix, direction) => {
            const text = direction.trim();
            const degrees = text in directions ? directions[text] : /^-?[\d.]+deg$/.test(text) ? parseFloat(text) : null;
            return degrees === null ? match : `${prefix}${degrees + turn}deg,`;
        });
    }

    _apply() {
        if (!this._overlay?.isConnected) return;
        for (const entry of this._entries) {
            const { el, background, mask } = entry;
            const w = el.offsetWidth, h = el.offsetHeight;
            if (!w || !h) continue;
            const placement = placeLightSource(this._source, this._angle);
            if (background !== 'none') {
                el.style.setProperty('--vn-fx-angled-background', this._gradient(background, w, h, placement));
                el.classList.add('vn-fx-angle-paint');
            }
            if (entry.conic) el.style.transformOrigin = `${placement.x}% ${placement.y}%`;
            if (mask && mask !== 'none') {
                const turned = this._gradient(mask, w, h, placement);
                el.style.setProperty('mask-image', turned, 'important');
                el.style.setProperty('-webkit-mask-image', turned, 'important');
            }
            if (entry.window) {
                if (!entry.window.matrix) {
                    const sheet = getComputedStyle(el.querySelector(':scope > .vn-fx-before'));
                    entry.window.matrix = new DOMMatrix(sheet.transform);
                    entry.window.x = parseFloat(sheet.left) / w;
                    entry.window.y = parseFloat(sheet.top) / h;
                }
                const x = w * (this._source[0] / 100 - entry.window.x), y = h * (this._source[1] / 100 - entry.window.y);
                const tx = w * (placement.x / 100 - entry.window.x), ty = h * (placement.y / 100 - entry.window.y);
                const matrix = new DOMMatrix().translate(tx, ty).rotate(placement.turn).translate(-x, -y).multiply(entry.window.matrix);
                el.style.setProperty('--vn-window-transform', matrix.toString());
            }
        }
    }

    _clear() {
        this._resize?.disconnect();
        this._resize = null;
        for (const { el, original } of this._entries) {
            el.classList.remove('vn-fx-angle-paint');
            for (const [key, value, priority] of original) {
                if (value) el.style.setProperty(key, value, priority);
                else el.style.removeProperty(key);
            }
        }
        this._entries = [];
    }

    destroy() { this._clear(); this._overlay = null; this._effect = null; }
}

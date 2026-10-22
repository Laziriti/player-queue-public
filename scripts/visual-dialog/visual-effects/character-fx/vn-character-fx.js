// ============================================================
// vn-character-fx.js — эффекты самого портрета персонажа (голограмма, тень…)
// Не связан с атмосферой сцены (частицы / visual FX): отдельное поле состояния, отдельный CSS.
// ============================================================

import { escapeHtml } from '../../vn-id-utils.js';

export const CHAR_FX =['none', 'hologram', 'shadow', 'ghost', 'glitch'];
export const CHAR_FX_ICONS = {
    none: 'fa-wand-magic-sparkles',
    hologram: 'fa-cube',
    shadow: 'fa-moon',
    ghost: 'fa-ghost',
    glitch: 'fa-bolt',
};

const CLASS = 'vn-character-fx';

/** Absolute CSS url() for a mask/background copy of the portrait (a relative path would resolve against the stylesheet). */
function cssUrl(src) {
    let abs = String(src ?? '');
    try { abs = new URL(abs, document.baseURI).href; } catch { /* keep as is */ }
    return `url("${abs.replace(/["\\\r\n]/g, encodeURIComponent)}")`;
}

export class VNCharFx {
    /** Keeps only known effects; 'none' is never stored (sparse map, like visibility). */
    static normalize(map) {
        const out = {};
        if (!map || typeof map !== 'object') return out;
        for (const [tokenId, fx] of Object.entries(map)) {
            if (fx !== 'none' && CHAR_FX.includes(fx)) out[tokenId] = fx;
        }
        return out;
    }

    /**
     * The portrait is wrapped in a layer that carries the effect. The portrait itself already owns `filter`,
     * `animation`, `translate` and `opacity` (speaker dimming, breathing, entrances), so the effect lives one level up
     * and composes with them instead of fighting over the same properties.
     */
    static wrapHTML(imgHTML, fx, src) {
        if (!fx) return imgHTML;
        return `<div class="${CLASS}" data-fx="${fx}" style="${escapeHtml(`--fx-src: ${cssUrl(src)}`)}">${imgHTML}</div>`;
    }

    /** Sets (or clears) the effect on a live `.vn-character`. The layer is created on demand and kept once created. */
    static apply(charEl, fx) {
        let layer = charEl.querySelector(`:scope > .${CLASS}`);
        if (!fx) {
            layer?.removeAttribute('data-fx');
            return;
        }
        const img = layer?.querySelector('.vn-character-img') ?? charEl.querySelector(':scope > .vn-character-img');
        if (!img) return;
        if (!layer) {
            layer = document.createElement('div');
            layer.className = CLASS;
            img.before(layer);
            layer.append(img);
        }
        layer.style.setProperty('--fx-src', cssUrl(img.src));
        if (layer.dataset.fx !== fx) layer.dataset.fx = fx;
    }
}

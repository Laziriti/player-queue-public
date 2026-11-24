import { CHAR_FX, normalizeCharFx } from './config.js';
import { applyPortraitEffect, clearPortraitEffect, ensurePortraitLayer } from './portrait-effects.js';
import { isFxDisabled } from '../fx-performance.js';

export { CHAR_FX_GROUPS, CHAR_FX_VARIANTS, CHAR_FX, charFxBase, charFxLabelKey, CHAR_FX_ICONS } from './config.js';

const CLASS = 'vn-character-fx';
const enabled = fx => fx !== 'none' && CHAR_FX.includes(fx) && !isFxDisabled('charfx', fx);

export class VNCharFx {
    static normalize(map) { return normalizeCharFx(map); }

    static wrapHTML(imgHTML) {
        return `<div class="${CLASS}">${imgHTML}</div>`;
    }

    /** Keep the original image in the layout and use it as the plain portrait fallback. */
    static apply(charEl, fx) {
        let layer = charEl.querySelector(`:scope > .${CLASS}`);
        if (!enabled(fx)) {
            if (layer) {
                clearPortraitEffect(layer);
                delete layer.dataset.fx;
                delete layer.dataset.fxVariant;
            }
            return;
        }
        layer ??= ensurePortraitLayer(charEl);
        const img = layer?.querySelector(':scope > img.vn-character-img');
        if (!img) return;
        const [base, variant] = fx.split(':');
        layer.dataset.fx = base;
        if (variant) layer.dataset.fxVariant = variant;
        else delete layer.dataset.fxVariant;
        applyPortraitEffect(layer, img, base, variant);
    }
}

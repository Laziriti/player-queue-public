import { escapeHtml } from '../../../utils/text.js';
import { resolveActorImg } from '../../scene/vn-id-utils.js';

// Renders the actor-avatar "pips" row (+N more) shown on poster-style preset cards.
// Emits the canonical .vn-preset-card-pip* classes — shared by the Presets and Adventure IO
// tabs' card views, which both mount inside a .vn-preset-card-poster container.
export function buildActorPipsHtml(ids, portraitImages = {}, portraitNames = {}, maxVisible = 4) {
    if (!ids.length) return '';
    const pips = ids.slice(0, maxVisible).map(id => {
        const src = escapeHtml(resolveActorImg(id, portraitImages));
        const name = escapeHtml(portraitNames[id] || '');
        return `<img class="vn-preset-card-pip" src="${src}" loading="lazy" decoding="async" alt="${name}" title="${name}" draggable="false">`;
    }).join('');
    const more = ids.length > maxVisible
        ? `<span class="vn-preset-card-pip vn-preset-card-pip--more">+${ids.length - maxVisible}</span>`
        : '';
    return `<div class="vn-preset-card-pips">${pips}${more}</div>`;
}

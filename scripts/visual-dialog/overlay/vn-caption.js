// Shared caption appearance: sparse preset/step options, safe values and DOM application.
import { NAMEPLATE_FONTS, nameplateFontFamily } from './vn-nameplate.js';
import { isRecord, isString } from '../../utils/validation.js';

export const CAPTION_FONTS = NAMEPLATE_FONTS;
export const CAPTION_BOXES = ['dark', 'glass', 'parchment', 'frame', 'none'];
export const CAPTION_POSITIONS = ['bottom', 'top'];
export const DEFAULT_CAPTION_STYLE = { font: 'default', color: 'auto', box: 'dark', position: 'bottom' };
const checks = {
    font: v => v === 'default' || Object.hasOwn(CAPTION_FONTS, v),
    color: v => v === 'auto' || /^#[0-9a-f]{6}$/i.test(v),
    box: v => CAPTION_BOXES.includes(v),
    position: v => CAPTION_POSITIONS.includes(v),
};

export function isCaptionStyle(value) {
    return isRecord(value)
        && Object.entries(value).every(([key, v]) => isString(v) && Object.hasOwn(checks, key) && checks[key](v));
}

export function normalizeCaptionStyle(value) {
    return isCaptionStyle(value) ? { ...value } : {};
}

/** Missing step properties follow the preset, never the previous step. */
export function resolveCaptionStyle(base, override) {
    return { ...DEFAULT_CAPTION_STYLE, ...normalizeCaptionStyle(base), ...normalizeCaptionStyle(override) };
}

export function captionColor(style) {
    return style.color === 'auto' ? (style.box === 'parchment' ? '#3d2b1f' : '#f2f4f8') : style.color;
}

export function applyCaptionStyle(element, value) {
    const style = resolveCaptionStyle(value);
    element.dataset.captionBox = style.box;
    element.dataset.captionPosition = style.position;
    element.style.setProperty('--vn-caption-color', captionColor(style));
    const font = CAPTION_FONTS[style.font];
    element.style.setProperty('--vn-caption-font', nameplateFontFamily(style.font) || 'inherit');
    element.style.setProperty('--vn-caption-weight', font?.weight ?? 'inherit');
}

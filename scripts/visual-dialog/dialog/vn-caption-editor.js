// Caption controls used by both sequence defaults and each step's sparse overrides.
import { CAPTION_FONTS, CAPTION_BOXES, CAPTION_POSITIONS, normalizeCaptionStyle, resolveCaptionStyle, captionColor, applyCaptionStyle } from '../overlay/vn-caption.js';
import { escapeHtml } from '../../utils/text.js';

const loc = key => game.i18n.localize(`vn.captionStyle.${key}`);

export function captionStyleHtml(style = {}, base = null, text = '') {
    style = normalizeCaptionStyle(style);
    const step = base !== null;
    const effective = resolveCaptionStyle(base, style);
    const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const inherit = current => step ? option('', loc('inherit'), current) : '';
    const font = style.font ?? (step ? '' : 'default');
    const box = style.box ?? (step ? '' : 'dark');
    const position = style.position ?? (step ? '' : 'bottom');
    const customColor = style.color != null && style.color !== 'auto';
    return `<details class="vn-caption-editor" data-caption-scope="${step ? 'step' : 'sequence'}"${step ? '' : ' open'}>
        <summary>${loc('title')}</summary>
        <div class="vn-caption-editor-fields">
            <label class="vn-seqed-field">
                <span>${loc('box')}</span>
                <select data-caption-key="box">${inherit(box)}${CAPTION_BOXES.map(v => option(v, loc(`boxes.${v}`), box)).join('')}</select>
            </label>
            <label class="vn-seqed-field">
                <span>${loc('font')}</span>
                <select data-caption-key="font">${inherit(font)}${option('default', loc('defaultFont'), font)}${Object.entries(CAPTION_FONTS).map(([v, cfg]) => option(v, cfg.label, font)).join('')}</select>
            </label>
            <label class="vn-seqed-field vn-caption-editor-position">
                <span>${loc('position')}</span>
                <select data-caption-key="position">${inherit(position)}${CAPTION_POSITIONS.map(v => option(v, loc(`positions.${v}`), position)).join('')}</select>
            </label>
            <div class="vn-caption-editor-color">
                <label class="vn-seqed-check"><input type="checkbox" data-caption-key="customColor"${customColor ? ' checked' : ''}> ${loc('customColor')}</label>
                <input type="color" data-caption-key="color" value="${captionColor(effective)}" aria-label="${loc('color')}"${customColor ? '' : ' disabled'}>
            </div>
            <p class="vn-seqed-hint">${loc(step ? 'stepHint' : 'presetHint')}</p>
            <div class="vn-caption-text vn-caption-preview">${escapeHtml(text || loc('preview'))}</div>
        </div>
    </details>`;
}

export function refreshCaptionPreviews(panel, preset) {
    for (const editor of panel.querySelectorAll('[data-caption-scope]')) {
        const stepId = editor.closest('.vn-seqed-step')?.dataset.stepId;
        const step = stepId ? preset.steps?.find(s => s.id === stepId) : null;
        const style = step ? resolveCaptionStyle(preset.captionStyle, step.captionStyle) : resolveCaptionStyle(preset.captionStyle);
        const preview = editor.querySelector('.vn-caption-preview');
        applyCaptionStyle(preview, style);
        preview.textContent = step?.caption || loc('preview');
        const color = editor.querySelector('[data-caption-key="color"]');
        color.value = captionColor(style);
        color.disabled = !editor.querySelector('[data-caption-key="customColor"]').checked;
    }
}

/** Build a sparse style from the controls; empty step choices restore inheritance. */
export function readCaptionControls(editor) {
    const style = {};
    for (const key of ['box', 'font', 'position']) {
        const value = editor.querySelector(`[data-caption-key="${key}"]`).value;
        if (value) style[key] = value;
    }
    if (editor.querySelector('[data-caption-key="customColor"]').checked) {
        style.color = editor.querySelector('[data-caption-key="color"]').value;
    }
    return style;
}

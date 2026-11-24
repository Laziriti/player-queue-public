import { VISUAL_SETTINGS_DEFAULTS, resolveVisualAngle } from '../scene/vn-scene-contract.js';
import { visualAngleControl, supportsVisualAngle } from '../visual-effects/vn-light-angle.js';
import { VISUAL_EFFECT_SETTINGS } from '../visual-effects/atmosphere/config/visual-effect-settings.js';
import { escapeHtml } from '../../utils/text.js';

function renderEffectControl(key, definition, state, loc) {
    const { effect, control, initial, label, icon, choices } = definition;
    const value = escapeHtml(state[key] ?? initial);
    const attributes = `data-visual-setting="${key}"`;
    const row = `data-visual-effect="${effect}"${effect === state.visualEffect ? '' : ' hidden'}`;
    if (control === 'select') {
        const options = Object.entries(choices).map(([id, choice]) =>
            `<option value="${id}"${id === value ? ' selected' : ''}>${escapeHtml(loc(choice))}</option>`).join('');
        return `<label class="vn-effect-option vn-visual-effect-control" ${row}>
            <span><i class="fas ${icon}" aria-hidden="true"></i> ${loc(label)}</span>
            <select ${attributes}>${options}</select>
        </label>`;
    }
    const field = control === 'color'
        ? `<input type="color" value="${value}" ${attributes}>`
        : `<input type="range" min="0" max="100" step="1" value="${value}" ${attributes}><output>${value}%</output>`;
    return `<label class="vn-visual-strength vn-visual-effect-control" ${row}>
        <i class="fas ${icon}" aria-hidden="true"></i><span>${loc(label)}</span>${field}
    </label>`;
}

function hasSpecificVisualSettings(effect) {
    return supportsVisualAngle(effect) || Object.values(VISUAL_EFFECT_SETTINGS).some(definition => definition.effect === effect);
}

export function renderVisualSettings(state = {}, { scope = 'editor' } = {}) {
    const loc = key => game.i18n.localize(key);
    const scopeId = String(scope).replace(/[^\w-]/g, '');
    const generalId = `vn-visual-settings-${scopeId}-general`;
    const effectId = `vn-visual-settings-${scopeId}-effect`;
    const generalPanelId = `${generalId}-panel`;
    const effectPanelId = `${effectId}-panel`;
    const strength = state.visualLayerStrength ?? VISUAL_SETTINGS_DEFAULTS.visualLayerStrength;
    const tintStrength = state.visualTintStrength ?? VISUAL_SETTINGS_DEFAULTS.visualTintStrength;
    const tintColor = state.visualTintColor ?? VISUAL_SETTINGS_DEFAULTS.visualTintColor;
    return `<div class="vn-visual-settings vn-fxset-body">
        <div class="vn-visual-settings-switch" role="group" aria-label="${loc('vn.bg.visualSettings')}">
            <input type="radio" name="vn-visual-settings-scope-${scopeId}" id="${generalId}" value="general" aria-controls="${generalPanelId}" checked>
            <label for="${generalId}">${loc('vn.atmosphere.visualSettingsScope.general')}</label>
            <input type="radio" name="vn-visual-settings-scope-${scopeId}" id="${effectId}" value="effect" aria-controls="${effectPanelId}"${hasSpecificVisualSettings(state.visualEffect) ? '' : ' disabled'}>
            <label for="${effectId}">${loc('vn.atmosphere.visualSettingsScope.effect')}</label>
            <span class="vn-visual-settings-thumb" aria-hidden="true"></span>
        </div>
        <div class="vn-visual-settings-page vn-visual-settings-general" id="${generalPanelId}" data-visual-scope="general">
            <label class="vn-visual-strength" title="${loc('vn.bg.visualLayerStrengthHint')}">
                <i class="fas fa-layer-group" aria-hidden="true"></i><span>${loc('vn.bg.visualLayerStrength')}</span>
                <input class="vn-visual-layer-strength" data-visual-setting="visualLayerStrength" type="range" min="0" max="100" step="1" value="${strength}">
                <output>${strength}%</output>
            </label>
            <div class="vn-effect-tint">
                <label class="vn-visual-strength">
                    <i class="fas fa-palette" aria-hidden="true"></i><span>${loc('vn.bg.visualTintStrength')}</span>
                    <input class="vn-visual-tint-strength" data-visual-setting="visualTintStrength" type="range" min="0" max="100" step="1" value="${tintStrength}">
                    <output>${tintStrength}%</output>
                </label>
                <input class="vn-visual-tint-color" data-visual-setting="visualTintColor" type="color" value="${tintColor}"
                    aria-label="${loc('vn.bg.tintColor')}" title="${loc('vn.bg.tintColor')}">
            </div>
            <label class="vn-overlay-toggle vn-fxset-toggle" title="${loc('vn.bg.visualBackgroundHint')}">
                <i class="fas fa-image" aria-hidden="true"></i><span>${loc('vn.bg.visualBackground')}</span>
                <input class="vn-visual-background" data-visual-setting="visualBackground" type="checkbox"${state.visualBackground !== false ? ' checked' : ''}>
                <span class="vn-toggle-track"></span>
            </label>
            <label class="vn-overlay-toggle vn-fxset-toggle" title="${loc('vn.bg.visualForegroundHint')}">
                <i class="fas fa-layer-group" aria-hidden="true"></i><span>${loc('vn.bg.visualForeground')}</span>
                <input class="vn-visual-foreground" data-visual-setting="visualForeground" type="checkbox"${state.visualForeground === true ? ' checked' : ''}>
                <span class="vn-toggle-track"></span>
            </label>
        </div>
        <div class="vn-visual-settings-page vn-visual-settings-effect" id="${effectPanelId}" data-visual-scope="effect" hidden>
            ${visualAngleControl(state.visualAngle, state.visualEffect)}
            ${Object.entries(VISUAL_EFFECT_SETTINGS).map(([key, definition]) => renderEffectControl(key, definition, state, loc)).join('')}
        </div>
        <button type="button" class="vn-visual-settings-reset"><i class="fas fa-rotate-left" aria-hidden="true"></i>
            ${loc('vn.bg.effectSettingsReset')}</button>
    </div>`;
}

export function updateVisualRange(input) {
    input.parentElement.querySelector('output').value = input.matches('.vn-visual-angle')
        ? `${input.valueAsNumber}°` : `${input.valueAsNumber}%`;
}

export function visualTintColorPatch(input) {
    const strength = input.closest('.vn-effect-tint').querySelector('.vn-visual-tint-strength');
    const patch = { visualTintColor: input.value };
    if (strength.valueAsNumber === 0) patch.visualTintStrength = 50;
    return patch;
}

function visualSettingValue(input) {
    if (input.type === 'checkbox') return input.checked;
    return input.matches('input[type="range"]') ? input.valueAsNumber : input.value;
}

export function visualSettingPatch(input) {
    if (input.dataset.visualSetting === 'visualTintColor') return visualTintColorPatch(input);
    return { [input.dataset.visualSetting]: visualSettingValue(input) };
}

export function syncVisualSettings(root, state) {
    const panel = root?.querySelector('.vn-visual-settings');
    if (!panel) return;
    const angle = panel.querySelector('.vn-visual-angle');
    angle.value = resolveVisualAngle(state.visualAngle);
    updateVisualRange(angle);
    for (const input of panel.querySelectorAll('[data-visual-setting]')) {
        const key = input.dataset.visualSetting;
        const value = state[key] ?? VISUAL_SETTINGS_DEFAULTS[key];
        if (input.type === 'checkbox') input.checked = value;
        else {
            input.value = value;
            if (input.matches('input[type="range"]')) updateVisualRange(input);
        }
    }
    syncVisualControlVisibility(panel, state.visualEffect);
}

export function syncVisualControlVisibility(root, visualEffect) {
    const angle = root.querySelector('.vn-visual-angle-control');
    if (angle) angle.hidden = !supportsVisualAngle(visualEffect);
    for (const control of root.querySelectorAll('.vn-visual-effect-control')) {
        control.hidden = control.dataset.visualEffect !== visualEffect;
    }
    syncVisualSettingsScope(root, visualEffect);
}

export function syncVisualSettingsScope(root, visualEffect) {
    const panel = root?.matches?.('.vn-visual-settings') ? root : root?.querySelector?.('.vn-visual-settings');
    const effectChoice = panel?.querySelector('.vn-visual-settings-switch input[value="effect"]');
    if (!effectChoice) return;
    const generalChoice = panel.querySelector('.vn-visual-settings-switch input[value="general"]');
    const hadFocus = effectChoice === root?.ownerDocument?.activeElement;
    effectChoice.disabled = !hasSpecificVisualSettings(visualEffect);
    if (effectChoice.disabled) {
        generalChoice.checked = true;
        if (hadFocus) generalChoice.focus();
    }
    const effectSelected = effectChoice.checked && !effectChoice.disabled;
    panel.querySelector('[data-visual-scope="general"]').hidden = effectSelected;
    panel.querySelector('[data-visual-scope="effect"]').hidden = !effectSelected;
}

export function readVisualSettings(root) {
    return {
        ...VISUAL_SETTINGS_DEFAULTS,
        ...Object.fromEntries(Array.from(root.querySelectorAll('[data-visual-setting]'),
            input => [input.dataset.visualSetting, visualSettingValue(input)])),
        visualAngle: resolveVisualAngle(root.querySelector('.vn-visual-angle')?.value),
    };
}

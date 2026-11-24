import { configurableParticle, particleMotion, particleMotionModes } from '../visual-effects/atmosphere/config/particle-effect-settings.js';
import { PARTICLE_LABELS } from '../visual-effects/atmosphere/config/particle-types.js';
import { escapeHtml, stripEmoji } from '../../utils/text.js';
import { renderParticleSettings } from './vn-particle-settings-ui.js';

function effectLabel(type) {
    return type ? stripEmoji(game.i18n.localize(PARTICLE_LABELS[type])) : '';
}

function renderMotionOptions(type, modes, selected) {
    return modes.map(mode => {
        const key = type === 'glass_dust' && mode === 'classic' ? 'float' : mode;
        const label = game.i18n.localize(`vn.atmosphere.particleMotion.${key}`);
        return `<option value="${mode}"${mode === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

export function renderParticleEffectSettings(effect, settings, { showEffectName = false } = {}) {
    const loc = key => game.i18n.localize(key);
    const type = configurableParticle(effect);
    const mode = particleMotion(effect, settings);
    return `<label class="vn-effect-option"${type ? '' : ' hidden'}>
        <span><i class="fas fa-feather" aria-hidden="true"></i> ${loc('vn.atmosphere.particleMotion.label')}
            ${showEffectName ? `<small data-particle-option-effect>${escapeHtml(effectLabel(type))}</small>` : ''}</span>
        <select data-particle-motion>
            ${renderMotionOptions(type, particleMotionModes(type), mode)}
        </select>
    </label>`;
}

export function syncParticleEffectSettings(root, effect, settings) {
    const select = root?.querySelector('[data-particle-motion]');
    if (!select) return;
    const type = configurableParticle(effect);
    const row = select.parentElement;
    row.hidden = !type;
    const modes = particleMotionModes(type);
    const selected = particleMotion(effect, settings);
    if (select.options[1]?.value !== modes[1]) {
        select.innerHTML = renderMotionOptions(type, modes, selected);
    }
    select.value = selected;
    const name = row.querySelector('[data-particle-option-effect]');
    if (name) name.textContent = effectLabel(type);
}

export function renderLiveParticleSettings(state) {
    const loc = key => game.i18n.localize(key);
    const available = configurableParticle(state.particleEffect);
    return `<div class="vn-particle-settings-switch" role="group" aria-label="${loc('vn.bg.particleSettings')}">
        <input type="radio" name="vn-particle-settings-scope" id="vn-particle-settings-general"
            value="general" aria-controls="vn-particle-settings-general-panel" checked>
        <label for="vn-particle-settings-general">${loc('vn.atmosphere.particleSettingsScope.general')}</label>
        <input type="radio" name="vn-particle-settings-scope" id="vn-particle-settings-effect"
            value="effect" aria-controls="vn-particle-settings-effect-panel"${available ? '' : ' disabled'}>
        <label for="vn-particle-settings-effect">${loc('vn.atmosphere.particleSettingsScope.effect')}</label>
        <span class="vn-particle-settings-thumb" aria-hidden="true"></span>
    </div>
    <div class="vn-particle-settings-page" id="vn-particle-settings-general-panel">${renderParticleSettings(state)}</div>
    <div class="vn-particle-settings-page" id="vn-particle-settings-effect-panel" hidden>
        ${renderParticleEffectSettings(state.particleEffect, state.particleEffectSettings, { showEffectName: true })}
    </div>`;
}

export function syncLiveParticleSettingsScope(root, effect) {
    const effectChoice = root?.querySelector('#vn-particle-settings-effect');
    if (!effectChoice) return;
    const generalChoice = root.querySelector('#vn-particle-settings-general');
    const hadFocus = effectChoice === root.ownerDocument.activeElement;
    effectChoice.disabled = !configurableParticle(effect);
    if (effectChoice.disabled) {
        generalChoice.checked = true;
        if (hadFocus) generalChoice.focus();
    }
    root.querySelector('#vn-particle-settings-general-panel').hidden = effectChoice.checked;
    root.querySelector('#vn-particle-settings-effect-panel').hidden = !effectChoice.checked;
}

import { PARTICLE_SETTINGS_DEFAULTS, PARTICLE_DEPTHS, PARTICLE_DEPTH_ICONS, PARTICLE_TEMPO_LIMITS,
    PARTICLE_LAYER_ICONS, SCALE_LIMITS, WIND_MAX } from '../scene/vn-scene-contract.js';
import { windLabel } from './vn-scene-labels.js';

const ranges = {
    particleIntensity: { label: 'vn.bg.particleIntensity', icon: 'fa-snowflake', min: 1, max: 20, step: 1,
        className: 'vn-fxset-intensity', format: String },
    particleScale: { label: 'vn.bg.particleScale', icon: 'fa-up-right-and-down-left-from-center',
        min: SCALE_LIMITS.MIN, max: SCALE_LIMITS.MAX, step: 0.05, format: value => `${value}×` },
    particleOpacity: { label: 'vn.bg.particleOpacity', icon: 'fa-droplet', min: 0, max: 100, step: 1,
        format: value => `${value}%` },
    particleTempo: { label: 'vn.bg.particleTempo', icon: 'fa-gauge',
        min: PARTICLE_TEMPO_LIMITS.MIN, max: PARTICLE_TEMPO_LIMITS.MAX, step: 0.05, format: value => `${value}×` },
    particleTintStrength: { label: 'vn.bg.particleTintStrength', icon: 'fa-palette', min: 0, max: 100, step: 1,
        format: value => `${value}%` },
    particleWind: { label: 'vn.bg.particleWind', icon: 'fa-wind', min: -WIND_MAX, max: WIND_MAX, step: 1,
        className: 'vn-fxset-wind', format: windLabel },
};

export function renderParticleSettings(state) {
    const loc = key => game.i18n.localize(key);
    const value = key => state?.[key] ?? PARTICLE_SETTINGS_DEFAULTS[key];
    const choices = (key, label, options, icons, className, attribute) => `
        <div class="vn-fxset-section">${loc(label)}</div>
        <div class="vn-fxset-layers" role="group" aria-label="${loc(label)}">
            ${options.map(id => {
                const text = loc(label + id[0].toUpperCase() + id.slice(1));
                const active = value(key) === id;
                return `<button type="button" class="${className}${active ? ' active' : ''}"
                    data-particle-setting="${key}" data-${attribute}="${id}" value="${id}" aria-pressed="${active}"
                    title="${text}"><i class="fas ${icons[id]}" aria-hidden="true"></i><span>${text}</span></button>`;
            }).join('')}
        </div>`;
    const range = key => {
        const { label, icon, min, max, step, className = '', format } = ranges[key];
        return `<label class="vn-particle-range">
            <i class="fas ${icon}" aria-hidden="true"></i><span>${loc(label)}</span>
            <input type="range" class="${className}" data-particle-setting="${key}"
                min="${min}" max="${max}" step="${step}" value="${value(key)}">
            <span class="vn-particle-range-value">${format(value(key))}</span>
        </label>`;
    };
    const toggle = (key, className, label, icon, hint) => `<label class="vn-overlay-toggle vn-fxset-toggle"${hint ? ` title="${loc(hint)}"` : ''}>
        <i class="fas ${icon}" aria-hidden="true"></i><span>${loc(label)}</span>
        <input type="checkbox" class="${className}" data-particle-setting="${key}"${value(key) ? ' checked' : ''}>
        <span class="vn-toggle-track"></span>
    </label>`;
    return `<div class="vn-particle-settings vn-fxset-body">
        <div class="vn-particle-settings-group">
            ${range('particleIntensity')}
            ${range('particleScale')}
            ${range('particleOpacity')}
            ${toggle('particleSolidTexture', 'vn-fxset-solid-texture', 'vn.bg.particleSolidTexture', 'fa-circle',
                'vn.bg.particleSolidTextureHint')}
            ${range('particleTempo')}
            <div class="vn-effect-tint">
                ${range('particleTintStrength')}
                <input type="color" data-particle-setting="particleTintColor" value="${value('particleTintColor')}"
                    aria-label="${loc('vn.bg.tintColor')}" title="${loc('vn.bg.tintColor')}">
            </div>
            ${range('particleWind')}
        </div>
        <div class="vn-particle-settings-group">
            ${choices('particlesLayer', 'vn.bg.particlesLayer', ['back', 'mix', 'front'], PARTICLE_LAYER_ICONS, 'vn-fxset-layer', 'layer')}
            ${choices('particleDepth', 'vn.bg.particleDepth', PARTICLE_DEPTHS, PARTICLE_DEPTH_ICONS, 'vn-fxset-depth', 'depth')}
            ${toggle('particleGusts', 'vn-fxset-gusts', 'vn.bg.particleGusts', 'fa-wave-square')}
            ${toggle('particleWrap', 'vn-fxset-wrap', 'vn.bg.particleWrap', 'fa-repeat')}
        </div>
        <button type="button" class="vn-particle-settings-reset"><i class="fas fa-rotate-left" aria-hidden="true"></i>
            ${loc('vn.bg.effectSettingsReset')}</button>
    </div>`;
}

function particleSettingValue(control) {
    if (control.type === 'checkbox') return control.checked;
    if (control.type === 'range') return control.valueAsNumber;
    return control.value;
}

export function particleSettingPatch(control) {
    const key = control.dataset.particleSetting;
    const patch = { [key]: particleSettingValue(control) };
    if (key === 'particleTintColor') {
        const strength = control.closest('.vn-effect-tint').querySelector('[data-particle-setting="particleTintStrength"]');
        if (strength.valueAsNumber === 0) patch.particleTintStrength = 50;
    }
    return patch;
}

export function updateParticleRange(control) {
    const range = ranges[control.dataset.particleSetting];
    if (range) control.closest('.vn-particle-range').querySelector('.vn-particle-range-value')
        .textContent = range.format(control.valueAsNumber);
}

export function syncParticleSettings(root, state) {
    root?.querySelectorAll('.vn-particle-settings [data-particle-setting]').forEach(control => {
        const value = state[control.dataset.particleSetting] ?? PARTICLE_SETTINGS_DEFAULTS[control.dataset.particleSetting];
        if (control.type === 'button') {
            const active = control.value === value;
            control.classList.toggle('active', active);
            control.setAttribute('aria-pressed', active);
        } else if (control.type === 'checkbox') {
            control.checked = value;
        } else if (control.type === 'range') {
            control.value = value;
            updateParticleRange(control);
        } else {
            control.value = value;
        }
    });
}

export function readParticleSettings(root) {
    const state = { ...PARTICLE_SETTINGS_DEFAULTS };
    root.querySelectorAll('.vn-particle-settings input[data-particle-setting], .vn-particle-settings button[aria-pressed="true"]')
        .forEach(control => { state[control.dataset.particleSetting] = particleSettingValue(control); });
    return state;
}

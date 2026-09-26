// ============================================================
// vn-effects-manager.js — вкладка "Эффекты": независимые пикеры
// частиц и визуальных эффектов + быстрые пресеты
// ============================================================

import { VNAtmosphere } from '../visual-effects/atmosphere/index.js';

export class VNEffectsManager {
    _renderGrid(groups, labelsMap, iconsMap, current, axis) {
        return groups.map(group =>
            `<div class="vn-atmo-group-header">${game.i18n.localize(group.label)}</div>`
            + group.types.map(t => {
                const label = game.i18n.localize(labelsMap[t]);
                return `<button type="button" class="vn-atmo-item${t === current ? ' active' : ''}" data-${axis}="${t}" title="${label}"><i class="fas ${iconsMap[t]}"></i><span>${label}</span></button>`;
            }).join('')
        ).join('');
    }

    _renderPresets(currentParticle, currentVisual) {
        return VNAtmosphere.EFFECT_GROUPS.map(group =>
            group.effects.map(id => {
                const preset = VNAtmosphere.PRESETS[id];
                const label = game.i18n.localize(VNAtmosphere.EFFECT_LABELS[id]);
                const active = preset.particles === currentParticle && preset.visual === currentVisual;
                return `<button type="button" class="vn-effects-preset-item${active ? ' active' : ''}" data-preset="${id}" title="${label}"><i class="fas ${VNAtmosphere.EFFECT_ICONS[id]}"></i><span>${label}</span></button>`;
            }).join('')
        ).join('');
    }

    generateTab(currentParticle = 'particles', currentVisual = 'none', currentParticlesFg = false, currentParticleIntensity = 1) {
        const particleGrid = this._renderGrid(VNAtmosphere.PARTICLE_GROUPS, VNAtmosphere.PARTICLE_LABELS, VNAtmosphere.PARTICLE_ICONS, currentParticle, 'particle');
        const visualGrid = this._renderGrid(VNAtmosphere.VISUAL_GROUPS, VNAtmosphere.VISUAL_LABELS, VNAtmosphere.VISUAL_ICONS, currentVisual, 'visual');
        const presets = this._renderPresets(currentParticle, currentVisual);

        return `<div class="vn-effects-tab">
            <input type="hidden" id="particle-effect" value="${currentParticle}">
            <input type="hidden" id="visual-effect" value="${currentVisual}">

            <div class="vn-effects-presets-row">${presets}</div>

            <div class="vn-effects-controls-row">
                <label class="vn-overlay-toggle">
                    <input type="checkbox" id="particles-foreground" ${currentParticlesFg ? 'checked' : ''}><span class="vn-toggle-track"></span><span>${game.i18n.localize('vn.bg.particlesForeground')}</span>
                </label>
                <label class="vn-overlay-toggle vn-particle-intensity-ctrl" title="${game.i18n.localize('vn.bg.particleIntensity')}">
                    <i class="fas fa-snowflake"></i>
                    <input type="range" id="particle-intensity" min="1" max="20" step="1" value="${currentParticleIntensity}">
                    <span class="vn-particle-intensity-val">${currentParticleIntensity}</span>
                </label>
            </div>

            <div class="vn-effects-grids">
                <div class="vn-effects-grid-col">
                    <div class="vn-effects-grid-title"><i class="fas fa-star"></i> ${game.i18n.localize('vn.atmosphere.particlesHeader')}</div>
                    <div class="vn-effects-inline-grid" data-axis="particle">${particleGrid}</div>
                </div>
                <div class="vn-effects-grid-col">
                    <div class="vn-effects-grid-title"><i class="fas fa-wand-sparkles"></i> ${game.i18n.localize('vn.atmosphere.visualHeader')}</div>
                    <div class="vn-effects-inline-grid" data-axis="visual">${visualGrid}</div>
                </div>
            </div>
        </div>`;
    }

    attachListeners(root) {
        if (!root || root._vnEffectsDelegated) return;
        root._vnEffectsDelegated = true;

        root.addEventListener('click', (e) => {
            const particleItem = e.target.closest('.vn-effects-inline-grid[data-axis="particle"] .vn-atmo-item');
            if (particleItem) {
                const particle = particleItem.dataset.particle;
                const input = root.querySelector('#particle-effect');
                if (input) input.value = particle;
                particleItem.closest('.vn-effects-inline-grid').querySelectorAll('.vn-atmo-item').forEach(i => i.classList.toggle('active', i === particleItem));
                this._syncPresetHighlight(root);
                return;
            }

            const visualItem = e.target.closest('.vn-effects-inline-grid[data-axis="visual"] .vn-atmo-item');
            if (visualItem) {
                const visual = visualItem.dataset.visual;
                const input = root.querySelector('#visual-effect');
                if (input) input.value = visual;
                visualItem.closest('.vn-effects-inline-grid').querySelectorAll('.vn-atmo-item').forEach(i => i.classList.toggle('active', i === visualItem));
                this._syncPresetHighlight(root);
                return;
            }

            const presetItem = e.target.closest('.vn-effects-preset-item');
            if (presetItem) {
                const id = presetItem.dataset.preset;
                const preset = VNAtmosphere.PRESETS[id];
                if (!preset) return;
                this._applyAxisValue(root, 'particle', preset.particles);
                this._applyAxisValue(root, 'visual', preset.visual);
                root.querySelectorAll('.vn-effects-preset-item').forEach(i => i.classList.toggle('active', i === presetItem));
            }
        });

        root.addEventListener('input', (e) => {
            const intensitySlider = e.target.closest('#particle-intensity');
            if (intensitySlider) {
                const valEl = intensitySlider.closest('.vn-particle-intensity-ctrl')?.querySelector('.vn-particle-intensity-val');
                if (valEl) valEl.textContent = intensitySlider.value;
            }
        });
    }

    _applyAxisValue(root, axis, value) {
        const input = root.querySelector(`#${axis}-effect`);
        if (input) input.value = value;
        root.querySelectorAll(`.vn-effects-inline-grid[data-axis="${axis}"] .vn-atmo-item`).forEach(i =>
            i.classList.toggle('active', i.dataset[axis] === value));
    }

    _syncPresetHighlight(root) {
        const particle = root.querySelector('#particle-effect')?.value;
        const visual = root.querySelector('#visual-effect')?.value;
        root.querySelectorAll('.vn-effects-preset-item').forEach(item => {
            const preset = VNAtmosphere.PRESETS[item.dataset.preset];
            item.classList.toggle('active', !!preset && preset.particles === particle && preset.visual === visual);
        });
    }
}

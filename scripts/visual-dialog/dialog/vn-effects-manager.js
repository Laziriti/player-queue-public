// ============================================================
// vn-effects-manager.js — вкладка "Эффекты": независимые пикеры
// частиц и визуальных эффектов + быстрые пресеты
// ============================================================

import { VNAtmosphere } from '../visual-effects/atmosphere/index.js';
import { stripEmoji } from '../vn-id-utils.js';

export class VNEffectsManager {
    _renderGrid(groups, labelsMap, iconsMap, current, axis, variantsMap = null, currentVariant = 'all') {
        return groups.map(group =>
            `<div class="vn-atmo-group-header">${game.i18n.localize(group.label)}</div>`
            + group.types.map(t => {
                const label = stripEmoji(game.i18n.localize(labelsMap[t]));
                const active = t === current;
                const variants = variantsMap?.[t];
                const activeVariant = active ? currentVariant : 'all';
                const tag = variants && activeVariant !== 'all'
                    ? `<small class="vn-atmo-item-variant-tag">${game.i18n.localize((variants.find(v => v.id === activeVariant) || variants[0]).label)}</small>`
                    : '';
                const caret = variants ? '<i class="fas fa-chevron-down vn-atmo-item-caret"></i>' : '';
                const btn = `<button type="button" class="vn-atmo-item${active ? ' active' : ''}${variants ? ' vn-atmo-item-expandable' : ''}" data-${axis}="${t}" title="${label}"><i class="fas ${iconsMap[t]}"></i><span>${label}</span>${tag}${caret}</button>`;
                if (!variants) return btn;
                const list = variants.map(v =>
                    `<button type="button" class="vn-variant-option${v.id === activeVariant ? ' active' : ''}" data-variant="${v.id}"><i class="fas fa-check"></i><span>${game.i18n.localize(v.label)}</span></button>`
                ).join('');
                return `<div class="vn-atmo-item-group" data-variant-axis="${axis}" data-variant-base="${t}">${btn}<div class="vn-variant-list" hidden>${list}</div></div>`;
            }).join('')
        ).join('');
    }

    _renderPresets(currentParticle, currentVisual) {
        return VNAtmosphere.EFFECT_GROUPS.map(group =>
            group.effects.map(id => {
                const preset = VNAtmosphere.PRESETS[id];
                const label = stripEmoji(game.i18n.localize(VNAtmosphere.EFFECT_LABELS[id]));
                const active = preset.particles === currentParticle && preset.visual === currentVisual;
                return `<button type="button" class="vn-effects-preset-item${active ? ' active' : ''}" data-preset="${id}" title="${label}"><i class="fas ${VNAtmosphere.EFFECT_ICONS[id]}"></i><span>${label}</span></button>`;
            }).join('')
        ).join('');
    }

    _renderLayerSwitch(current) {
        const items = [
            ['back', 'fa-arrow-down', 'vn.bg.particlesLayerBack'],
            ['mix', 'fa-shuffle', 'vn.bg.particlesLayerMix'],
            ['front', 'fa-arrow-up', 'vn.bg.particlesLayerFront'],
        ];
        return `<div class="vn-particles-layer-switch" role="group" title="${game.i18n.localize('vn.bg.particlesLayer')}">
            <input type="hidden" id="particles-layer" value="${current}">
            <i class="fas fa-layer-group"></i>
            ${items.map(([id, icon, key]) =>
                `<button type="button" class="vn-particles-layer-opt${id === current ? ' active' : ''}" data-layer="${id}"><i class="fas ${icon}"></i><span>${game.i18n.localize(key)}</span></button>`
            ).join('')}
        </div>`;
    }

    _variantsOf(axis) {
        return axis === 'particle' ? VNAtmosphere.PARTICLE_VARIANTS : VNAtmosphere.VISUAL_VARIANTS;
    }

    /** "Snow", "Feathers · Black" or "Noir · Blinds": what is selected on an axis, shown in the column title so it stays visible while the list scrolls. */
    _currentLabel(axis, value) {
        const [type, variant = 'all'] = String(value || 'none').split(':');
        const labels = axis === 'particle' ? VNAtmosphere.PARTICLE_LABELS : VNAtmosphere.VISUAL_LABELS;
        if (!labels[type]) return '';
        let text = stripEmoji(game.i18n.localize(labels[type]));
        if (variant !== 'all') {
            const v = this._variantsOf(axis)[type]?.find(x => x.id === variant);
            if (v) text += ` · ${game.i18n.localize(v.label)}`;
        }
        return text;
    }

    _updateCurrent(root) {
        for (const axis of ['particle', 'visual']) {
            const el = root.querySelector(`.vn-effects-current[data-axis="${axis}"]`);
            if (el) el.textContent = this._currentLabel(axis, root.querySelector(`#${axis}-effect`)?.value);
        }
    }

    _applySearch(root, query) {
        const q = query.trim().toLowerCase();
        root.querySelectorAll('.vn-effects-inline-grid').forEach(grid => {
            let header = null, shown = 0;
            const flush = () => { if (header) header.style.display = shown ? '' : 'none'; };
            for (const el of grid.children) {
                if (el.classList.contains('vn-atmo-group-header')) {
                    flush();
                    header = el; shown = 0;
                    continue;
                }
                const btn = el.matches('.vn-atmo-item') ? el : el.querySelector('.vn-atmo-item');
                const hit = !q || (btn?.title || '').toLowerCase().includes(q);
                el.style.display = hit ? '' : 'none';
                if (hit) shown++;
            }
            flush();
        });
    }

    generateTab(currentParticle = 'particles', currentVisual = 'none', currentParticlesLayer = 'back', currentParticleIntensity = 1) {
        const [particleType, particleVariant = 'all'] = currentParticle.split(':');
        const particleGrid = this._renderGrid(VNAtmosphere.PARTICLE_GROUPS, VNAtmosphere.PARTICLE_LABELS, VNAtmosphere.PARTICLE_ICONS, particleType, 'particle', VNAtmosphere.PARTICLE_VARIANTS, particleVariant);
        const [visualType, visualVariant = 'all'] = currentVisual.split(':');
        const visualGrid = this._renderGrid(VNAtmosphere.VISUAL_GROUPS, VNAtmosphere.VISUAL_LABELS, VNAtmosphere.VISUAL_ICONS, visualType, 'visual', VNAtmosphere.VISUAL_VARIANTS, visualVariant);
        const presets = this._renderPresets(currentParticle, currentVisual);

        return `<div class="vn-effects-tab">
            <input type="hidden" id="particle-effect" value="${currentParticle}">
            <input type="hidden" id="visual-effect" value="${currentVisual}">

            <details class="vn-collapsible vn-effects-combos">
                <summary class="vn-collapsible-header"><i class="fas fa-swatchbook"></i> ${game.i18n.localize('vn.atmosphere.combosHeader')}<i class="fas fa-chevron-down vn-chevron"></i></summary>
                <div class="vn-collapsible-body"><div class="vn-effects-presets-row">${presets}</div></div>
            </details>

            <div class="vn-effects-controls-row">
                ${this._renderLayerSwitch(currentParticlesLayer)}
                <label class="vn-overlay-toggle vn-particle-intensity-ctrl" title="${game.i18n.localize('vn.bg.particleIntensity')}">
                    <i class="fas fa-snowflake"></i>
                    <span class="vn-particle-intensity-label">${game.i18n.localize('vn.bg.particleIntensity')}</span>
                    <input type="range" id="particle-intensity" min="1" max="20" step="1" value="${currentParticleIntensity}">
                    <span class="vn-particle-intensity-val">${currentParticleIntensity}</span>
                </label>
                <div class="vn-effects-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input type="text" class="vn-effects-search-input" placeholder="${game.i18n.localize('vn.atmosphere.searchPlaceholder')}" autocomplete="off" spellcheck="false">
                </div>
            </div>

            <div class="vn-effects-grids">
                <div class="vn-effects-grid-col">
                    <div class="vn-effects-grid-title"><i class="fas fa-star"></i> ${game.i18n.localize('vn.atmosphere.particlesHeader')}<span class="vn-effects-current" data-axis="particle">${this._currentLabel('particle', currentParticle)}</span></div>
                    <div class="vn-effects-inline-grid" data-axis="particle">${particleGrid}</div>
                </div>
                <div class="vn-effects-grid-col">
                    <div class="vn-effects-grid-title"><i class="fas fa-wand-sparkles"></i> ${game.i18n.localize('vn.atmosphere.visualHeader')}<span class="vn-effects-current" data-axis="visual">${this._currentLabel('visual', currentVisual)}</span></div>
                    <div class="vn-effects-inline-grid" data-axis="visual">${visualGrid}</div>
                </div>
            </div>
        </div>`;
    }

    attachListeners(root) {
        if (!root || root._vnEffectsDelegated) return;
        root._vnEffectsDelegated = true;

        root.addEventListener('click', (e) => {
            const layerOpt = e.target.closest('.vn-particles-layer-opt');
            if (layerOpt) {
                this.setLayer(root, layerOpt.dataset.layer);
                return;
            }

            const variantOption = e.target.closest('.vn-variant-option');
            if (variantOption) {
                const group = variantOption.closest('.vn-atmo-item-group');
                const base = group?.dataset.variantBase;
                const variant = variantOption.dataset.variant;
                if (base && variant) {
                    this._applyAxisValue(root, group.dataset.variantAxis || 'particle', variant === 'all' ? base : `${base}:${variant}`);
                    this._syncPresetHighlight(root);
                }
                return;
            }

            const axisItem = e.target.closest('.vn-effects-inline-grid[data-axis] .vn-atmo-item');
            if (axisItem) {
                const axis = axisItem.closest('.vn-effects-inline-grid').dataset.axis;
                const group = axisItem.closest('.vn-atmo-item-group');

                // Клик по тайлу с вариантами — только открыть/закрыть его список
                // подвариантов, не применяя ничего; выбор происходит по клику
                // на конкретный .vn-variant-option внутри.
                if (group) {
                    root.querySelectorAll(`.vn-effects-inline-grid[data-axis="${axis}"] .vn-atmo-item-group.vn-variant-open`)
                        .forEach(g => { if (g !== group) this._closeVariantGroup(g); });
                    // A first click on an inactive type selects it (base variant) and opens the variant list; later clicks only fold/unfold it
                    const base = group.dataset.variantBase;
                    const current = root.querySelector(`#${axis}-effect`)?.value.split(':')[0];
                    if (current !== base) {
                        this._applyAxisValue(root, axis, base);
                        this._syncPresetHighlight(root);
                        this._openVariantGroup(group);
                        return;
                    }
                    this._toggleVariantGroup(group);
                    return;
                }

                this._applyAxisValue(root, axis, axisItem.dataset[axis]);
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

        // Registered after the handler above, so it sees the already updated hidden inputs
        root.addEventListener('click', () => this._updateCurrent(root));

        root.addEventListener('input', (e) => {
            if (e.target.classList.contains('vn-effects-search-input')) this._applySearch(root, e.target.value);
            const intensitySlider = e.target.closest('#particle-intensity');
            if (intensitySlider) {
                const valEl = intensitySlider.closest('.vn-particle-intensity-ctrl')?.querySelector('.vn-particle-intensity-val');
                if (valEl) valEl.textContent = intensitySlider.value;
            }
        });
    }

    setLayer(root, layer) {
        const input = root.querySelector('#particles-layer');
        if (input) input.value = layer;
        root.querySelectorAll('.vn-particles-layer-opt').forEach(o => o.classList.toggle('active', o.dataset.layer === layer));
    }

    _applyAxisValue(root, axis, value) {
        const input = root.querySelector(`#${axis}-effect`);
        if (input) input.value = value;
        const base = value.split(':')[0];
        root.querySelectorAll(`.vn-effects-inline-grid[data-axis="${axis}"] .vn-atmo-item`).forEach(i =>
            i.classList.toggle('active', i.dataset[axis] === base));
        this._syncVariantUI(root, axis, value);
    }

    /**
     * Синхронизирует все вложенные в тайлы списки вариантов одной оси
     * с полным значением particleEffect / visualEffect (может быть "type" или "type:variant").
     */
    _syncVariantUI(root, axis, axisValue) {
        const [type, variant = 'all'] = axisValue.split(':');
        root.querySelectorAll(`.vn-effects-inline-grid[data-axis="${axis}"] .vn-atmo-item-group`).forEach(group => {
            const v = group.dataset.variantBase === type ? variant : 'all';
            this._closeVariantGroup(group);
            group.querySelectorAll('.vn-variant-option').forEach(o => o.classList.toggle('active', o.dataset.variant === v));
            this._setVariantTag(group, v);
        });
    }

    _setVariantTag(group, variant) {
        const btn = group.querySelector('.vn-atmo-item');
        if (!btn) return;
        let tag = btn.querySelector('.vn-atmo-item-variant-tag');
        if (variant === 'all') { tag?.remove(); return; }
        const v = this._variantsOf(group.dataset.variantAxis || 'particle')[group.dataset.variantBase]?.find(v => v.id === variant);
        if (!v) { tag?.remove(); return; }
        if (!tag) {
            tag = document.createElement('small');
            tag.className = 'vn-atmo-item-variant-tag';
            const caret = btn.querySelector('.vn-atmo-item-caret');
            if (caret) caret.insertAdjacentElement('beforebegin', tag);
            else btn.appendChild(tag);
        }
        tag.textContent = game.i18n.localize(v.label);
    }

    _openVariantGroup(group) {
        group.classList.add('vn-variant-open');
        const list = group.querySelector('.vn-variant-list');
        if (list) list.hidden = false;
    }

    _closeVariantGroup(group) {
        group.classList.remove('vn-variant-open');
        const list = group.querySelector('.vn-variant-list');
        if (list) list.hidden = true;
    }

    _toggleVariantGroup(group) {
        if (group.classList.contains('vn-variant-open')) this._closeVariantGroup(group);
        else this._openVariantGroup(group);
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

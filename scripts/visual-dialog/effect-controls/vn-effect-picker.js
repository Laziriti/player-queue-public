import { PARTICLE_GROUPS, PARTICLE_LABELS, PARTICLE_ICONS, PARTICLE_VARIANTS } from '../visual-effects/atmosphere/config/particle-types.js';
import { VISUAL_GROUPS, VISUAL_LABELS, VISUAL_ICONS, VISUAL_VARIANTS } from '../visual-effects/atmosphere/config/visual-types.js';
import { escapeHtml, stripEmoji } from '../../utils/text.js';

const axes = {
    particle: { groups: PARTICLE_GROUPS, labels: PARTICLE_LABELS, icons: PARTICLE_ICONS, variants: PARTICLE_VARIANTS },
    visual: { groups: VISUAL_GROUPS, labels: VISUAL_LABELS, icons: VISUAL_ICONS, variants: VISUAL_VARIANTS },
};
const localize = key => game.i18n.localize(key);

function variantLabel(axis, type, variant) {
    if (variant === 'all') return '';
    const option = axes[axis].variants[type]?.find(({ id }) => id === variant);
    return option ? localize(option.label) : '';
}

export function effectPickerLabel(axis, value) {
    const [type, variant = 'all'] = (value || 'none').split(':');
    const key = axes[axis].labels[type];
    if (!key) return '';
    const label = stripEmoji(localize(key));
    const detail = variantLabel(axis, type, variant);
    return detail ? `${label} · ${detail}` : label;
}

export function renderEffectTiles(axis, effect) {
    const { groups, labels, icons, variants } = axes[axis];
    const [currentType, currentVariant = 'all'] = effect.split(':');
    return groups.map(group =>
        `<div class="vn-atmo-group-header">${escapeHtml(localize(group.label))}</div>`
        + group.types.map(type => {
            const label = escapeHtml(stripEmoji(localize(labels[type])));
            const active = type === currentType;
            const options = variants[type];
            const selected = active ? currentVariant : 'all';
            const detail = variantLabel(axis, type, selected);
            const tag = detail ? `<small class="vn-atmo-item-variant-tag">${escapeHtml(detail)}</small>` : '';
            const caret = options ? '<i class="fas fa-chevron-down vn-atmo-item-caret"></i>' : '';
            const button = `<button type="button" class="vn-atmo-item${active ? ' active' : ''}${options ? ' vn-atmo-item-expandable' : ''}" data-${axis}="${type}" title="${label}"><i class="fas ${icons[type]}"></i><span>${label}</span>${tag}${caret}</button>`;
            if (!options) return button;
            const list = options.map(option =>
                `<button type="button" class="vn-variant-option${option.id === selected ? ' active' : ''}" data-variant="${option.id}"><i class="fas fa-check"></i><span>${escapeHtml(localize(option.label))}</span></button>`
            ).join('');
            return `<div class="vn-atmo-item-group" data-variant-axis="${axis}" data-variant-base="${type}">${button}<div class="vn-variant-list" hidden>${list}</div></div>`;
        }).join('')
    ).join('');
}

export function setVariantGroupOpen(group, open) {
    group.classList.toggle('vn-variant-open', open);
    const list = group.querySelector('.vn-variant-list');
    if (list) list.hidden = !open;
}

export function toggleVariantGroup(group, grid) {
    for (const sibling of grid?.querySelectorAll('.vn-atmo-item-group.vn-variant-open') ?? []) {
        if (sibling !== group) setVariantGroupOpen(sibling, false);
    }
    setVariantGroupOpen(group, !group.classList.contains('vn-variant-open'));
}

export function syncEffectVariants(root, axis, type, variant = 'all') {
    for (const group of root.querySelectorAll(`.vn-atmo-item-group[data-variant-axis="${axis}"]`)) {
        const base = group.dataset.variantBase;
        const selected = base === type ? variant : 'all';
        setVariantGroupOpen(group, false);
        for (const option of group.querySelectorAll('.vn-variant-option')) {
            option.classList.toggle('active', option.dataset.variant === selected);
        }
        const button = group.querySelector('.vn-atmo-item');
        if (!button) continue;
        const label = variantLabel(axis, base, selected);
        let tag = button.querySelector('.vn-atmo-item-variant-tag');
        if (!label) {
            tag?.remove();
            continue;
        }
        if (!tag) {
            tag = button.ownerDocument.createElement('small');
            tag.className = 'vn-atmo-item-variant-tag';
            const caret = button.querySelector('.vn-atmo-item-caret');
            button.insertBefore(tag, caret);
        }
        tag.textContent = label;
    }
}

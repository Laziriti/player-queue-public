// Selected preset details, metadata editing and the embedded sequence editor.
import { VNPresets } from '../../presets/vn-presets.js';
import { escapeHtml as esc } from '../../../utils/text.js';
import { presetScenes } from '../../presets/vn-preset-utils.js';
import { VNSequenceEditor } from './vn-sequence-editor.js';
import { refreshCaptionPreviews } from '../vn-caption-editor.js';
import { formatPresetDate } from './vn-presets-view.js';

export class VNPresetsPanel {
    constructor({ getHooks, refresh, onAction, confirm }) {
        this.selectedPresetId = null;
        this._getHooks = getHooks;
        this._refresh = refresh;
        this._onAction = onAction;
        this.sequenceEditor = new VNSequenceEditor({
            getHooks, refresh, confirm,
            renderPanel: (root, preset) => this.render(root, preset),
        });
    }

    _getAllExistingTags(root) {
        const tags = new Set();
        root.querySelectorAll('.vn-preset-item[data-tags], .vn-preset-card[data-tags]').forEach(el => {
            (el.dataset.tags || '').split(',').filter(Boolean).forEach(t => tags.add(t));
        });
        return [...tags].sort();
    }

    _markSelectedItem(root, presetId) {
        root.querySelectorAll('.vn-preset-item, .vn-preset-card').forEach(el => {
            el.classList.toggle('vn-preset-selected', el.dataset.preset === presetId);
        });
    }

    async select(root, presetId) {
        this.selectedPresetId = presetId;
        this._markSelectedItem(root, presetId);
        const preset = await VNPresets.load(presetId);
        this.render(root, preset);
        this.attachListeners(root);
    }

    render(root, preset) {
        const panel = root.querySelector('.vn-preset-detail-panel');
        if (!panel) return;

        const split = panel.closest('.vn-presets-split');
        // The panel exists only while a preset is open: with nothing selected the list gets the whole width
        panel.hidden = !preset;
        split?.classList.toggle('has-panel', !!preset);

        if (!preset) {
            panel.removeAttribute('data-preset-id');
            panel.removeAttribute('data-preset-name');
            panel.innerHTML = '';
            return;
        }

        const sameBody = panel.dataset.presetId === preset.id ? panel.querySelector('.vn-panel-body') : null;
        const keepScroll = sameBody?.scrollTop ?? 0;

        panel.dataset.presetId = preset.id;
        panel.dataset.presetName = preset.name;

        const tags = [...(preset.tags || [])];
        const allTags = this._getAllExistingTags(root);
        const suggestions = allTags.filter(t => !tags.includes(t));
        const dateCreated = formatPresetDate(preset.createdAt || preset.savedAt);
        const dateUpdated = (preset.updatedAt && preset.updatedAt !== preset.createdAt) ? formatPresetDate(preset.updatedAt) : null;

        const tagsChipsHtml = tags.map((t, i) =>
            `<span class="vn-tag-chip vn-tag-chip--rm" data-tag="${esc(t)}"><span>${esc(t)}</span><button type="button" class="vn-tag-rm-btn" data-index="${i}">×</button></span>`
        ).join('');
        const suggestHtml = suggestions.map(t =>
            `<button type="button" class="vn-panel-tag-suggest" data-tag="${esc(t)}">${esc(t)}</button>`
        ).join('');

        const scenes = presetScenes(preset);
        const sceneChipsHtml = scenes.map((s, i) => `<span class="vn-scene-chip" title="${esc(s.name || s.id)}"><i class="fas fa-map-pin"></i><span>${esc(s.name || s.id)}</span><button type="button" class="vn-scene-rm-btn" data-index="${i}">×</button></span>`).join('');

        const isSequence = VNPresets.isSequence(preset);
        const panelAction = (action, icon, key, extra = '') =>
            `<button type="button" class="vn-btn vn-btn-sm ${extra} vn-panel-action" data-action="${action}" data-preset="${preset.id}"><i class="fas ${icon}"></i> ${game.i18n.localize(key)}</button>`;
        // A sequence is launched, not loaded into the form; its content is edited step by step instead
        const launchAction = panelAction('launch', 'fa-play', 'vn.dialog.presetActionLaunch', 'vn-btn-accent vn-panel-action--launch');
        const primaryActions = isSequence
            ? launchAction
            : launchAction + panelAction('load', 'fa-upload', 'vn.dialog.presetActionLoad') + panelAction('update', 'fa-arrows-rotate', 'vn.dialog.presetActionUpdate');
        const optionsHtml = isSequence ? this.sequenceEditor.optionsHtml(preset) : '';
        const stepsHtml = isSequence ? this.sequenceEditor.stepsHtml(preset) : '';

        const nameAndActions = `
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelName')}</label>
                    <input type="text" class="vn-panel-name-input" value="${esc(preset.name)}" autocomplete="off" spellcheck="false">
                </div>
                <div class="vn-panel-section">
                    <div class="vn-panel-actions${isSequence ? ' vn-panel-actions--compact' : ''}">
                        ${primaryActions}
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="regen" data-preset="${preset.id}"><i class="fas fa-camera"></i> ${game.i18n.localize('vn.dialog.presetActionRegen')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="macro" data-preset="${preset.id}"><i class="fas fa-code"></i> ${game.i18n.localize('vn.dialog.presetActionMacro')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-panel-action" data-action="duplicate" data-preset="${preset.id}" title="${esc(game.i18n.localize('vn.dialog.presetActionDuplicateTitle'))}"><i class="fas fa-clone"></i> ${game.i18n.localize('vn.dialog.presetActionDuplicate')}</button>
                        <button type="button" class="vn-btn vn-btn-sm vn-btn-danger vn-panel-action vn-panel-action--delete" data-action="delete" data-preset="${preset.id}"><i class="fas fa-trash"></i> ${game.i18n.localize('vn.dialog.presetActionDelete')}</button>
                    </div>
                </div>`;

        const infoAndTags = `
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <div class="vn-panel-info">
                        ${preset.version ? `<span class="vn-panel-info-row"><i class="fas fa-code-branch"></i><span>v${preset.version}</span></span>` : ''}
                        ${dateCreated ? `<span class="vn-panel-info-row"><i class="fas fa-calendar-plus"></i><span>${dateCreated}</span></span>` : ''}
                        ${dateUpdated ? `<span class="vn-panel-info-row"><i class="fas fa-calendar-check"></i><span>${dateUpdated}</span></span>` : ''}
                    </div>
                </div>
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelScenes')} <span class="vn-badge">${scenes.length}</span></label>
                    <div class="vn-panel-scenes">${sceneChipsHtml}</div>
                    <button type="button" class="vn-btn vn-btn-sm vn-panel-action vn-panel-scenes-btn" data-action="assign" data-preset="${preset.id}"><i class="fas fa-location-dot"></i> ${game.i18n.localize('vn.dialog.presetActionAssign')}</button>
                </div>
                <hr class="vn-panel-section-divider">
                <div class="vn-panel-section">
                    <label class="vn-panel-label">${game.i18n.localize('vn.dialog.panelLabelTags')}</label>
                    <div class="vn-panel-tags-chips">${tagsChipsHtml}</div>
                    <div class="vn-panel-tag-input-wrap">
                        <i class="fas fa-magnifying-glass"></i>
                        <input type="text" class="vn-panel-tag-input" placeholder="${game.i18n.localize('vn.dialog.tagAddPlaceholder')}" autocomplete="off" spellcheck="false" maxlength="32">
                    </div>
                    ${suggestHtml ? `<span class="vn-panel-sublabel">${game.i18n.localize('vn.dialog.panelTagsExisting')}</span>` : ''}
                    <div class="vn-panel-tag-dropdown">${suggestHtml}</div>
                </div>`;

        // Same panel width as a regular preset; a composite one just scrolls further down (options, then the steps)
        const body = isSequence
            ? `<div class="vn-panel-body">${nameAndActions}${optionsHtml}<hr class="vn-panel-section-divider">${stepsHtml}${infoAndTags}</div>`
            : `<div class="vn-panel-body">${nameAndActions}${infoAndTags}</div>`;

        panel.innerHTML = `
            <div class="vn-panel-header--preset-detail">
                <span class="vn-panel-title"><i class="fas ${isSequence ? 'fa-film' : 'fa-pen-to-square'}"></i> ${esc(preset.name)}</span>
                <button type="button" class="vn-btn vn-btn-xs vn-panel-close-btn" title="${game.i18n.localize('vn.dialog.btnClose')}" aria-label="${game.i18n.localize('vn.dialog.btnClose')}"><i class="fas fa-times vn-panel-close-icon"></i><i class="fas fa-arrow-left vn-panel-back-icon"></i><span class="vn-panel-back-label">${game.i18n.localize('vn.dialog.panelBack')}</span></button>
            </div>
            ${body}`;

        if (isSequence) refreshCaptionPreviews(panel, preset);

        if (keepScroll) {
            const newBody = panel.querySelector('.vn-panel-body');
            if (newBody) newBody.scrollTop = keepScroll;
        }
    }

    attachListeners(root) {
        const panel = root.querySelector('.vn-preset-detail-panel');
        if (!panel || panel._panelListenerAttached) return;
        panel._panelListenerAttached = true;
        this.sequenceEditor.attach(panel, root);

        panel.addEventListener('click', async (e) => {
            if (e.target.closest('.vn-panel-close-btn')) {
                this.selectedPresetId = null;
                this._markSelectedItem(root, null);
                this.render(root, null);
                return;
            }

            const rmBtn = e.target.closest('.vn-tag-rm-btn');
            if (rmBtn) {
                const presetId = this.selectedPresetId;
                if (!presetId) return;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                tags.splice(Number(rmBtn.dataset.index), 1);
                const sorted = await VNPresets.setTags(presetId, tags);
                if (sorted) this._refresh(root, sorted);
                return;
            }

            const sceneRm = e.target.closest('.vn-scene-rm-btn');
            if (sceneRm) {
                const presetId = this.selectedPresetId;
                const preset = presetId ? await VNPresets.load(presetId) : null;
                if (!preset) return;
                const sorted = await VNPresets.setScenes(presetId, presetScenes(preset).filter((_, i) => i !== Number(sceneRm.dataset.index)));
                if (sorted) { this._refresh(root, sorted); this._getHooks().onChanged?.(root); }
                return;
            }

            const suggest = e.target.closest('.vn-panel-tag-suggest');
            if (suggest) {
                const presetId = this.selectedPresetId;
                if (!presetId) return;
                const tag = suggest.dataset.tag;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                if (!tags.includes(tag)) {
                    tags.push(tag);
                    const sorted = await VNPresets.setTags(presetId, tags);
                    if (sorted) this._refresh(root, sorted);
                }
                return;
            }

            const actionBtn = e.target.closest('.vn-panel-action[data-action]');
            if (actionBtn) {
                await this._onAction(actionBtn.dataset.action, actionBtn.dataset.preset, actionBtn, root);
            }
        });

        panel.addEventListener('input', (e) => {
            if (!e.target.classList.contains('vn-panel-tag-input')) return;
            const query = e.target.value.trim().toLowerCase();
            const currentTags = new Set(
                [...panel.querySelectorAll('.vn-panel-tags-chips .vn-tag-chip span')].map(el => el.textContent.trim())
            );
            const allTags = this._getAllExistingTags(root);
            const available = allTags.filter(t => !currentTags.has(t));
            const filtered = query ? available.filter(t => t.toLowerCase().includes(query)) : available;
            const dropdown = panel.querySelector('.vn-panel-tag-dropdown');
            if (dropdown) {
                dropdown.innerHTML = filtered.map(t =>
                    `<button type="button" class="vn-panel-tag-suggest" data-tag="${esc(t)}">${esc(t)}</button>`
                ).join('');
            }
        });

        panel.addEventListener('keydown', async (e) => {
            if (e.target.classList.contains('vn-panel-tag-input')) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const presetId = this.selectedPresetId;
                if (!presetId) return;
                const typed = e.target.value.trim().replace(/,+/g, '');
                // An existing tag typed in other letter case (imported tags keep capitals and spaces) is reused, not duplicated
                const val = this._getAllExistingTags(root).find(t => t.toLowerCase() === typed.toLowerCase())
                    ?? typed.toLowerCase().replace(/\s+/g, '-').slice(0, 32);
                if (!val) return;
                const preset = await VNPresets.load(presetId);
                if (!preset) return;
                const tags = [...(preset.tags || [])];
                if (!tags.includes(val)) { tags.push(val); }
                e.target.value = '';
                const sorted = await VNPresets.setTags(presetId, tags);
                if (sorted) this._refresh(root, sorted);
                root.querySelector('.vn-preset-detail-panel')?.querySelector('.vn-panel-tag-input')?.focus();
            } else if (e.target.classList.contains('vn-panel-name-input')) {
                if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    const preset = await VNPresets.load(this.selectedPresetId);
                    if (preset) e.target.value = preset.name;
                    e.target.blur();
                }
            }
        });

        panel.addEventListener('blur', async (e) => {
            if (!e.target.classList.contains('vn-panel-name-input')) return;
            const presetId = this.selectedPresetId;
            if (!presetId) return;
            const preset = await VNPresets.load(presetId);
            if (!preset) return;
            const newName = e.target.value.trim();
            if (newName && newName !== preset.name) {
                const sorted = await VNPresets.rename(presetId, newName);
                if (sorted) this._refresh(root, sorted);
            }
        }, { capture: true });

        panel.addEventListener('contextmenu', async (e) => {
            if (!e.target.closest('.vn-panel-tags-chips')) return;
            const chip = e.target.closest('.vn-tag-chip');
            if (!chip) return;
            e.preventDefault();
            const presetId = this.selectedPresetId;
            if (!presetId) return;
            const tag = chip.dataset.tag;
            const preset = await VNPresets.load(presetId);
            if (!preset) return;
            const sorted = await VNPresets.setTags(presetId, (preset.tags || []).filter(t => t !== tag));
            if (sorted) this._refresh(root, sorted);
        });
    }

    refresh(root, sorted) {
        if (this.selectedPresetId) {
            const still = sorted.find(p => p.id === this.selectedPresetId);
            if (still) {
                this._markSelectedItem(root, this.selectedPresetId);
                this.render(root, still);
            } else {
                this.selectedPresetId = null;
                this.render(root, null);
            }
        }
        this.attachListeners(root);
    }
}

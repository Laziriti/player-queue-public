// ============================================================
// vn-dialog-builder.js — UI диалога настроек сцены
// ============================================================

import { VNSceneState } from '../scene/vn-scene-state.js';
import { VNPresets } from '../presets/vn-presets.js';
import { readSceneSnapshot, readScenePatch } from '../scene/vn-scene-contract.js';
import { VNTransitions } from '../visual-effects/vn-transitions.js';
import { collectCharacterForm } from './vn-character-form.js';
import { VNCharactersManager } from './vn-characters-manager.js';
import { VNBackgroundManager } from './vn-background-manager.js';
import { VNEffectsManager } from './vn-effects-manager.js';
import { VNMusicManager } from './vn-music-manager.js';
import { VNPresetsManager } from './presets/vn-presets-manager.js';
import { VNAdventureIOManager } from './vn-adventure-io-manager.js';
import { MODULE_ID } from '../vn-constants.js';
import { debounce } from '../../utils/timing.js';
import { readLocalJSON, writeLocalJSON } from '../../utils/local-storage.js';

export class VNDialogBuilder {
    /** getState is read-only to the editor; all live-scene writes go through actions.
     * favorites exposes list/load/add/remove; tabs may be injected independently for previews/tests.
     */
    constructor({ getState, actions, favorites, tabs = {} }) {
        this._getState = getState;
        this._actions = actions;
        this._favorites = favorites;
        this.tabs = {
            background: tabs.background ?? new VNBackgroundManager(MODULE_ID),
            effects: tabs.effects ?? new VNEffectsManager(),
            music: tabs.music ?? new VNMusicManager(),
            presets: tabs.presets ?? new VNPresetsManager(),
            adventureIO: tabs.adventureIO ?? new VNAdventureIOManager(),
        };
        this._characters = new VNCharactersManager(favorites);
        this._dialog = null;
        this._scaleDialog = null;
        this._dialogAbortCtrl = null;
        this._pendingFlipped = null;
        this._pendingScales = null;
        this._pendingSpeakers = null;
    }

    get dialog() { return this._dialog; }
    get state() { return this._getState(); }

    // ══════════════════════════════════════════════════════════
    // Main Scene Dialog
    // ══════════════════════════════════════════════════════════

    openSceneDialog() { return this._show(false); }
    editSceneDialog() { return this.state.isActive ? this._show(true) : undefined; }

    static _DIALOG_SIZE_KEY = 'player-queue.vn-dialog-size';

    async _show(isEdit) {
        // Opening takes several awaits: a second call before the first one finishes must replace it, not add a second window
        this.close();
        const token = this._showToken;
        this._pendingFlipped = null;
        this._pendingScales = null;
        this._pendingSpeakers = null;
        this._stepEdit = null;
        this._dialogAbortCtrl = new AbortController();
        this._characters.reset(this._dialogAbortCtrl.signal);

        const tokens = canvas.tokens.placeables.filter(t => t.actor);

        await this.tabs.background.restoreLastPath();
        await this._favorites.load();

        const sorted = await VNPresets.getSorted();
        if (token !== this._showToken) return;
        const presetsHTML = this.tabs.presets.generateTab(sorted);
        const ioHTML = this.tabs.adventureIO.generateTab(sorted);
        const dialogContent = this._generateContent(tokens, isEdit ? this.state : null, presetsHTML, ioHTML);

        const savedSize = readLocalJSON(VNDialogBuilder._DIALOG_SIZE_KEY);
        const dialogPosition = (savedSize?.width >= 600 && savedSize?.height >= 400)
            ? { width: savedSize.width, height: savedSize.height }
            : { width: 1050, height: 840 };

        const keepOpen = game.settings.get(MODULE_ID, 'keepSceneEditorOpen');
        this._baseTitle = isEdit ? game.i18n.localize('vn.dialog.editTitle') : game.i18n.localize('vn.dialog.createTitle');
        const dialog = new foundry.applications.api.DialogV2({
            classes: ['vn-scene-window', 'vn-scene-window--tabs', ...(isEdit ? ['vn-scene-window--edit'] : [])],
            window: { title: this._baseTitle, icon: isEdit ? 'fas fa-edit' : 'fas fa-theater-masks', resizable: true, minimizable: keepOpen },
            position: dialogPosition,
            form: { closeOnSubmit: !keepOpen },
            submit: (action, dlg) => { if (keepOpen && action === 'cancel') return dlg.close({ submitted: true }); },
            content: dialogContent,
            buttons: [
                { action: 'create', label: isEdit ? game.i18n.localize('vn.dialog.btnUpdate') : game.i18n.localize('vn.dialog.btnCreate'), icon: isEdit ? 'fas fa-sync' : 'fas fa-play', default: true,
                    callback: (_, __, dlg) => { this._applyScene(dlg, false); } },
                { action: 'background-only', label: isEdit ? game.i18n.localize('vn.dialog.btnRemoveCharacters') : game.i18n.localize('vn.dialog.btnBackgroundOnly'), icon: 'fas fa-image',
                    callback: (_, __, dlg) => { this._applyScene(dlg, true); } },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' }
            ]
        });

        dialog.addEventListener('render', () => {
            if (this._dialog === dialog) this._setupInteractions(dialog.element, isEdit);
        });
        dialog.addEventListener('close', () => {
            const { width, height } = dialog.position ?? {};
            if (width >= 600 && height >= 400) writeLocalJSON(VNDialogBuilder._DIALOG_SIZE_KEY, { width, height });
            // A dialog that was replaced by a newer one closes late: it must not drop the newer one's reference and listeners
            if (this._dialog !== dialog) return;
            this.tabs.presets.dispose(dialog.element);
            this._dialog = null;
            this._dialogAbortCtrl?.abort();
            this._dialogAbortCtrl = null;
            this._characters.reset();
        });
        this._dialog = dialog;
        dialog.render({ force: true });
    }

    close() {
        this._showToken = (this._showToken ?? 0) + 1;
        const dialog = this._dialog;
        this._dialog = null;
        if (dialog) this.tabs.presets.dispose(dialog.element);
        this._dialogAbortCtrl?.abort();
        this._dialogAbortCtrl = null;
        this._characters.reset();
        try { dialog?.close(); } catch {}
    }

    // ══════════════════════════════════════════════════════════
    // Submit
    // ══════════════════════════════════════════════════════════

    _applyScene(dialog, backgroundOnly) {
        const root = dialog.element;
        const form = root.querySelector('.vn-scene-dialog--tabs');
        const isEdit = form.dataset.mode === 'edit' && this.state.isActive;
        const result = this._handleSubmit(root, isEdit, backgroundOnly);
        if (result === false || dialog.options.form.closeOnSubmit) return;
        if (backgroundOnly) this._characters.moveTokensToPositions(root, this.state);
        if (!isEdit) this._setMode(dialog, true);
    }

    _setMode(dialog, isEdit) {
        const root = dialog.element;
        const form = root.querySelector('.vn-scene-dialog--tabs');
        form.dataset.mode = isEdit ? 'edit' : 'create';
        root.classList.toggle('vn-scene-window--edit', isEdit);
        const loc = key => game.i18n.localize(key);
        this._baseTitle = loc(isEdit ? 'vn.dialog.editTitle' : 'vn.dialog.createTitle');
        this._syncTitle(form.dataset.tab);
        if (dialog.window?.icon) dialog.window.icon.className = isEdit ? 'window-icon fas fa-edit fa-fw' : 'window-icon fas fa-theater-masks fa-fw';
        const create = root.querySelector('.form-footer button[data-action="create"]');
        create.querySelector('i').className = isEdit ? 'fas fa-sync' : 'fas fa-play';
        create.querySelector('span').textContent = loc(isEdit ? 'vn.dialog.btnUpdate' : 'vn.dialog.btnCreate');
        const backgroundOnly = root.querySelector('.form-footer button[data-action="background-only"]');
        backgroundOnly.querySelector('span').textContent = loc(isEdit ? 'vn.dialog.btnRemoveCharacters' : 'vn.dialog.btnBackgroundOnly');
        this._syncFooter(root, form.dataset.tab);
    }

    sceneClosed() {
        const dialog = this._dialog;
        if (dialog?.rendered && !dialog.options.form.closeOnSubmit) this._setMode(dialog, false);
    }

    _handleSubmit(root, isEdit, backgroundOnly = false) {
        const payload = this._gatherDialogPayload(root, { backgroundOnly });
        // A layout edit retains live transforms unless a preset supplied replacements.
        // Global scale and speakers keep their existing submit behavior; saved presets include both.
        delete payload.portraitScale;
        delete payload.speakers;
        payload.flipped = this._pendingFlipped == null ? (isEdit ? null : {}) : payload.flipped;
        payload.portraitScales = this._pendingScales == null ? (isEdit ? null : {}) : payload.portraitScales;
        payload.gmOnly = root.querySelector('#vn-gm-only-toggle')?.checked ?? false;
        this._pendingFlipped = null;
        this._pendingScales = null;
        this._pendingSpeakers = null;
        if (isEdit) return this._actions.updateSceneLayout(payload);
        return this._actions.createScene(payload);
    }

    // ══════════════════════════════════════════════════════════
    // Dialog Interactions Setup
    // ══════════════════════════════════════════════════════════

    _setupInteractions(root, isEdit) {
        this._characters.attachListeners(root);
        this.tabs.background.attachListeners(root);
        this.tabs.effects.attachListeners(root);
        this.tabs.music.attachListeners(root);
        this.tabs.presets.attachListeners(root, {
            gatherState: (root) => this._gatherDialogState(root),
            applyPreset: (root, preset) => this.applyPreset(root, preset),
            launchScene: async (preset, stepIndex = null) => {
                const dialog = this._dialog;
                if (!await this._actions.launchPreset(preset, { stepIndex }) || this._dialog !== dialog) return;
                if (dialog.options.form.closeOnSubmit) return dialog.close();
                this.applyPreset(root, this.state.toPayload());
                this._pendingFlipped = this._pendingScales = this._pendingSpeakers = null;
                this._setMode(dialog, true);
                this.syncPrivacy();
            },
            getLiveState: () => (this.state.isActive ? this.state : null),
            onSequenceChanged: (preset) => this._actions.syncSequence(preset),
            onPresetCreated: (preset) => {
                if (root.querySelector('.vn-scene-dialog--tabs').dataset.mode === 'edit') this._actions.bindPreset(preset);
            },
            beginStepEdit: (root, edit) => this.beginStepEdit(root, edit),
            syncPresetActors: ids => this._actions.syncPresetActors(ids),
            onChanged: (root) => this.tabs.adventureIO.refreshExportList(root),
        });
        this.tabs.adventureIO.attachListeners(root, {
            onImported: (root) => this.tabs.presets.refresh(root),
        });
        this._setupTabs(root);
        this._syncFooter(root, 'characters');
        this._setupStepEditBanner(root);

        if (isEdit && this.state.isActive) {
            this.syncPrivacy();
            const signal = this._dialogAbortCtrl.signal;
            requestAnimationFrame(() => {
                if (signal.aborted || !root.isConnected) return;
                this._characters.moveTokensToPositions(root, this.state);
                this._setDefaults(root);
            });
        }
    }

    syncPrivacy() {
        const form = this._dialog?.element?.querySelector('.vn-scene-dialog--tabs[data-mode="edit"]');
        if (form) form.querySelector('#vn-gm-only-toggle').checked = this._actions.isPrivate?.() ?? false;
    }

    _setupTabs(root) {
        root.querySelectorAll('.vn-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = btn.dataset.tab;
                root.querySelectorAll('.vn-tab-btn').forEach(b => b.classList.remove('active'));
                root.querySelectorAll('.vn-tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                root.querySelector(`.vn-tab-panel[data-tab="${tab}"]`)?.classList.add('active');
                // The active tab is mirrored on the dialog root so CSS can adapt the footer to it
                const dialogRoot = root.querySelector('.vn-scene-dialog--tabs');
                if (dialogRoot) dialogRoot.dataset.tab = tab;
                this._syncTitle(tab);
                this._syncFooter(root, tab);
            });
        });
    }

    // Presets and import/export have their own launch/apply buttons: the footer's "update/create scene" and
    // "remove characters / background only" would apply the half-edited form behind those tabs, so they are
    // hidden and disabled there (disabled also stops Enter in a text field from submitting the form through the default button).
    // Cancel turns into "Close" since nothing is being cancelled on those tabs.
    static _NO_APPLY_TABS = new Set(['presets', 'adventure-io']);

    _syncFooter(root, tab) {
        const footer = root.querySelector('.form-footer');
        if (!footer) return;
        const off = VNDialogBuilder._NO_APPLY_TABS.has(tab);
        for (const action of ['create', 'background-only']) {
            const btn = footer.querySelector(`button[data-action="${action}"]`);
            if (btn) { btn.hidden = off; btn.disabled = off; }
        }
        const bgOnly = footer.querySelector('button[data-action="background-only"]');
        if (bgOnly) bgOnly.title = game.i18n.localize(root.querySelector('.vn-scene-dialog--tabs')?.dataset.mode === 'edit' ? 'vn.dialog.btnRemoveCharactersHint' : 'vn.dialog.btnBackgroundOnlyHint');
        const label = footer.querySelector('button[data-action="cancel"] span');
        if (label) {
            label.dataset.label ??= label.textContent;
            label.textContent = off ? game.i18n.localize('vn.dialog.btnClose') : label.dataset.label;
        }
    }

    // ── Editing one step of a composite preset in the regular form ──
    // The step is loaded into the form, a banner says what is being edited, and "Save to step" writes the form back
    // and returns to the presets tab — instead of hopping between tabs to find the right button.

    beginStepEdit(root, { preset, step, stepId, index }) {
        this.applyPreset(root, step);
        this._stepEdit = { presetId: preset.id, stepId, index, name: preset.name };
        const banner = root.querySelector('.vn-edit-banner');
        if (banner) {
            banner.querySelector('.vn-edit-banner-text').textContent = game.i18n.format('vn.sequence.editBanner', { n: index + 1, name: preset.name });
            banner.hidden = false;
        }
        const dialogRoot = root.querySelector('.vn-scene-dialog--tabs');
        if (dialogRoot) dialogRoot.dataset.editing = 'step';
        root.querySelector('.vn-tab-btn[data-tab="characters"]')?.click();
    }

    endStepEdit(root) {
        this._stepEdit = null;
        const banner = root.querySelector('.vn-edit-banner');
        if (banner) banner.hidden = true;
        root.querySelector('.vn-scene-dialog--tabs')?.removeAttribute('data-editing');
    }

    _setupStepEditBanner(root) {
        root.querySelector('.vn-edit-banner-save')?.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!this._stepEdit) return;
            const saved = await this.tabs.presets.saveFormToStep(root, this._stepEdit);
            if (!saved) {
                ui.notifications.warn(game.i18n.localize('vn.sequence.editLost'));
                this.endStepEdit(root);
                return;
            }
            this.endStepEdit(root);
            root.querySelector('.vn-tab-btn[data-tab="presets"]')?.click();
        });
        root.querySelector('.vn-edit-banner-cancel')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.endStepEdit(root);
        });
    }

    /** Presets and import/export are not "creating a scene" — the window title says what the tab is for. */
    _syncTitle(tab) {
        const key = { presets: 'vn.dialog.titlePresets', 'adventure-io': 'vn.dialog.titleIO' }[tab];
        const heading = this._dialog?.window?.title;
        if (heading) heading.textContent = key ? game.i18n.localize(key) : this._baseTitle;
    }

    // ══════════════════════════════════════════════════════════
    // Apply form values
    // ══════════════════════════════════════════════════════════

    _setDefaults(root) {
        const state = this.state;
        this._setEntrances(root, state);

        this.tabs.background.applyState(root, state);
        this.tabs.effects.applyState(root, state);
        this._characters.applyDefaults(root, state);
        this.tabs.music.applyState(root, state);
    }

    applyPreset(root, preset) {
        preset = readSceneSnapshot(preset);
        this._setEntrances(root, preset);
        this._pendingFlipped = preset.flipped || {};
        this._pendingScales = preset.portraitScales || {};
        this._pendingSpeakers = preset.speakers || {};
        this._characters.applyPreset(root, preset);
        this.tabs.background.applyState(root, preset);
        this.tabs.effects.applyState(root, preset);
        this.tabs.music.applyState(root, preset);
    }

    /**
     * Active speakers for a saved preset: the ones of the preset just loaded into the form, otherwise those of the running scene.
     * The form has no speaker control, so without this every saved preset lost them. A speaker only stays if
     * that character is still in the same zone of the form.
     */
    _gatherSpeakers(idsByPosition) {
        const source = this._pendingSpeakers ?? (this.state.isActive ? this.state.speakers : null);
        return Object.fromEntries(VNSceneState.POSITIONS.map(pos => {
            const id = source?.[pos] ?? null;
            return [pos, id && idsByPosition[pos].includes(id) ? id : null];
        }));
    }

    _gatherDialogState(root) {
        const state = new VNSceneState();
        state.fromPayload(this._gatherDialogPayload(root));
        return state;
    }

    _gatherDialogPayload(root, { backgroundOnly = false } = {}) {
        const characters = collectCharacterForm(root, { backgroundOnly });
        const { ids, portraitImages, portraitNames, visibility, charFx } = characters;
        const rawScales = this._pendingScales ?? (this.state.isActive ? this.state.portraitScales : {});
        const rawFlipped = this._pendingFlipped ?? this.state.flipped;
        const remappedScales = characters.remap(rawScales);
        const remappedFlipped = characters.remap(rawFlipped);

        return readScenePatch({
            leftIds: ids.left,
            centerIds: ids.center,
            rightIds: ids.right,
            ...this.tabs.background.readState(root),
            ...this._gatherEntrances(root),
            ...this.tabs.effects.readState(root),
            portraitScale: this.state.portraitScale,
            portraitScales: remappedScales,
            speakers: this._gatherSpeakers(ids),
            visibility,
            charFx,
            ...this.tabs.music.readState(root),
            flipped: Object.fromEntries(Object.entries(remappedFlipped).filter(([, value]) => value)),
            portraitImages,
            portraitNames,
            presetActors: [...root.querySelectorAll('#scene-participants .vn-token-option')]
                .map(el => el.dataset.actorId ? `actor-${el.dataset.actorId}` : el.dataset.tokenId || null).filter(Boolean),
        });
    }

    // ══════════════════════════════════════════════════════════
    // Portrait Scale Dialog
    // ══════════════════════════════════════════════════════════

    openScaleDialog() {
        if (!game.user.isGM) return;
        if (this._scaleDialog) { try { this._scaleDialog.close(); } catch {} }

        const currentPercent = Math.round(this.state.portraitScale * 100);
        const presets = [50, 75, 100, 125, 150, 200];
        const debouncedScale = debounce(val => this._actions.setPortraitScale(val / 100, false), 30);

        const dialog = new foundry.applications.api.DialogV2({
            classes: ['vn-scale-window'],
            window: { title: game.i18n.localize('vn.dialog.portraitSizeTitle'), icon: 'fas fa-expand-arrows-alt' },
            position: { width: 380, height: 'auto' },
            content: `<div class="vn-scale-dialog">
                <div class="vn-scale-header"><label>${game.i18n.localize('vn.dialog.scaleLabel')}</label><span class="vn-scale-value" id="scale-value">${currentPercent}%</span></div>
                <input type="range" id="portrait-scale-slider" name="scaleSlider" min="50" max="200" step="5" value="${currentPercent}">
                <div class="vn-scale-presets">${presets.map(v => `<button type="button" class="vn-btn vn-scale-preset ${v === currentPercent ? 'active' : ''}" data-scale="${v}">${v}%</button>`).join('')}</div>
            </div>`,
            buttons: [
                { action: 'apply', label: game.i18n.localize('vn.dialog.btnApplyForAll'), icon: 'fas fa-check', default: true,
                    callback: (_, button) => this._actions.setPortraitScale(parseInt(button.form.elements.scaleSlider.value) / 100, true) },
                { action: 'cancel', label: game.i18n.localize('vn.dialog.btnCancel'), icon: 'fas fa-times' }
            ]
        });

        dialog.addEventListener('render', () => {
            const root = dialog.element;
            const slider = root.querySelector('#portrait-scale-slider');
            const display = root.querySelector('#scale-value');

            slider?.addEventListener('input', () => {
                display.textContent = slider.value + '%';
                debouncedScale(parseInt(slider.value));
                root.querySelectorAll('.vn-scale-preset').forEach(btn =>
                    btn.classList.toggle('active', btn.dataset.scale === slider.value));
            });

            root.querySelectorAll('.vn-scale-preset').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const s = parseInt(btn.dataset.scale);
                    slider.value = s;
                    display.textContent = s + '%';
                    this._actions.setPortraitScale(s / 100, false);
                    root.querySelectorAll('.vn-scale-preset').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        });

        dialog.addEventListener('close', () => {
            debouncedScale.cancel();
            if (this._scaleDialog === dialog) this._scaleDialog = null;
        });
        this._scaleDialog = dialog;
        dialog.render({ force: true });
    }

    // ══════════════════════════════════════════════════════════
    // HTML Generation
    // ══════════════════════════════════════════════════════════

    _gatherEntrances(root) {
        return Object.fromEntries(['initialEntrance', 'characterEntrance'].map(key =>
            [key, VNTransitions.resolveEntrance(root.querySelector(`[name="${key}"]`)?.value)]));
    }

    _setEntrances(root, source) {
        for (const key of ['initialEntrance', 'characterEntrance']) {
            const select = root.querySelector(`[name="${key}"]`);
            if (select) select.value = VNTransitions.resolveEntrance(source[key]);
        }
    }

    _entrancesHTML(source) {
        return `<fieldset class="vn-entrances">
            <legend><i class="fas fa-person-walking-arrow-right"></i> ${game.i18n.localize('vn.entrance.title')}</legend>
            ${['initialEntrance', 'characterEntrance'].map(key => `<label class="vn-entrance-field">
                <span>${game.i18n.localize(`vn.entrance.${key}`)}</span>
                <select name="${key}" title="${game.i18n.localize(`vn.entrance.${key}Hint`)}">
                    ${VNTransitions.ENTER_TYPES.map(type => `<option value="${type}"${VNTransitions.resolveEntrance(source?.[key]) === type ? ' selected' : ''}>${game.i18n.localize(`vn.entrance.types.${type}`)}</option>`).join('')}
                </select>
            </label>`).join('')}
        </fieldset>`;
    }

    _generateContent(tokens, sceneState, presetsHTML = '', ioHTML = '') {
        const currentOverlay = sceneState ? sceneState.backgroundOverlay !== false : true;
        const currentVignette = sceneState ? sceneState.vignette !== false : true;
        const currentFog = sceneState ? sceneState.groundFog !== false : true;
        const currentBg = sceneState?.background || null;
        const currentParticle = sceneState?.particleEffect || 'none';
        const currentVisual = sceneState?.visualEffect || 'none';
        const currentMusicUuid = sceneState?.musicUuid || null;
        const currentSoundCues = sceneState?.soundCues || [];

        return `<div class="vn-scene-dialog vn-scene-dialog--tabs" data-tab="characters" data-mode="${sceneState ? 'edit' : 'create'}">
            <div class="vn-edit-banner" hidden>
                <i class="fas fa-pen-to-square"></i>
                <span class="vn-edit-banner-text"></span>
                <button type="button" class="vn-btn vn-btn-sm vn-btn-accent vn-edit-banner-save"><i class="fas fa-floppy-disk"></i> ${game.i18n.localize('vn.sequence.editSave')}</button>
                <button type="button" class="vn-btn vn-btn-sm vn-edit-banner-cancel">${game.i18n.localize('vn.sequence.editCancel')}</button>
            </div>
            <div class="vn-tabs">
                <button type="button" class="vn-tab-btn active" data-tab="characters" title="${game.i18n.localize('vn.dialog.tabCharacters')}"><i class="fas fa-users"></i><span class="vn-tab-label">${game.i18n.localize('vn.dialog.tabCharacters')}</span></button>
                <button type="button" class="vn-tab-btn" data-tab="background" title="${game.i18n.localize('vn.dialog.tabBackground')}"><i class="fas fa-image"></i><span class="vn-tab-label">${game.i18n.localize('vn.dialog.tabBackground')}</span></button>
                <button type="button" class="vn-tab-btn" data-tab="effects" title="${game.i18n.localize('vn.dialog.tabEffects')}"><i class="fas fa-wand-magic-sparkles"></i><span class="vn-tab-label">${game.i18n.localize('vn.dialog.tabEffects')}</span></button>
                <button type="button" class="vn-tab-btn" data-tab="music" title="${game.i18n.localize('vn.dialog.tabMusic')}"><i class="fas fa-music"></i><span class="vn-tab-label">${game.i18n.localize('vn.dialog.tabMusic')}</span></button>
                <button type="button" class="vn-tab-btn" data-tab="presets" title="${game.i18n.localize('vn.dialog.tabPresets')}"><i class="fas fa-bookmark"></i><span class="vn-tab-label">${game.i18n.localize('vn.dialog.tabPresets')}</span></button>
                <button type="button" class="vn-tab-btn" data-tab="adventure-io" title="${game.i18n.localize('vn.dialog.tabAdventures')}"><i class="fas fa-boxes-stacked"></i><span class="vn-tab-label">${game.i18n.localize('vn.dialog.tabAdventures')}</span></button>
                <label class="vn-gm-only-toggle" title="${game.i18n.localize('vn.dialog.gmOnlyToggleTitle')}">
                    <input type="checkbox" id="vn-gm-only-toggle"><span class="vn-toggle-track"></span>
                    <i class="fas fa-eye-slash"></i><span class="vn-gm-label">${game.i18n.localize('vn.dialog.gmOnlyLabel')}</span>
                </label>
            </div>
            <div class="vn-tab-panel active" data-tab="characters">
                ${this._characters.generateTab(tokens, sceneState, this._entrancesHTML(sceneState))}
            </div>
            <div class="vn-tab-panel" data-tab="background">
                ${this.tabs.background.generateSelector(currentBg, currentOverlay, currentVignette, currentFog)}
            </div>
            <div class="vn-tab-panel" data-tab="effects">
                ${this.tabs.effects.generateTab(currentParticle, currentVisual, sceneState ?? undefined)}
            </div>
            <div class="vn-tab-panel" data-tab="music">
                ${this.tabs.music.generateTab(currentMusicUuid, currentSoundCues)}
            </div>
            <div class="vn-tab-panel" data-tab="presets">${presetsHTML}</div>
            <div class="vn-tab-panel" data-tab="adventure-io">${ioHTML}</div>
        </div>`;
    }

}

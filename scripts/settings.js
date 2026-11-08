// ============================================================
// settings.js — registerSettings function
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { ModuleSettingsApp } from './module-settings.js';
import { NAMEPLATE_FONTS, applyNameplateImage, applyNameplateFont } from './visual-dialog/vn-nameplate.js';

// Every setting below has config:false: they are all edited in ModuleSettingsApp (scripts/module-settings.js), whose single menu button
// is the only thing the standard Foundry settings page shows for this module.
function registerSettings() {
    const S = (key, opts) => game.settings.register(PlayerQueue.ID, key, opts);
    // Пересоздаём floating queue с новыми настройками
    const onFloatingChange = () => PlayerQueue.instance?.widget.rebuild();

    game.settings.registerMenu(PlayerQueue.ID, 'moduleSettings', {
        name: 'settings.moduleSettings.name',
        label: 'settings.moduleSettings.label',
        hint: 'settings.moduleSettings.hint',
        icon: 'fas fa-gear',
        type: ModuleSettingsApp,
        restricted: false
    });

    S('queueState', {
        scope: 'world',
        config: false,
        type: Object,
        default: { rev: 0, nextOrder: 1, entries: [] },
        onChange: (value) => PlayerQueue.instance?.onStateSetting(value)
    });

    S('queuePosition', {
        name: 'settings.queuePosition.name',
        hint: 'settings.queuePosition.hint',
        scope: 'client', config: false, type: String, default: 'bottom-right',
        choices: {
            'top-left':     game.i18n.localize('settings.queuePosition.topLeft'),
            'top-right':    game.i18n.localize('settings.queuePosition.topRight'),
            'bottom-left':  game.i18n.localize('settings.queuePosition.bottomLeft'),
            'bottom-right': game.i18n.localize('settings.queuePosition.bottomRight')
        },
        onChange: () => {
            localStorage.removeItem(`${PlayerQueue.ID}-position`);
            onFloatingChange();
        }
    });

    S('queueOrientation', {
        name: 'settings.queueOrientation.name',
        hint: 'settings.queueOrientation.hint',
        scope: 'client', config: false, type: String, default: 'vertical',
        choices: {
            vertical:   game.i18n.localize('settings.queueOrientation.vertical'),
            horizontal: game.i18n.localize('settings.queueOrientation.horizontal')
        },
        onChange: onFloatingChange
    });

    S('queueSize', {
        name: 'settings.queueSize.name',
        hint: 'settings.queueSize.hint',
        scope: 'client', config: false, type: Number, default: 50,
        range: { min: 30, max: 100, step: 5 },
        onChange: onFloatingChange
    });

    S('queueMaxItems', {
        name: 'settings.queueMaxItems.name',
        hint: 'settings.queueMaxItems.hint',
        scope: 'client', config: false, type: Number, default: 8,
        range: { min: 3, max: 15, step: 1 },
        onChange: onFloatingChange
    });

    S('queueCompact', {
        name: 'settings.queueCompact.name',
        hint: 'settings.queueCompact.hint',
        scope: 'client', config: false, type: Boolean, default: false,
        onChange: onFloatingChange
    });

    S('queueDuringScene', {
        name: 'settings.queueDuringScene.name',
        hint: 'settings.queueDuringScene.hint',
        scope: 'client', config: false, type: String, default: 'top',
        choices: {
            top:  game.i18n.localize('settings.queueDuringScene.top'),
            keep: game.i18n.localize('settings.queueDuringScene.keep')
        },
        onChange: () => {
            PlayerQueue.instance?.widget.rebuild();
            window.visualNovelScene?.updateQueueDisplay();
        }
    });

    S('announceInChat', {
        name: 'settings.announceInChat.name',
        hint: 'settings.announceInChat.hint',
        scope: 'world', config: false, type: Boolean, default: true
    });

    S('enableSounds', {
        name: 'settings.enableSounds.name',
        hint: 'settings.enableSounds.hint',
        scope: 'client', config: false, type: Boolean, default: true
    });

    S('soundVolume', {
        name: 'settings.soundVolume.name',
        hint: 'settings.soundVolume.hint',
        scope: 'client', config: false, type: Number, default: 50,
        range: { min: 0, max: 100, step: 5 }
    });

    S('soundOnlyForSelf', {
        name: 'settings.soundOnlyForSelf.name',
        hint: 'settings.soundOnlyForSelf.hint',
        scope: 'client', config: false, type: Boolean, default: false
    });

    S('enableLowPrioritySound', {
        name: 'settings.enableLowPrioritySound.name',
        hint: 'settings.enableLowPrioritySound.hint',
        scope: 'client', config: false, type: Boolean, default: true
    });

    S('enableMediumPrioritySound', {
        name: 'settings.enableMediumPrioritySound.name',
        hint: 'settings.enableMediumPrioritySound.hint',
        scope: 'client', config: false, type: Boolean, default: true
    });

    S('enableHighPrioritySound', {
        name: 'settings.enableHighPrioritySound.name',
        hint: 'settings.enableHighPrioritySound.hint',
        scope: 'client', config: false, type: Boolean, default: true
    });

    S('darkTheme', {
        name: 'settings.darkTheme.name',
        hint: 'settings.darkTheme.hint',
        scope: 'client', config: false, type: Boolean, default: false,
        onChange: (v) => PlayerQueue.instance?.updateTheme(v)
    });

    S('nameplateImage', {
        name: 'settings.nameplateImage.name',
        hint: 'settings.nameplateImage.hint',
        scope: 'world', config: false, type: String,
        default: 'modules/player-queue/assets/dialog name labels/name_label_drakkenheim.webp',
        onChange: (v) => applyNameplateImage(v)
    });

    S('nameplateFont', {
        name: 'settings.nameplateFont.name',
        hint: 'settings.nameplateFont.hint',
        scope: 'world', config: false, type: String, default: '',
        choices: {
            '': game.i18n.localize('settings.nameplateFont.defaultFont'),
            ...Object.fromEntries(Object.entries(NAMEPLATE_FONTS).map(([key, f]) => [key, f.label]))
        },
        onChange: (v) => applyNameplateFont(v)
    });

    S('backgroundFolder', {
        scope: 'world', config: false, type: String, default: ''
    });

    // Where preset thumbnails are written. Empty = a per-world default; any folder in Data works (including one inside a module).
    S('thumbnailFolder', {
        name: 'settings.thumbnailFolder.name',
        hint: 'settings.thumbnailFolder.hint',
        scope: 'world', config: false, type: String, default: ''
    });

    S('liteMode', {
        name: 'settings.liteMode.name',
        hint: 'settings.liteMode.hint',
        scope: 'client', config: false, type: Boolean, default: false,
        onChange: () => window.visualNovelScene?.applyLiteMode()
    });

    // Fine-grained alternative to the lite mode: which effects this client does not draw, and a ceiling for the particle intensity.
    // Edited in the EffectFiltersApp window (opened from the performance section of the module settings), so the two settings themselves are hidden.
    S('fxDisabled', { scope: 'client', config: false, type: Array, default: [] });
    S('particleIntensityMax', { scope: 'client', config: false, type: Number, default: 20 });

    S('parallaxEnabled', {
        name: 'settings.parallaxEnabled.name',
        hint: 'settings.parallaxEnabled.hint',
        scope: 'client', config: false, type: Boolean, default: true,
        onChange: v => window.visualNovelScene?.setParallaxOptions({ enabled: v })
    });

    S('parallaxDepth', {
        name: 'settings.parallaxDepth.name',
        hint: 'settings.parallaxDepth.hint',
        scope: 'client', config: false, type: Number, default: 50,
        range: { min: 0, max: 100, step: 10 },
        onChange: v => window.visualNovelScene?.setParallaxOptions({ depth: v })
    });

    S('cameraEnabled', {
        name: 'settings.cameraEnabled.name',
        hint: 'settings.cameraEnabled.hint',
        scope: 'client', config: false, type: Boolean, default: true,
        onChange: v => window.visualNovelScene?.setCameraEnabled(v)
    });

    S('dimInactive', {
        name: 'settings.dimInactive.name',
        hint: 'settings.dimInactive.hint',
        scope: 'world', config: false, type: Boolean, default: true,
        onChange: () => window.visualNovelScene?.applyInactiveLook()
    });

    S('blurInactive', {
        name: 'settings.blurInactive.name',
        hint: 'settings.blurInactive.hint',
        scope: 'world', config: false, type: Boolean, default: true,
        onChange: () => window.visualNovelScene?.applyInactiveLook()
    });

    S('cameraDoF', {
        name: 'settings.cameraDoF.name',
        hint: 'settings.cameraDoF.hint',
        scope: 'client', config: false, type: Boolean, default: true,
        onChange: () => window.visualNovelScene?._reapplyCameraDof()
    });

    S('kenBurnsDirection', {
        name: 'settings.kenBurnsDirection.name',
        hint: 'settings.kenBurnsDirection.hint',
        scope: 'client', config: false, type: String, default: 'none',
        choices: {
            none: 'settings.kenBurnsDirection.none',
            random: 'settings.kenBurnsDirection.random',
            left: 'settings.kenBurnsDirection.left',
            right: 'settings.kenBurnsDirection.right',
        },
        onChange: v => window.visualNovelScene?.setParallaxOptions({ kenBurns: { enabled: v !== 'none', direction: v } })
    });
}

export { registerSettings };

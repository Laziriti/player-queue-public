// ============================================================
// settings.js — registerSettings function
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { SoundTestApp } from './sound-test.js';

// Per-nameplate display parameters. Add an entry here for each new nameplate image.
// ratio:     width / height aspect ratio of the frame image
// textWidth: fixed width of the text element in px (nameplate is always this width)
// paddingX:  how far the frame image extends beyond the text element on each side (px)
//            — use this to accommodate decorative elements around the text zone
// offsetY:   vertical shift of frame image from text center in px (positive = image shifts down)
// fontSize:  text font size (any CSS value)
const NAMEPLATE_CONFIGS = {
    'modules/player-queue/assets/dialog name labels/name_label_drakkenheim.webp': {
        label:     'Drakkenheim',
        ratio:     4.94,
        textWidth: 200,
        paddingX:  70,
        offsetY:   -3,
        fontSize:  '0.9em',
    },
    'modules/player-queue/assets/dialog name labels/name_label_dark_fantasy.webp': {
        label:     'Dark Fantasy',
        ratio:     4.94,
        textWidth: 200,
        paddingX:  70,
        offsetY:   -3,
        fontSize:  '0.9em',
    },
    'modules/player-queue/assets/dialog name labels/name_label_knight.webp': {
        label:     'Knight',
        ratio:     4.94,
        textWidth: 200,
        paddingX:  70,
        offsetY:   -3,
        fontSize:  '0.9em',
    },
    'modules/player-queue/assets/dialog name labels/name_label_strahd.webp': {
        label:     'Curse of Strahd',
        ratio:     4.94,
        textWidth: 200,
        paddingX:  70,
        offsetY:   -3,
        fontSize:  '0.9em',
    },
};

function registerSettings() {
    const S = (key, opts) => game.settings.register(PlayerQueue.ID, key, opts);
    const onFloatingChange = () => {
        // Пересоздаём floating queue с новыми настройками
        const el = document.getElementById('floating-queue');
        if (el) {
            if (PlayerQueue.instance?._dragController) {
                PlayerQueue.instance._dragController.abort();
                PlayerQueue.instance._dragController = null;
            }
            el.remove();
        }
        PlayerQueue.instance?.updateFloatingQueue();
    };

    S('queueData', { scope: 'world', config: false, type: Array, default: [] });

    S('queuePosition', {
        name: 'settings.queuePosition.name',
        hint: 'settings.queuePosition.hint',
        scope: 'client', config: true, type: String, default: 'bottom-right',
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
        scope: 'client', config: true, type: String, default: 'vertical',
        choices: {
            vertical:   game.i18n.localize('settings.queueOrientation.vertical'),
            horizontal: game.i18n.localize('settings.queueOrientation.horizontal')
        },
        onChange: onFloatingChange
    });

    S('queueSize', {
        name: 'settings.queueSize.name',
        hint: 'settings.queueSize.hint',
        scope: 'client', config: true, type: Number, default: 50,
        range: { min: 30, max: 100, step: 5 },
        onChange: onFloatingChange
    });

    S('queueMaxItems', {
        name: 'settings.queueMaxItems.name',
        hint: 'settings.queueMaxItems.hint',
        scope: 'client', config: true, type: Number, default: 8,
        range: { min: 3, max: 15, step: 1 },
        onChange: onFloatingChange
    });

    S('enableSounds', {
        name: 'settings.enableSounds.name',
        hint: 'settings.enableSounds.hint',
        scope: 'client', config: true, type: Boolean, default: true
    });

    S('soundVolume', {
        name: 'settings.soundVolume.name',
        hint: 'settings.soundVolume.hint',
        scope: 'client', config: true, type: Number, default: 50,
        range: { min: 0, max: 100, step: 5 }
    });

    S('soundOnlyForSelf', {
        name: 'settings.soundOnlyForSelf.name',
        hint: 'settings.soundOnlyForSelf.hint',
        scope: 'client', config: true, type: Boolean, default: false
    });

    S('enableLowPrioritySound', {
        name: 'settings.enableLowPrioritySound.name',
        hint: 'settings.enableLowPrioritySound.hint',
        scope: 'client', config: true, type: Boolean, default: true
    });

    S('enableMediumPrioritySound', {
        name: 'settings.enableMediumPrioritySound.name',
        hint: 'settings.enableMediumPrioritySound.hint',
        scope: 'client', config: true, type: Boolean, default: true
    });

    S('enableHighPrioritySound', {
        name: 'settings.enableHighPrioritySound.name',
        hint: 'settings.enableHighPrioritySound.hint',
        scope: 'client', config: true, type: Boolean, default: true
    });

    // SoundTestApp вместо SoundTestDialog (FormApplication)
    game.settings.registerMenu(PlayerQueue.ID, 'testSounds', {
        name: 'settings.testSounds.name',
        label: 'settings.testSounds.label',
        hint: 'settings.testSounds.hint',
        icon: 'fas fa-volume-up',
        type: SoundTestApp,
        restricted: false
    });

    S('darkTheme', {
        name: 'settings.darkTheme.name',
        hint: 'settings.darkTheme.hint',
        scope: 'client', config: true, type: Boolean, default: false,
        onChange: (v) => PlayerQueue.instance?.updateTheme(v)
    });

    S('nameplateImage', {
        name: 'settings.nameplateImage.name',
        hint: 'settings.nameplateImage.hint',
        scope: 'world', config: true, type: String,
        default: 'modules/player-queue/assets/dialog name labels/name_label_drakkenheim.webp',
        onChange: (v) => applyNameplateImage(v)
    });

    let _nameplateFilesCache = null;

    Hooks.on('renderSettingsConfig', async (app, html) => {
        const inputEl = html.querySelector('[name="player-queue.nameplateImage"]');
        if (!inputEl) return;

        const FOLDER = 'modules/player-queue/assets/dialog name labels';
        const IMAGE_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

        if (!_nameplateFilesCache) {
            try {
                const result = await FilePicker.browse('data', FOLDER);
                _nameplateFilesCache = result.files.filter(f => IMAGE_EXTS.some(ext => f.toLowerCase().endsWith('.' + ext)));
            } catch {
                _nameplateFilesCache = [];
            }
        }
        const files = _nameplateFilesCache;

        const currentValue = game.settings.get(PlayerQueue.ID, 'nameplateImage');
        const normPath = p => decodeURIComponent(p).replace(/^\//, '');

        const select = document.createElement('select');
        select.name = inputEl.name;
        select.className = inputEl.className;

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = game.i18n.localize('settings.nameplateImage.defaultView');
        select.appendChild(emptyOpt);

        const hiddenOpt = document.createElement('option');
        hiddenOpt.value = '__hidden__';
        hiddenOpt.textContent = game.i18n.localize('settings.nameplateImage.noPlate');
        select.appendChild(hiddenOpt);

        for (const f of files) {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = NAMEPLATE_CONFIGS[f]?.label
                ?? f.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ');
            select.appendChild(opt);
        }

        // Set initial selection robustly — after all options are added
        const matchingOpt = [...select.options].find(o => normPath(o.value) === normPath(currentValue));
        if (matchingOpt) matchingOpt.selected = true;

        const originalValue = game.settings.get(PlayerQueue.ID, 'nameplateImage');
        let saved = false;

        select.addEventListener('change', () => {
            applyNameplateImage(select.value);
        });

        html.closest('form')?.addEventListener('submit', () => { saved = true; }, { once: true });

        Hooks.once('closeSettingsConfig', () => {
            if (!saved) applyNameplateImage(originalValue);
        });

        inputEl.replaceWith(select);
    });

    S('backgroundFolder', {
        scope: 'world', config: false, type: String, default: ''
    });

    S('parallaxEnabled', {
        name: 'settings.parallaxEnabled.name',
        hint: 'settings.parallaxEnabled.hint',
        scope: 'client', config: true, type: Boolean, default: true,
        onChange: v => window.visualNovelScene?.setParallaxOptions({ enabled: v })
    });

    S('parallaxDepth', {
        name: 'settings.parallaxDepth.name',
        hint: 'settings.parallaxDepth.hint',
        scope: 'client', config: true, type: Number, default: 50,
        range: { min: 0, max: 100, step: 10 },
        onChange: v => window.visualNovelScene?.setParallaxOptions({ depth: v })
    });

    S('cameraEnabled', {
        name: 'settings.cameraEnabled.name',
        hint: 'settings.cameraEnabled.hint',
        scope: 'client', config: true, type: Boolean, default: true,
        onChange: v => window.visualNovelScene?.setCameraEnabled(v)
    });

    S('cameraDoF', {
        name: 'settings.cameraDoF.name',
        hint: 'settings.cameraDoF.hint',
        scope: 'client', config: true, type: Boolean, default: true,
        onChange: () => window.visualNovelScene?._reapplyCameraDof()
    });

    S('kenBurnsDirection', {
        name: 'settings.kenBurnsDirection.name',
        hint: 'settings.kenBurnsDirection.hint',
        scope: 'client', config: true, type: String, default: 'none',
        choices: {
            none: 'settings.kenBurnsDirection.none',
            random: 'settings.kenBurnsDirection.random',
            left: 'settings.kenBurnsDirection.left',
            right: 'settings.kenBurnsDirection.right',
        },
        onChange: v => window.visualNovelScene?.setParallaxOptions({ kenBurns: { enabled: v !== 'none', direction: v } })
    });
}

function escapeCSSUrl(url) {
    return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, '');
}

function applyNameplateImage(path) {
    const PROPS = ['--vn-nameplate-image', '--vn-nameplate-ratio', '--np-text-width', '--np-padding-x', '--np-offset-y', '--np-font-size'];
    const clear = () => PROPS.forEach(p => document.documentElement.style.removeProperty(p));

    document.body.classList.remove('vn-nameplate-hidden');
    if (path === '__hidden__') {
        clear();
        document.body.classList.remove('vn-nameplate-has-image');
        document.body.classList.add('vn-nameplate-hidden');
    } else if (path) {
        // CSS url() in a stylesheet resolves relative to the .css file — prepend / to make absolute
        const url = /^https?:\/\/|^\//.test(path) ? path : '/' + path;
        const normPath = p => decodeURIComponent(p).replace(/^\//, '').replace(/\\/g, '/');
        const cfg = NAMEPLATE_CONFIGS[path] || NAMEPLATE_CONFIGS[normPath(path)] || {};
        document.documentElement.style.setProperty('--vn-nameplate-image', `url("${escapeCSSUrl(url)}")`);
        document.documentElement.style.setProperty('--vn-nameplate-ratio', cfg.ratio ?? 4.94);
        document.documentElement.style.setProperty('--np-text-width', `${cfg.textWidth ?? 200}px`);
        document.documentElement.style.setProperty('--np-padding-x', `${cfg.paddingX ?? 0}px`);
        document.documentElement.style.setProperty('--np-offset-y', `${cfg.offsetY ?? 0}px`);
        document.documentElement.style.setProperty('--np-font-size', cfg.fontSize ?? '0.9em');
        document.body.classList.add('vn-nameplate-has-image');
    } else {
        clear();
        document.body.classList.remove('vn-nameplate-has-image');
    }
}

export { registerSettings, applyNameplateImage, NAMEPLATE_CONFIGS };

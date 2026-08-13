// ============================================================
// settings.js — registerSettings function
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { SoundTestApp } from './sound-test.js';

// Per-nameplate display parameters. Add an entry here for each new nameplate image.
// ratio: width/height aspect ratio of the image frame
// paddingX: horizontal padding to keep text within the frame's "safe zone"
// minWidth: minimum rendered width of the nameplate element
const NAMEPLATE_CONFIGS = {
    'modules/player-queue/assets/dialog name lables/name_lable_drakkenheim.webp': {
        label: 'Drakkenheim',
        ratio: 4.94,      // width / height of the frame image
        height: '3.2em',  // nameplate height (scales with font); width = height × ratio
        paddingX: '2.2em', // horizontal padding — em of the nameplate's own font-size
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
        name: 'Позиция очереди по умолчанию',
        hint: 'Начальная позиция плавающего окна очереди (можно перетащить)',
        scope: 'client', config: true, type: String, default: 'bottom-right',
        choices: {
            'top-left': 'Верх-лево', 'top-right': 'Верх-право',
            'bottom-left': 'Низ-лево', 'bottom-right': 'Низ-право'
        },
        onChange: () => {
            localStorage.removeItem(`${PlayerQueue.ID}-position`);
            onFloatingChange();
        }
    });

    S('queueOrientation', {
        name: 'Ориентация очереди',
        hint: 'Вертикальная или горизонтальная очередь',
        scope: 'client', config: true, type: String, default: 'vertical',
        choices: { vertical: 'Вертикальная', horizontal: 'Горизонтальная' },
        onChange: onFloatingChange
    });

    S('queueSize', {
        name: 'Размер портретов',
        hint: 'Размер портретов в пикселях',
        scope: 'client', config: true, type: Number, default: 50,
        range: { min: 30, max: 100, step: 5 },
        onChange: onFloatingChange
    });

    S('queueMaxItems', {
        name: 'Максимум видимых игроков',
        hint: 'Максимальное количество видимых игроков до появления прокрутки',
        scope: 'client', config: true, type: Number, default: 8,
        range: { min: 3, max: 15, step: 1 },
        onChange: onFloatingChange
    });

    S('enableSounds', {
        name: '🔊 Включить звуки приоритетов',
        hint: 'Воспроизводить звуки при изменении приоритета в очереди',
        scope: 'client', config: true, type: Boolean, default: true
    });

    S('soundVolume', {
        name: '🔉 Громкость звуков',
        hint: 'Громкость звуков приоритетов (0-100%)',
        scope: 'client', config: true, type: Number, default: 50,
        range: { min: 0, max: 100, step: 5 }
    });

    S('soundOnlyForSelf', {
        name: '🎵 Звуки только для себя',
        hint: 'Если включено — слышны только ваши звуки',
        scope: 'client', config: true, type: Boolean, default: false
    });

    S('enableLowPrioritySound', {
        name: '🟢 Звук низкого приоритета (!)',
        hint: 'Воспроизводить звук для низкого приоритета',
        scope: 'client', config: true, type: Boolean, default: true
    });

    S('enableMediumPrioritySound', {
        name: '🟡 Звук среднего приоритета (!!)',
        hint: 'Воспроизводить звук для среднего приоритета',
        scope: 'client', config: true, type: Boolean, default: true
    });

    S('enableHighPrioritySound', {
        name: '🔴 Звук высокого приоритета (!!!)',
        hint: 'Воспроизводить звук для высокого приоритета',
        scope: 'client', config: true, type: Boolean, default: true
    });

    // SoundTestApp вместо SoundTestDialog (FormApplication)
    game.settings.registerMenu(PlayerQueue.ID, 'testSounds', {
        name: '🎮 Тестировать звуки',
        label: 'Открыть тест звуков',
        hint: 'Проверить как звучат разные приоритеты с текущими настройками',
        icon: 'fas fa-volume-up',
        type: SoundTestApp,
        restricted: false
    });

    S('darkTheme', {
        name: '🌙 Тёмная тема',
        hint: 'Использовать тёмную тему для интерфейса очереди',
        scope: 'client', config: true, type: Boolean, default: false,
        onChange: (v) => PlayerQueue.instance?.updateTheme(v)
    });

    S('nameplateImage', {
        name: '🎭 Плашка имени персонажа',
        hint: 'Выберите изображение из папки assets/dialog name lables/ или оставьте пустым для стандартного вида.',
        scope: 'world', config: true, type: String,
        default: 'modules/player-queue/assets/dialog name lables/name_lable_drakkenheim.webp',
        onChange: (v) => applyNameplateImage(v)
    });

    let _nameplateFilesCache = null;

    Hooks.on('renderSettingsConfig', async (app, html) => {
        const inputEl = html.querySelector('[name="player-queue.nameplateImage"]');
        if (!inputEl) return;

        const FOLDER = 'modules/player-queue/assets/dialog name lables';
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

        const select = document.createElement('select');
        select.name = inputEl.name;
        select.className = inputEl.className;

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '— Стандартный вид —';
        if (!currentValue) emptyOpt.selected = true;
        select.appendChild(emptyOpt);

        for (const f of files) {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = NAMEPLATE_CONFIGS[f]?.label
                ?? f.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ');
            if (f === currentValue) opt.selected = true;
            select.appendChild(opt);
        }

        inputEl.replaceWith(select);
    });

    S('backgroundFolder', {
        scope: 'world', config: false, type: String, default: ''
    });

    S('parallaxEnabled', {
        name: '🎥 Параллакс фона',
        hint: 'Плавное смещение фона при движении мыши в сцене диалога',
        scope: 'client', config: true, type: Boolean, default: true,
        onChange: v => window.visualNovelScene?.setParallaxOptions({ enabled: v })
    });

    S('parallaxDepth', {
        name: '🎥 Глубина параллакса',
        hint: 'Насколько сильно фон смещается при движении мыши (0 — нет смещения, 100 — максимум)',
        scope: 'client', config: true, type: Number, default: 50,
        range: { min: 0, max: 100, step: 10 },
        onChange: v => window.visualNovelScene?.setParallaxOptions({ depth: v })
    });
}

function applyNameplateImage(path) {
    if (path) {
        // CSS url() in a stylesheet resolves relative to the .css file — prepend / to make absolute
        const url = /^https?:\/\/|^\//.test(path) ? path : '/' + path;
        const cfg = NAMEPLATE_CONFIGS[path] || {};
        document.documentElement.style.setProperty('--vn-nameplate-image', `url("${url}")`);
        document.documentElement.style.setProperty('--vn-nameplate-ratio', cfg.ratio ?? 4.94);
        document.documentElement.style.setProperty('--vn-nameplate-height', cfg.height ?? '2.8em');
        document.documentElement.style.setProperty('--vn-nameplate-padding-x', cfg.paddingX ?? '1.8em');
        document.body.classList.add('vn-nameplate-has-image');
    } else {
        document.documentElement.style.removeProperty('--vn-nameplate-image');
        document.documentElement.style.removeProperty('--vn-nameplate-ratio');
        document.documentElement.style.removeProperty('--vn-nameplate-height');
        document.documentElement.style.removeProperty('--vn-nameplate-padding-x');
        document.body.classList.remove('vn-nameplate-has-image');
    }
}

export { registerSettings, applyNameplateImage, NAMEPLATE_CONFIGS };

// ============================================================
// sound-test.js — SoundTestApp: priority sound preview (settings menu)
// Uses only Foundry theme variables (see styles.css), so it follows the core color scheme like the queue window.
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { MODULE_ID, applyForcedTheme, priorityIconUrl } from './queue/queue-constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class SoundTestApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'player-queue-sound-test',
        classes: ['pq-sound-test'],
        window: {
            title: 'soundTest.title',
            icon: 'fas fa-volume-up',
            resizable: false
        },
        position: { width: 440, height: 'auto' },
        actions: {
            play: SoundTestApp.#onPlay
        }
    };

    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/sound-test.hbs` }
    };

    async _prepareContext(options) {
        const setting = (key) => PlayerQueue.setting(key);
        const enabled = {
            0: setting('enableLowPrioritySound'),
            1: setting('enableMediumPrioritySound'),
            2: setting('enableHighPrioritySound')
        };
        const soundsOn = setting('enableSounds');
        const loc = (key) => game.i18n.localize(key);
        const onOff = (value) => ({ on: !!value, text: loc(value ? 'soundTest.on' : 'soundTest.off') });

        const buttons = Object.values(PlayerQueue.PRIORITIES).map(p => ({
            value: p.value,
            color: p.color,
            icon: priorityIconUrl(p.value),
            name: loc(p.name),
            file: p.sound,
            muted: !soundsOn || !enabled[p.value]
        }));

        return {
            buttons,
            status: [
                { label: loc('soundTest.labelSounds'), ...onOff(soundsOn) },
                { label: loc('soundTest.labelVolume'), on: true, text: `${setting('soundVolume')}%` },
                ...buttons.map(b => ({ label: b.name, ...onOff(enabled[b.value]) }))
            ]
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        applyForcedTheme(this.element);
    }

    static #onPlay(event, target) {
        PlayerQueue.instance?.playPrioritySound(Number(target.dataset.priority), true);
    }
}

export { SoundTestApp };

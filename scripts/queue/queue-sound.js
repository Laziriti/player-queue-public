// ============================================================
// queue-sound.js — QueueSound: priority notification sounds
// ============================================================

import { MODULE_ID, SOUND_COOLDOWN_MS, PRIORITY_SOUND_SETTINGS, getPriorityData, setting } from './queue-constants.js';

class QueueSound {
    #audioCache = new Map();
    #lastRemoteAt = new Map();

    #getAudio(soundFile) {
        if (!this.#audioCache.has(soundFile)) {
            const audio = new Audio(`modules/${MODULE_ID}/assets/${soundFile}`);
            audio.preload = 'auto';
            this.#audioCache.set(soundFile, audio);
        }
        return this.#audioCache.get(soundFile);
    }

    play(priority, isOwnAction = false) {
        try {
            if (!setting('enableSounds')) return;
            if (setting('soundOnlyForSelf') && !isOwnAction) return;

            const settingKey = PRIORITY_SOUND_SETTINGS[priority];
            if (settingKey && !setting(settingKey)) return;

            const volume = setting('soundVolume') / 100;
            if (volume <= 0) return;

            const audio = this.#getAudio(getPriorityData(priority).sound);
            audio.currentTime = 0;
            audio.volume = volume;
            audio.play().catch(() => {});
        } catch (error) {
            console.error('Error playing priority sound:', error);
        }
    }

    /** Sound for somebody else's action; at most once per SOUND_COOLDOWN_MS per user. */
    playRemote(userId, priority) {
        const now = Date.now();
        if (now - (this.#lastRemoteAt.get(userId) ?? 0) < SOUND_COOLDOWN_MS) return;
        this.#lastRemoteAt.set(userId, now);
        this.play(priority, false);
    }
}

export { QueueSound };

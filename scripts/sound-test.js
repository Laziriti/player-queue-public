// ============================================================
// sound-test.js — SoundTestApp class
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';

class SoundTestApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'player-queue-sound-test',
        window: {
            title: 'Тест звуков приоритетов',
            icon: 'fas fa-volume-up',
            resizable: false
        },
        position: { width: 400, height: 'auto' }
    };

    // ApplicationV2 требует get PARTS для шаблонов,
    // но мы используем ручной рендер через _renderHTML
    async _renderHTML() {
        const settings = {
            enableSounds: PlayerQueue.setting('enableSounds'),
            soundVolume: PlayerQueue.setting('soundVolume'),
            enableLow: PlayerQueue.setting('enableLowPrioritySound'),
            enableMedium: PlayerQueue.setting('enableMediumPrioritySound'),
            enableHigh: PlayerQueue.setting('enableHighPrioritySound')
        };

        const container = document.createElement('div');
        container.classList.add('sound-test-dialog');
        container.innerHTML = `
            <div class="sound-test-buttons">
                ${Object.entries(PlayerQueue.PRIORITIES).map(([key, p]) => `
                    <button type="button" class="priority-test-btn ${key.toLowerCase()}"
                            data-priority="${p.value}">
                        <span class="priority-icon">${p.label}</span>
                        <span class="priority-name">${p.name}</span>
                        <span class="sound-file">${p.sound}</span>
                    </button>
                `).join('')}
            </div>
            <div class="current-settings">
                <h4>Текущие настройки:</h4>
                <ul>
                    <li>Звуки: ${settings.enableSounds ? '✅' : '❌'}</li>
                    <li>Громкость: ${settings.soundVolume}%</li>
                    <li>Низкий: ${settings.enableLow ? '✅' : '❌'}</li>
                    <li>Средний: ${settings.enableMedium ? '✅' : '❌'}</li>
                    <li>Высокий: ${settings.enableHigh ? '✅' : '❌'}</li>
                </ul>
            </div>`;

        return container;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    _onRender(context, options) {
        this.element.querySelectorAll('.priority-test-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const priority = parseInt(btn.dataset.priority);
                PlayerQueue.instance?.playPrioritySound(priority, true);
            });
        });
    }
}

export { SoundTestApp };

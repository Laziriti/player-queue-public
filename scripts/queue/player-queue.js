// ============================================================
// player-queue.js — PlayerQueue class
// ============================================================

let playerQueueInstance = null;

const DEBUG = false;
function log(...args) {
    if (DEBUG) console.log('[PlayerQueue]', ...args);
}

class PlayerQueue {
    static ID = 'player-queue';
    static SOCKET = 'module.player-queue';

    static PRIORITIES = {
        LOW:    { value: 0, label: '!',   name: 'Низкий',  color: '#28a745', sound: 'request0.wav' },
        MEDIUM: { value: 1, label: '!!',  name: 'Средний', color: '#ffc107', sound: 'request1.wav' },
        HIGH:   { value: 2, label: '!!!', name: 'Высокий', color: '#dc3545', sound: 'request2.wav' }
    };

    static VALID_PRIORITIES = new Set([0, 1, 2]);

    static _PRIORITY_MAP = new Map(
        Object.values(PlayerQueue.PRIORITIES).map(p => [p.value, p])
    );

    static PRIORITY_SOUND_SETTINGS = {
        0: 'enableLowPrioritySound',
        1: 'enableMediumPrioritySound',
        2: 'enableHighPrioritySound'
    };

    constructor() {
        this.queue = [];
        this.isOpen = false;
        this.isLoaded = false;
        this._queueDialog = null;
        this._saveDebounceTimer = null;
        this._savePromise = null;
        this._audioCache = new Map();
        this._dragController = null;
    }

    static initialize() {
        playerQueueInstance = new PlayerQueue();
        window.PlayerQueue = PlayerQueue;
        window.playerQueue = playerQueueInstance;
        return playerQueueInstance;
    }

    static get instance() {
        return playerQueueInstance;
    }

    // ── Helpers ──

    static getPriorityData(value) {
        return PlayerQueue._PRIORITY_MAP.get(value) ?? PlayerQueue.PRIORITIES.LOW;
    }

    static setting(key) {
        return game.settings.get(PlayerQueue.ID, key);
    }

    static validatePlayerData(data) {
        if (!data || typeof data !== 'object') return null;

        const user = game.users.get(data.id);
        if (!user) return null;

        const priority = Number(data.priority);
        if (!PlayerQueue.VALID_PRIORITIES.has(priority)) return null;

        return {
            id: String(data.id),
            name: user.name,
            avatar: user.avatar || 'icons/svg/mystery-man.svg',
            priority,
            timestamp: Number(data.timestamp) || Date.now()
        };
    }

    // ── Theme ──

    updateTheme(isDark) {
        document.body.classList.toggle('player-queue-dark-theme', isDark);
        if (this.isOpen) this.updateDisplay();
    }

    // ── Sound ──

    _getAudio(soundFile) {
        if (!this._audioCache.has(soundFile)) {
            const audio = new Audio(`modules/player-queue/assets/${soundFile}`);
            audio.preload = 'auto';
            this._audioCache.set(soundFile, audio);
        }
        return this._audioCache.get(soundFile);
    }

    playPrioritySound(priority, isOwnAction = false) {
        try {
            if (!PlayerQueue.setting('enableSounds')) return;
            if (PlayerQueue.setting('soundOnlyForSelf') && !isOwnAction) return;

            const settingKey = PlayerQueue.PRIORITY_SOUND_SETTINGS[priority];
            if (settingKey && !PlayerQueue.setting(settingKey)) return;

            const volume = PlayerQueue.setting('soundVolume') / 100;
            if (volume <= 0) return;

            const pd = PlayerQueue.getPriorityData(priority);
            const audio = this._getAudio(pd.sound);
            audio.currentTime = 0;
            audio.volume = volume;
            audio.play().catch(() => {});
        } catch (error) {
            console.error('Error playing priority sound:', error);
        }
    }

    // ── Queue Data ──

    sortQueue() {
        this.queue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
    }

    isInQueue(userId) {
        return this.queue.some(p => p.id === userId);
    }

    async loadQueue() {
        if (this.isLoaded) return;

        try {
            const savedQueue = PlayerQueue.setting('queueData');

            if (Array.isArray(savedQueue) && savedQueue.length > 0) {
                const onlineIds = new Set(
                    game.users.contents.filter(u => u.active).map(u => u.id)
                );

                this.queue = savedQueue
                    .filter(p => onlineIds.has(p.id))
                    .map(p => {
                        const user = game.users.get(p.id);
                        return {
                            ...p,
                            priority: p.priority ?? 0,
                            name: user?.name ?? p.name,
                            avatar: user?.avatar || 'icons/svg/mystery-man.svg'
                        };
                    });

                this.sortQueue();

                if (this.queue.length !== savedQueue.length) {
                    this.saveQueue();
                }
            } else {
                this.queue = [];
            }
        } catch (error) {
            console.error('Error loading queue:', error);
            this.queue = [];
        }

        this.isLoaded = true;
        this.updateDisplay();
    }

    saveQueue() {
        if (!game.user.isGM) return;

        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }

        this._saveDebounceTimer = setTimeout(async () => {
            try {
                if (this._savePromise) await this._savePromise;

                this._savePromise = game.settings.set(
                    PlayerQueue.ID, 'queueData', structuredClone(this.queue)
                );
                await this._savePromise;
                this._savePromise = null;
            } catch (error) {
                console.error('Error saving queue:', error);
                this._savePromise = null;
            }
        }, 100);
    }

    // ── Position Persistence ──

    loadQueuePosition() {
        try {
            const saved = localStorage.getItem(`${PlayerQueue.ID}-position`);
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    saveQueuePosition(x, y) {
        try {
            localStorage.setItem(`${PlayerQueue.ID}-position`, JSON.stringify({ x, y }));
        } catch {}
    }

    // ── Queue Dialog (DialogV2) ──

    async toggleQueue() {
        if (this.isOpen && this._queueDialog) {
            this._queueDialog.close();
            return;
        }
        await this.openQueue();
    }

    async openQueue() {
        // Закрываем предыдущий если есть
        if (this._queueDialog) {
            try { this._queueDialog.close(); } catch {}
        }

        const dialog = new foundry.applications.api.DialogV2({
            window: {
                title: "Очередь игроков",
                icon: "fas fa-users",
                resizable: true
            },
            position: { width: 450, height: 520 },
            content: this._generateDialogContent(),
            buttons: this._generateDialogButtons(),
            // Не закрываем при нажатии кнопок приоритета
            modal: false
        });

        // Обработчики после рендера
        dialog.addEventListener('render', () => {
            this._attachDialogListeners(dialog.element);
        });

        dialog.addEventListener('close', () => {
            this.isOpen = false;
            this._queueDialog = null;
        });

        this._queueDialog = dialog;
        this.isOpen = true;
        dialog.render({ force: true });
    }

    _generateDialogContent() {
        const currentPlayer = this.queue.find(p => p.id === game.user.id);
        const isGM = game.user.isGM;

        const queueItems = this.queue.length > 0
            ? this.queue.map(player => {
                const pd = PlayerQueue.getPriorityData(player.priority);
                return `
                    <div class="queue-player ${isGM ? 'gm-clickable' : ''}"
                         title="${player.name} - ${pd.name} приоритет"
                         data-user-id="${player.id}"
                         style="border-color: ${pd.color}; border-width: 3px;">
                        <img src="${player.avatar}" alt="${player.name}"
                             onerror="this.src='icons/svg/mystery-man.svg'">
                    </div>`;
            }).join('')
            : '<div class="queue-empty">Очередь пуста</div>';

        const controls = currentPlayer
            ? this._generateInQueueControls(currentPlayer)
            : this._generateJoinControls();

        const { HIGH, MEDIUM, LOW } = PlayerQueue.PRIORITIES;

        return `
            <div class="queue-dialog">
                <div class="queue-container">${queueItems}</div>
                <div class="queue-controls">
                    ${controls}
                    ${isGM ? '<button type="button" class="clear-btn" data-action="clear-queue">Очистить очередь</button>' : ''}
                </div>
                <div class="queue-info">
                    <small>Игроков в очереди: ${this.queue.length}</small>
                    ${isGM ? '<br><small>ЛКМ - объявить и убрать, ПКМ - просто убрать</small>' : ''}
                    <div class="priority-legend">
                        <small>Приоритеты:
                            <span style="color:${HIGH.color};font-weight:bold;">${HIGH.label} Высокий</span> •
                            <span style="color:${MEDIUM.color};font-weight:bold;">${MEDIUM.label} Средний</span> •
                            <span style="color:${LOW.color};font-weight:bold;">${LOW.label} Низкий</span>
                        </small>
                    </div>
                </div>
            </div>`;
    }

    _generateDialogButtons() {
        // DialogV2 требует хотя бы одну кнопку, делаем «Закрыть»
        return [{
            action: 'close',
            label: 'Закрыть',
            icon: 'fas fa-times'
        }];
    }

    _generateJoinControls() {
        return `
            <div class="priority-buttons">
                ${[['low', 0, '!', 'Низкий'], ['medium', 1, '!!', 'Средний'], ['high', 2, '!!!', 'Высокий']]
                .map(([cls, val, icon, text]) => `
                    <button type="button" class="priority-join-btn ${cls}"
                            data-priority="${val}"
                            title="Встать в очередь с ${text.toLowerCase()} приоритетом">
                        <span class="priority-icon">${icon}</span>
                        <span class="priority-text">${text}</span>
                    </button>`).join('')}
            </div>`;
    }

    _generateInQueueControls(player) {
        const pd = PlayerQueue.getPriorityData(player.priority);
        return `
            <div class="current-player-controls">
                <div class="current-priority-info">
                    <span class="current-priority-label">Ваш приоритет:</span>
                    <span class="current-priority-value" style="color: ${pd.color};">
                        ${pd.label} ${pd.name}
                    </span>
                </div>
                <div class="priority-change-buttons">
                    ${[['low', 0, '!'], ['medium', 1, '!!'], ['high', 2, '!!!']].map(([cls, val, icon]) => `
                        <button type="button"
                                class="priority-change-btn ${cls} ${player.priority === val ? 'active' : ''}"
                                data-priority="${val}"
                                title="Изменить на ${cls} приоритет">${icon}</button>`).join('')}
                </div>
                <button type="button" class="leave-btn" data-action="leave-queue">
                    Покинуть очередь
                </button>
            </div>`;
    }

    // ── Dialog Listeners ──

    _attachDialogListeners(html) {
        if (!html || html._queueDelegated) return;
        html._queueDelegated = true;

        html.addEventListener('click', (e) => {
            const joinBtn = e.target.closest('.priority-join-btn');
            if (joinBtn) { e.preventDefault(); this.joinQueueWithPriority(parseInt(joinBtn.dataset.priority)); return; }

            const changeBtn = e.target.closest('.priority-change-btn');
            if (changeBtn) { e.preventDefault(); this.changePriority(parseInt(changeBtn.dataset.priority)); return; }

            const leaveBtn = e.target.closest('[data-action="leave-queue"]');
            if (leaveBtn) { e.preventDefault(); this.leaveQueue(); return; }

            const clearBtn = e.target.closest('[data-action="clear-queue"]');
            if (clearBtn) { e.preventDefault(); this.clearQueue(); return; }

            if (game.user.isGM) {
                const playerEl = e.target.closest('.queue-player.gm-clickable');
                if (playerEl) { e.stopPropagation(); this.announcePlayerAndRemove(playerEl.dataset.userId); }
            }
        });

        if (game.user.isGM) {
            html.addEventListener('contextmenu', (e) => {
                const playerEl = e.target.closest('.queue-player.gm-clickable');
                if (playerEl) { e.preventDefault(); e.stopPropagation(); this.removePlayerFromQueue(playerEl.dataset.userId); }
            });
        }
    }

    // ── Dialog Refresh ──

    refreshDialog() {
        if (!this._queueDialog?.element) return;

        const html = this._queueDialog.element;
        const oldContent = html.querySelector('.queue-dialog');
        if (!oldContent) {
            // Fallback: полный перерендер
            this._queueDialog.close();
            this.openQueue();
            return;
        }

        // Сохраняем скролл
        const container = oldContent.querySelector('.queue-container');
        const scrollTop = container?.scrollTop ?? 0;

        // Создаём новый контент
        const temp = document.createElement('div');
        temp.innerHTML = this._generateDialogContent();
        const newContent = temp.firstElementChild;

        // Заменяем
        oldContent.replaceWith(newContent);

        // Восстанавливаем скролл
        const newContainer = newContent.querySelector('.queue-container');
        if (newContainer) newContainer.scrollTop = scrollTop;
    }

    // ── Queue Actions ──

    async joinQueueWithPriority(priority) {
        if (!PlayerQueue.VALID_PRIORITIES.has(priority)) return;

        const playerData = {
            id: game.user.id,
            name: game.user.name,
            avatar: game.user.avatar || 'icons/svg/mystery-man.svg',
            priority,
            timestamp: Date.now()
        };

        this.playPrioritySound(priority, true);
        this.emitSocketEvent('join', playerData);
        await this.addToQueue(playerData);
    }

    async changePriority(priority) {
        if (!PlayerQueue.VALID_PRIORITIES.has(priority)) return;

        const player = this.queue.find(p => p.id === game.user.id);
        if (!player || player.priority === priority) return;

        player.priority = priority;
        player.timestamp = Date.now();

        this.playPrioritySound(priority, true);
        this.sortQueue();
        this.saveQueue();
        this.emitSocketEvent('update', {
            userId: game.user.id,
            priority,
            timestamp: player.timestamp
        });
        this.updateDisplay();
    }

    leaveQueue() {
        if (!this.isInQueue(game.user.id)) return;
        this.emitSocketEvent('leave', { userId: game.user.id });
        this.removeFromQueue(game.user.id);
    }

    clearQueue() {
        if (!game.user.isGM) return;
        this.emitSocketEvent('clear', {});
        this.queue = [];
        this.saveQueue();
        this.updateDisplay();
    }

    async announcePlayerAndRemove(userId) {
        if (!game.user.isGM) return;
        const player = this.queue.find(p => p.id === userId);
        if (!player) return;

        const pd = PlayerQueue.getPriorityData(player.priority);
        await ChatMessage.create({
            user: game.user.id,
            speaker: { alias: "Система" },
            content: `🎭 <strong>${player.name}</strong> сейчас выступает! <span style="color: ${pd.color}; font-weight: bold;">(${pd.label} ${pd.name} приоритет)</span>`,
        });

        this.removePlayerFromQueue(userId);
    }

    removePlayerFromQueue(userId) {
        if (!game.user.isGM) return;
        if (!this.isInQueue(userId)) return;

        this.emitSocketEvent('leave', { userId });
        this.removeFromQueue(userId);
    }

    addToQueue(playerData) {
        const idx = this.queue.findIndex(p => p.id === playerData.id);
        if (idx !== -1) {
            this.queue[idx] = playerData;
        } else {
            this.queue.push(playerData);
        }

        this.sortQueue();
        this.saveQueue();
        this.updateDisplay();
    }

    removeFromQueue(userId) {
        const idx = this.queue.findIndex(p => p.id === userId);
        if (idx === -1) return;

        this.queue.splice(idx, 1);
        this.saveQueue();
        this.updateDisplay();
    }

    updatePlayerPriority(userId, priority, timestamp) {
        const player = this.queue.find(p => p.id === userId);
        if (!player) return;

        player.priority = priority;
        player.timestamp = timestamp;
        this.sortQueue();
        this.saveQueue();
        this.updateDisplay();
    }

    // ── Socket ──

    emitSocketEvent(action, data) {
        log('emit:', action, data);
        if (!game.socket) {
            console.error('Socket not available');
            return;
        }
        game.socket.emit(PlayerQueue.SOCKET, {
            action, data, sender: game.user.id
        });
    }

    handleSocketEvent(socketData) {
        if (!socketData || typeof socketData !== 'object') return;
        const { action, data, sender } = socketData;

        if (!game.users.get(sender)) return;
        if (sender === game.user.id) return;

        log('received:', action, data);

        switch (action) {
            case 'join': {
                const validated = PlayerQueue.validatePlayerData(data);
                if (!validated) return;
                this.addToQueue(validated);
                this.playPrioritySound(validated.priority, false);
                break;
            }

            case 'leave': {
                const userId = String(data?.userId);
                if (!game.users.get(userId)) return;
                if (sender !== userId && !game.users.get(sender)?.isGM) return;
                this.removeFromQueue(userId);
                break;
            }

            case 'update': {
                const priority = Number(data?.priority);
                if (!PlayerQueue.VALID_PRIORITIES.has(priority)) return;
                const userId = String(data?.userId);
                if (!game.users.get(userId)) return;
                this.updatePlayerPriority(
                    userId, priority, Number(data?.timestamp) || Date.now()
                );
                this.playPrioritySound(priority, false);
                break;
            }

            case 'clear': {
                if (!game.users.get(sender)?.isGM) return;
                this.queue = [];
                this.saveQueue();
                this.updateDisplay();
                break;
            }

            case 'sync': {
                if (!game.users.get(sender)?.isGM) return;
                if (game.user.isGM) return;
                const validated = (Array.isArray(data) ? data : [])
                    .map(p => PlayerQueue.validatePlayerData(p))
                    .filter(Boolean);
                this.queue = validated;
                this.sortQueue();
                this.updateDisplay();
                break;
            }
        }
    }

    requestSync() {
        if (game.user.isGM && this.isLoaded) {
            this.emitSocketEvent('sync', this.queue);
        }
    }

    // ── Display ──

    updateDisplay() {
        if (this.isOpen && this._queueDialog) this.refreshDialog();
        this.updateFloatingQueue();
        Hooks.callAll('playerQueueUpdated', this.queue);
    }

    // ── Floating Queue ──

    updateFloatingQueue() {
        let el = document.getElementById('floating-queue');

        // GM uses the in-scene queue display when VN scene is active
        if (game.user?.isGM && window.visualNovelScene?.state?.isActive) {
            if (el) {
                if (this._dragController) {
                    this._dragController.abort();
                    this._dragController = null;
                }
                el.remove();
            }
            return;
        }

        if (this.queue.length === 0) {
            if (el) {
                if (this._dragController) {
                    this._dragController.abort();
                    this._dragController = null;
                }
                el.remove();
            }
            return;
        }

        if (!el) el = this._createFloatingQueue();
        this._renderFloatingContent(el);
    }

    _createFloatingQueue() {
        const el = document.createElement('div');
        el.id = 'floating-queue';
        el.className = 'floating-queue';

        const orientation = PlayerQueue.setting('queueOrientation');
        const size = PlayerQueue.setting('queueSize');
        const maxItems = PlayerQueue.setting('queueMaxItems');

        el.classList.add(orientation);
        el.style.setProperty('--queue-size', size + 'px');
        el.style.setProperty('--queue-max-items', maxItems);

        const savedPos = this.loadQueuePosition();
        if (savedPos) {
            el.style.position = 'fixed';
            el.style.left = savedPos.x + 'px';
            el.style.top = savedPos.y + 'px';
        } else {
            this._applyQueuePosition(el, PlayerQueue.setting('queuePosition'));
        }

        document.body.appendChild(el);
        this._makeDraggable(el);
        return el;
    }

    _applyQueuePosition(el, position) {
        Object.assign(el.style, { top: '', bottom: '', left: '', right: '' });

        const map = {
            'top-left':     { top: '20px', left: '20px' },
            'top-right':    { top: '20px', right: '20px' },
            'bottom-left':  { bottom: '20px', left: '20px' },
            'bottom-right': { bottom: '20px', right: '20px' }
        };

        Object.assign(el.style, map[position] || map['bottom-right']);
    }

    _makeDraggable(element) {
        if (this._dragController) {
            this._dragController.abort();
        }
        this._dragController = new AbortController();
        const { signal } = this._dragController;

        const handle = document.createElement('div');
        handle.className = 'drag-handle';
        handle.innerHTML = '⋮⋮';
        handle.title = 'Перетащить очередь';
        element.appendChild(handle);

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            const rect = element.getBoundingClientRect();
            const startLeft = rect.left;
            const startTop = rect.top;

            Object.assign(element.style, {
                position: 'fixed',
                top: startTop + 'px',
                left: startLeft + 'px',
                right: '', bottom: ''
            });

            const onMove = (ev) => {
                element.style.left = (startLeft + ev.clientX - startX) + 'px';
                element.style.top  = (startTop  + ev.clientY - startY) + 'px';
            };

            const onUp = () => {
                const r = element.getBoundingClientRect();
                this.saveQueuePosition(r.left, r.top);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }, { signal });
    }

    _renderFloatingContent(floatingQueue) {
        const maxItems = PlayerQueue.setting('queueMaxItems');
        const isGM = game.user.isGM;

        let container = floatingQueue.querySelector('.queue-items');
        if (!container) {
            container = document.createElement('div');
            container.className = 'queue-items';
            floatingQueue.appendChild(container);

            // Клик на пустое место — открыть диалог
            container.addEventListener('click', (e) => {
                if (e.target === container ||
                    e.target.closest('.queue-player:not(.gm-clickable)')) {
                    this.toggleQueue();
                }
            });
        }

        container.classList.toggle('scrollable', this.queue.length > maxItems);

        // Дифференциальное обновление
        const existingElements = new Map();
        container.querySelectorAll('.queue-player').forEach(el => {
            existingElements.set(el.dataset.userId, el);
        });

        const targetIds = new Set(this.queue.map(p => p.id));

        // Удаляем отсутствующих
        for (const [id, el] of existingElements) {
            if (!targetIds.has(id)) {
                el.remove();
                existingElements.delete(id);
            }
        }

        // Обновляем/создаём в правильном порядке
        let previousElement = null;
        for (const [index, player] of this.queue.entries()) {
            const pd = PlayerQueue.getPriorityData(player.priority);
            let el = existingElements.get(player.id);

            if (el) {
                // Обновляем существующий
                el.style.border = `3px solid ${pd.color}`;
                el.title = `${player.name} (${index + 1}) - ${pd.name} приоритет`;
                const img = el.querySelector('img');
                if (img) {
                    const expectedSrc = player.avatar;
                    if (!img.src.endsWith(expectedSrc)) img.src = expectedSrc;
                }
            } else {
                // Создаём новый
                el = this._createFloatingPlayerElement(player, index, pd, isGM);
                container.appendChild(el);
            }

            // Обеспечиваем порядок
            if (previousElement) {
                if (previousElement.nextElementSibling !== el) {
                    previousElement.after(el);
                }
            } else if (container.firstElementChild !== el) {
                container.prepend(el);
            }

            previousElement = el;
        }
    }

    _createFloatingPlayerElement(player, index, pd, isGM) {
        const el = document.createElement('div');
        el.className = `queue-player ${isGM ? 'gm-clickable' : ''}`;
        el.title = `${player.name} (${index + 1}) - ${pd.name} приоритет`;
        el.dataset.userId = player.id;
        el.style.border = `3px solid ${pd.color}`;

        const img = document.createElement('img');
        img.src = player.avatar;
        img.alt = player.name;
        img.onerror = () => { img.src = 'icons/svg/mystery-man.svg'; };
        el.appendChild(img);

        if (isGM) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.announcePlayerAndRemove(player.id);
            });
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.removePlayerFromQueue(player.id);
            });
        }

        return el;
    }
}

export { PlayerQueue };

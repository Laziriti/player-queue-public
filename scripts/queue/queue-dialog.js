// ============================================================
// queue-dialog.js — QueueDialog: the queue window (ApplicationV2 + Handlebars)
//
// Colors come from Foundry's own theme variables (--color-text-*, --color-border, --background), so the window
// follows the core "color scheme" setting (body.theme-dark / body.theme-light) with no theme code of its own.
// The module setting `darkTheme` only forces this window dark via Foundry's `.themed.theme-dark` classes.
// ============================================================

import {
    MODULE_ID, PRIORITIES, FALLBACK_AVATAR, getPriorityData, priorityIconUrl, applyForcedTheme
} from './queue-constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const JOIN_TITLES = {
    low:    'playerQueue.dialog.joinTitleLow',
    medium: 'playerQueue.dialog.joinTitleMedium',
    high:   'playerQueue.dialog.joinTitleHigh'
};

const CHANGE_TITLES = {
    low:    'playerQueue.dialog.changeTitleLow',
    medium: 'playerQueue.dialog.changeTitleMedium',
    high:   'playerQueue.dialog.changeTitleHigh'
};

const BUTTON_KINDS = [
    { cls: 'low',    priority: PRIORITIES.LOW },
    { cls: 'medium', priority: PRIORITIES.MEDIUM },
    { cls: 'high',   priority: PRIORITIES.HIGH }
];

class QueueDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'player-queue-dialog',
        classes: ['pq-queue-window'],
        window: {
            title: 'playerQueue.dialog.title',
            icon: 'fas fa-users',
            resizable: true
        },
        position: { width: 460, height: 580 },
        actions: {
            join: QueueDialog.#onJoin,
            change: QueueDialog.#onChange,
            leave: QueueDialog.#onLeave,
            clear: QueueDialog.#onClear,
            announce: QueueDialog.#onAnnounce,
            remove: QueueDialog.#onRemove
        }
    };

    static PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/queue-window.hbs`,
            scrollable: ['.pq-body']
        }
    };

    #controller;
    #focusKey = null;

    constructor(controller, options = {}) {
        super(options);
        this.#controller = controller;
    }

    async _prepareContext(options) {
        const queue = this.#controller.queue;
        const isGM = game.user.isGM;
        const loc = (key) => game.i18n.localize(key);

        const me = queue.find(p => p.id === game.user.id);

        const rows = queue.map((p, index) => {
            const pd = getPriorityData(p.priority);
            return {
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                color: pd.color,
                priority: p.priority,
                priorityName: loc(pd.name),
                icon: priorityIconUrl(p.priority),
                position: index + 1,
                isNext: index === 0,
                isMe: p.id === game.user.id
            };
        });

        const buttons = (titles) => BUTTON_KINDS.map(({ cls, priority }) => ({
            cls,
            value: priority.value,
            color: priority.color,
            icon: priorityIconUrl(priority.value),
            text: loc(priority.name),
            title: loc(titles[cls]),
            active: me?.priority === priority.value
        }));

        return {
            isGM,
            inQueue: !!me,
            rows,
            next: queue[0] ? { name: queue[0].name, avatar: queue[0].avatar } : null,
            fallbackAvatar: FALLBACK_AVATAR,
            joinButtons: buttons(JOIN_TITLES),
            changeButtons: buttons(CHANGE_TITLES),
            countText: game.i18n.format('playerQueue.dialog.playerCount', { count: queue.length }),
            announceLabel: loc('playerQueue.dialog.announce'),
            removeLabel: loc('playerQueue.dialog.remove')
        };
    }

    // ── Theme override and focus retention ──

    /** `darkTheme` forces this window dark; otherwise it follows Foundry's color scheme on its own. */
    applyThemeOverride() {
        applyForcedTheme(this.element);
    }

    #activeKey() {
        const active = document.activeElement;
        if (!active || !this.element?.contains(active)) return null;
        const { action, userId, priority } = active.dataset;
        return action ? { action, userId, priority } : null;
    }

    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this.#focusKey = this.#activeKey();
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        this.applyThemeOverride();

        // Каждое изменение очереди перерисовывает окно целиком — возвращаем фокус клавиатуры на ту же кнопку
        const key = this.#focusKey;
        this.#focusKey = null;
        if (!key) return;
        const match = [...this.element.querySelectorAll('[data-action]')].find(b =>
            b.dataset.action === key.action
            && b.dataset.userId === key.userId
            && b.dataset.priority === key.priority);
        match?.focus();
    }

    // ── Actions (called with `this` = the dialog instance) ──

    static #onJoin(event, target) {
        this.#controller.joinQueueWithPriority(Number(target.dataset.priority));
    }

    static #onChange(event, target) {
        this.#controller.changePriority(Number(target.dataset.priority));
    }

    static #onLeave() {
        this.#controller.leaveQueue();
    }

    static #onClear() {
        this.#controller.clearQueue();
    }

    static #onAnnounce(event, target) {
        this.#controller.announcePlayerAndRemove(target.dataset.userId);
    }

    static #onRemove(event, target) {
        this.#controller.removePlayerFromQueue(target.dataset.userId);
    }
}

export { QueueDialog };

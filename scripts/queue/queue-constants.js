// ============================================================
// queue-constants.js — shared constants and tiny helpers for the queue modules
// ============================================================

export const MODULE_ID = 'player-queue';

export const FALLBACK_AVATAR = 'icons/svg/mystery-man.svg';

export const PRIORITIES = {
    LOW:    { value: 0, label: '!',   name: 'playerQueue.priority.low',    color: '#28a745', sound: 'request0.wav', icon: 'request0.webp' },
    MEDIUM: { value: 1, label: '!!',  name: 'playerQueue.priority.medium', color: '#ffc107', sound: 'request1.wav', icon: 'request1.webp' },
    HIGH:   { value: 2, label: '!!!', name: 'playerQueue.priority.high',   color: '#dc3545', sound: 'request2.wav', icon: 'request2.webp' }
};

export const VALID_PRIORITIES = new Set([0, 1, 2]);

export const PRIORITY_SOUND_SETTINGS = {
    0: 'enableLowPrioritySound',
    1: 'enableMediumPrioritySound',
    2: 'enableHighPrioritySound'
};

export const ACTION_COOLDOWN_MS = 700;
export const MIN_REMOTE_INTERVAL_MS = 300;
export const SOUND_COOLDOWN_MS = 1500;

const PRIORITY_MAP = new Map(Object.values(PRIORITIES).map(p => [p.value, p]));

export function getPriorityData(value) {
    return PRIORITY_MAP.get(value) ?? PRIORITIES.LOW;
}

/** Image with 1 / 2 / 3 exclamation marks for the priority (assets/request0..2.webp). */
export function priorityIconUrl(priority) {
    return `modules/${MODULE_ID}/assets/${getPriorityData(priority).icon}`;
}

export function setting(key) {
    return game.settings.get(MODULE_ID, key);
}

/** Module setting `darkTheme`: force Foundry's own dark theme on a module window (otherwise it follows the core color scheme). */
export function applyForcedTheme(element) {
    if (!element) return;
    const dark = !!setting('darkTheme');
    element.classList.toggle('themed', dark);
    element.classList.toggle('theme-dark', dark);
}

export function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Accessible name of a queue entry: "Name, position 2, priority: High" (+ ", next" for the first). */
export function queueItemLabel(player, index) {
    const label = game.i18n.format('playerQueue.floatingQueue.itemLabel', {
        name: player.name,
        position: index + 1,
        priority: game.i18n.localize(getPriorityData(player.priority).name)
    });
    return index === 0 ? `${label}, ${game.i18n.localize('playerQueue.floatingQueue.next')}` : label;
}

export function priorityTooltip(name, priority) {
    const pd = getPriorityData(priority);
    return `${name} - ${game.i18n.localize(pd.name)} ${game.i18n.localize('playerQueue.priority.suffix')}`;
}

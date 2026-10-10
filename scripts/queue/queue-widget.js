// ============================================================
// queue-widget.js — QueueWidget: the draggable floating queue (#floating-queue)
// ============================================================

import {
    MODULE_ID, FALLBACK_AVATAR, getPriorityData, setting, priorityTooltip, priorityIconUrl, queueItemLabel,
    prefersReducedMotion
} from './queue-constants.js';

const POSITION_KEY = `${MODULE_ID}-position`;
const KEY_STEP = 10;
const KEY_STEP_BIG = 50;
const FLIP_MS = 250;
const LEAVE_FALLBACK_MS = 500;

const ARROW_DELTAS = {
    ArrowLeft:  [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp:    [0, -1],
    ArrowDown:  [0, 1]
};

class QueueWidget {
    #controller;
    #dragController = null;

    constructor(controller) {
        this.#controller = controller;
    }

    get element() {
        return document.getElementById('floating-queue');
    }

    /** Syncs the widget with the controller's queue: creates, differentially updates or removes it. */
    update() {
        let el = this.element;

        if (this.#isMovedIntoScene() || this.#controller.queue.length === 0) {
            this.destroy();
            return;
        }

        const compact = !!setting('queueCompact');
        if (el && el.classList.contains('compact') !== compact) {
            this.destroy();
            el = null;
        }

        if (!el) el = this.#create(compact);
        if (compact) this.#renderCompact(el);
        else this.#renderList(el);
    }

    /**
     * With `queueDuringScene = top` the queue lives in the dialog scene's top panel while the scene is on screen,
     * so the floating widget steps aside. A minimized scene hides its panel, so the widget comes back then.
     */
    #isMovedIntoScene() {
        if (setting('queueDuringScene') !== 'top') return false;
        const state = window.visualNovelScene?.state;
        return !!state?.isActive && !state.minimized;
    }

    /** Drops the element so the next update() recreates it with the current settings. */
    rebuild() {
        this.destroy();
        this.update();
    }

    destroy() {
        this.#dragController?.abort();
        this.#dragController = null;
        this.element?.remove();
    }

    // ── Position persistence ──

    #loadPosition() {
        try {
            const saved = localStorage.getItem(POSITION_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    #savePosition(x, y) {
        try {
            localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
        } catch {}
    }

    // ── Element ──

    #create(compact) {
        const el = document.createElement('div');
        el.id = 'floating-queue';
        el.className = 'floating-queue';
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', game.i18n.localize('playerQueue.dialog.title'));

        el.classList.add(setting('queueOrientation'));
        el.classList.toggle('compact', compact);
        el.style.setProperty('--queue-size', setting('queueSize') + 'px');
        el.style.setProperty('--queue-max-items', setting('queueMaxItems'));

        const savedPos = this.#loadPosition();
        if (savedPos) {
            el.style.position = 'fixed';
            el.style.left = Math.min(Math.max(0, savedPos.x), window.innerWidth  - 60) + 'px';
            el.style.top  = Math.min(Math.max(0, savedPos.y), window.innerHeight - 60) + 'px';
        } else {
            this.#applyDefaultPosition(el, setting('queuePosition'));
        }

        document.body.appendChild(el);
        this.#makeDraggable(el);
        return el;
    }

    #applyDefaultPosition(el, position) {
        Object.assign(el.style, { top: '', bottom: '', left: '', right: '' });

        const map = {
            'top-left':     { top: '20px', left: '20px' },
            'top-right':    { top: '20px', right: '20px' },
            'bottom-left':  { bottom: '20px', left: '20px' },
            'bottom-right': { bottom: '20px', right: '20px' }
        };

        Object.assign(el.style, map[position] || map['bottom-right']);
    }

    // ── Dragging (pointer events: mouse, touch and pen; arrow keys on the focused handle) ──

    #makeDraggable(element) {
        this.#dragController?.abort();
        this.#dragController = new AbortController();
        const { signal } = this.#dragController;

        const handle = document.createElement('div');
        handle.className = 'drag-handle';
        handle.textContent = '⋮⋮';
        handle.tabIndex = 0;
        handle.setAttribute('role', 'button');
        const label = game.i18n.localize('playerQueue.floatingQueue.dragHandle');
        handle.title = label;
        handle.setAttribute('aria-label', label);
        element.appendChild(handle);

        handle.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);

            const startX = e.clientX;
            const startY = e.clientY;
            const { left: startLeft, top: startTop } = this.#pinToViewport(element);

            const onMove = (ev) => {
                this.#moveTo(element, startLeft + ev.clientX - startX, startTop + ev.clientY - startY);
            };
            const onEnd = () => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onEnd);
                handle.removeEventListener('pointercancel', onEnd);
                this.#persistPosition(element);
            };

            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onEnd);
            handle.addEventListener('pointercancel', onEnd);
        }, { signal });

        handle.addEventListener('keydown', (e) => {
            const dir = ARROW_DELTAS[e.key];
            if (!dir) return;
            e.preventDefault();
            const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
            const { left, top } = this.#pinToViewport(element);
            this.#moveTo(element, left + dir[0] * step, top + dir[1] * step);
            this.#persistPosition(element);
        }, { signal });
    }

    /** Switches the element from corner anchoring to explicit fixed left/top and returns its position. */
    #pinToViewport(element) {
        const rect = element.getBoundingClientRect();
        Object.assign(element.style, {
            position: 'fixed',
            top: rect.top + 'px',
            left: rect.left + 'px',
            right: '', bottom: ''
        });
        return { left: rect.left, top: rect.top };
    }

    #moveTo(element, left, top) {
        const w = element.offsetWidth, h = element.offsetHeight;
        element.style.left = Math.min(Math.max(0, left), window.innerWidth  - w) + 'px';
        element.style.top  = Math.min(Math.max(0, top),  window.innerHeight - h) + 'px';
    }

    #persistPosition(element) {
        const r = element.getBoundingClientRect();
        this.#savePosition(r.left, r.top);
    }

    // ── Compact mode: one badge with the count and the priority of the first entry ──

    #renderCompact(floatingQueue) {
        const queue = this.#controller.queue;
        const first = queue[0];
        const pd = getPriorityData(first.priority);

        let btn = floatingQueue.querySelector('.queue-compact');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'queue-compact';
            btn.innerHTML = '<i class="fas fa-users" aria-hidden="true"></i>'
                + '<span class="queue-compact-count"></span>'
                + '<img class="queue-compact-flag" alt="" aria-hidden="true" draggable="false">';
            btn.addEventListener('click', () => this.#controller.toggleQueue());
            floatingQueue.prepend(btn);
        }

        btn.style.setProperty('--queue-color', pd.color);
        btn.querySelector('.queue-compact-count').textContent = queue.length;
        this.#setImageSrc(btn.querySelector('.queue-compact-flag'), priorityIconUrl(first.priority));

        const label = game.i18n.format('playerQueue.floatingQueue.compactLabel', {
            count: queue.length,
            name: first.name
        });
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }

    // ── Portraits list ──

    #renderList(floatingQueue) {
        const queue = this.#controller.queue;
        const maxItems = setting('queueMaxItems');
        const isGM = game.user.isGM;
        const animate = !prefersReducedMotion();

        const container = this.#ensureContainer(floatingQueue);
        container.classList.toggle('scrollable', queue.length > maxItems);

        // Текущие (не уходящие) элементы и их позиции — для анимации перестановки (FLIP)
        const existing = new Map();
        container.querySelectorAll('.queue-player:not(.leaving)').forEach(el => {
            existing.set(el.dataset.userId, el);
        });
        const firstRects = new Map();
        for (const [id, el] of existing) firstRects.set(id, el.getBoundingClientRect());

        // Убираем отсутствующих (с анимацией выхода)
        const targetIds = new Set(queue.map(p => p.id));
        for (const [id, el] of existing) {
            if (targetIds.has(id)) continue;
            this.#removeAnimated(el, animate);
            existing.delete(id);
            firstRects.delete(id);
        }

        // Обновляем/создаём в правильном порядке (уходящие элементы порядок не учитывает)
        const nextLive = (node) => {
            let s = node.nextElementSibling;
            while (s?.classList.contains('leaving')) s = s.nextElementSibling;
            return s;
        };
        const firstLive = () => {
            let s = container.firstElementChild;
            while (s?.classList.contains('leaving')) s = s.nextElementSibling;
            return s;
        };

        let previousElement = null;
        for (const [index, player] of queue.entries()) {
            let el = existing.get(player.id);

            if (el) {
                this.#updatePlayerElement(el, player, index);
            } else {
                el = this.#createPlayerElement(player, index, isGM, animate);
                container.appendChild(el);
            }

            if (previousElement) {
                if (nextLive(previousElement) !== el) previousElement.after(el);
            } else if (firstLive() !== el) {
                container.prepend(el);
            }

            previousElement = el;
        }

        if (animate) this.#playFlip(existing, firstRects);
    }

    #ensureContainer(floatingQueue) {
        let container = floatingQueue.querySelector('.queue-items');
        if (container) return container;

        container = document.createElement('div');
        container.className = 'queue-items';
        container.setAttribute('role', 'group');
        container.setAttribute('aria-label', game.i18n.localize('playerQueue.dialog.title'));
        floatingQueue.prepend(container);

        // Клик на пустое место — открыть диалог
        container.addEventListener('click', (e) => {
            if (e.target === container ||
                e.target.closest('.queue-player:not(.gm-clickable)')) {
                this.#controller.toggleQueue();
            }
        });

        container.addEventListener('keydown', (e) => this.#onItemKeydown(e, container));
        return container;
    }

    /** Enter/Space = click, Delete = remove (GM, same as right click), arrows = move focus. */
    #onItemKeydown(e, container) {
        const item = e.target.closest('.queue-player');
        if (!item || item !== e.target) return;

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
        } else if (game.user.isGM && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            this.#controller.removePlayerFromQueue(item.dataset.userId);
        } else if (ARROW_DELTAS[e.key]) {
            e.preventDefault();
            const forward = ARROW_DELTAS[e.key][0] + ARROW_DELTAS[e.key][1] > 0;
            const items = [...container.querySelectorAll('.queue-player:not(.leaving)')];
            items[items.indexOf(item) + (forward ? 1 : -1)]?.focus();
        }
    }

    #removeAnimated(el, animate) {
        if (!animate) {
            el.remove();
            return;
        }

        // Вынимаем из потока на текущем месте, чтобы остальные сразу сдвигались (FLIP), а этот плавно гас
        Object.assign(el.style, {
            position: 'absolute',
            left: el.offsetLeft + 'px',
            top: el.offsetTop + 'px',
            width: el.offsetWidth + 'px',
            height: el.offsetHeight + 'px',
            margin: '0',
            pointerEvents: 'none'
        });
        el.classList.remove('entering', 'is-next');
        el.classList.add('leaving');
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;

        el.addEventListener('animationend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), LEAVE_FALLBACK_MS);
    }

    #playFlip(existing, firstRects) {
        for (const [id, el] of existing) {
            const first = firstRects.get(id);
            if (!first) continue;
            const last = el.getBoundingClientRect();
            const dx = first.left - last.left;
            const dy = first.top - last.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            el.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                { duration: FLIP_MS, easing: 'ease-out' }
            );
        }
    }

    #updatePlayerElement(el, player, index) {
        const pd = getPriorityData(player.priority);
        el.style.border = `3px solid ${pd.color}`;
        el.style.setProperty('--queue-color', pd.color);
        el.dataset.priority = player.priority;
        el.title = priorityTooltip(`${player.name} (${index + 1})`, player.priority);
        el.setAttribute('aria-label', queueItemLabel(player, index));
        el.classList.toggle('is-next', index === 0);

        el.querySelector('.queue-position').textContent = index + 1;
        this.#setImageSrc(el.querySelector('.priority-flag'), priorityIconUrl(player.priority));

        const portrait = el.querySelector('.queue-portrait');
        if (!portrait.src.endsWith(player.avatar)) portrait.src = player.avatar;
    }

    #setImageSrc(img, url) {
        if (img.getAttribute('src') !== url) img.src = url;
    }

    #createPlayerElement(player, index, isGM, animate) {
        const el = document.createElement('div');
        el.className = `queue-player ${isGM ? 'gm-clickable' : ''}`;
        el.dataset.userId = player.id;
        el.setAttribute('role', 'button');
        el.tabIndex = 0;

        const portrait = document.createElement('img');
        portrait.className = 'queue-portrait';
        portrait.src = player.avatar;
        portrait.alt = '';
        portrait.draggable = false;
        portrait.onerror = () => { portrait.onerror = null; portrait.src = FALLBACK_AVATAR; };
        el.appendChild(portrait);

        // Значок приоритета (1–3 восклицательных знака) у верхнего края кружка и номер позиции у нижнего
        const flag = document.createElement('img');
        flag.className = 'priority-flag';
        flag.alt = '';
        flag.draggable = false;
        flag.setAttribute('aria-hidden', 'true');
        el.appendChild(flag);

        const position = document.createElement('span');
        position.className = 'queue-position';
        position.setAttribute('aria-hidden', 'true');
        el.appendChild(position);

        this.#updatePlayerElement(el, player, index);

        if (animate) {
            el.classList.add('entering');
            el.addEventListener('animationend', () => el.classList.remove('entering'), { once: true });
        }

        if (isGM) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.#controller.announcePlayerAndRemove(player.id);
            });
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.#controller.removePlayerFromQueue(player.id);
            });
        }

        return el;
    }
}

export { QueueWidget };

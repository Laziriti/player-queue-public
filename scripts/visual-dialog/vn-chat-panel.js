// ============================================================
// vn-chat-panel.js — chat sidebar integration for VN scene
// ============================================================

class VNChatPanel {
    constructor(getOverlay) {
        this._getOverlay = getOverlay;

        this._visible = false;
        this._busy = false;
        this._openToken = 0;
        this._movedChat = null;
        this._placeholder = null;
        this._originalParent = null;
        this._originalNextSibling = null;
        this._restoreState = null;
        this._pendingSidebarRestore = null;
    }

    get _$overlay() { return this._getOverlay(); }

    // ──────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────

    async toggle() {
        if (this._busy) return;

        const panel = this._$overlay?.[0]?.querySelector('.vn-chat-panel');
        if (!panel) return;

        if (this._visible || this._movedChat) {
            this.close();
            return;
        }

        this._busy = true;
        const token = ++this._openToken;

        panel.hidden = false;
        panel.style.visibility = 'hidden';

        try {
            const opened = await this._openPanel(panel, token);

            if (!opened || token !== this._openToken) {
                panel.hidden = true;
                panel.style.visibility = '';
                this._flushSidebarRestore();
                return;
            }

            this._visible = true;
            panel.style.visibility = '';

            this._$overlay
                .find('.vn-chat-button')
                .addClass('active');
        } catch (error) {
            console.error('[VN] Failed to open chat panel:', error);

            panel.hidden = true;
            panel.style.visibility = '';
            this._flushSidebarRestore();

            ui.notifications?.warn(
                game.i18n.localize('vn.chat.error')
            );
        } finally {
            this._busy = false;
        }
    }

    close() {
        ++this._openToken;

        const chat = this._movedChat;
        const placeholder = this._placeholder;
        const restoreState = this._restoreState;

        if (chat) {
            if (placeholder?.parentNode) {
                placeholder.parentNode.replaceChild(chat, placeholder);
            } else if (
                this._originalParent
                && document.contains(this._originalParent)
            ) {
                if (
                    this._originalNextSibling
                    && this._originalNextSibling.parentNode
                    === this._originalParent
                ) {
                    this._originalParent.insertBefore(
                        chat,
                        this._originalNextSibling
                    );
                } else {
                    this._originalParent.appendChild(chat);
                }
            } else {
                // Rare fallback if Foundry fully re-rendered the sidebar.
                document.getElementById('sidebar-content')?.appendChild(chat);
            }

            if (restoreState) {
                chat.classList.toggle('active', !!restoreState.wasActive);

                if (restoreState.hadHidden) {
                    chat.setAttribute('hidden', '');
                } else {
                    chat.removeAttribute('hidden');
                }

                if (restoreState.ariaHidden == null) {
                    chat.removeAttribute('aria-hidden');
                } else {
                    chat.setAttribute('aria-hidden', restoreState.ariaHidden);
                }
            }
        } else {
            placeholder?.remove();
        }

        this._movedChat = null;
        this._placeholder = null;
        this._originalParent = null;
        this._originalNextSibling = null;
        this._restoreState = null;
        this._visible = false;
        this._flushSidebarRestore();

        const panel = document.querySelector('#vn-scene-overlay .vn-chat-panel');
        if (panel) {
            panel.hidden = true;
            panel.style.visibility = '';
        }

        document.querySelectorAll('#vn-scene-overlay .vn-chat-button')
            .forEach(button => button.classList.remove('active'));
    }

    // ──────────────────────────────────────────────────────────
    // Chat element helpers
    // ──────────────────────────────────────────────────────────

    _getChatElement() {
        const byId = document.getElementById('chat');
        if (byId) return byId;

        const element = ui.chat?.element;
        if (element instanceof HTMLElement) return element;
        if (element?.[0] instanceof HTMLElement) return element[0];

        return null;
    }

    _chatHasComposer(chat) {
        if (!chat) return false;

        // Check for actual input elements only — NOT bare `form` or `.chat-form`,
        // because Foundry v14 with card-notifications renders an empty
        // <form class="chat-form"> in the DOM even when the chat tab is inactive.
        return !!chat.querySelector([
            '#chat-message',            // v14: prose-mirror input id
            'prose-mirror.chat-input',  // v14: prose-mirror by element + class
            'textarea[name="message"]', // v13
            '#chat-form',               // v13: form by id (≠ v14's .chat-form class)
        ].join(','));
    }

    // ──────────────────────────────────────────────────────────
    // Sidebar state
    // ──────────────────────────────────────────────────────────

    _getActiveSidebarTab() {
        return ui.sidebar?.tabGroups?.primary
            ?? ui.sidebar?.activeTab
            ?? document.querySelector(
                '#sidebar-content > .tab.active, #sidebar-content [data-tab].active'
            )?.dataset?.tab
            ?? null;
    }

    _captureSidebarState() {
        const sidebar = ui.sidebar;
        const sidebarEl = document.getElementById('sidebar');
        const sidebarContent = document.getElementById('sidebar-content');

        let expanded;

        if (typeof sidebar?._collapsed === 'boolean') {
            expanded = !sidebar._collapsed;
        } else if (typeof sidebar?.collapsed === 'boolean') {
            expanded = !sidebar.collapsed;
        } else if (sidebarContent) {
            expanded = sidebarContent.classList.contains('expanded');
        } else {
            expanded = !sidebarEl?.classList.contains('collapsed');
        }

        return {
            activeTab: this._getActiveSidebarTab(),
            expanded
        };
    }

    async _setSidebarExpanded(expanded) {
        const sidebar = ui.sidebar;
        const method = expanded ? sidebar?.expand : sidebar?.collapse;

        if (typeof method === 'function') {
            try {
                await Promise.resolve(method.call(sidebar));
                return;
            } catch (error) {
                console.warn('[VN] Sidebar expand/collapse failed:', error);
            }
        }

        const sidebarContent = document.getElementById('sidebar-content');
        if (sidebarContent) {
            sidebarContent.classList.toggle('expanded', expanded);
        }

        const sidebarEl = document.getElementById('sidebar');
        if (sidebarEl) {
            sidebarEl.classList.toggle('collapsed', !expanded);
        }
    }

    async _activateSidebarTab(tabName) {
        if (!tabName) return;

        const sidebar = ui.sidebar;

        try {
            if (typeof sidebar?.changeTab === 'function') {
                await Promise.resolve(sidebar.changeTab(tabName, 'primary'));
            } else if (typeof sidebar?.activateTab === 'function') {
                await Promise.resolve(sidebar.activateTab(tabName));
            } else {
                const buttons = document.querySelectorAll(
                    '#sidebar-tabs [data-tab], [data-group="primary"][data-tab]'
                );
                Array.from(buttons).find(el => el.dataset.tab === tabName)?.click();
            }
        } catch (error) {
            console.warn(`[VN] Failed to activate sidebar tab "${tabName}":`, error);
        }

        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    async _restoreSidebarAfterChatInit(state) {
        if (!state) return;

        if (state.activeTab && state.activeTab !== 'chat') {
            await this._activateSidebarTab(state.activeTab);
        }

        if (!state.expanded) {
            await this._setSidebarExpanded(false);
        }
    }

    _flushSidebarRestore() {
        const state = this._pendingSidebarRestore;
        this._pendingSidebarRestore = null;
        if (state) this._restoreSidebarAfterChatInit(state).catch(() => {});
    }

    // ──────────────────────────────────────────────────────────
    // Chat readiness
    // ──────────────────────────────────────────────────────────

    _waitForChatReady(timeout = 2500) {
        const getReadyChat = () => {
            const chat = this._getChatElement();
            return this._chatHasComposer(chat) ? chat : null;
        };

        const ready = getReadyChat();
        if (ready) return Promise.resolve(ready);

        return new Promise(resolve => {
            let observer = null;
            let timer = null;
            let finished = false;

            const finish = chat => {
                if (finished) return;
                finished = true;
                observer?.disconnect();
                clearTimeout(timer);
                resolve(chat);
            };

            observer = new MutationObserver(() => {
                const chat = getReadyChat();
                if (chat) finish(chat);
            });

            observer.observe(document.body, { childList: true, subtree: true });
            timer = setTimeout(() => finish(getReadyChat()), timeout);
        });
    }

    async _forceRenderChat() {
        if (typeof ui.chat?.render !== 'function') return;

        try {
            await Promise.resolve(ui.chat.render({ force: true }));
        } catch (error) {
            console.warn('[VN] Forced chat render failed:', error);
        }

        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    // ──────────────────────────────────────────────────────────
    // Open / scroll
    // ──────────────────────────────────────────────────────────

    async _openPanel(panelEl, token) {
        const sidebarState = this._captureSidebarState();
        const initialChat = this._getChatElement();

        const restoreState = {
            wasActive: initialChat?.classList.contains('active')
                ?? sidebarState.activeTab === 'chat',
            hadHidden: initialChat?.hasAttribute('hidden') ?? false,
            ariaHidden: initialChat?.getAttribute('aria-hidden') ?? null
        };

        let chat = initialChat;
        let sidebarWasTemporarilyChanged = false;

        try {
            if (!this._chatHasComposer(chat)) {
                sidebarWasTemporarilyChanged = true;

                if (!sidebarState.expanded) {
                    await this._setSidebarExpanded(true);
                }

                if (token !== this._openToken) return false;

                await this._activateSidebarTab('chat');

                if (token !== this._openToken) return false;

                chat = await this._waitForChatReady(1200);

                if (!this._chatHasComposer(chat)) {
                    await this._forceRenderChat();
                    chat = await this._waitForChatReady(2500);
                }
            }

            if (token !== this._openToken) return false;

            chat = this._getChatElement();

            if (!chat || !this._chatHasComposer(chat)) {
                throw new Error('Foundry rendered the chat without its message form');
            }

            await new Promise(resolve => setTimeout(resolve, 0));
            await new Promise(resolve => requestAnimationFrame(resolve));

            if (token !== this._openToken) return false;

            const placeholder = document.createComment('VN chat original position');
            const originalParent = chat.parentNode;
            if (!originalParent) throw new Error('Chat has no parent element');

            originalParent.insertBefore(placeholder, chat);

            this._placeholder = placeholder;
            this._originalParent = originalParent;
            this._originalNextSibling = chat.nextSibling;
            this._restoreState = restoreState;
            this._movedChat = chat;

            panelEl.appendChild(chat);

            chat.classList.add('active');
            chat.removeAttribute('hidden');
            chat.setAttribute('aria-hidden', 'false');
        } finally {
            if (sidebarWasTemporarilyChanged) {
                // Defer sidebar restoration until the panel closes — calling
                // changeTab() here triggers Foundry to re-render the chat app,
                // which strips the composer from the element we just moved.
                this._pendingSidebarRestore = sidebarState;
            }
        }

        if (token !== this._openToken || this._movedChat !== chat) return false;

        chat.classList.add('active');
        chat.removeAttribute('hidden');
        chat.setAttribute('aria-hidden', 'false');

        panelEl.style.visibility = '';

        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        this._scrollToBottom(chat);

        return true;
    }

    _scrollToBottom(chat) {
        if (!chat) return;

        const scroll = () => {
            if (this._movedChat !== chat) return;

            try {
                Promise.resolve(ui.chat?.scrollBottom?.({ waitImages: true })).catch(() => {});
            } catch { /* some versions have a different scrollBottom signature */ }

            const selectors = [
                '#chat-log',
                '.chat-log',
                '.chat-scroll',
                '.chat-messages',
                '[data-application-part="log"]'
            ];

            const scrollElements = new Set();
            for (const selector of selectors) {
                chat.querySelectorAll(selector).forEach(el => scrollElements.add(el));
            }

            for (const element of scrollElements) {
                element.scrollTop = element.scrollHeight;
                if (typeof element.scrollTo === 'function') {
                    element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
                }
            }
        };

        requestAnimationFrame(() => requestAnimationFrame(scroll));
        setTimeout(scroll, 80);
        setTimeout(scroll, 250);

        chat.querySelectorAll('img').forEach(image => {
            if (!image.complete) image.addEventListener('load', scroll, { once: true });
        });
    }
}

export { VNChatPanel };

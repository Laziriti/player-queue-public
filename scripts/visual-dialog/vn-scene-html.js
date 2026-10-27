// ============================================================
// vn-scene-html.js — HTML generation for VisualNovelScene
// ============================================================

import { QueueBridge } from './vn-queue-bridge.js';
import { VNSceneState, PARTICLE_LAYER_ICONS } from './vn-state.js';
import { VNAtmosphere } from './visual-effects/atmosphere/index.js';
import { VNCharFx } from './visual-effects/character-fx/vn-character-fx.js';
import { FALLBACK_AVATAR, stripEmoji, escapeHtml } from './vn-id-utils.js';

const esc = escapeHtml;

class VNSceneHTML {
    constructor(scene, rowConfig) {
        this._scene = scene;
        this._rowConfig = rowConfig;
    }

    // ──────────────────────────────────────────────────────────
    // Row layout
    // ──────────────────────────────────────────────────────────

    computeRowLayout(count, position) {
        const cfg = this._rowConfig[position];
        if (!cfg?.enabled || count <= cfg.maxPerRow || cfg.maxRows <= 1) {
            return { rows: [count], useMultiRow: false };
        }

        const numRows = Math.min(cfg.maxRows, Math.ceil(count / cfg.maxPerRow));
        const rows = new Array(numRows).fill(0);
        let remaining = count;

        for (let r = numRows - 1; r >= 0; r--) {
            if (r === 0) { rows[r] = remaining; }
            else { const perRow = Math.ceil(remaining / (r + 1)); rows[r] = perRow; remaining -= perRow; }
        }
        return { rows, useMultiRow: rows.length > 1 };
    }

    sideCharacters(tokens, position, queueData, layout) {
        const { rows, useMultiRow } = layout || this.computeRowLayout(tokens.length, position);
        if (!useMultiRow || tokens.length <= 1) {
            return tokens.map(t => this.character(t, queueData)).join('');
        }

        let html = '', idx = 0;
        const totalRows = rows.length;
        for (let r = 0; r < totalRows; r++) {
            const rowTokens = tokens.slice(idx, idx + rows[r]);
            idx += rows[r];
            const isFront = r === totalRows - 1;
            let rowClass = 'vn-row';
            if (isFront) rowClass += ' vn-front-row';
            else if (totalRows === 2) rowClass += ' vn-back-row';
            else rowClass += ` vn-back-row vn-row-depth-${totalRows - 1 - r}`;
            const rowType = isFront ? 'front' : 'back';
            html += `<div class="${rowClass}" data-depth="${r}">${rowTokens.map(t => this.character(t, queueData, rowType)).join('')}</div>`;
        }
        return html;
    }

    // ──────────────────────────────────────────────────────────
    // Character
    // ──────────────────────────────────────────────────────────

    character(token, queueData, row = null) {
        const state = this._scene.state;
        const tokenId = token.id || `actor-${token.actor.id}`;
        const imgSrc = token.actor.img || token.document?.texture?.src || FALLBACK_AVATAR;
        const pd = QueueBridge.resolveActorPriority(token.actor, queueData);
        const priorityClass = pd ? `queue-priority-${pd.priority}` : '';
        const rowClass = row ? `vn-row-${row}` : '';
        const visibility = state.visibility?.[tokenId] ?? 'visible';
        const hiddenClass = visibility === 'hidden' ? 'vn-character-hidden'
                          : visibility === 'name-hidden' ? 'vn-character-name-hidden' : '';
        const displayName = (visibility !== 'visible') ? '???' : token.name;

        // Inline transform vars so element starts at correct values — prevents transition flash on insertion
        const charScale = state.portraitScales[tokenId];
        const flipX = state.flipped[tokenId] ? '-1' : '1';
        const charStyle = (pd ? `--queue-color: ${pd.color};` : '')
            + (charScale !== undefined ? `--char-scale: ${charScale};` : '')
            + `--flip-x: ${flipX};`;
        const imgHTML = `<img class="vn-character-img" src="${esc(imgSrc)}" alt="${esc(token.name)}" loading="lazy" style="--flip-x: ${flipX}">`;

        return `<div class="vn-character ${priorityClass} ${rowClass} ${hiddenClass}" data-token-id="${esc(tokenId)}" data-name="${esc(token.name)}" style="${charStyle}">
            <div class="vn-speaking-indicator"><span></span><span></span><span></span></div>
            ${VNCharFx.wrapHTML(imgHTML, state.charFx?.[tokenId], imgSrc)}
            <div class="vn-character-nameplate"><span class="vn-nameplate-text">${esc(displayName)}</span></div>
            <div class="vn-character-glow"></div>${this.queueMark(pd?.priority)}</div>`;
    }

    /** Exclamation badge (request0..2.webp) over the portrait of a character whose player is in the queue. */
    queueMark(priority) {
        if (priority == null) return '';
        return `<img class="vn-queue-mark" data-priority="${priority}" src="${QueueBridge.getPriorityIcon(priority)}" alt="" draggable="false">`;
    }

    // ──────────────────────────────────────────────────────────
    // Queue display
    // ──────────────────────────────────────────────────────────

    queueDisplay(queueData) {
        const isGM = game.user.isGM;
        // Players always get the panel (with the hand button) so they can raise a hand when the queue is empty
        if (!QueueBridge.queueInScene || (!queueData?.length && isGM)) return '';
        const hand = isGM ? '' : this.handControl(queueData);
        return `<div class="vn-queue-container">
            <div class="vn-queue-title"><i class="fas fa-users"></i> ${game.i18n.localize('vn.queue.title')}</div>
            <div class="vn-queue-items">${queueData.map((player, i) => {
            const pd = QueueBridge.getPriorityData(player.priority);
            const hint = isGM ? `&#10;${game.i18n.localize('vn.queue.itemHint')}` : '';
            return `<div class="vn-queue-item${isGM ? ' gm-clickable' : ''}" title="${esc(player.name)} — ${game.i18n.localize(pd.name)}${hint}" data-user-id="${esc(player.id)}" style="border-color: ${pd.color};">
                    <img class="vn-queue-portrait" src="${esc(player.avatar)}" alt="${esc(player.name)}" onerror="this.onerror=null;this.src='${FALLBACK_AVATAR}'" loading="lazy" draggable="false">
                    <img class="vn-queue-flag" src="${QueueBridge.getPriorityIcon(player.priority)}" alt="" draggable="false">
                    <span class="vn-queue-number">${i + 1}</span></div>`;
        }).join('')}</div>${hand}</div>`;
    }

    /** Player's hand button; when open (`scene._handPickerOpen`) it unfolds the three priorities (+ "lower hand" if raised). */
    handControl(queueData) {
        const loc = (key) => game.i18n.localize(key);
        const mine = queueData.find(p => p.id === game.user.id);
        const open = !!this._scene._handPickerOpen;
        const label = loc(mine ? 'vn.queue.raisedHand' : 'vn.queue.raiseHand');

        const titleKeys = ['Low', 'Medium', 'High'];
        const picker = open ? `<div class="vn-queue-picker" role="group" aria-label="${loc('playerQueue.dialog.yourPriority')}">
            ${titleKeys.map((suffix, priority) => {
                const active = mine?.priority === priority;
                const title = loc(`playerQueue.dialog.${mine ? 'changeTitle' : 'joinTitle'}${suffix}`);
                return `<button type="button" class="vn-queue-pick${active ? ' active' : ''}" data-priority="${priority}"
                    style="--c: ${QueueBridge.getPriorityData(priority).color};" title="${title}" aria-label="${title}" aria-pressed="${active}">
                    <img src="${QueueBridge.getPriorityIcon(priority)}" alt="" draggable="false"></button>`;
            }).join('')}
            ${mine ? `<button type="button" class="vn-queue-lower" title="${loc('vn.queue.lowerHand')}" aria-label="${loc('vn.queue.lowerHand')}"><i class="fas fa-xmark"></i></button>` : ''}
        </div>` : '';

        return `<div class="vn-queue-hand-wrap${open ? ' open' : ''}">
            <button type="button" class="vn-queue-hand${mine ? ' raised' : ''}" title="${label}" aria-label="${label}"
                aria-haspopup="true" aria-expanded="${open}"><i class="fas fa-hand"></i></button>${picker}</div>`;
    }

    // ──────────────────────────────────────────────────────────
    // Full scene skeleton
    // ──────────────────────────────────────────────────────────

    scene(tokens) {
        const state = this._scene.state;
        const qd = QueueBridge.getQueue();
        const isGM = game.user.isGM;

        const sides = VNSceneState.POSITIONS.map(side => {
            const t = tokens[side] || [];
            const layout = this.computeRowLayout(t.length, side);
            return `<div class="vn-side vn-${side}-side ${t.length ? '' : 'empty'} ${layout.useMultiRow ? 'vn-multi-row' : ''}">${this.sideCharacters(t, side, qd, layout)}</div>`;
        }).join('');

        const sizeButtons = isGM ? `
            <button type="button" class="vn-size-button" id="decrease-size" title="${game.i18n.localize('vn.toolbar.sizeDecrease')}"><i class="fas fa-minus"></i></button>
            <button type="button" class="vn-size-button vn-size-reset" id="reset-size" title="${game.i18n.localize('vn.toolbar.sizeReset')}">${Math.round(state.portraitScale * 100)}%</button>
            <button type="button" class="vn-size-button" id="increase-size" title="${game.i18n.localize('vn.toolbar.sizeIncrease')}"><i class="fas fa-plus"></i></button>
            <button type="button" class="vn-size-button" id="size-dialog" title="${game.i18n.localize('vn.toolbar.sizeSettings')}"><i class="fas fa-sliders-h"></i></button>
        ` : '';

        const mkHint = (k, d) => `<div class="vn-help-hint"><span class="vn-help-key">${k}</span><span>${d}</span></div>`;
        const helpHints = isGM
            ? mkHint(game.i18n.localize('vn.help.k_click'),      game.i18n.localize('vn.help.d_click'))
            + mkHint(game.i18n.localize('vn.help.k_ctrlClick'),  game.i18n.localize('vn.help.d_ctrlClick'))
            + mkHint(game.i18n.localize('vn.help.k_shiftClick'), game.i18n.localize('vn.help.d_shiftClick'))
            + mkHint(game.i18n.localize('vn.help.k_midClick'),   game.i18n.localize('vn.help.d_midClick'))
            + mkHint(game.i18n.localize('vn.help.k_rightClick'), game.i18n.localize('vn.help.d_rightClick'))
            + mkHint(game.i18n.localize('vn.help.k_altWheel'),   game.i18n.localize('vn.help.d_altWheel'))
            : mkHint(game.i18n.localize('vn.help.k_close'), game.i18n.localize('vn.help.d_close'))
            + mkHint(game.i18n.localize('vn.help.k_chat'),  game.i18n.localize('vn.help.d_chat'));

        const controls = `<div class="vn-size-controls">${sizeButtons}<div class="vn-help-wrap">
            <button type="button" class="vn-size-button" title="${game.i18n.localize('vn.help.btnTitle')}"><i class="fas fa-question"></i></button>
            <div class="vn-help-popup">
                <div class="vn-help-popup-title">${game.i18n.localize(isGM ? 'vn.help.titleGM' : 'vn.help.titlePlayer')}</div>
                ${helpHints}
            </div>
        </div></div>`;

        const particleEffect = state.particleEffect || 'particles';
        const [particleType, particleVariant = 'all'] = particleEffect.split(':');
        const visualEffect = state.visualEffect || 'none';
        const [visualType, visualVariant = 'all'] = visualEffect.split(':');

        // Тайлы пикера одной оси. Тип с подвариантами (PARTICLE_VARIANTS / VISUAL_VARIANTS) — группа:
        // кнопка тайла раскрывает список вариантов, data-variant-axis говорит, к какой оси он относится
        const pickerItems = (axis, groups, labels, icons, variantsMap, currentType, currentVariant) => groups.map(group =>
            `<div class="vn-atmo-group-header">${game.i18n.localize(group.label)}</div>`
            + group.types.map(t => {
                const label = stripEmoji(game.i18n.localize(labels[t]));
                const active = t === currentType;
                const variants = variantsMap[t];
                const activeVariant = active ? currentVariant : 'all';
                const tag = variants && activeVariant !== 'all'
                    ? `<small class="vn-atmo-item-variant-tag">${game.i18n.localize((variants.find(v => v.id === activeVariant) || variants[0]).label)}</small>`
                    : '';
                const caret = variants ? '<i class="fas fa-chevron-down vn-atmo-item-caret"></i>' : '';
                const btn = `<button type="button" class="vn-atmo-item${active ? ' active' : ''}${variants ? ' vn-atmo-item-expandable' : ''}" data-${axis}="${t}" title="${label}"><i class="fas ${icons[t]}"></i><span>${label}</span>${tag}${caret}</button>`;
                if (!variants) return btn;
                const list = variants.map(v =>
                    `<button type="button" class="vn-variant-option${v.id === activeVariant ? ' active' : ''}" data-variant="${v.id}"><i class="fas fa-check"></i><span>${game.i18n.localize(v.label)}</span></button>`
                ).join('');
                return `<div class="vn-atmo-item-group" data-variant-axis="${axis}" data-variant-base="${t}">${btn}<div class="vn-variant-list" hidden>${list}</div></div>`;
            }).join('')
        ).join('');

        const particlePickerItems = pickerItems('particle', VNAtmosphere.PARTICLE_GROUPS, VNAtmosphere.PARTICLE_LABELS,
            VNAtmosphere.PARTICLE_ICONS, VNAtmosphere.PARTICLE_VARIANTS, particleType, particleVariant);
        const visualPickerItems = pickerItems('visual', VNAtmosphere.VISUAL_GROUPS, VNAtmosphere.VISUAL_LABELS,
            VNAtmosphere.VISUAL_ICONS, VNAtmosphere.VISUAL_VARIANTS, visualType, visualVariant);

        const btn = (cls, icon, title) => `<button type="button" class="vn-toolbar-btn ${cls}" title="${title}"><i class="fas ${icon}"></i></button>`;

        const toolbar = isGM
            ? `<div class="vn-toolbar">
                ${btn('vn-settings-button', 'fa-cog', game.i18n.localize('vn.toolbar.settings'))}
                <div class="vn-atmo-wrap">
                    ${btn('vn-particle-cycle-btn', VNAtmosphere.PARTICLE_ICONS[particleType], game.i18n.format('vn.atmosphere.particleButtonTitle', { effect: game.i18n.localize(VNAtmosphere.PARTICLE_LABELS[particleType]) }))}
                    <div class="vn-atmosphere-picker" hidden>
                        <div class="vn-atmosphere-picker-header"><i class="fas fa-star"></i> ${game.i18n.localize('vn.atmosphere.particlesHeader')}</div>
                        <div class="vn-atmosphere-picker-grid">${particlePickerItems}</div>
                    </div>
                </div>
                <div class="vn-atmo-wrap">
                    ${btn('vn-visual-cycle-btn', VNAtmosphere.VISUAL_ICONS[visualType], game.i18n.format('vn.atmosphere.visualButtonTitle', { effect: game.i18n.localize(VNAtmosphere.VISUAL_LABELS[visualType]) }))}
                    <div class="vn-atmosphere-picker" hidden>
                        <div class="vn-atmosphere-picker-header"><i class="fas fa-wand-sparkles"></i> ${game.i18n.localize('vn.atmosphere.visualHeader')}</div>
                        <div class="vn-atmosphere-picker-grid">${visualPickerItems}</div>
                    </div>
                </div>
                ${btn(`vn-particles-fg-btn${state.particlesLayer !== 'back' ? ' active' : ''}`, PARTICLE_LAYER_ICONS[state.particlesLayer], game.i18n.localize(`vn.toolbar.particlesLayer.${state.particlesLayer}`))}
                ${this._scene._generateSoundsWrapHTML()}
                ${btn('vn-minimize-all-button', 'fa-window-minimize', game.i18n.localize('vn.toolbar.minimizeAll'))}
                ${btn('vn-minimize-self-button', 'fa-eye-slash', game.i18n.localize('vn.toolbar.minimizeSelf'))}
                ${btn('vn-epicrolls-button', 'fa-dice-d20', game.i18n.localize('vn.toolbar.epicRolls'))}
                <button type="button" class="vn-toolbar-btn vn-broadcast-button" title="${game.i18n.localize('vn.toolbar.broadcast')}" style="display:none"><i class="fas fa-broadcast-tower"></i></button>
                ${btn('vn-chat-button', 'fa-comments', game.i18n.localize('vn.toolbar.showChat'))}
                ${btn('vn-close-button', 'fa-times', game.i18n.localize('vn.toolbar.closeScene'))}
            </div>`
            : `<div class="vn-toolbar">
                ${btn('vn-chat-button', 'fa-comments', game.i18n.localize('vn.toolbar.showChat'))}
                ${btn('vn-close-button', 'fa-times', game.i18n.localize('vn.toolbar.closePlayer'))}
            </div>`;

        const maxBar = isGM ? `<div class="vn-maximized-actions">
            <button type="button" class="vn-toolbar-btn vn-maximize-all-button" title="${game.i18n.localize('vn.toolbar.maximizeAll')}"><i class="fas fa-window-maximize"></i></button>
            <button type="button" class="vn-toolbar-btn vn-maximize-self-button" title="${game.i18n.localize('vn.toolbar.maximizeSelf')}"><i class="fas fa-eye"></i></button>
        </div>` : '';

        return `<div id="vn-scene-overlay"${this._scene.liteMode ? ' class="vn-lite"' : ''}>
            <div class="vn-bg-layer"></div><div class="vn-background-overlay"></div>
            <div class="vn-fx-tint"></div><div class="vn-fx-rays"></div><div class="vn-fx-edges"></div><div class="vn-fx-scan"></div><div class="vn-fx-flash"></div>
            <div class="vn-vignette"></div><div class="vn-ambient-light"></div><div class="vn-particles"></div><div class="vn-particles vn-particles-upper"></div><div class="vn-ground-fog"></div>
            <div class="vn-fx-bloom"></div>
            ${controls}
            <div class="vn-queue-display">${this.queueDisplay(qd)}</div>
            ${sides}<div class="vn-caption" hidden><div class="vn-caption-text"></div></div><div class="vn-fx-grain"></div>${toolbar}
            <div class="vn-maximized-bar"><span class="vn-scene-title"><i class="fas fa-theater-masks"></i> ${game.i18n.localize('vn.scene.title')}</span>${maxBar}</div>
            <div class="vn-chat-panel" hidden>
                <div class="vn-chat-panel-header"><i class="fas fa-comments"></i> ${game.i18n.localize('vn.chat.header')}</div>
            </div>
        </div>`;
    }
}

export { VNSceneHTML };

// ============================================================
// module-settings.js — ModuleSettingsApp: все настройки модуля в одном окне (меню настроек, window.openPlayerQueueSettings)
// Слева разделы, справа карточки с настройками; изменения записываются сразу (onChange настроек применяет их на лету).
// Настройки в settings.js зарегистрированы с config:false — в стандартном окне Foundry остаётся одна кнопка, открывающая это окно.
// Описание разделов — SECTIONS ниже; подписи берутся из settings.<key>.name / hint. Стили: styles/module-settings.css.
// ============================================================

import { PlayerQueue } from './queue/player-queue.js';
import { MODULE_ID, PRIORITIES, PRIORITY_SOUND_SETTINGS, applyForcedTheme, priorityIconUrl } from './queue/queue-constants.js';
import { NAMEPLATE_CONFIGS, NAMEPLATE_FONTS, nameplateFontFamily } from './visual-dialog/vn-nameplate.js';
import { escapeHtml, stripEmoji } from './visual-dialog/vn-id-utils.js';
import { EffectFiltersApp } from './effect-filters.js';

const { ApplicationV2 } = foundry.applications.api;

const loc = key => game.i18n.localize(key);
const esc = escapeHtml;

const PLATE_FOLDER = 'modules/player-queue/assets/dialog name labels';
const PLATE_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];
const NO_PLATE = '__hidden__';
const normPath = p => decodeURIComponent(String(p ?? '')).replace(/^\//, '');

/**
 * control: toggle | range | segmented | corner | select | plates | fonts | folder | button
 * choices: { значение: ключ подписи в settings.<key>.<ключ> }
 * needs:   ключ настройки-переключателя; пока он выключен, элемент недоступен
 * world:   настройка мира — видна и меняется только тем, кому разрешено менять настройки (ведущему)
 */
const SECTIONS = [
    {
        id: 'queue', icon: 'fa-hand', groups: [
            {
                id: 'window', items: [
                    { key: 'queuePosition', control: 'corner', choices: { 'top-left': 'topLeft', 'top-right': 'topRight', 'bottom-left': 'bottomLeft', 'bottom-right': 'bottomRight' } },
                    { key: 'queueOrientation', control: 'segmented', choices: { vertical: 'vertical', horizontal: 'horizontal' } },
                    { key: 'queueSize', control: 'range', min: 30, max: 100, step: 5, unit: 'px' },
                    { key: 'queueMaxItems', control: 'range', min: 3, max: 15, step: 1 },
                    { key: 'queueCompact', control: 'toggle' },
                ]
            },
            {
                id: 'behavior', items: [
                    { key: 'queueDuringScene', control: 'select', choices: { top: 'top', keep: 'keep' } },
                    { key: 'darkTheme', control: 'toggle' },
                    { key: 'announceInChat', control: 'toggle', world: true },
                ]
            },
        ]
    },
    {
        id: 'sounds', icon: 'fa-volume-high', groups: [
            {
                id: 'general', items: [
                    { key: 'enableSounds', control: 'toggle' },
                    { key: 'soundVolume', control: 'range', min: 0, max: 100, step: 5, unit: '%', needs: 'enableSounds' },
                    { key: 'soundOnlyForSelf', control: 'toggle', needs: 'enableSounds' },
                ]
            },
            { id: 'priorities', custom: 'priorities', needs: 'enableSounds' },
        ]
    },
    {
        id: 'camera', icon: 'fa-video', groups: [
            {
                id: 'main', items: [
                    { key: 'parallaxEnabled', control: 'toggle' },
                    { key: 'parallaxDepth', control: 'range', min: 0, max: 100, step: 10, unit: '%', needs: 'parallaxEnabled' },
                    { key: 'cameraEnabled', control: 'toggle' },
                    { key: 'cameraDoF', control: 'toggle', needs: 'cameraEnabled' },
                    { key: 'kenBurnsDirection', control: 'segmented', choices: { none: 'none', random: 'random', left: 'left', right: 'right' } },
                ]
            },
        ]
    },
    {
        id: 'look', icon: 'fa-palette', world: true, groups: [
            {
                id: 'plate', items: [
                    { key: 'nameplateImage', control: 'plates', world: true },
                    { key: 'nameplateFont', control: 'fonts', world: true },
                ]
            },
            {
                id: 'characters', items: [
                    { key: 'dimInactive', control: 'toggle', world: true },
                    { key: 'blurInactive', control: 'toggle', world: true },
                ]
            },
            { id: 'files', items: [{ key: 'thumbnailFolder', control: 'folder', world: true }] },
        ]
    },
    {
        id: 'perf', icon: 'fa-gauge-high', groups: [
            {
                id: 'main', items: [
                    { key: 'liteMode', control: 'toggle' },
                    { key: 'effectFilters', control: 'button', action: 'openEffectFilters', icon: 'fa-sliders' },
                ]
            },
        ]
    },
];

const PRIORITY_KEYS = Object.values(PRIORITY_SOUND_SETTINGS);
const sectionKeys = section => section.groups.flatMap(g => g.custom === 'priorities' ? PRIORITY_KEYS : g.items.filter(i => i.control !== 'button').map(i => i.key));

let plateFilesCache = null;
async function loadPlateFiles() {
    if (plateFilesCache) return plateFilesCache;
    try {
        const result = await foundry.applications.apps.FilePicker.implementation.browse('data', PLATE_FOLDER);
        plateFilesCache = result.files.filter(f => PLATE_EXTS.some(ext => f.toLowerCase().endsWith(`.${ext}`)));
    } catch {
        plateFilesCache = [];
    }
    return plateFilesCache;
}

class ModuleSettingsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'player-queue-settings',
        classes: ['pq-settings'],
        tag: 'div',
        window: {
            title: 'settingsApp.title',
            icon: 'fas fa-gear',
            resizable: true
        },
        position: { width: 900, height: 660 },
        actions: {
            showSection: ModuleSettingsApp.#onShowSection,
            resetSection: ModuleSettingsApp.#onResetSection,
            playSound: ModuleSettingsApp.#onPlaySound,
            openEffectFilters: ModuleSettingsApp.#onOpenEffectFilters
        }
    };

    #section = SECTIONS[0].id;
    #values = {};
    #savedTimer = 0;

    get #canWorld() {
        return !!game.user.can?.('SETTINGS_MODIFY') || !!game.user.isGM;
    }

    #sections() {
        return SECTIONS.filter(s => !s.world || this.#canWorld);
    }

    async _prepareContext() {
        this.#values = {};
        for (const section of this.#sections()) {
            for (const key of sectionKeys(section)) this.#values[key] = game.settings.get(MODULE_ID, key);
        }
        return { plates: this.#canWorld ? await loadPlateFiles() : [] };
    }

    async _renderHTML(context) {
        const sections = this.#sections();
        if (!sections.some(s => s.id === this.#section)) this.#section = sections[0].id;

        const nav = sections.map(s => `
            <button type="button" role="tab" class="pqs-tab" id="pqs-tab-${s.id}" data-action="showSection" data-section="${s.id}"
                    aria-controls="pqs-panel-${s.id}" aria-selected="${s.id === this.#section}" tabindex="${s.id === this.#section ? 0 : -1}"
                    title="${esc(loc(`settingsApp.sections.${s.id}.title`))}">
                <i class="fas ${s.icon}" aria-hidden="true"></i>
                <span>${esc(loc(`settingsApp.sections.${s.id}.title`))}</span>
            </button>`).join('');

        const panels = sections.map(s => this.#panel(s, context)).join('');

        return `
            <div class="pqs">
                <nav class="pqs-nav" role="tablist" aria-orientation="vertical">${nav}</nav>
                <div class="pqs-main">${panels}</div>
                <footer class="pqs-foot">
                    <span class="pqs-status" role="status" aria-live="polite">
                        <i class="fas fa-circle-info" aria-hidden="true"></i><span>${esc(loc('settingsApp.autosave'))}</span>
                    </span>
                </footer>
            </div>`;
    }

    _replaceHTML(result, content) {
        content.innerHTML = result;
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        applyForcedTheme(this.element);

        const root = this.element;
        if (!root.dataset.bound) {
            root.dataset.bound = '1';
            root.addEventListener('change', event => this.#onChange(event));
            root.addEventListener('input', event => {
                if (event.target.matches?.('input[type="range"]')) this.#showRange(event.target);
            });
            root.addEventListener('keydown', event => this.#onNavKey(event));
        }
        this.#syncDeps();
        this.#showCornerNames();
        for (const range of root.querySelectorAll('input[type="range"]')) this.#showRange(range);
    }

    // ── разметка ──────────────────────────────────────────────

    #panel(section, context) {
        const active = section.id === this.#section;
        const groups = section.groups.map(group => {
            const title = group.id === 'main' ? '' : `<h3 class="pqs-group-title">${esc(loc(`settingsApp.groups.${group.id}`))}</h3>`;
            const body = group.custom === 'priorities'
                ? this.#priorities(group)
                : `<div class="pqs-card">${group.items.filter(i => !i.world || this.#canWorld).map(i => this.#row(i, context)).join('')}</div>`;
            return `<div class="pqs-group">${title}${body}</div>`;
        }).join('');

        return `
            <section class="pqs-panel" role="tabpanel" id="pqs-panel-${section.id}" data-section="${section.id}"
                     aria-labelledby="pqs-tab-${section.id}"${active ? '' : ' hidden'}>
                <header class="pqs-head">
                    <div class="pqs-head-text">
                        <h2>${esc(loc(`settingsApp.sections.${section.id}.title`))}</h2>
                        <p>${esc(loc(`settingsApp.sections.${section.id}.desc`))}</p>
                    </div>
                    <button type="button" class="pqs-reset" data-action="resetSection" data-section="${section.id}"
                            title="${esc(loc('settingsApp.resetTitle'))}">
                        <i class="fas fa-rotate-left" aria-hidden="true"></i><span>${esc(loc('settingsApp.reset'))}</span>
                    </button>
                </header>
                <div class="pqs-body">${groups}</div>
            </section>`;
    }

    #row(item, context) {
        const name = esc(stripEmoji(loc(`settings.${item.key}.name`)));
        const hint = esc(loc(`settings.${item.key}.hint`));
        const badge = item.world
            ? `<span class="pqs-badge" title="${esc(loc('settingsApp.worldTitle'))}">${esc(loc('settingsApp.world'))}</span>` : '';
        const needs = item.needs ? ` data-needs="${item.needs}"` : '';
        const wide = item.control === 'plates' || item.control === 'fonts';
        const tag = item.control === 'toggle' ? 'label' : 'div';
        return `
            <${tag} class="pqs-row${wide ? ' is-wide' : ''}" data-key="${item.key}"${needs}>
                <span class="pqs-text">
                    <span class="pqs-name">${name}${badge}</span>
                    <span class="pqs-hint">${hint}</span>
                </span>
                <span class="pqs-ctl">${this.#control(item, name, context)}</span>
            </${tag}>`;
    }

    #control(item, name, context) {
        const { key } = item;
        const value = this.#values[key];
        const choiceLabel = id => esc(loc(`settings.${key}.${item.choices[id]}`));
        const radios = (cls, inner) => `<span class="${cls}" role="radiogroup" aria-label="${name}">${Object.keys(item.choices).map(id => `
            <label${cls === 'pqs-corner' ? ` data-pos="${id}" title="${choiceLabel(id)}"` : ''}>
                <input type="radio" name="pqs-${key}" data-setting="${key}" value="${id}"${value === id ? ' checked' : ''}${cls === 'pqs-corner' ? ` aria-label="${choiceLabel(id)}"` : ''}>
                ${inner(id)}
            </label>`).join('')}</span>`;

        switch (item.control) {
            case 'toggle':
                return `<span class="pqs-switch"><input type="checkbox" role="switch" data-setting="${key}"${value ? ' checked' : ''}><span class="pqs-track" aria-hidden="true"></span></span>`;
            case 'range':
                return `<span class="pqs-range"><input type="range" data-setting="${key}" min="${item.min}" max="${item.max}" step="${item.step}" value="${value}" aria-label="${name}"><output data-unit="${item.unit ?? ''}">${value}${item.unit ?? ''}</output></span>`;
            case 'segmented':
                return radios('pqs-seg', id => `<span>${choiceLabel(id)}</span>`);
            case 'corner':
                return `${radios('pqs-corner', () => '<i aria-hidden="true"></i>')}<span class="pqs-corner-name" data-corner-name></span>`;
            case 'select':
                return `<select class="pqs-select" data-setting="${key}" aria-label="${name}">${Object.keys(item.choices).map(id => `<option value="${id}"${value === id ? ' selected' : ''}>${choiceLabel(id)}</option>`).join('')}</select>`;
            case 'folder':
                return `<file-picker type="folder" noupload data-setting="${key}" value="${esc(value)}"></file-picker>`;
            case 'button':
                return `<button type="button" class="pqs-btn" data-action="${item.action}"><i class="fas ${item.icon}" aria-hidden="true"></i><span>${esc(loc(`settings.${key}.label`))}</span></button>`;
            case 'plates':
                return this.#plates(item, context.plates, value);
            case 'fonts':
                return this.#fonts(item, value);
            default:
                return '';
        }
    }

    #plates(item, files, value) {
        const current = normPath(value);
        const card = (id, label, inner) => `
            <label class="pqs-plate">
                <input type="radio" name="pqs-${item.key}" data-setting="${item.key}" value="${esc(id)}"${normPath(id) === current ? ' checked' : ''}>
                <span class="pqs-plate-img">${inner}</span>
                <span class="pqs-plate-name">${esc(label)}</span>
            </label>`;
        const cards = [
            card('', loc('settingsApp.plateDefault'), '<i class="fas fa-image" aria-hidden="true"></i>'),
            card(NO_PLATE, loc('settingsApp.plateNone'), '<i class="fas fa-ban" aria-hidden="true"></i>'),
            ...files.map(f => card(f,
                NAMEPLATE_CONFIGS[f]?.label ?? NAMEPLATE_CONFIGS[normPath(f)]?.label ?? f.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' '),
                `<img src="${esc(encodeURI(normPath(f)))}" alt="" loading="lazy" draggable="false">`))
        ];
        return `<span class="pqs-plates" role="radiogroup" aria-label="${esc(stripEmoji(loc('settings.nameplateImage.name')))}">${cards.join('')}</span>`;
    }

    #fonts(item, value) {
        const sample = esc(loc('settingsApp.nameSample'));
        const chip = (id, label, style) => `
            <label class="pqs-font" title="${esc(label)}">
                <input type="radio" name="pqs-${item.key}" data-setting="${item.key}" value="${id}"${(value || '') === id ? ' checked' : ''}>
                <span class="pqs-font-sample"${style}>${sample}</span>
                <small>${esc(label)}</small>
            </label>`;
        const chips = [
            chip('', loc('settingsApp.fontDefault'), ''),
            ...Object.entries(NAMEPLATE_FONTS).map(([id, f]) => chip(id, f.label, ` style="font-family:${esc(nameplateFontFamily(id))};font-weight:${f.weight};font-size:${Math.min(1.2, 1.2 * f.scale).toFixed(2)}em"`))
        ];
        return `<span class="pqs-fonts" role="radiogroup" aria-label="${esc(stripEmoji(loc('settings.nameplateFont.name')))}">${chips.join('')}</span>`;
    }

    #priorities(group) {
        const cards = Object.values(PRIORITIES).map(p => {
            const key = PRIORITY_SOUND_SETTINGS[p.value];
            const name = esc(loc(p.name));
            return `
                <div class="pqs-prio" style="--c:${p.color};" data-needs="${group.needs}">
                    <img src="${esc(priorityIconUrl(p.value))}" alt="" aria-hidden="true" draggable="false">
                    <strong>${name}</strong>
                    <small>${esc(p.sound)}</small>
                    <span class="pqs-prio-ctl">
                        <button type="button" class="pqs-play" data-action="playSound" data-priority="${p.value}"
                                title="${esc(loc('settingsApp.playSound'))}" aria-label="${esc(loc('settingsApp.playSound'))}: ${name}">
                            <i class="fas fa-play" aria-hidden="true"></i>
                        </button>
                        <label class="pqs-switch" title="${name}">
                            <input type="checkbox" role="switch" data-setting="${key}" aria-label="${name}"${this.#values[key] ? ' checked' : ''}>
                            <span class="pqs-track" aria-hidden="true"></span>
                        </label>
                    </span>
                </div>`;
        }).join('');
        return `<div class="pqs-prios">${cards}</div>`;
    }

    // ── поведение ─────────────────────────────────────────────

    #read(el) {
        if (el.type === 'checkbox') return el.checked;
        if (el.type === 'range') return Number(el.value);
        return el.value ?? '';
    }

    async #onChange(event) {
        const el = event.target.closest?.('[data-setting]');
        if (!el) return;
        const key = el.dataset.setting;
        const value = this.#read(el);
        if (el.type === 'range') this.#showRange(el);
        if (el.type === 'radio' && el.closest('.pqs-corner')) this.#showCornerNames();
        await this.#commit(key, value);
    }

    async #commit(key, value) {
        if (JSON.stringify(this.#values[key]) === JSON.stringify(value)) return;
        const before = this.#values[key];
        this.#values[key] = value;
        this.#syncDeps();
        try {
            await game.settings.set(MODULE_ID, key, value);
            this.#flash(loc('settingsApp.saved'), true);
        } catch (err) {
            console.error(`${MODULE_ID} | не удалось сохранить настройку ${key}`, err);
            this.#values[key] = before;
            ui.notifications.error(loc('settingsApp.saveFailed'));
            this.render();
        }
    }

    #flash(text, ok) {
        const status = this.element?.querySelector('.pqs-status');
        if (!status) return;
        status.classList.toggle('is-saved', ok);
        status.querySelector('i').className = `fas ${ok ? 'fa-check' : 'fa-circle-info'}`;
        status.querySelector('span').textContent = text;
        clearTimeout(this.#savedTimer);
        if (ok) {
            this.#savedTimer = setTimeout(() => this.element && this.#flash(loc('settingsApp.autosave'), false), 1800);
        }
    }

    #showRange(input) {
        const pct = (input.value - input.min) / (input.max - input.min) * 100;
        input.style.setProperty('--pct', `${pct}%`);
        const output = input.parentElement.querySelector('output');
        if (output) output.textContent = `${input.value}${output.dataset.unit ?? ''}`;
    }

    #showCornerNames() {
        for (const name of this.element.querySelectorAll('[data-corner-name]')) {
            const checked = name.parentElement.querySelector('input:checked');
            name.textContent = checked?.closest('label')?.title ?? '';
        }
    }

    /** Элементы с data-needs недоступны, пока нужный переключатель выключен. */
    #syncDeps() {
        for (const el of this.element.querySelectorAll('[data-needs]')) {
            const off = !this.#values[el.dataset.needs];
            el.classList.toggle('is-disabled', off);
            for (const control of el.querySelectorAll('input, select, button, file-picker')) control.disabled = off;
        }
    }

    #onNavKey(event) {
        const tab = event.target.closest?.('.pqs-tab');
        if (!tab || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const tabs = [...this.element.querySelectorAll('.pqs-tab')];
        const index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
    }

    #show(id) {
        this.#section = id;
        for (const tab of this.element.querySelectorAll('.pqs-tab')) {
            const on = tab.dataset.section === id;
            tab.setAttribute('aria-selected', String(on));
            tab.tabIndex = on ? 0 : -1;
        }
        for (const panel of this.element.querySelectorAll('.pqs-panel')) panel.hidden = panel.dataset.section !== id;
        this.element.querySelector('.pqs-main')?.scrollTo?.({ top: 0 });
    }

    static #onShowSection(event, target) {
        this.#show(target.dataset.section);
    }

    static async #onResetSection(event, target) {
        const section = SECTIONS.find(s => s.id === target.dataset.section);
        if (!section) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: loc('settingsApp.resetConfirmTitle'), icon: 'fas fa-rotate-left' },
            content: `<p>${esc(loc('settingsApp.resetConfirm').replace('{section}', loc(`settingsApp.sections.${section.id}.title`)))}</p>`,
            rejectClose: false
        });
        if (!ok) return;
        const failed = [];
        for (const key of sectionKeys(section)) {
            const definition = game.settings.settings.get(`${MODULE_ID}.${key}`);
            if (!definition || (definition.scope === 'world' && !this.#canWorld)) continue;
            try {
                await game.settings.set(MODULE_ID, key, definition.default);
            } catch (err) {
                console.error(`${MODULE_ID} | не удалось сбросить настройку ${key}`, err);
                failed.push(key);
            }
        }
        if (failed.length) ui.notifications.error(loc('settingsApp.saveFailed'));
        await this.render();
        if (!failed.length) this.#flash(loc('settingsApp.resetDone'), true);
    }

    static #onPlaySound(event, target) {
        PlayerQueue.instance?.playPrioritySound(Number(target.dataset.priority), true);
    }

    static #onOpenEffectFilters() {
        new EffectFiltersApp().render({ force: true });
    }

    static open() {
        const open = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
        if (open) { open.bringToFront?.(); return open; }
        const app = new this();
        app.render({ force: true });
        return app;
    }
}

export { ModuleSettingsApp };

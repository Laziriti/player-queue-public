// ============================================================
// effect-filters.js — EffectFiltersApp: тонкая настройка эффектов диалоговых сцен (меню настроек)
// Что не рисовать на этом клиенте (эффекты фона, частицы, эффекты портретов) и потолок интенсивности частиц.
// Эффекты разбиты на группы по нагрузке (FX_PERF); группу и целый раздел можно отметить разом.
// Хранение и применение: visual-dialog/visual-effects/fx-performance.js. Стили — в конце styles/styles.css.
// ============================================================

import { MODULE_ID, applyForcedTheme } from './queue/queue-constants.js';
import { FX_TIERS, tierOf } from './visual-dialog/visual-effects/fx-performance.js';
import { VISUAL_TYPES, VISUAL_LABELS, VISUAL_ICONS } from './visual-dialog/visual-effects/atmosphere/config/visual-types.js';
import { PARTICLE_TYPES, PARTICLE_LABELS, PARTICLE_ICONS } from './visual-dialog/visual-effects/atmosphere/config/particle-types.js';
import { CHAR_FX, CHAR_FX_ICONS } from './visual-dialog/visual-effects/character-fx/vn-character-fx.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const loc = key => game.i18n.localize(key);
// В подписях эффектов фона уже есть эмодзи: в списке рядом иконка FontAwesome, второй значок не нужен
const stripEmoji = text => text.replace(/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+/u, '');

const KINDS = [
    { id: 'visual', icon: 'fa-mountain-sun', ids: VISUAL_TYPES, label: id => stripEmoji(loc(VISUAL_LABELS[id])), iconOf: id => VISUAL_ICONS[id] },
    { id: 'particle', icon: 'fa-snowflake', ids: PARTICLE_TYPES, label: id => loc(PARTICLE_LABELS[id]), iconOf: id => PARTICLE_ICONS[id] },
    { id: 'charfx', icon: 'fa-user-astronaut', ids: CHAR_FX, label: id => loc(`vn.charFx.${id}`), iconOf: id => CHAR_FX_ICONS[id] },
];

class EffectFiltersApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'player-queue-effect-filters',
        tag: 'form',
        classes: ['pq-fx-filters'],
        window: {
            title: 'fxFilters.title',
            icon: 'fas fa-gauge-high',
            resizable: true
        },
        position: { width: 600, height: 680 },
        form: {
            handler: EffectFiltersApp.#onSubmit,
            closeOnSubmit: true
        },
        actions: {
            // Не «tab»: это имя ApplicationV2 зарезервировал под собственные вкладки, и такой обработчик не вызывается
            showPanel: EffectFiltersApp.#onShowPanel
        }
    };

    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/effect-filters.hbs` }
    };

    async _prepareContext(options) {
        const off = new Set(game.settings.get(MODULE_ID, 'fxDisabled') ?? []);

        const kinds = KINDS.map((kind, index) => {
            const ids = kind.ids.filter(id => id !== 'none');
            const groups = FX_TIERS.map(tier => ({
                tier,
                title: loc(`fxFilters.tiers.${tier}`),
                hint: loc(`fxFilters.tierHints.${tier}`),
                items: ids.filter(id => tierOf(kind.id, id) === tier).map(id => ({
                    key: `${kind.id}:${id}`,
                    label: kind.label(id),
                    icon: kind.iconOf(id),
                    off: off.has(`${kind.id}:${id}`)
                }))
            })).filter(group => group.items.length);

            return {
                id: kind.id,
                icon: kind.icon,
                label: loc(`fxFilters.tabs.${kind.id}`),
                active: index === 0,
                isParticle: kind.id === 'particle',
                particleIntensityMax: game.settings.get(MODULE_ID, 'particleIntensityMax') ?? 20,
                total: ids.length,
                groups
            };
        });

        return { kinds };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        applyForcedTheme(this.element);

        const root = this.element;
        if (root.dataset.bound) return this.#sync();
        root.dataset.bound = '1';

        root.addEventListener('change', event => this.#onChange(event));
        root.addEventListener('input', event => {
            if (event.target.matches('[name="particleIntensityMax"]')) this.#syncCap();
        });
        this.#sync();
        this.#syncCap();
    }

    /** Главный, раздельный и групповой флажки массово ставят флажки эффектов ниже; затем состояния пересчитываются. */
    #onChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;

        let scope = null;
        if (target.matches('[data-master="all"]')) scope = this.element;
        else if (target.matches('[data-master]')) scope = this.element.querySelector(`.pq-fx-panel[data-panel="${target.dataset.master}"]`);
        else if (target.matches('[data-group]')) scope = target.closest('.pq-fx-group');

        if (scope) scope.querySelectorAll('input[name="off"]').forEach(box => { box.checked = target.checked; });
        this.#sync();
    }

    /** Трёхпозиционные флажки (все / часть / ни одного) групп, разделов и общего, а также счётчики на вкладках. */
    #sync() {
        const root = this.element;
        const setTri = (box, boxes) => {
            const on = boxes.filter(b => b.checked).length;
            box.checked = boxes.length > 0 && on === boxes.length;
            box.indeterminate = on > 0 && on < boxes.length;
        };

        for (const group of root.querySelectorAll('.pq-fx-group')) {
            setTri(group.querySelector('[data-group]'), [...group.querySelectorAll('input[name="off"]')]);
        }
        for (const panel of root.querySelectorAll('.pq-fx-panel')) {
            const boxes = [...panel.querySelectorAll('input[name="off"]')];
            setTri(panel.querySelector('[data-master]'), boxes);
            const counter = root.querySelector(`[data-count="${panel.dataset.panel}"]`);
            if (counter) counter.textContent = `${boxes.filter(b => b.checked).length}/${boxes.length}`;
        }
        setTri(root.querySelector('[data-master="all"]'), [...root.querySelectorAll('input[name="off"]')]);
    }

    #syncCap() {
        const input = this.element.querySelector('[name="particleIntensityMax"]');
        const output = this.element.querySelector('[data-cap-output]');
        if (input && output) output.textContent = Number(input.value) >= 20 ? loc('fxFilters.unlimited') : input.value;
    }

    static #onShowPanel(event, target) {
        const kind = target.dataset.kind;
        this.element.querySelectorAll('[data-action="showPanel"]').forEach(tab => tab.classList.toggle('active', tab === target));
        this.element.querySelectorAll('.pq-fx-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== kind; });
    }

    static async #onSubmit(event, form, formData) {
        const off = [...form.querySelectorAll('input[name="off"]:checked')].map(box => box.value).sort();
        const max = Math.min(20, Math.max(1, Math.round(Number(form.querySelector('[name="particleIntensityMax"]')?.value) || 20)));

        const before = JSON.stringify([[...(game.settings.get(MODULE_ID, 'fxDisabled') ?? [])].sort(), game.settings.get(MODULE_ID, 'particleIntensityMax') ?? 20]);
        if (JSON.stringify([off, max]) === before) return;

        await game.settings.set(MODULE_ID, 'fxDisabled', off);
        await game.settings.set(MODULE_ID, 'particleIntensityMax', max);
        window.visualNovelScene?.applyEffectFilters();
    }
}

export { EffectFiltersApp };

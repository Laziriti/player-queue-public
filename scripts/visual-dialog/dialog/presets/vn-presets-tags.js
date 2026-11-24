// Tag-filter state, picker lifecycle and global tag deletion.
import { VNPresets } from '../../presets/vn-presets.js';
import { escapeHtml as esc } from '../../../utils/text.js';

export class VNPresetsTags {
    static MAX_ROWS = 300;

    constructor({ onFilter, onRefresh, confirm }) {
        this.filters = new Set();
        this.match = 'all';
        this._tagCounts = new Map();
        this._tagOutsideListener = null;
        this._onFilter = onFilter;
        this._onRefresh = onRefresh;
        this._confirm = confirm;
    }

    _countListTags(root) {
        const counts = new Map();
        root.querySelectorAll('.vn-preset-item[data-tags], .vn-preset-card[data-tags]').forEach(item => {
            for (const t of (item.dataset.tags || '').split(',').filter(Boolean)) counts.set(t, (counts.get(t) || 0) + 1);
        });
        return counts;
    }

    _toggleTagFilter(root, tag) {
        if (this.filters.has(tag)) this.filters.delete(tag);
        else this.filters.add(tag);
        this.refresh(root);
        this._onFilter(root);
    }

    _clearTagFilters(root) {
        this.filters.clear();
        this.refresh(root);
        this._onFilter(root);
    }

    _openTagPicker(root) {
        const picker = root.querySelector('.vn-tag-picker');
        if (!picker || !picker.hidden) return;
        picker.hidden = false;
        this._placeTagPicker(root, picker);
        this._renderTagPicker(root);
        const input = picker.querySelector('.vn-tag-picker-input');
        input?.focus();
        input?.select();
        this._tagOutsideListener = (e) => {
            if (picker.contains(e.target) || e.target.closest('.vn-tag-picker-btn')) return;
            this.close(root);
        };
        document.addEventListener('mousedown', this._tagOutsideListener, true);
    }

    _placeTagPicker(root, picker) {
        const btn = root.querySelector('.vn-tag-picker-btn');
        const host = picker.offsetParent;
        if (!btn || !host) return;
        const pane = root.querySelector('.vn-presets-list-pane')?.getBoundingClientRect() ?? host.getBoundingClientRect();
        const h = host.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        const width = Math.min(420, pane.width);
        const left = Math.max(pane.left, Math.min(b.left, pane.right - width));
        picker.style.width = `${width}px`;
        picker.style.left = `${left - h.left}px`;
        picker.style.top = `${b.bottom - h.top + 2}px`;
    }

    close(root) {
        const picker = root?.querySelector('.vn-tag-picker');
        if (picker) picker.hidden = true;
        if (this._tagOutsideListener) document.removeEventListener('mousedown', this._tagOutsideListener, true);
        this._tagOutsideListener = null;
    }

    attachListeners(root) {
        const bar = root.querySelector('.vn-preset-tag-bar');
        if (!bar) return;

        bar.addEventListener('click', (e) => {
            if (e.target.closest('.vn-tag-picker-btn')) {
                bar.querySelector('.vn-tag-picker')?.hidden ? this._openTagPicker(root) : this.close(root);
                return;
            }
            if (e.target.closest('.vn-tag-bar-clear') || e.target.closest('.vn-tag-picker-reset')) {
                this._clearTagFilters(root);
                return;
            }
            const matchBtn = e.target.closest('.vn-tag-match-btn');
            if (matchBtn) {
                this.match = matchBtn.dataset.match === 'any' ? 'any' : 'all';
                this.refresh(root);
                this._onFilter(root);
                return;
            }
            const del = e.target.closest('.vn-tag-picker-del');
            if (del) {
                e.preventDefault();
                this._deleteTagEverywhere(root, del.closest('.vn-tag-picker-row')?.dataset.tag);
                return;
            }
            // Active chip (also its ×): drop that tag from the filter
            const chip = e.target.closest('.vn-tag-bar-active .vn-tag-chip');
            if (chip) this._toggleTagFilter(root, chip.dataset.tag);
        });

        bar.addEventListener('change', (e) => {
            const row = e.target.closest('.vn-tag-picker-row');
            if (row && e.target.matches('input[type="checkbox"]')) this._toggleTagFilter(root, row.dataset.tag);
        });

        bar.addEventListener('input', (e) => {
            if (e.target.classList.contains('vn-tag-picker-input')) this._renderTagPicker(root);
        });

        bar.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || bar.querySelector('.vn-tag-picker')?.hidden) return;
            e.preventDefault();
            e.stopPropagation();
            this.close(root);
            bar.querySelector('.vn-tag-picker-btn')?.focus();
        });
    }

    async _deleteTagEverywhere(root, tag) {
        if (!tag) return;
        const confirmed = await this._confirm(
            game.i18n.localize('vn.dialog.deleteTagGlobalTitle'),
            `<p>${game.i18n.format('vn.dialog.deleteTagGlobalConfirm', { tag: esc(tag) })}</p>`,
            game.i18n.localize('vn.dialog.btnDelete'), 'fas fa-trash'
        );
        if (!confirmed) return;
        const presets = await VNPresets.getAll();
        for (const p of Object.values(presets).filter(p => (p.tags || []).includes(tag))) {
            await VNPresets.setTags(p.id, (p.tags || []).filter(t => t !== tag));
        }
        this.filters.delete(tag);
        this._onRefresh(root);
    }

    _renderTagPicker(root) {
        const picker = root.querySelector('.vn-tag-picker');
        if (!picker) return;
        const query = (picker.querySelector('.vn-tag-picker-input')?.value || '').trim().toLowerCase();
        const all = [...this._tagCounts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const found = query ? all.filter(t => t.toLowerCase().includes(query)) : all;
        const shown = found.slice(0, VNPresetsTags.MAX_ROWS);

        const list = picker.querySelector('.vn-tag-picker-list');
        const keepScroll = list.scrollTop;
        const delTitle = esc(game.i18n.localize('vn.dialog.tagDeleteEverywhere'));
        list.innerHTML = shown.length
            ? shown.map(t => {
                const on = this.filters.has(t);
                return `<label class="vn-tag-picker-row${on ? ' is-on' : ''}" data-tag="${esc(t)}">
                    <input type="checkbox"${on ? ' checked' : ''}>
                    <span class="vn-tag-picker-name" title="${esc(t)}">${esc(t)}</span>
                    <span class="vn-tag-picker-n">${this._tagCounts.get(t)}</span>
                    <button type="button" class="vn-tag-picker-del" title="${delTitle}"><i class="fas fa-trash-can"></i></button>
                </label>`;
            }).join('')
            : `<div class="vn-empty-hint">${game.i18n.localize('vn.dialog.tagPickerEmpty')}</div>`;
        list.scrollTop = keepScroll;

        const more = found.length > shown.length
            ? ` · ${game.i18n.format('vn.dialog.tagPickerMore', { n: shown.length })}` : '';
        picker.querySelector('.vn-tag-picker-total').textContent =
            game.i18n.format('vn.dialog.tagPickerTotal', { shown: found.length, total: all.length }) + more;
        picker.querySelector('.vn-tag-picker-reset').disabled = !this.filters.size;
        picker.querySelectorAll('.vn-tag-match-btn').forEach(b => b.classList.toggle('active', b.dataset.match === this.match));
    }

    refresh(root) {
        const bar = root.querySelector('.vn-preset-tag-bar');
        if (!bar) return;
        this._tagCounts = this._countListTags(root);
        if (!this._tagCounts.size) {
            this.close(root);
            bar.querySelector('.vn-tag-bar-active').innerHTML = '';
            bar.hidden = true;
            this.filters.clear();
            return;
        }
        bar.hidden = false;
        for (const t of [...this.filters]) if (!this._tagCounts.has(t)) this.filters.delete(t);

        const n = this.filters.size;
        const badge = bar.querySelector('.vn-tag-picker-count');
        badge.hidden = !n;
        badge.textContent = n;
        bar.querySelector('.vn-tag-bar-clear').hidden = !n;
        bar.querySelector('.vn-tag-bar-picked').hidden = !n;
        bar.querySelector('.vn-tag-bar-active').innerHTML = [...this.filters].map(t =>
            `<span class="vn-tag-chip vn-tag-chip--rm" data-tag="${esc(t)}" title="${esc(t)}"><span>${esc(t)}</span><button type="button" class="vn-tag-rm-btn">×</button></span>`
        ).join('');

        if (!bar.querySelector('.vn-tag-picker').hidden) this._renderTagPicker(root);
        else bar.querySelectorAll('.vn-tag-match-btn').forEach(b => b.classList.toggle('active', b.dataset.match === this.match));
    }
}

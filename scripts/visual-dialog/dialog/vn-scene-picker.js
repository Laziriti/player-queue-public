// ============================================================
// vn-scene-picker.js — window for choosing the Foundry scenes a preset is linked to
// ============================================================

import { escapeHtml } from '../vn-id-utils.js';

const esc = escapeHtml;
const loc = (key) => game.i18n.localize(key);

/**
 * Multi-select of the world's scenes laid out like the Scenes sidebar (same folders and nesting), with a search box.
 * Resolves to the chosen scenes as [{ id, name }], or null if the GM cancelled.
 * Links to scenes that do not exist in this world (an imported preset) are listed at the bottom and stay linked until unticked.
 */
export class VNScenePicker {

    static pick({ title, linked = [] }) {
        return new Promise(resolve => {
            const known = new Set(game.scenes.map(s => s.id));
            const missing = linked.filter(link => !link.id || !known.has(link.id));
            const chosen = new Set(linked.map(link => link.id).filter(Boolean));
            const tree = VNScenePicker._tree(game.folders.filter(f => f.type === 'Scene'), game.scenes.contents, 'a');

            const dialog = new foundry.applications.api.DialogV2({
                window: { title, icon: 'fas fa-map-location-dot', resizable: true },
                classes: ['vn-confirm-dialog', 'vn-scpick-dialog'],
                position: { width: 460, height: 580 },
                content: `<div class="vn-scpick">
                    <label class="vn-scpick-search">
                        <i class="fas fa-magnifying-glass"></i>
                        <input type="text" class="vn-scpick-q" autocomplete="off" spellcheck="false" placeholder="${esc(loc('vn.scenePicker.search'))}">
                    </label>
                    <div class="vn-scpick-bar">
                        <span class="vn-scpick-count"></span>
                        <button type="button" class="vn-btn vn-btn-xs vn-scpick-current"${canvas?.scene ? '' : ' disabled'} title="${esc(loc('vn.scenePicker.currentTitle'))}"><i class="fas fa-map-pin"></i> ${loc('vn.scenePicker.current')}</button>
                        <button type="button" class="vn-btn vn-btn-xs vn-scpick-clear">${loc('vn.scenePicker.clear')}</button>
                    </div>
                    <div class="vn-scpick-tree">
                        ${VNScenePicker._nodeHtml(tree, chosen)}
                        ${VNScenePicker._missingHtml(missing)}
                        <div class="vn-empty-hint vn-scpick-nothing" hidden>${loc('vn.scenePicker.nothing')}</div>
                    </div>
                </div>`,
                buttons: [
                    {
                        action: 'save', label: loc('vn.scenePicker.save'), icon: 'fas fa-check', default: true,
                        callback: (event, button, dlg) => VNScenePicker._collect(dlg.element),
                    },
                    { action: 'cancel', label: loc('vn.dialog.btnCancel'), icon: 'fas fa-times' },
                ],
                rejectClose: false,
                submit: result => resolve(Array.isArray(result) ? result : null),
            });
            dialog.addEventListener('close', () => resolve(null), { once: true });
            dialog.addEventListener('render', () => VNScenePicker._attach(dialog.element));
            dialog.render({ force: true });
        });
    }

    // ── Data ──

    /** { folders: [{ folder, folders, scenes }], scenes } for one level; `mode` 'a' = by name, otherwise the manual order */
    static _tree(allFolders, allScenes, mode, parentId = null) {
        const cmp = (a, b) => mode === 'a'
            ? String(a.name).localeCompare(String(b.name))
            : ((a.sort ?? 0) - (b.sort ?? 0)) || String(a.name).localeCompare(String(b.name));
        return {
            folders: allFolders
                .filter(f => (f.folder?.id ?? null) === parentId)
                .sort(cmp)
                .map(folder => ({ folder, ...VNScenePicker._tree(allFolders, allScenes, folder.sorting === 'm' ? 'm' : 'a', folder.id) })),
            scenes: allScenes.filter(s => (s.folder?.id ?? null) === parentId).sort(cmp),
        };
    }

    // ── Markup ──

    static _countScenes(node) {
        return node.scenes.length + node.folders.reduce((n, f) => n + VNScenePicker._countScenes(f), 0);
    }

    static _sceneHtml(scene, chosen) {
        const current = canvas?.scene?.id === scene.id;
        return `<label class="vn-scpick-scene" data-name="${esc(scene.name.toLowerCase())}">
            <input type="checkbox" class="vn-scpick-cb" value="${esc(scene.id)}" data-name="${esc(scene.name)}"${chosen.has(scene.id) ? ' checked' : ''}>
            <i class="fas fa-map"></i>
            <span class="vn-scpick-name" title="${esc(scene.name)}">${esc(scene.name)}</span>
            ${current ? `<span class="vn-scpick-here" title="${esc(loc('vn.scenePicker.currentTitle'))}"><i class="fas fa-map-pin"></i></span>` : ''}
        </label>`;
    }

    static _nodeHtml(node, chosen) {
        const folders = node.folders.filter(f => VNScenePicker._countScenes(f)).map(f => `<details class="vn-scpick-folder" open${f.folder.color ? ` style="--vn-folder-color:${esc(String(f.folder.color.css ?? f.folder.color))}"` : ''}>
            <summary>
                <input type="checkbox" class="vn-scpick-fcb" title="${esc(loc('vn.scenePicker.folderTitle'))}">
                <i class="fas fa-folder-open"></i>
                <span class="vn-scpick-name" title="${esc(f.folder.name)}">${esc(f.folder.name)}</span>
                <span class="vn-badge">${VNScenePicker._countScenes(f)}</span>
            </summary>
            <div class="vn-scpick-children">${VNScenePicker._nodeHtml(f, chosen)}</div>
        </details>`).join('');
        return folders + node.scenes.map(scene => VNScenePicker._sceneHtml(scene, chosen)).join('');
    }

    static _missingHtml(missing) {
        if (!missing.length) return '';
        return `<div class="vn-scpick-missing">
            <div class="vn-scpick-missing-hdr"><i class="fas fa-triangle-exclamation"></i> ${loc('vn.scenePicker.missing')}</div>
            ${missing.map(link => `<label class="vn-scpick-scene" data-name="${esc(String(link.name ?? '').toLowerCase())}">
                <input type="checkbox" class="vn-scpick-cb vn-scpick-cb--missing" value="" data-id="${esc(link.id ?? '')}" data-name="${esc(link.name ?? '')}" checked>
                <i class="fas fa-ghost"></i>
                <span class="vn-scpick-name" title="${esc(link.id ?? '')}">${esc(link.name || link.id)}</span>
            </label>`).join('')}
        </div>`;
    }

    // ── Behaviour ──

    static _attach(root) {
        const q = root.querySelector('.vn-scpick-q');
        const boxes = () => [...root.querySelectorAll('.vn-scpick-cb')];
        const visible = (scope = root) => [...scope.querySelectorAll('.vn-scpick-scene:not([hidden]) .vn-scpick-cb')];

        const sync = () => {
            for (const folderCb of root.querySelectorAll('.vn-scpick-fcb')) {
                const list = visible(folderCb.closest('details'));
                const n = list.filter(cb => cb.checked).length;
                folderCb.checked = list.length > 0 && n === list.length;
                folderCb.indeterminate = n > 0 && n < list.length;
            }
            root.querySelector('.vn-scpick-count').textContent = game.i18n.format('vn.scenePicker.count', { count: boxes().filter(cb => cb.checked).length });
        };

        const filter = () => {
            const query = q.value.trim().toLowerCase();
            for (const row of root.querySelectorAll('.vn-scpick-scene')) row.hidden = !!query && !row.dataset.name.includes(query);
            // folders without a match disappear; with a query the ones that remain are opened
            const folders = [...root.querySelectorAll('.vn-scpick-folder')];
            for (const folder of folders) {
                const any = !!folder.querySelector('.vn-scpick-scene:not([hidden])');
                folder.hidden = !any;
                if (query && any) folder.open = true;
            }
            const missing = root.querySelector('.vn-scpick-missing');
            if (missing) missing.hidden = !missing.querySelector('.vn-scpick-scene:not([hidden])');
            root.querySelector('.vn-scpick-nothing').hidden = !!root.querySelector('.vn-scpick-scene:not([hidden])');
            sync();
        };

        q.addEventListener('input', filter);
        root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === q) e.preventDefault(); });

        root.addEventListener('change', (e) => {
            if (e.target.classList.contains('vn-scpick-fcb')) {
                // a folder box applies to the scenes that are currently shown inside it
                for (const cb of visible(e.target.closest('details'))) cb.checked = e.target.checked;
            }
            sync();
        });

        root.querySelector('.vn-scpick-clear').addEventListener('click', (e) => {
            e.preventDefault();
            for (const cb of visible()) cb.checked = false;
            sync();
        });

        root.querySelector('.vn-scpick-current').addEventListener('click', (e) => {
            e.preventDefault();
            const here = boxes().find(cb => cb.value === canvas?.scene?.id);
            if (!here) return;
            here.checked = true;
            here.closest('.vn-scpick-scene').scrollIntoView({ block: 'nearest' });
            sync();
        });

        sync();
        q.focus();
    }

    /** Ticked boxes -> [{ id, name }]; a ticked link to a scene missing from this world keeps its stored id and name */
    static _collect(root) {
        const out = [];
        for (const cb of root.querySelectorAll('.vn-scpick-cb:checked')) {
            out.push({ id: cb.classList.contains('vn-scpick-cb--missing') ? (cb.dataset.id || null) : cb.value, name: cb.dataset.name });
        }
        return out;
    }
}

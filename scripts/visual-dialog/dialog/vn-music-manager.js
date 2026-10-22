// ============================================================
// vn-music-manager.js — вкладка "Музыка": фоновый трек + звуковые реплики
// ============================================================

import { parsePlaylistUuid, escapeHtml } from '../vn-id-utils.js';

const loc = (key) => game.i18n.localize(key);

export class VNMusicManager {
    _resolveSoundFromUuid(uuid) {
        return parsePlaylistUuid(uuid)?.sound ?? null;
    }

    _pickButton(target) {
        return `<button type="button" class="vn-btn vn-btn-xs vn-music-pick" data-target="${target}"><i class="fas fa-list-music"></i> ${loc('vn.dialog.pickFromPlaylist')}</button>`;
    }

    /** Searchable window with every playlist track: the alternative to dragging a track in from the sidebar. */
    _pickSound() {
        const playlists = [...game.playlists].filter(pl => pl.sounds.size)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!playlists.length) { ui.notifications.warn(loc('vn.dialog.pickSoundNoPlaylists')); return Promise.resolve(null); }

        const total = playlists.reduce((n, pl) => n + pl.sounds.size, 0);
        const groups = playlists.map(pl => {
            const sounds = [...pl.sounds].sort((a, b) => a.name.localeCompare(b.name));
            return `<section class="vn-pick-group" data-hay="${escapeHtml(pl.name.toLowerCase())}">
                <header class="vn-pick-group-hdr"><i class="fas fa-list-music"></i><span>${escapeHtml(pl.name)}</span><span class="vn-badge">${sounds.length}</span></header>
                ${sounds.map(s => `<button type="button" class="vn-pick-item" data-uuid="${escapeHtml(s.uuid)}" data-hay="${escapeHtml(s.name.toLowerCase())}"><i class="fas fa-music"></i><span>${escapeHtml(s.name)}</span></button>`).join('')}
            </section>`;
        }).join('');

        return new Promise(resolve => {
            let picked = null, submitted = false;
            const dlg = new foundry.applications.api.DialogV2({
                window: { title: loc('vn.dialog.pickSoundTitle') },
                classes: ['vn-confirm-dialog', 'vn-pick-dialog'],
                position: { width: 680 },
                content: `<div class="vn-pick-sound">
                    <div class="vn-pick-search">
                        <i class="fas fa-magnifying-glass"></i>
                        <input type="text" class="vn-pick-search-input" placeholder="${loc('vn.dialog.pickSoundSearch')}" autocomplete="off" spellcheck="false">
                        <span class="vn-pick-count">${total}</span>
                    </div>
                    <div class="vn-pick-list">${groups}<div class="vn-pick-empty" hidden>${loc('vn.dialog.nothingFound')}</div></div>
                </div>`,
                buttons: [
                    { action: 'select', label: loc('vn.dialog.pickSoundConfirm'), icon: 'fas fa-check', default: false },
                    { action: 'cancel', label: loc('vn.dialog.btnCancel'), icon: 'fas fa-times' },
                ],
                rejectClose: false,
                submit: (action) => { submitted = true; resolve(action === 'select' ? picked : null); },
            });
            dlg.addEventListener('close', () => { if (!submitted) resolve(null); }, { once: true });

            dlg.render({ force: true }).then(() => {
                const el = dlg.element;
                const input = el.querySelector('.vn-pick-search-input');
                const list = el.querySelector('.vn-pick-list');
                const okBtn = el.querySelector('button[data-action="select"]');
                const countEl = el.querySelector('.vn-pick-count');
                okBtn.disabled = true;

                const select = (item) => {
                    list.querySelectorAll('.vn-pick-item.selected').forEach(i => i.classList.remove('selected'));
                    item?.classList.add('selected');
                    picked = item?.dataset.uuid ?? null;
                    okBtn.disabled = !picked;
                    item?.scrollIntoView({ block: 'nearest' });
                };
                const visibleItems = () => [...list.querySelectorAll('.vn-pick-item:not([hidden])')];

                const filter = () => {
                    const q = input.value.trim().toLowerCase();
                    let shown = 0;
                    list.querySelectorAll('.vn-pick-group').forEach(group => {
                        const groupHit = !q || group.dataset.hay.includes(q);
                        let any = 0;
                        group.querySelectorAll('.vn-pick-item').forEach(item => {
                            const hit = groupHit || item.dataset.hay.includes(q);
                            item.hidden = !hit;
                            if (hit) any++;
                        });
                        group.hidden = !any;
                        shown += any;
                    });
                    list.querySelector('.vn-pick-empty').hidden = shown > 0;
                    countEl.textContent = q ? `${shown} / ${total}` : total;
                    const sel = list.querySelector('.vn-pick-item.selected');
                    if (sel?.hidden) select(null);
                };

                input.addEventListener('input', filter);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        if (!picked) select(visibleItems()[0] ?? null);
                        if (picked) okBtn.click();
                    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        const items = visibleItems();
                        if (!items.length) return;
                        const i = items.indexOf(list.querySelector('.vn-pick-item.selected'));
                        const next = ev.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
                        select(items[next < 0 ? 0 : next]);
                    }
                });
                list.addEventListener('click', (ev) => {
                    const item = ev.target.closest('.vn-pick-item');
                    if (item) select(item);
                });
                list.addEventListener('dblclick', (ev) => {
                    if (ev.target.closest('.vn-pick-item')) okBtn.click();
                });
                input.focus();
            });
        });
    }

    _addCue(root, uuid) {
        const sound = this._resolveSoundFromUuid(uuid);
        const list = root.querySelector('#vn-cue-list');
        if (!sound || !list) return;
        const temp = document.createElement('div');
        temp.innerHTML = this._buildCueItemHtml({ id: foundry.utils.randomID(), uuid, label: `${sound.parent.name} — ${sound.name}` });
        list.append(temp.firstElementChild);
    }

    generateTab(musicUuid, soundCues = []) {
        const cuesHtml = soundCues.map(c => this._buildCueItemHtml(c)).join('');
        return `<div class="vn-music-tab">
            ${this._generateMusicSection(musicUuid)}
            <div class="vn-cues-section">
                <div class="vn-music-label"><i class="fas fa-play-circle"></i> ${game.i18n.localize('vn.dialog.soundCuesLabel')}</div>
                <p class="vn-cues-hint">${game.i18n.localize('vn.dialog.soundCuesHint')}</p>
                <div class="vn-cue-drop-zone" id="vn-cue-drop">
                    <i class="fas fa-plus-circle"></i>
                    <span>${game.i18n.localize('vn.dialog.dragTracksFromPlaylist')}</span>
                    ${this._pickButton('cue')}
                </div>
                <div class="vn-cue-list" id="vn-cue-list">${cuesHtml}</div>
            </div>
        </div>`;
    }

    _buildCueItemHtml(cue) {
        return `<div class="vn-cue-item" data-cue-id="${cue.id}" data-cue-uuid="${escapeHtml(cue.uuid)}">
            <i class="fas fa-music vn-cue-icon"></i>
            <input type="text" class="vn-cue-label-input" value="${escapeHtml(cue.label || '')}" placeholder="${game.i18n.localize('vn.dialog.cueLabelPlaceholder')}">
            <button type="button" class="vn-music-clear vn-cue-delete" title="${game.i18n.localize('vn.dialog.btnDelete')}"><i class="fas fa-times"></i></button>
        </div>`;
    }

    _generateMusicSection(musicUuid) {
        let nameText = '';
        let hasMusic = false;
        if (musicUuid) {
            const sound = this._resolveSoundFromUuid(musicUuid);
            if (sound) { nameText = `${sound.parent.name} — ${sound.name}`; hasMusic = true; }
        }
        return `<div class="vn-music-section">
            <div class="vn-music-label"><i class="fas fa-music"></i> ${game.i18n.localize('vn.dialog.musicLabel')}</div>
            <div class="vn-music-drop-zone" id="vn-music-drop"${hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span>${game.i18n.localize('vn.dialog.dragTrackFromPlaylist')}</span>
                ${this._pickButton('music')}
            </div>
            <div class="vn-music-selected" id="vn-music-selected"${!hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span class="vn-music-name" id="vn-music-name">${escapeHtml(nameText)}</span>
                <button type="button" class="vn-music-clear" id="vn-music-clear" title="${game.i18n.localize('vn.dialog.clearMusic')}"><i class="fas fa-times"></i></button>
            </div>
            <input type="hidden" id="vn-music-uuid" value="${escapeHtml(musicUuid || '')}">
        </div>`;
    }

    gatherCues(root) {
        return Array.from(root.querySelectorAll('#vn-cue-list .vn-cue-item')).map(el => ({
            id: el.dataset.cueId || foundry.utils.randomID(),
            uuid: el.dataset.cueUuid,
            label: el.querySelector('.vn-cue-label-input')?.value?.trim() || '',
        })).filter(c => c.uuid);
    }

    applyCues(root, cues) {
        const list = root.querySelector('#vn-cue-list');
        if (!list) return;
        list.innerHTML = cues.map(c => this._buildCueItemHtml(c)).join('');
    }

    setMusic(root, musicUuid) {
        const uuidInput = root.querySelector('#vn-music-uuid');
        const dropZone = root.querySelector('#vn-music-drop');
        const selectedDiv = root.querySelector('#vn-music-selected');
        const nameSpan = root.querySelector('#vn-music-name');
        if (!uuidInput) return;
        if (musicUuid) {
            const sound = this._resolveSoundFromUuid(musicUuid);
            if (sound) {
                uuidInput.value = musicUuid;
                if (nameSpan) nameSpan.textContent = `${sound.parent.name} — ${sound.name}`;
                if (dropZone) dropZone.hidden = true;
                if (selectedDiv) selectedDiv.hidden = false;
                return;
            }
        }
        uuidInput.value = '';
        if (dropZone) dropZone.hidden = false;
        if (selectedDiv) selectedDiv.hidden = true;
    }

    attachListeners(root) {
        if (!root || root._vnMusicDelegated) return;
        root._vnMusicDelegated = true;

        const dropZone = root.querySelector('#vn-music-drop');
        const uuidInput = root.querySelector('#vn-music-uuid');
        if (dropZone && uuidInput) {
            const selectedDiv = root.querySelector('#vn-music-selected');
            const nameSpan = root.querySelector('#vn-music-name');
            const clearBtn = root.querySelector('#vn-music-clear');

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                dropZone.classList.add('drag-over');
            });
            dropZone.addEventListener('dragleave', (e) => {
                if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.type !== 'PlaylistSound' || !data.uuid) return;
                    const sound = this._resolveSoundFromUuid(data.uuid);
                    if (!sound) return;
                    uuidInput.value = data.uuid;
                    if (nameSpan) nameSpan.textContent = `${sound.parent.name} — ${sound.name}`;
                    dropZone.hidden = true;
                    if (selectedDiv) selectedDiv.hidden = false;
                } catch {}
            });

            clearBtn?.addEventListener('click', () => {
                uuidInput.value = '';
                dropZone.hidden = false;
                if (selectedDiv) selectedDiv.hidden = true;
            });
        }

        const cueDropZone = root.querySelector('#vn-cue-drop');
        if (cueDropZone) {
            cueDropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                cueDropZone.classList.add('drag-over');
            });
            cueDropZone.addEventListener('dragleave', (e) => {
                if (!cueDropZone.contains(e.relatedTarget)) cueDropZone.classList.remove('drag-over');
            });
            cueDropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                cueDropZone.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.type !== 'PlaylistSound' || !data.uuid) return;
                    const sound = this._resolveSoundFromUuid(data.uuid);
                    if (!sound) return;
                    this._addCue(root, data.uuid);
                } catch {}
            });
        }

        root.addEventListener('click', async (e) => {
            const pick = e.target.closest('.vn-music-pick');
            if (!pick) return;
            e.preventDefault();
            const uuid = await this._pickSound();
            if (!uuid) return;
            if (pick.dataset.target === 'music') this.setMusic(root, uuid);
            else this._addCue(root, uuid);
        });

        root.querySelector('#vn-cue-list')?.addEventListener('click', (e) => {
            if (e.target.closest('.vn-cue-delete')) e.target.closest('.vn-cue-item')?.remove();
        });
    }
}

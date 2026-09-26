// ============================================================
// vn-music-manager.js — вкладка "Музыка": фоновый трек + звуковые реплики
// ============================================================

import { parsePlaylistUuid } from '../vn-id-utils.js';

export class VNMusicManager {
    _resolveSoundFromUuid(uuid) {
        return parsePlaylistUuid(uuid)?.sound ?? null;
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
                </div>
                <div class="vn-cue-list" id="vn-cue-list">${cuesHtml}</div>
            </div>
        </div>`;
    }

    _buildCueItemHtml(cue) {
        return `<div class="vn-cue-item" data-cue-id="${cue.id}" data-cue-uuid="${cue.uuid}">
            <i class="fas fa-music vn-cue-icon"></i>
            <input type="text" class="vn-cue-label-input" value="${cue.label || ''}" placeholder="${game.i18n.localize('vn.dialog.cueLabelPlaceholder')}">
            <button type="button" class="vn-btn vn-btn-xs vn-cue-delete" title="${game.i18n.localize('vn.dialog.btnDelete')}"><i class="fas fa-times"></i></button>
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
            </div>
            <div class="vn-music-selected" id="vn-music-selected"${!hasMusic ? ' hidden' : ''}>
                <i class="fas fa-music"></i>
                <span class="vn-music-name" id="vn-music-name">${nameText}</span>
                <button type="button" class="vn-music-clear" id="vn-music-clear" title="${game.i18n.localize('vn.dialog.clearMusic')}"><i class="fas fa-times"></i></button>
            </div>
            <input type="hidden" id="vn-music-uuid" value="${musicUuid || ''}">
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
                    const cueId = foundry.utils.randomID();
                    const label = `${sound.parent.name} — ${sound.name}`;
                    const cueList = root.querySelector('#vn-cue-list');
                    if (cueList) {
                        const temp = document.createElement('div');
                        temp.innerHTML = this._buildCueItemHtml({ id: cueId, uuid: data.uuid, label });
                        cueList.append(temp.firstElementChild);
                    }
                } catch {}
            });
        }

        root.querySelector('#vn-cue-list')?.addEventListener('click', (e) => {
            if (e.target.closest('.vn-cue-delete')) e.target.closest('.vn-cue-item')?.remove();
        });
    }
}

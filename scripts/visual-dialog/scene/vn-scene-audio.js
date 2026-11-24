// Scene music playback, paused-track restoration and the GM sound-cue toolbar.
import { parsePlaylistUuid } from '../media/vn-audio-utils.js';
import { escapeHtml } from '../../utils/text.js';
import { VNOverlayPickers } from '../overlay/vn-overlay-pickers.js';

export class VNSceneAudio {
    constructor(scene) {
        this._scene = scene;
        this.currentMusicUuid = null;
        this._pausedSounds = null; // null until the first scene track pauses other sounds
        this._pickers = new VNOverlayPickers();
        this._namespace = null;
        this._soundHookId = null;
    }

    async start(uuid) {
        if (!uuid) return;
        try {
            const parsed = parsePlaylistUuid(uuid);
            if (!parsed) return;
            const { playlist, sound } = parsed;

            // First start only: pause other sounds, saving their position for later resume
            if (this._pausedSounds === null) {
                this._pausedSounds = [];
                for (const pl of game.playlists.contents) {
                    for (const s of pl.sounds.contents) {
                        if (s.playing) {
                            this._pausedSounds.push({ playlistId: pl.id, soundId: s.id });
                            await s.update({ playing: false, pausedTime: s.sound?.currentTime ?? null });
                        }
                    }
                }
            }

            if (!sound.repeat) await sound.update({ repeat: true });
            await playlist.playSound(sound);
            this.currentMusicUuid = uuid;
        } catch(e) { console.error('[VN] Failed to start scene music:', e); }
    }

    async stop(resumePaused = false) {
        if (this.currentMusicUuid) {
            try {
                const parsed = parsePlaylistUuid(this.currentMusicUuid);
                if (parsed?.sound?.playing) await parsed.playlist.stopSound(parsed.sound);
            } catch {}
            this.currentMusicUuid = null;
        }
        if (resumePaused && this._pausedSounds) {
            const toResume = [...this._pausedSounds];
            this._pausedSounds = null;
            for (const { playlistId, soundId } of toResume) {
                try {
                    const pl = game.playlists.get(playlistId);
                    const s = pl?.sounds.get(soundId);
                    if (s) await pl.playSound(s);
                } catch {}
            }
        } else if (resumePaused) {
            this._pausedSounds = null;
        }
    }

    async transition(newUuid) {
        // When removing music: resume paused. When switching: keep paused sounds waiting.
        await this.stop(newUuid === null);
        if (newUuid) await this.start(newUuid);
    }

    _buildSoundItemHtml(cue) {
        const playing = parsePlaylistUuid(cue.uuid)?.sound?.playing ?? false;
        const icon = playing ? 'fa-stop-circle' : 'fa-play-circle';
        const cls = playing ? ' playing' : '';
        return `<button type="button" class="vn-sound-item${cls}" data-uuid="${escapeHtml(cue.uuid)}" title="${escapeHtml(cue.label || '')}">`
            + `<i class="fas ${icon}"></i><span>${escapeHtml(cue.label || game.i18n.localize('vn.sounds.untitled'))}</span></button>`;
    }

    buildToolbarHTML() {
        const cues = this._scene.state.soundCues || [];
        const btn = (cls, icon, title) => `<button type="button" class="vn-toolbar-btn ${cls}" title="${title}"><i class="fas ${icon}"></i></button>`;
        const items = cues.length
            ? cues.map(c => this._buildSoundItemHtml(c)).join('')
            : `<div class="vn-sounds-empty">${game.i18n.localize('vn.sounds.empty')}</div>`;
        return `<div class="vn-sounds-wrap"${!cues.length ? ' hidden' : ''}>
            ${btn('vn-sounds-btn', 'fa-volume-up', game.i18n.localize('vn.sounds.buttonTitle'))}
            <div class="vn-sounds-picker" hidden>
                <div class="vn-sounds-picker-header"><i class="fas fa-music"></i> ${game.i18n.localize('vn.sounds.header')}</div>
                <div class="vn-sounds-list">${items}</div>
            </div>
        </div>`;
    }

    updatePanel() {
        const overlay = this._scene.$overlay?.[0];
        const wrap = overlay?.querySelector('.vn-sounds-wrap');
        if (!wrap) return;
        const cues = this._scene.state.soundCues || [];
        wrap.hidden = !cues.length;
        const picker = wrap.querySelector('.vn-sounds-picker');
        if (!picker) return;
        if (!cues.length) { picker.hidden = true; return; }
        const list = picker.querySelector('.vn-sounds-list');
        if (list) list.innerHTML = cues.map(c => this._buildSoundItemHtml(c)).join('');
    }

    _refreshSoundItemState(soundDoc) {
        const list = this._scene.$overlay?.[0]?.querySelector('.vn-sounds-list');
        if (!list) return;
        for (const cue of (this._scene.state.soundCues || [])) {
            // UUID format: Playlist.playlistId.PlaylistSound.soundId
            if (cue.uuid?.split('.')?.[3] !== soundDoc.id) continue;
            const btn = list.querySelector(`.vn-sound-item[data-uuid="${cue.uuid}"]`);
            if (!btn) continue;
            const playing = soundDoc.playing;
            btn.classList.toggle('playing', playing);
            const icon = btn.querySelector('i');
            if (icon) icon.className = `fas ${playing ? 'fa-stop-circle' : 'fa-play-circle'}`;
        }
    }

    async playCue(uuid) {
        if (!game.user.isGM) return;
        const parsed = parsePlaylistUuid(uuid);
        const sound = parsed?.sound;
        if (!sound) { ui.notifications.warn(game.i18n.localize('vn.sounds.trackNotFound')); return; }
        const playlist = sound.parent;
        if (sound.playing) {
            await playlist.stopSound(sound);
        } else {
            await playlist.playSound(sound);
        }
        this.updatePanel();
    }

    attachListeners(namespace) {
        this.detachListeners();
        const ns = this._namespace = namespace + 'Audio';
        $(document).on(`click${ns}`, '.vn-sounds-btn', (e) => {
            e.stopPropagation();
            const wrap = e.currentTarget.closest('.vn-sounds-wrap');
            const picker = wrap?.querySelector('.vn-sounds-picker');
            if (!picker) return;
            this._pickers.toggle(wrap, picker, 'sounds', () => this.updatePanel());
        });

        $(document).on(`click${ns}`, '.vn-sound-item', (e) => {
            const uuid = e.currentTarget.dataset.uuid;
            if (uuid) this._scene.playSoundCue(uuid);
        });


        this._soundHookId = Hooks.on('updatePlaylistSound', (soundDoc) => {
            this._refreshSoundItemState(soundDoc);
        });
    }

    detachListeners() {
        if (this._namespace) $(document).off(this._namespace);
        this._namespace = null;
        this._pickers.clear();
        if (this._soundHookId != null) Hooks.off('updatePlaylistSound', this._soundHookId);
        this._soundHookId = null;
    }
}

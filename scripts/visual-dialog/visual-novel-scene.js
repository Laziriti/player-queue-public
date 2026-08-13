// ============================================================
// visual-novel-scene.js — v4.0 (refactored core)
// ============================================================

import { VNSceneState, VNPresets } from './vn-state.js';
import { VNAtmosphere } from './visual-effects/atmosphere/index.js';
import { QueueBridge } from './vn-queue-bridge.js';
import { VNTransitions } from './visual-effects/vn-transitions.js';
import { VNBackgroundManager } from './vn-background-manager.js';
import { VNDialogBuilder } from './vn-dialog-builder.js';
import { VNSocketHandler } from './vn-socket-handler.js';
import { stripDupSuffix, parseActorId, parsePlaylistUuid } from './vn-id-utils.js';

const VN_DEBUG = false;
const vnLog = VN_DEBUG ? (...args) => console.log('[VN]', ...args) : () => {};

const UNKNOWN_NAME = 'Неизвестный';

class VisualNovelScene {
    static ID = 'player-queue';
    static NS = '.vnScene';

    static ROW_CONFIG = {
        left:   { enabled: true, maxPerRow: 3, maxRows: 3 },
        center: { enabled: true, maxPerRow: 3, maxRows: 3 },
        right:  { enabled: true, maxPerRow: 3, maxRows: 3 }
    };

    static DEFAULTS = {
        PORTRAIT_SCALE: 1.0,
        SCALE_LIMITS: { MIN: 0.5, MAX: 2.0, STEP: 0.1 },
        ANIMATION_DELAY: 100,
    };

    static SEL = {
        OVERLAY: '#vn-scene-overlay',
        CHARACTER: '.vn-character',
        QUEUE_ITEM: '.vn-queue-item.gm-clickable',
    };

    constructor() {
        this.state = new VNSceneState();
        this.favoriteActors = [];
        this._$overlay = null;
        this._creating = false;
        this._atmosphere = new VNAtmosphere();
        this._bgManager = new VNBackgroundManager(VisualNovelScene.ID);
        this._dialogBuilder = new VNDialogBuilder(this);
        this._socketHandler = null; // initialized after socket is ready
        this._sceneMusicUuid = null;
        this._pausedSounds = null; // null = scene music never started; array = it has
        this._gmOnly = false;      // true = scene hidden from players until "broadcast"
    }

    // ══════════════════════════════════════════════════════════
    // Init
    // ══════════════════════════════════════════════════════════

    async initialize() {
        vnLog('initialized');
        this._registerSettings();
        VNPresets.register();
        await this._bgManager.load();
        await this.loadFavoriteActors();
    }

    initSocket(socket) {
        this._socketHandler = new VNSocketHandler(this, socket);
    }

    _registerSettings() {
        for (const [key, type, def] of [['activeScene', Object, {}], ['favoriteActors', Array, []]]) {
            try {
                game.settings.register(VisualNovelScene.ID, key, {
                    name: key, scope: 'world', config: false, type, default: def
                });
            } catch { /* already registered */ }
        }
    }

    // ══════════════════════════════════════════════════════════
    // Utilities
    // ══════════════════════════════════════════════════════════

    static clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    static debounce(fn, ms = 50) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    static _sidePosition($el) {
        const $side = $el.closest('.vn-side');
        if ($side.hasClass('vn-left-side')) return 'left';
        if ($side.hasClass('vn-center-side')) return 'center';
        if ($side.hasClass('vn-right-side')) return 'right';
        return null;
    }

    get $overlay() {
        if (!this._$overlay?.length || !document.contains(this._$overlay[0])) {
            this._$overlay = $(VisualNovelScene.SEL.OVERLAY);
        }
        return this._$overlay;
    }

    _invalidateOverlayCache() { this._$overlay = null; }

    _cleanupListeners() {
        $(document).off(VisualNovelScene.NS);
        this._removeAtmoOutsideListener();
        this._removeSoundsOutsideListener();
        if (this._soundHookId != null) {
            Hooks.off('updatePlaylistSound', this._soundHookId);
            this._soundHookId = null;
        }
        this._atmosphere.destroy();
    }

    _removeAtmoOutsideListener() {
        if (this._atmoOutsideListener) {
            document.removeEventListener('click', this._atmoOutsideListener, true);
            this._atmoOutsideListener = null;
        }
    }

    _removeSoundsOutsideListener() {
        if (this._soundsOutsideListener) {
            document.removeEventListener('click', this._soundsOutsideListener, true);
            this._soundsOutsideListener = null;
        }
    }

    // ══════════════════════════════════════════════════════════
    // Socket (delegated)
    // ══════════════════════════════════════════════════════════

    emitSocketEvent(action, payload) {
        this._socketHandler?.emit(action, payload);
    }

    handleSocketEvent(data) {
        this._socketHandler?.handle(data);
    }

    setParallaxOptions(opts) {
        this._atmosphere._parallax.setOptions(opts);
    }

    // ══════════════════════════════════════════════════════════
    // Token Resolution
    // ══════════════════════════════════════════════════════════

    static resolveTokens(ids, portraitImages = {}, portraitNames = {}) {
        return ids.map(id => {
            const baseId = stripDupSuffix(id);
            const actorId = parseActorId(baseId);
            if (actorId) {
                const actor = game.actors.get(actorId);
                if (!actor) {
                    const img = portraitImages[id] || portraitImages[baseId];
                    if (!img) return null;
                    const name = portraitNames[id] || portraitNames[baseId] || UNKNOWN_NAME;
                    return { id, actor: { img, id: actorId, name }, name, document: { texture: { src: img } } };
                }
                return { id, actor, name: actor.name, document: { texture: { src: actor.prototypeToken?.texture?.src || actor.img } } };
            }
            const canvasToken = canvas?.tokens?.get(baseId);
            if (canvasToken) {
                if (id === baseId) return canvasToken;
                return { id, actor: canvasToken.actor, name: canvasToken.name, document: canvasToken.document };
            }
            for (const scene of (game.scenes?.contents ?? [])) {
                const td = scene.tokens.get(baseId);
                if (td?.actor) return { id, actor: td.actor, name: td.name || td.actor.name,
                    document: { texture: { src: td.texture?.src || td.actor?.img } } };
            }
            const img = portraitImages[id] || portraitImages[baseId];
            if (img) {
                const name = portraitNames[id] || portraitNames[baseId] || UNKNOWN_NAME;
                return { id, actor: { img, id: baseId, name }, name, document: { texture: { src: img } } };
            }
            return null;
        }).filter(Boolean);
    }

    // ══════════════════════════════════════════════════════════
    // Multi-Row Layout
    // ══════════════════════════════════════════════════════════

    _computeRowLayout(count, position) {
        const cfg = VisualNovelScene.ROW_CONFIG[position];
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

    _generateSideCharacters(tokens, position, queueData, layout) {
        const { rows, useMultiRow } = layout || this._computeRowLayout(tokens.length, position);
        if (!useMultiRow || tokens.length <= 1) {
            return tokens.map(t => this._generateCharacterHTML(t, queueData)).join('');
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
            html += `<div class="${rowClass}" data-depth="${r}">${rowTokens.map(t => this._generateCharacterHTML(t, queueData, rowType)).join('')}</div>`;
        }
        return html;
    }

    // ══════════════════════════════════════════════════════════
    // State Persistence
    // ══════════════════════════════════════════════════════════

    async _persistState() {
        if (!game.user.isGM) return;
        try {
            await game.settings.set(VisualNovelScene.ID, 'activeScene',
                this.state.isActive ? this.state.toPayload() : {});
        } catch (e) { console.error('VN: Failed to persist state:', e); }
    }

    async restoreStateIfNeeded() {
        if (this.state.isActive) return;
        try {
            const s = game.settings.get(VisualNovelScene.ID, 'activeScene');
            if (!s || (!s.leftIds?.length && !s.centerIds?.length && !s.rightIds?.length && !s.background)) return;
            vnLog('Restoring scene');
            this._sceneMusicUuid = s.musicUuid || null;
            this.createScene(s, false);
        } catch { /* no saved state */ }
    }

    // ══════════════════════════════════════════════════════════
    // Favorites
    // ══════════════════════════════════════════════════════════

    async loadFavoriteActors() {
        try { this.favoriteActors = await game.settings.get(VisualNovelScene.ID, 'favoriteActors') || []; }
        catch { this.favoriteActors = []; }
    }

    async saveFavoriteActors() {
        try { await game.settings.set(VisualNovelScene.ID, 'favoriteActors', this.favoriteActors); }
        catch (e) { console.error('Error saving favorite actors:', e); }
    }

    async addToFavorites(actorId) {
        if (this.favoriteActors.includes(actorId)) return;
        this.favoriteActors.push(actorId);
        await this.saveFavoriteActors();
    }

    async removeFromFavorites(actorId) {
        const idx = this.favoriteActors.indexOf(actorId);
        if (idx === -1) return;
        this.favoriteActors.splice(idx, 1);
        await this.saveFavoriteActors();
    }

    // ══════════════════════════════════════════════════════════
    // Portrait Scale
    // ══════════════════════════════════════════════════════════

    setPortraitScale(scale, emit = true) {
        if (emit && !game.user.isGM) return;
        const { MIN, MAX } = VisualNovelScene.DEFAULTS.SCALE_LIMITS;
        this.state.portraitScale = VisualNovelScene.clamp(scale, MIN, MAX);
        this._applyAllPortraitTransforms();
        const resetBtn = document.getElementById('reset-size');
        if (resetBtn) resetBtn.textContent = Math.round(this.state.portraitScale * 100) + '%';
        if (emit) this.emitSocketEvent('setPortraitScale', { scale: this.state.portraitScale });
    }

    _applyAllPortraitTransforms() {
        document.documentElement.style.setProperty('--portrait-scale', this.state.portraitScale);
        document.querySelectorAll(VisualNovelScene.SEL.CHARACTER).forEach(charEl => {
            const tid = charEl.dataset.tokenId;
            const img = charEl.querySelector('.vn-character-img');
            if (img) img.style.setProperty('--flip-x', this.state.flipped[tid] ? '-1' : '1');
            const charScale = this.state.portraitScales?.[tid];
            if (charScale !== undefined) charEl.style.setProperty('--char-scale', charScale);
            else charEl.style.removeProperty('--char-scale');
        });
    }

    setCharacterScale(tokenId, scale, emit = true) {
        if (emit && !game.user.isGM) return;
        const { MIN, MAX } = VisualNovelScene.DEFAULTS.SCALE_LIMITS;
        scale = VisualNovelScene.clamp(Math.round(scale * 20) / 20, MIN, MAX);
        this.state.portraitScales[tokenId] = scale;
        const charEl = document.querySelector(`${VisualNovelScene.SEL.CHARACTER}[data-token-id="${tokenId}"]`);
        if (charEl) charEl.style.setProperty('--char-scale', scale);
        if (emit) this.emitSocketEvent('setCharacterScale', { tokenId, scale });
        this._persistState();
    }

    applyFlip(tokenId, flip) {
        this.state.flipped[tokenId] = flip;
        this._applyAllPortraitTransforms();
    }

    static _applyHiddenToElement(charEl, hidden) {
        charEl.classList.toggle('vn-character-hidden', hidden);
        const nm = charEl.querySelector('.vn-nameplate-text');
        if (nm) nm.textContent = hidden ? '???' : (charEl.dataset.name || '');
    }

    applyHidden(tokenId, hidden, emit = true) {
        if (emit && !game.user.isGM) return;
        if (hidden) this.state.hidden[tokenId] = true;
        else delete this.state.hidden[tokenId];
        const charEl = document.querySelector(`.vn-character[data-token-id="${tokenId}"]`);
        if (charEl) VisualNovelScene._applyHiddenToElement(charEl, !!hidden);
        if (emit) { this.emitSocketEvent('setHidden', { tokenId, hidden: !!hidden }); this._persistState(); }
    }

    _applyAllHiddenStates() {
        document.querySelectorAll('.vn-character').forEach(charEl =>
            VisualNovelScene._applyHiddenToElement(charEl, !!this.state.hidden[charEl.dataset.tokenId]));
    }

    // ══════════════════════════════════════════════════════════
    // Scene Music
    // ══════════════════════════════════════════════════════════

    async startSceneMusic(uuid) {
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
            this._sceneMusicUuid = uuid;
        } catch(e) { console.error('[VN] Failed to start scene music:', e); }
    }

    async stopSceneMusic(resumePaused = false) {
        if (this._sceneMusicUuid) {
            try {
                const parsed = parsePlaylistUuid(this._sceneMusicUuid);
                if (parsed?.sound?.playing) await parsed.playlist.stopSound(parsed.sound);
            } catch {}
            this._sceneMusicUuid = null;
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

    async _handleMusicTransition(newUuid) {
        // When removing music: resume paused. When switching: keep paused sounds waiting.
        await this.stopSceneMusic(newUuid === null);
        if (newUuid) await this.startSceneMusic(newUuid);
    }

    // ══════════════════════════════════════════════════════════
    // Background Overlay & Atmosphere
    // ══════════════════════════════════════════════════════════

    setBackgroundOverlay(enabled, emit = true) {
        if (emit && !game.user.isGM) return;
        this.state.backgroundOverlay = enabled;
        this._bgManager.applyBackground(this.$overlay, this.state.background, enabled);
        if (emit) this.emitSocketEvent('setBackgroundOverlay', { enabled });
    }

    setAtmosphereEffect(effect, emit = true) {
        if (emit && !game.user.isGM) return;
        if (!VNAtmosphere.EFFECTS.includes(effect)) return;
        this.state.atmosphereEffect = effect;
        const overlayEl = this.$overlay?.[0];
        if (overlayEl) {
            this._atmosphere.destroy();
            this._atmosphere.init(overlayEl, effect);
            this._updateAtmosphereButton();
        }
        if (emit) { this.emitSocketEvent('setAtmosphereEffect', { effect }); this._persistState(); }
    }

    _updateAtmosphereButton() {
        const effect = this.state.atmosphereEffect || 'particles';
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const btn = overlay.querySelector('.vn-atmosphere-cycle-btn');
        if (btn) {
            btn.querySelector('i').className = `fas ${VNAtmosphere.EFFECT_ICONS[effect]}`;
            btn.title = `Атмосфера: ${VNAtmosphere.EFFECT_LABELS[effect]}`;
        }
        overlay.querySelectorAll('.vn-atmo-item').forEach(item =>
            item.classList.toggle('active', item.dataset.effect === effect));
    }

    // ══════════════════════════════════════════════════════════
    // Sound Cues
    // ══════════════════════════════════════════════════════════

    _buildSoundItemHtml(cue) {
        const playing = parsePlaylistUuid(cue.uuid)?.sound?.playing ?? false;
        const icon = playing ? 'fa-stop-circle' : 'fa-play-circle';
        const cls = playing ? ' playing' : '';
        return `<button type="button" class="vn-sound-item${cls}" data-uuid="${cue.uuid}" title="${cue.label || ''}">`
            + `<i class="fas ${icon}"></i><span>${cue.label || 'Без названия'}</span></button>`;
    }

    _generateSoundsWrapHTML() {
        const cues = this.state.soundCues || [];
        const btn = (cls, icon, title) => `<button type="button" class="vn-toolbar-btn ${cls}" title="${title}"><i class="fas ${icon}"></i></button>`;
        const items = cues.length
            ? cues.map(c => this._buildSoundItemHtml(c)).join('')
            : '<div class="vn-sounds-empty">Нет звуков</div>';
        return `<div class="vn-sounds-wrap"${!cues.length ? ' hidden' : ''}>
            ${btn('vn-sounds-btn', 'fa-volume-up', 'Звуки сцены')}
            <div class="vn-sounds-picker" hidden>
                <div class="vn-sounds-picker-header"><i class="fas fa-music"></i> Звуки</div>
                <div class="vn-sounds-list">${items}</div>
            </div>
        </div>`;
    }

    _updateSoundsPanel() {
        const overlay = this.$overlay?.[0];
        const wrap = overlay?.querySelector('.vn-sounds-wrap');
        if (!wrap) return;
        const cues = this.state.soundCues || [];
        wrap.hidden = !cues.length;
        const picker = wrap.querySelector('.vn-sounds-picker');
        if (!picker) return;
        if (!cues.length) { picker.hidden = true; return; }
        const list = picker.querySelector('.vn-sounds-list');
        if (list) list.innerHTML = cues.map(c => this._buildSoundItemHtml(c)).join('');
    }

    _refreshSoundItemState(soundDoc) {
        const list = this.$overlay?.[0]?.querySelector('.vn-sounds-list');
        if (!list) return;
        for (const cue of (this.state.soundCues || [])) {
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

    async playSoundCue(uuid) {
        if (!game.user.isGM) return;
        const parsed = parsePlaylistUuid(uuid);
        const sound = parsed?.sound;
        if (!sound) { ui.notifications.warn('Трек не найден'); return; }
        const playlist = sound.parent;
        if (sound.playing) {
            await playlist.stopSound(sound);
        } else {
            await playlist.playSound(sound);
        }
        this._updateSoundsPanel();
    }

    // ══════════════════════════════════════════════════════════
    // GM-Only mode
    // ══════════════════════════════════════════════════════════

    broadcastToPlayers() {
        if (!game.user.isGM || !this.state.isActive) return;
        this._gmOnly = false;
        this.emitSocketEvent('open', this.state.toPayload());
        if (this._sceneMusicUuid) this.startSceneMusic(this._sceneMusicUuid);
        this._updateGmOnlyUI();
    }

    _updateGmOnlyUI() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const broadcastBtn = overlay.querySelector('.vn-broadcast-button');
        if (broadcastBtn) broadcastBtn.style.display = this._gmOnly ? '' : 'none';
        overlay.classList.toggle('vn-gm-only', this._gmOnly);
    }

    // ══════════════════════════════════════════════════════════
    // Minimize / Maximize
    // ══════════════════════════════════════════════════════════

    setMinimized(value, emit = true, forAll = true, fromSocket = false) {
        if (forAll && !game.user.isGM && !fromSocket) return;
        this.state.minimized = value;
        this.$overlay.toggleClass('minimized', value);
        if (emit && forAll && game.user.isGM) this.emitSocketEvent(value ? 'minimize' : 'maximize', {});
    }

    _setMinimizedSelf(value) {
        if (!game.user.isGM) return;
        this.state.minimized = value;
        this.$overlay.toggleClass('minimized', value);
    }

    // ══════════════════════════════════════════════════════════
    // Dialog (delegated)
    // ══════════════════════════════════════════════════════════

    openSceneDialog() { this._dialogBuilder.openSceneDialog(); }
    editSceneDialog() { this._dialogBuilder.editSceneDialog(); }
    openPortraitSizeDialog() { this._dialogBuilder.openScaleDialog(); }

    // ══════════════════════════════════════════════════════════
    // Create / Update / Close Scene
    // ══════════════════════════════════════════════════════════

    createScene(payload, emit = true) {
        if (this._creating) return;
        this._creating = true;
        try { this._doCreateScene(payload, emit); }
        finally { this._creating = false; }
    }

    _doCreateScene(payload, emit) {
        vnLog('createScene, emit:', emit);
        this._atmosphere.destroy();
        this.state.reset();
        this.state.fromPayload({
            leftIds: payload.leftIds,
            centerIds: payload.centerIds,
            rightIds: payload.rightIds,
            background: payload.background,
            backgroundOverlay: payload.backgroundOverlay ?? true,
            portraitScale: payload.portraitScale ?? VisualNovelScene.DEFAULTS.PORTRAIT_SCALE,
            atmosphereEffect: payload.atmosphereEffect ?? 'particles',
            flipped: payload.flipped || {},
            hidden: payload.hidden || {},
            musicUuid: payload.musicUuid ?? null,
            soundCues: payload.soundCues || [],
            portraitImages: payload.portraitImages || {},
            portraitNames: payload.portraitNames || {},
            portraitScales: payload.portraitScales || {},
        });

        this._gmOnly = !!(payload.gmOnly) && emit && game.user.isGM;

        if (emit && !this._gmOnly) this.emitSocketEvent('open', this.state.toPayload());

        const musicUuid = this.state.musicUuid;
        if (emit && game.user.isGM) {
            const prevMusicUuid = this._sceneMusicUuid;
            if (prevMusicUuid !== musicUuid) this._handleMusicTransition(musicUuid);
        } else {
            this._sceneMusicUuid = musicUuid;
        }

        $(VisualNovelScene.SEL.OVERLAY).remove();
        this._invalidateOverlayCache();
        this._cleanupListeners();

        const tokens = Object.fromEntries(
            VNSceneState.POSITIONS.map(pos => [pos, VisualNovelScene.resolveTokens(
                this.state[`${pos}Ids`], this.state.portraitImages, this.state.portraitNames)])
        );

        $('body').append(this._generateSceneHTML(tokens));
        this._invalidateOverlayCache();

        document.querySelectorAll('#vn-scene-overlay .vn-character .vn-character-img').forEach(img => img.style.opacity = '0');
        this._bgManager.applyBackground(this.$overlay, this.state.background, this.state.backgroundOverlay);

        setTimeout(() => {
            this.activateSceneListeners();
            this._applyAllPortraitTransforms();
            this._atmosphere.init(this.$overlay[0], this.state.atmosphereEffect);
            this._updateAtmosphereButton();
            this._animateInitialCharacters();
            if (game.user.isGM) this._updateGmOnlyUI();
        }, VisualNovelScene.DEFAULTS.ANIMATION_DELAY);

        this._persistState();
    }

    updateSceneLayout(payload, emit = true) {
        if (!this.state.isActive) return;

        const prevSpeakers = { ...this.state.speakers };
        const prevBackground = this.state.background;

        this.state.leftIds = payload.leftIds ? [...payload.leftIds] : [];
        this.state.centerIds = payload.centerIds ? [...payload.centerIds] : [];
        this.state.rightIds = payload.rightIds ? [...payload.rightIds] : [];
        if (payload.background != null) this.state.background = payload.background;
        if (payload.backgroundOverlay != null) this.state.backgroundOverlay = payload.backgroundOverlay;
        if (payload.flipped !== undefined && payload.flipped !== null) this.state.flipped = { ...payload.flipped };
        if (payload.hidden !== undefined && payload.hidden !== null) this.state.hidden = { ...payload.hidden };
        if (payload.portraitImages !== undefined && payload.portraitImages !== null) this.state.portraitImages = { ...payload.portraitImages };
        if (payload.portraitNames !== undefined && payload.portraitNames !== null) this.state.portraitNames = { ...payload.portraitNames };
        if (payload.portraitScales !== undefined && payload.portraitScales !== null) this.state.portraitScales = { ...payload.portraitScales };
        if (payload.atmosphereEffect != null && this.state.atmosphereEffect !== payload.atmosphereEffect) {
            this.state.atmosphereEffect = payload.atmosphereEffect;
            const overlayEl = this.$overlay?.[0];
            if (overlayEl) { this._atmosphere.destroy(); this._atmosphere.init(overlayEl, payload.atmosphereEffect); this._updateAtmosphereButton(); }
        }
        if ('musicUuid' in payload && emit && game.user.isGM) {
            const prevMusicUuid = this._sceneMusicUuid;
            this.state.musicUuid = payload.musicUuid;
            if (prevMusicUuid !== payload.musicUuid) this._handleMusicTransition(payload.musicUuid);
        }
        if (payload.soundCues !== undefined && payload.soundCues !== null) {
            this.state.soundCues = [...payload.soundCues];
            if (emit) this._updateSoundsPanel();
        }

        if ('gmOnly' in payload && emit && game.user.isGM) this._gmOnly = !!payload.gmOnly;

        if (emit && !this._gmOnly) this.emitSocketEvent('updateScene', this.state.toPayload());
        const queueData = QueueBridge.getQueue();

        requestAnimationFrame(async () => {
            const bgChanged = payload.background != null && payload.background !== prevBackground && prevBackground;
            if (bgChanged) await this._bgManager.switchWithTransition(this.$overlay, this.state.background, this.state.backgroundOverlay, this._atmosphere);
            else this._bgManager.applyBackground(this.$overlay, this.state.background, this.state.backgroundOverlay);

            await Promise.all(VNSceneState.POSITIONS.map(side =>
                this._updateSide(this.state[`${side}Ids`], `.vn-${side}-side`, side, queueData)));

            this._applyAllPortraitTransforms();
            this._applyAllHiddenStates();
            this._restoreSpeakers(prevSpeakers);
        });

        this._persistState();
    }

    async _updateSide(ids, sideSelector, position, queueData) {
        const tokens = VisualNovelScene.resolveTokens(ids, this.state.portraitImages, this.state.portraitNames);
        const container = document.querySelector(`.vn-side${sideSelector}`);
        if (!container) return;

        const { useMultiRow } = this._computeRowLayout(ids.length, position);
        container.classList.toggle('vn-multi-row', useMultiRow);

        const oldChars = container.querySelectorAll('.vn-character');
        const oldIds = Array.from(oldChars).map(el => el.dataset.tokenId);
        const newIds = tokens.map(t => t.id || `actor-${t.actor.id}`);

        if (oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i])) return;

        const oldIdSet = new Set(oldIds);
        const newIdSet = new Set(newIds);
        const removingEls = Array.from(oldChars).filter(el => !newIdSet.has(el.dataset.tokenId));
        const addingIds = new Set(newIds.filter(id => !oldIdSet.has(id)));

        if (removingEls.length) await Promise.all(removingEls.map(el => VNTransitions.exitCharacter(el)));

        if (tokens.length) {
            container.innerHTML = this._generateSideCharacters(tokens, position, queueData);
            container.classList.remove('empty');

            const activeSpeaker = this.state.speakers[position];
            container.querySelectorAll('.vn-character').forEach(charEl => {
                const tid = charEl.dataset.tokenId;
                const img = charEl.querySelector('.vn-character-img');
                if (img) img.style.setProperty('--flip-x', this.state.flipped[tid] ? '-1' : '1');
                if (tid === activeSpeaker) charEl.classList.add('active');
                if (addingIds.has(tid) && img) img.style.opacity = '0';
            });

            let idx = 0;
            container.querySelectorAll('.vn-character').forEach(charEl => {
                if (addingIds.has(charEl.dataset.tokenId)) {
                    setTimeout(() => VNTransitions.enterCharacter(charEl, 'auto'), idx++ * 100);
                }
            });
        } else {
            container.innerHTML = '';
            container.classList.add('empty');
        }
    }

    _restoreSpeakers(prevSpeakers) {
        for (const pos of VNSceneState.POSITIONS) {
            const sid = prevSpeakers[pos];
            this.state.speakers[pos] = null;
            if (sid && this.state.getIdsForPosition(pos).includes(sid)) {
                this.setActiveSpeaker(sid, false, pos);
            } else {
                $(`.vn-${pos}-side .vn-character`).removeClass('active');
                $(`.vn-${pos}-side .vn-row`).removeClass('vn-row-promoted');
            }
        }
    }

    closeScene(emit = true) {
        if (emit && !game.user.isGM) return;
        if (emit) this.stopSceneMusic(true);
        this._cleanupListeners();

        const $ov = this.$overlay;
        if ($ov.length) {
            const characters = $ov[0].querySelectorAll('.vn-character');
            characters.forEach((charEl, i) => setTimeout(() => VNTransitions.exitCharacter(charEl), i * 50));
            const exitDelay = Math.min(characters.length * 50 + 600, 900);
            setTimeout(() => { $ov.addClass('vn-closing'); setTimeout(() => $ov.remove(), 600); }, exitDelay);
        }

        this._invalidateOverlayCache();
        this.state.reset();
        if (emit) this.emitSocketEvent('close', {});
        this._persistState();
        // Re-show floating queue for GM now that VN scene is closed
        setTimeout(() => window.PlayerQueue?.instance?.updateFloatingQueue?.(), 200);
    }

    // ══════════════════════════════════════════════════════════
    // Active Speaker
    // ══════════════════════════════════════════════════════════

    setActiveSpeaker(tokenId, emit = true, position = null) {
        if (emit && !game.user.isGM) return;
        const $char = $(`.vn-character[data-token-id="${tokenId}"]`);

        if (!position) position = VisualNovelScene._sidePosition($char);
        if (!position) return;

        const activated = this.state.toggleSpeaker(tokenId, position);
        $(`.vn-${position}-side .vn-character`).removeClass('active');
        const $side = $(`.vn-${position}-side`);
        $side.find('.vn-row').removeClass('vn-row-promoted');

        if (activated) {
            $char.addClass('active');
            const $parentRow = $char.closest('.vn-row');
            if ($parentRow.length && $parentRow.hasClass('vn-back-row')) $parentRow.addClass('vn-row-promoted');
        }

        if (emit) this.emitSocketEvent('setSpeaker', { tokenId, position });
    }

    setExclusiveSpeaker(tokenId, emit = true) {
        if (emit && !game.user.isGM) return;
        for (const pos of VNSceneState.POSITIONS) {
            this.state.speakers[pos] = null;
            $(`.vn-${pos}-side .vn-character`).removeClass('active');
            $(`.vn-${pos}-side .vn-row`).removeClass('vn-row-promoted');
        }
        const $char = $(`.vn-character[data-token-id="${tokenId}"]`);
        const position = VisualNovelScene._sidePosition($char);
        if (!position) return;
        this.state.speakers[position] = tokenId;
        $char.addClass('active');
        const $row = $char.closest('.vn-row');
        if ($row.hasClass('vn-back-row')) $row.addClass('vn-row-promoted');
        if (emit) this.emitSocketEvent('setExclusiveSpeaker', { tokenId });
    }

    // ══════════════════════════════════════════════════════════
    // Queue Display
    // ══════════════════════════════════════════════════════════

    updateQueueDisplay() {
        if (!this.state.isActive || !game.user.isGM) return;
        const queueData = QueueBridge.getQueue();
        $('.vn-queue-display').html(this._generateQueueDisplay(queueData));
        this._updateCharacterBorders();
        this.emitSocketEvent('updateQueue', {});
    }

    _updateCharacterBorders() {
        if (!this.state.isActive || !QueueBridge.available) return;
        const index = QueueBridge.buildActorIndex(QueueBridge.getQueue());
        document.querySelectorAll('.vn-character').forEach(charEl => {
            const tokenId = stripDupSuffix(charEl.dataset.tokenId);
            const aid = parseActorId(tokenId);
            const actor = aid ? game.actors.get(aid) : canvas.tokens.get(tokenId)?.actor;
            charEl.classList.remove('queue-priority-0', 'queue-priority-1', 'queue-priority-2');
            const pd = QueueBridge.resolveActorPriority(actor, index);
            if (pd) { charEl.style.setProperty('--queue-color', pd.color); charEl.classList.add(`queue-priority-${pd.priority}`); }
            else charEl.style.removeProperty('--queue-color');
        });
    }

    // ══════════════════════════════════════════════════════════
    // Animations
    // ══════════════════════════════════════════════════════════

    _animateInitialCharacters(staggerMs = 120) {
        const overlay = this.$overlay[0];
        if (!overlay) return;
        overlay.querySelectorAll('.vn-character').forEach((charEl, index) => {
            const img = charEl.querySelector('.vn-character-img');
            if (img) img.style.opacity = '0';
            setTimeout(() => VNTransitions.enterCharacter(charEl, 'auto'), index * staggerMs);
        });
    }

    // ══════════════════════════════════════════════════════════
    // HTML Generation
    // ══════════════════════════════════════════════════════════

    _generateCharacterHTML(token, queueData, row = null) {
        const tokenId = token.id || `actor-${token.actor.id}`;
        const imgSrc = token.actor.img || token.document?.texture?.src || 'icons/svg/mystery-man.svg';
        const pd = QueueBridge.resolveActorPriority(token.actor, queueData);
        const priorityClass = pd ? `queue-priority-${pd.priority}` : '';
        const rowClass = row ? `vn-row-${row}` : '';
        const isHidden = !!this.state.hidden[tokenId];
        const hiddenClass = isHidden ? 'vn-character-hidden' : '';
        const displayName = isHidden ? '???' : token.name;

        // Inline transform vars so element starts at correct values — prevents transition flash on insertion
        const charScale = this.state.portraitScales[tokenId];
        const charStyle = (pd ? `--queue-color: ${pd.color};` : '')
            + (charScale !== undefined ? `--char-scale: ${charScale};` : '');
        const flipX = this.state.flipped[tokenId] ? '-1' : '1';

        return `<div class="vn-character ${priorityClass} ${rowClass} ${hiddenClass}" data-token-id="${tokenId}" data-name="${token.name}" style="${charStyle}">
            <div class="vn-speaking-indicator"><span></span><span></span><span></span></div>
            <img class="vn-character-img" src="${imgSrc}" alt="${token.name}" loading="lazy" style="--flip-x: ${flipX}">
            <div class="vn-character-nameplate"><span class="vn-nameplate-text">${displayName}</span></div>
            <div class="vn-character-glow"></div></div>`;
    }

    _generateQueueDisplay(queueData) {
        if (!game.user.isGM || !queueData?.length) return '';
        return `<div class="vn-queue-container">
            <div class="vn-queue-title"><i class="fas fa-users"></i> Очередь</div>
            <div class="vn-queue-items">${queueData.map((player, i) => {
            const pd = QueueBridge.getPriorityData(player.priority);
            return `<div class="vn-queue-item gm-clickable" title="${player.name} — ${pd.name}&#10;ЛКМ: объявить · ПКМ: убрать" data-user-id="${player.id}" style="border-color: ${pd.color};">
                    <img src="${player.avatar}" alt="${player.name}" onerror="this.src='icons/svg/mystery-man.svg'" loading="lazy">
                    <span class="vn-queue-number">${i + 1}</span></div>`;
        }).join('')}</div></div>`;
    }

    _generateSceneHTML(tokens) {
        const qd = QueueBridge.getQueue();
        const isGM = game.user.isGM;

        const sides = VNSceneState.POSITIONS.map(side => {
            const t = tokens[side] || [];
            const layout = this._computeRowLayout(t.length, side);
            return `<div class="vn-side vn-${side}-side ${t.length ? '' : 'empty'} ${layout.useMultiRow ? 'vn-multi-row' : ''}">${this._generateSideCharacters(t, side, qd, layout)}</div>`;
        }).join('');

        const controls = isGM ? `<div class="vn-size-controls">
            <button type="button" class="vn-size-button" id="decrease-size" title="Уменьшить"><i class="fas fa-minus"></i></button>
            <button type="button" class="vn-size-button vn-size-reset" id="reset-size" title="Сброс">${Math.round(this.state.portraitScale * 100)}%</button>
            <button type="button" class="vn-size-button" id="increase-size" title="Увеличить"><i class="fas fa-plus"></i></button>
            <button type="button" class="vn-size-button" id="size-dialog" title="Настройка"><i class="fas fa-sliders-h"></i></button>
        </div>` : '';

        const atmoEffect = this.state.atmosphereEffect || 'particles';

        const pickerItems = VNAtmosphere.EFFECT_GROUPS.map(group =>
            `<div class="vn-atmo-group-header">${group.label}</div>`
            + group.effects.map(e =>
                `<button type="button" class="vn-atmo-item${e === atmoEffect ? ' active' : ''}" data-effect="${e}" title="${VNAtmosphere.EFFECT_LABELS[e]}"><i class="fas ${VNAtmosphere.EFFECT_ICONS[e]}"></i><span>${VNAtmosphere.EFFECT_LABELS[e]}</span></button>`
            ).join('')
        ).join('');

        const btn = (cls, icon, title) => `<button type="button" class="vn-toolbar-btn ${cls}" title="${title}"><i class="fas ${icon}"></i></button>`;

        const toolbar = isGM
            ? `<div class="vn-toolbar">
                ${btn('vn-settings-button', 'fa-cog', 'Настройки сцены')}
                <div class="vn-atmo-wrap">
                    ${btn('vn-atmosphere-cycle-btn', VNAtmosphere.EFFECT_ICONS[atmoEffect], `Атмосфера: ${VNAtmosphere.EFFECT_LABELS[atmoEffect]}`)}
                    <div class="vn-atmosphere-picker" hidden>
                        <div class="vn-atmosphere-picker-header"><i class="fas fa-wand-sparkles"></i> Атмосфера</div>
                        <div class="vn-atmosphere-picker-grid">${pickerItems}</div>
                    </div>
                </div>
                ${this._generateSoundsWrapHTML()}
                ${btn('vn-minimize-all-button', 'fa-window-minimize', 'Свернуть для всех')}
                ${btn('vn-minimize-self-button', 'fa-eye-slash', 'Свернуть для себя')}
                ${btn('vn-epicrolls-button', 'fa-dice-d20', 'Epic Rolls')}
                <button type="button" class="vn-toolbar-btn vn-broadcast-button" title="Показать игрокам" style="display:none"><i class="fas fa-broadcast-tower"></i></button>
                ${btn('vn-close-button', 'fa-times', 'Закрыть сцену')}
            </div>`
            : '<button type="button" class="vn-toolbar-btn vn-close-button vn-close-standalone" title="Закрыть"><i class="fas fa-times"></i></button>';

        const maxBar = isGM ? `<div class="vn-maximized-actions">
            <button type="button" class="vn-toolbar-btn vn-maximize-all-button" title="Развернуть для всех"><i class="fas fa-window-maximize"></i></button>
            <button type="button" class="vn-toolbar-btn vn-maximize-self-button" title="Развернуть для себя"><i class="fas fa-eye"></i></button>
        </div>` : '';

        return `<div id="vn-scene-overlay">
            <div class="vn-bg-layer"></div><div class="vn-background-overlay"></div>
            <div class="vn-fx-tint"></div><div class="vn-fx-rays"></div><div class="vn-fx-edges"></div><div class="vn-fx-scan"></div><div class="vn-fx-flash"></div>
            <div class="vn-vignette"></div><div class="vn-ambient-light"></div><div class="vn-particles"></div><div class="vn-ground-fog"></div>
            ${controls}
            <div class="vn-queue-display">${this._generateQueueDisplay(qd)}</div>
            ${sides}${toolbar}
            <div class="vn-maximized-bar"><span class="vn-scene-title"><i class="fas fa-theater-masks"></i> Диалоговая сцена</span>${maxBar}</div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    // Scene Listeners
    // ══════════════════════════════════════════════════════════

    activateSceneListeners() {
        this._cleanupListeners();
        const ns = VisualNovelScene.NS;

        $(document).on(`click${ns}`, '.vn-close-button', () => this.closeScene(true));
        $(document).on(`keydown${ns}`, (e) => {
            if (e.key === 'Escape') {
                const picker = document.querySelector('#vn-scene-overlay .vn-atmosphere-picker');
                if (picker && !picker.hidden) { picker.hidden = true; return; }
                if (!this.state.minimized) this.closeScene(true);
            }
        });

        if (game.user.isGM) this._setupGMListeners(ns);
        this._setupCharacterListeners();
    }

    _setupGMListeners(ns) {
        const { STEP } = VisualNovelScene.DEFAULTS.SCALE_LIMITS;
        const actions = {
            '.vn-settings-button': () => this.editSceneDialog(),
            '.vn-minimize-all-button': () => this.setMinimized(true, true, true),
            '.vn-minimize-self-button': () => this._setMinimizedSelf(true),
            '.vn-maximize-all-button': () => this.setMinimized(false, true, true),
            '.vn-maximize-self-button': () => this._setMinimizedSelf(false),
            '#decrease-size': () => this.setPortraitScale(this.state.portraitScale - STEP, true),
            '#increase-size': () => this.setPortraitScale(this.state.portraitScale + STEP, true),
            '#reset-size': () => this.setPortraitScale(VisualNovelScene.DEFAULTS.PORTRAIT_SCALE, true),
            '#size-dialog': () => this.openPortraitSizeDialog(),
            '.vn-atmosphere-cycle-btn': (e) => {
                e.stopPropagation();
                const wrap = e.currentTarget.closest('.vn-atmo-wrap');
                const picker = wrap?.querySelector('.vn-atmosphere-picker');
                if (!picker) return;
                if (!picker.hidden) { picker.hidden = true; return; }
                picker.hidden = false;
                this._removeAtmoOutsideListener();
                this._atmoOutsideListener = (ev) => {
                    if (!wrap.contains(ev.target)) {
                        picker.hidden = true;
                        this._removeAtmoOutsideListener();
                    }
                };
                setTimeout(() => document.addEventListener('click', this._atmoOutsideListener, true), 0);
            }
        };
        for (const [sel, fn] of Object.entries(actions)) $(document).on(`click${ns}`, sel, fn);

        $(document).on(`click${ns}`, '.vn-broadcast-button', () => this.broadcastToPlayers());

        $(document).on(`click${ns}`, '.vn-sounds-btn', (e) => {
            e.stopPropagation();
            const wrap = e.currentTarget.closest('.vn-sounds-wrap');
            const picker = wrap?.querySelector('.vn-sounds-picker');
            if (!picker) return;
            if (!picker.hidden) { picker.hidden = true; return; }
            picker.hidden = false;
            this._updateSoundsPanel();
            this._removeSoundsOutsideListener();
            this._soundsOutsideListener = (ev) => {
                if (!wrap.contains(ev.target)) {
                    picker.hidden = true;
                    this._removeSoundsOutsideListener();
                }
            };
            setTimeout(() => document.addEventListener('click', this._soundsOutsideListener, true), 0);
        });

        $(document).on(`click${ns}`, '.vn-sound-item', (e) => {
            const uuid = e.currentTarget.dataset.uuid;
            if (uuid) this.playSoundCue(uuid);
        });

        $(document).on(`click${ns}`, '.vn-atmo-item', (e) => {
            const effect = e.currentTarget.dataset.effect;
            if (!effect) return;
            this.setAtmosphereEffect(effect);
            const picker = document.querySelector('#vn-scene-overlay .vn-atmosphere-picker');
            if (picker) picker.hidden = true;
        });

        $(document).on(`click${ns}`, '.vn-epicrolls-button', () => {
            if (!game.modules.get('epic-rolls-5e')?.active) return;
            if (ui.EpicRolls5e?.GetRollData) new ui.EpicRolls5e.GetRollData({ actors: [], contestants: [], type: '', contest: null, options: {} }).render(true);
        });

        $(document).on(`click${ns}`, VisualNovelScene.SEL.QUEUE_ITEM, (e) => { e.stopPropagation(); QueueBridge.announceAndRemove($(e.currentTarget).data('user-id')); });
        $(document).on(`contextmenu${ns}`, VisualNovelScene.SEL.QUEUE_ITEM, (e) => { e.preventDefault(); e.stopPropagation(); QueueBridge.removeFromQueue($(e.currentTarget).data('user-id')); });

        this._soundHookId = Hooks.on('updatePlaylistSound', (soundDoc) => {
            this._refreshSoundItemState(soundDoc);
        });
    }

    _setupCharacterListeners() {
        const ns = VisualNovelScene.NS;
        const sel = VisualNovelScene.SEL.CHARACTER;

        $(document).on(`click${ns}`, sel, (e) => {
            e.preventDefault(); e.stopPropagation();
            const tokenId = $(e.currentTarget).data('token-id');
            if (e.ctrlKey) this.setExclusiveSpeaker(tokenId, true);
            else this.setActiveSpeaker(tokenId, true);
        });
        $(document).on(`mousedown${ns}`, sel, (e) => {
            if (!game.user.isGM || e.button !== 1) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const tokenId = $(e.currentTarget).data('token-id');
            const newFlip = !this.state.flipped[tokenId];
            this.applyFlip(tokenId, newFlip);
            this.emitSocketEvent('flipPortrait', { tokenId, flip: newFlip });
        });
        $(document).on(`contextmenu${ns}`, sel, (e) => {
            if (!game.user.isGM) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const tokenId = $(e.currentTarget).data('token-id');
            this.applyHidden(tokenId, !this.state.hidden[tokenId], true);
        });
        $(document).on(`wheel${ns}`, sel, (e) => {
            if (!game.user.isGM || !e.altKey) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const tokenId = $(e.currentTarget).data('token-id');
            const current = this.state.portraitScales[tokenId] ?? 1;
            const delta = e.originalEvent.deltaY > 0 ? -0.05 : 0.05;
            this.setCharacterScale(tokenId, current + delta);
        });
    }
}

window.VisualNovelScene = VisualNovelScene;
window.VNSceneState = VNSceneState;
window.QueueBridge = QueueBridge;
window.VNPresets = VNPresets;

export { VisualNovelScene };

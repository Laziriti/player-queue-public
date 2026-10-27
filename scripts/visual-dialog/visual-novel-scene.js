// ============================================================
// visual-novel-scene.js — v4.0 (refactored core)
// ============================================================

import { VNSceneState, VNPresets, VNFolders, PARTICLE_LAYERS, PARTICLE_LAYER_ICONS, resolveParticlesLayer } from './vn-state.js';
import { VNAtmosphere } from './visual-effects/atmosphere/index.js';
import { QueueBridge } from './vn-queue-bridge.js';
import { VNTransitions } from './visual-effects/vn-transitions.js';
import { VNCharFx } from './visual-effects/character-fx/vn-character-fx.js';
import { VNBackgroundManager } from './dialog/vn-background-manager.js';
import { VNEffectsManager } from './dialog/vn-effects-manager.js';
import { VNMusicManager } from './dialog/vn-music-manager.js';
import { VNPresetsManager } from './dialog/vn-presets-manager.js';
import { VNAdventureIOManager } from './dialog/vn-adventure-io-manager.js';
import { VNDialogBuilder } from './dialog/vn-dialog-builder.js';
import { VNSocketHandler } from './vn-socket-handler.js';
import { stripDupSuffix, parseActorId, parsePlaylistUuid, escapeHtml } from './vn-id-utils.js';
import { VNChatPanel } from './vn-chat-panel.js';
import { VNSceneHTML } from './vn-scene-html.js';
import { VNSequence } from './vn-sequence.js';
import { VNPreloader } from './vn-preload.js';

const VN_DEBUG = false;
const vnLog = VN_DEBUG ? (...args) => console.log('[VN]', ...args) : () => {};

const UNKNOWN_NAME = 'vn.actor.unknown';

class VisualNovelScene {
    static ID = 'player-queue';
    static NS = '.vnScene';
    static MINIMIZED_POS_KEY = 'player-queue-vn-minimized-pos';

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
        QUEUE_HAND: '.vn-queue-hand',
    };

    constructor() {
        this.state = new VNSceneState();
        this.favoriteActors = [];
        this._$overlay = null;
        this._creating = false;
        this._atmosphere = new VNAtmosphere();
        this._bgManager = new VNBackgroundManager(VisualNovelScene.ID);
        this._effectsManager = new VNEffectsManager();
        this._musicManager = new VNMusicManager();
        this._presetsManager = new VNPresetsManager();
        this._ioManager = new VNAdventureIOManager();
        this._dialogBuilder = new VNDialogBuilder(this);
        this._socketHandler = null; // initialized after socket is ready
        this._sceneMusicUuid = null;
        this._pausedSounds = null; // null = scene music never started; array = it has
        this._gmOnly = false;      // true = scene hidden from players until "broadcast"
        this._closing = false;

        this._chatPanel = new VNChatPanel(() => this.$overlay);
        this._sequence = new VNSequence(this);
        this._html = new VNSceneHTML(this, VisualNovelScene.ROW_CONFIG);
        this._persistStateDebounced = VisualNovelScene.debounce(() => this._persistState(), 400);
    }

    // ══════════════════════════════════════════════════════════
    // Init
    // ══════════════════════════════════════════════════════════

    async initialize() {
        vnLog('initialized');
        this._registerSettings();
        VNPresets.register();
        VNFolders.register();
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

    /** `keepAtmosphere`: the scene is closing and its effects must stay until the overlay has faded out with them. */
    _cleanupListeners({ keepAtmosphere = false } = {}) {
        $(document).off(VisualNovelScene.NS);
        if (this._wheelListener) {
            document.removeEventListener('wheel', this._wheelListener);
            this._wheelListener = null;
        }
        this._removeParticleOutsideListener();
        this._removeVisualOutsideListener();
        this._removeSoundsOutsideListener();
        if (this._soundHookId != null) {
            Hooks.off('updatePlaylistSound', this._soundHookId);
            this._soundHookId = null;
        }
        if (!keepAtmosphere) this._atmosphere.destroy();
    }

    _removeParticleOutsideListener() {
        if (this._particleOutsideListener) {
            document.removeEventListener('click', this._particleOutsideListener, true);
            this._particleOutsideListener = null;
        }
    }

    _removeVisualOutsideListener() {
        if (this._visualOutsideListener) {
            document.removeEventListener('click', this._visualOutsideListener, true);
            this._visualOutsideListener = null;
        }
    }

    _removeSoundsOutsideListener() {
        if (this._soundsOutsideListener) {
            document.removeEventListener('click', this._soundsOutsideListener, true);
            this._soundsOutsideListener = null;
        }
    }

    _setupPickerDismiss(wrap, picker, listenerKey, onOpen = null) {
        if (!picker.hidden) { picker.hidden = true; return; }
        picker.hidden = false;
        onOpen?.();
        if (this[listenerKey]) {
            document.removeEventListener('click', this[listenerKey], true);
            this[listenerKey] = null;
        }
        this[listenerKey] = (ev) => {
            if (!wrap.contains(ev.target)) {
                picker.hidden = true;
                document.removeEventListener('click', this[listenerKey], true);
                this[listenerKey] = null;
            }
        };
        setTimeout(() => document.addEventListener('click', this[listenerKey], true), 0);
    }

    // ══════════════════════════════════════════════════════════
    // Socket (delegated)
    // ══════════════════════════════════════════════════════════

    emitSocketEvent(action, payload) {
        this._socketHandler?.emit(action, payload);
    }

    handleSocketEvent(data, senderId) {
        this._socketHandler?.handle(data, senderId);
    }

    setParallaxOptions(opts) {
        this._atmosphere._parallax.setOptions(opts);
    }

    setCameraEnabled(enabled) {
        this._atmosphere?._camera?.setEnabled(enabled && !this.liteMode);
        this._reapplyCameraDof();
    }

    _reapplyCameraDof() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const hasSpeaker = Object.values(this.state.speakers).some(Boolean);
        const cameraOn = game.settings.get(VisualNovelScene.ID, 'cameraEnabled');
        const dofOn = game.settings.get(VisualNovelScene.ID, 'cameraDoF');
        overlay.classList.toggle('vn-camera-dof', hasSpeaker && cameraOn && dofOn && !this.liteMode);
    }

    /** Client setting `liteMode`: this client draws no particles / visual effects / parallax / camera and drops heavy CSS filters. */
    get liteMode() {
        try { return !!game.settings.get(VisualNovelScene.ID, 'liteMode'); }
        catch { return false; }
    }

    /** Applies a changed `liteMode` to a scene that is already open on this client. */
    applyLiteMode() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        overlay.classList.toggle('vn-lite', this.liteMode);
        this._reinitAtmosphere();
        this._reapplyCameraDof();
        // destroy() resets the camera target; point it at the current speaker again
        this._atmosphere.onSpeakerChange(overlay.querySelector('.vn-character.active'));
    }

    /**
     * Applies changed effect filters (client settings `fxDisabled` / `particleIntensityMax`, edited in the "effectFilters"
     * settings menu) to a scene that is already open on this client: background and particle effects are rebuilt,
     * portrait effects are re-evaluated.
     */
    applyEffectFilters() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        this._reinitAtmosphere();
        this._applyAllCharFx();
        this._reapplyCameraDof();
        this._atmosphere.onSpeakerChange(overlay.querySelector('.vn-character.active'));
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
                    const name = portraitNames[id] || portraitNames[baseId] || game.i18n.localize(UNKNOWN_NAME);
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
                const name = portraitNames[id] || portraitNames[baseId] || game.i18n.localize(UNKNOWN_NAME);
                return { id, actor: { img, id: baseId, name }, name, document: { texture: { src: img } } };
            }
            return null;
        }).filter(Boolean);
    }

    // ══════════════════════════════════════════════════════════
    // State Persistence
    // ══════════════════════════════════════════════════════════

    async _persistState() {
        if (!game.user.isGM) return;
        try {
            await game.settings.set(VisualNovelScene.ID, 'activeScene',
                this.state.isActive ? { ...this.state.toPayload(), sequence: this._sequence.snapshot() } : {});
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
            if (s.sequence && game.user.isGM) this._sequence.restore(s.sequence);
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
            // A character that is no longer in the state is about to leave: keep its current flip/scale until it is
            // gone. The state is replaced before the exit animation runs, so applying it here would make the leaving
            // portrait un-flip and shrink first (players hit this on every step switch via setPortraitScale).
            if (!this.state.hasToken(tid)) return;
            const img = charEl.querySelector('.vn-character-img');
            const flip = this.state.flipped[tid] ? '-1' : '1';
            if (img) img.style.setProperty('--flip-x', flip);
            charEl.style.setProperty('--flip-x', flip);
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
        this._persistStateDebounced();
    }

    // Normalize portraitScales: for legacy presets where scales are stored under canvas token IDs
    // instead of actor-based IDs, add actor-based aliases so character() can find the scale.
    // Handles single-actor case only — multi-instance (same actor N times) requires re-saving the preset.
    static _normalizePortraitScales(scales) {
        if (!scales) return {};
        const result = { ...scales };
        if (!canvas?.tokens) return result;
        for (const [key, val] of Object.entries(scales)) {
            const base = stripDupSuffix(key);
            if (!parseActorId(base)) {
                const actorId = canvas.tokens.get(base)?.actor?.id;
                if (actorId && result[`actor-${actorId}`] === undefined) {
                    result[`actor-${actorId}`] = val;
                }
            }
        }
        return result;
    }

    static _normalizeFlipped(flipped) {
        if (!flipped) return {};
        const result = { ...flipped };
        if (!canvas?.tokens) return result;
        for (const [key, val] of Object.entries(flipped)) {
            const base = stripDupSuffix(key);
            if (!parseActorId(base)) {
                const actorId = canvas.tokens.get(base)?.actor?.id;
                if (actorId && result[`actor-${actorId}`] === undefined) {
                    result[`actor-${actorId}`] = val;
                }
            }
        }
        return result;
    }

    applyFlip(tokenId, flip) {
        this.state.flipped[tokenId] = flip;
        this._applyAllPortraitTransforms();
    }

    _applyAllCharFx() {
        document.querySelectorAll(VisualNovelScene.SEL.CHARACTER).forEach(charEl => {
            const tid = charEl.dataset.tokenId;
            if (this.state.hasToken(tid)) VNCharFx.apply(charEl, this.state.charFx[tid]);
        });
    }

    static _applyVisibilityToElement(charEl, visibility) {
        const v = visibility ?? 'visible';
        charEl.classList.toggle('vn-character-hidden',      v === 'hidden');
        charEl.classList.toggle('vn-character-name-hidden', v === 'name-hidden');
        const nm = charEl.querySelector('.vn-nameplate-text');
        if (nm) nm.textContent = (v !== 'visible') ? '???' : (charEl.dataset.name || '');
    }

    applyVisibility(tokenId, visibility, emit = true) {
        if (emit && !game.user.isGM) return;
        if (visibility && visibility !== 'visible') this.state.visibility[tokenId] = visibility;
        else delete this.state.visibility[tokenId];
        const charEl = document.querySelector(`.vn-character[data-token-id="${tokenId}"]`);
        if (charEl) VisualNovelScene._applyVisibilityToElement(charEl, visibility ?? 'visible');
        if (emit) { this.emitSocketEvent('setVisibility', { tokenId, visibility: visibility ?? 'visible' }); this._persistState(); }
    }

    _applyAllVisibilityStates() {
        document.querySelectorAll('.vn-character').forEach(charEl =>
            VisualNovelScene._applyVisibilityToElement(charEl, this.state.visibility[charEl.dataset.tokenId] ?? 'visible'));
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

    setParticleEffect(particle, emit = true) {
        if (emit && !game.user.isGM) return;
        const [particleType] = particle.split(':');
        if (!VNAtmosphere.PARTICLE_TYPES.includes(particleType)) return;
        this.state.particleEffect = particle;
        this._reinitAtmosphere();
        if (emit) { this.emitSocketEvent('setParticleEffect', { particle }); this._persistState(); }
    }

    setVisualEffect(visual, emit = true) {
        if (emit && !game.user.isGM) return;
        const [visualType] = String(visual).split(':');
        if (!VNAtmosphere.VISUAL_TYPES.includes(visualType)) return;
        this.state.visualEffect = visual;
        this._reinitAtmosphere();
        if (emit) { this.emitSocketEvent('setVisualEffect', { visual }); this._persistState(); }
    }

    setParticlesLayer(layer, emit = true) {
        if (emit && !game.user.isGM) return;
        if (!PARTICLE_LAYERS.includes(layer)) return;
        const prev = this.state.particlesLayer;
        this.state.particlesLayer = layer;
        // Вход/выход из 'mix' требует перераскладки частиц по контейнерам; back<->front — только CSS-класс
        if ((prev === 'mix') !== (layer === 'mix')) this._reinitAtmosphere();
        else this._applyParticlesLayerUI();
        if (emit) { this.emitSocketEvent('setParticlesLayer', { layer }); this._persistState(); }
    }

    cycleParticlesLayer() {
        const i = PARTICLE_LAYERS.indexOf(this.state.particlesLayer);
        this.setParticlesLayer(PARTICLE_LAYERS[(i + 1) % PARTICLE_LAYERS.length], true);
    }

    _applyParticlesLayerUI() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const layer = this.state.particlesLayer;
        overlay.classList.toggle('vn-particles-fg', layer === 'front');
        const btn = overlay.querySelector('.vn-particles-fg-btn');
        if (btn) {
            btn.classList.toggle('active', layer !== 'back');
            btn.title = game.i18n.localize(`vn.toolbar.particlesLayer.${layer}`);
            const icon = btn.querySelector('i');
            if (icon) icon.className = `fas ${PARTICLE_LAYER_ICONS[layer]}`;
        }
    }

    _reinitAtmosphere() {
        const overlayEl = this.$overlay?.[0];
        if (!overlayEl) return;
        this._atmosphere.destroy();
        this._atmosphere.init(overlayEl, this.state.particleEffect, this.state.visualEffect, this.state.particleIntensity, this.state.particlesLayer);
        this._updateAtmosphereButtons();
        this._applyParticlesLayerUI();
    }

    _updateAtmosphereButtons() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const [particleType, particleVariant = 'all'] = (this.state.particleEffect || 'particles').split(':');
        const [visual, visualVariant = 'all'] = (this.state.visualEffect || 'none').split(':');

        const particleBtn = overlay.querySelector('.vn-particle-cycle-btn');
        if (particleBtn) {
            particleBtn.querySelector('i').className = `fas ${VNAtmosphere.PARTICLE_ICONS[particleType]}`;
            particleBtn.title = game.i18n.format('vn.atmosphere.particleButtonTitle', { effect: game.i18n.localize(VNAtmosphere.PARTICLE_LABELS[particleType]) });
        }
        overlay.querySelectorAll('.vn-atmo-item[data-particle]').forEach(item =>
            item.classList.toggle('active', item.dataset.particle === particleType));
        this._syncVariantUI(overlay, 'particle', particleType, particleVariant);

        const visualBtn = overlay.querySelector('.vn-visual-cycle-btn');
        if (visualBtn) {
            visualBtn.querySelector('i').className = `fas ${VNAtmosphere.VISUAL_ICONS[visual]}`;
            visualBtn.title = game.i18n.format('vn.atmosphere.visualButtonTitle', { effect: game.i18n.localize(VNAtmosphere.VISUAL_LABELS[visual]) });
        }
        overlay.querySelectorAll('.vn-atmo-item[data-visual]').forEach(item =>
            item.classList.toggle('active', item.dataset.visual === visual));
        this._syncVariantUI(overlay, 'visual', visual, visualVariant);
    }

    /**
     * Синхронизирует раскрывающиеся группы подвариантов одной оси (напр. чёрные/белые перья, нуар с жалюзи),
     * выросшие прямо из своего тайла, с текущим типом+вариантом: сворачивает все, подсвечивает активный вариант
     * и обновляет бейдж варианта на кнопке тайла.
     */
    _syncVariantUI(overlay, axis, type, currentVariant = 'all') {
        overlay.querySelectorAll(`.vn-atmo-item-group[data-variant-axis="${axis}"]`).forEach(group => {
            const variant = group.dataset.variantBase === type ? currentVariant : 'all';
            this._closeVariantGroup(group);
            group.querySelectorAll('.vn-variant-option').forEach(o => o.classList.toggle('active', o.dataset.variant === variant));
            this._setVariantTag(group, variant);
        });
    }

    _setVariantTag(group, variant) {
        const btn = group.querySelector('.vn-atmo-item');
        if (!btn) return;
        let tag = btn.querySelector('.vn-atmo-item-variant-tag');
        if (variant === 'all') { tag?.remove(); return; }
        const variants = group.dataset.variantAxis === 'visual' ? VNAtmosphere.VISUAL_VARIANTS : VNAtmosphere.PARTICLE_VARIANTS;
        const v = variants[group.dataset.variantBase]?.find(v => v.id === variant);
        if (!v) { tag?.remove(); return; }
        if (!tag) {
            tag = document.createElement('small');
            tag.className = 'vn-atmo-item-variant-tag';
            const caret = btn.querySelector('.vn-atmo-item-caret');
            if (caret) caret.insertAdjacentElement('beforebegin', tag);
            else btn.appendChild(tag);
        }
        tag.textContent = game.i18n.localize(v.label);
    }

    _openVariantGroup(group) {
        group.classList.add('vn-variant-open');
        const list = group.querySelector('.vn-variant-list');
        if (list) list.hidden = false;
    }

    _closeVariantGroup(group) {
        group.classList.remove('vn-variant-open');
        const list = group.querySelector('.vn-variant-list');
        if (list) list.hidden = true;
    }

    _toggleVariantGroup(group) {
        if (group.classList.contains('vn-variant-open')) this._closeVariantGroup(group);
        else this._openVariantGroup(group);
    }

    // ══════════════════════════════════════════════════════════
    // Sound Cues
    // ══════════════════════════════════════════════════════════

    _buildSoundItemHtml(cue) {
        const playing = parsePlaylistUuid(cue.uuid)?.sound?.playing ?? false;
        const icon = playing ? 'fa-stop-circle' : 'fa-play-circle';
        const cls = playing ? ' playing' : '';
        return `<button type="button" class="vn-sound-item${cls}" data-uuid="${escapeHtml(cue.uuid)}" title="${escapeHtml(cue.label || '')}">`
            + `<i class="fas ${icon}"></i><span>${escapeHtml(cue.label || game.i18n.localize('vn.sounds.untitled'))}</span></button>`;
    }

    _generateSoundsWrapHTML() {
        const cues = this.state.soundCues || [];
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
        if (!sound) { ui.notifications.warn(game.i18n.localize('vn.sounds.trackNotFound')); return; }
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
        this._sequence.preload();
        if (this._sceneMusicUuid) this.startSceneMusic(this._sceneMusicUuid);
        this._updateGmOnlyUI();
    }

    /** Socket `preload`: warm the browser cache with the images of upcoming sequence steps. */
    preloadImages(urls) {
        if (!Array.isArray(urls)) return;
        VNPreloader.enqueue(urls.filter(url => typeof url === 'string').slice(0, 300));
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
        if (value) this._applyMinimizedPosition();
        else this._clearMinimizedPosition();
        if (emit && forAll && game.user.isGM) this.emitSocketEvent(value ? 'minimize' : 'maximize', {});
        QueueBridge.refreshFloating();
    }

    _setMinimizedSelf(value) {
        if (!game.user.isGM) return;
        this.setMinimized(value, false, false);
    }

    // ── Minimized pill: draggable position, remembered per-client ──

    _loadMinimizedPosition() {
        try {
            const saved = localStorage.getItem(VisualNovelScene.MINIMIZED_POS_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    }

    _saveMinimizedPosition(x, y) {
        try {
            localStorage.setItem(VisualNovelScene.MINIMIZED_POS_KEY, JSON.stringify({ x, y }));
        } catch {}
    }

    _applyMinimizedPosition() {
        const saved = this._loadMinimizedPosition();
        const el = this.$overlay?.[0];
        if (!saved || !el) return;
        const w = el.offsetWidth, h = el.offsetHeight;
        el.style.right = 'auto'; el.style.bottom = 'auto';
        el.style.left = Math.min(Math.max(0, saved.x), window.innerWidth  - w) + 'px';
        el.style.top  = Math.min(Math.max(0, saved.y), window.innerHeight - h) + 'px';
    }

    _clearMinimizedPosition() {
        const el = this.$overlay?.[0];
        if (!el) return;
        el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
    }

    _setupMinimizedDragListener(ns) {
        $(document).on(`mousedown${ns}`, '.vn-maximized-bar', (e) => {
            if (!this.$overlay?.hasClass('minimized') || e.target.closest('button')) return;
            e.preventDefault();
            const el = this.$overlay[0];
            const rect = el.getBoundingClientRect();
            const startX = e.clientX, startY = e.clientY;
            const startLeft = rect.left, startTop = rect.top;
            Object.assign(el.style, { left: `${startLeft}px`, top: `${startTop}px`, right: 'auto', bottom: 'auto' });

            const onMove = (ev) => {
                const w = el.offsetWidth, h = el.offsetHeight;
                el.style.left = Math.min(Math.max(0, startLeft + ev.clientX - startX), window.innerWidth  - w) + 'px';
                el.style.top  = Math.min(Math.max(0, startTop  + ev.clientY - startY), window.innerHeight - h) + 'px';
            };
            const onUp = () => {
                const r = el.getBoundingClientRect();
                this._saveMinimizedPosition(r.left, r.top);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
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
        if (this._creating) return false;
        this._creating = true;
        this._closing = false;
        try { this._doCreateScene(payload, emit); }
        finally { this._creating = false; }
        return true;
    }

    /**
     * Launches any preset: a regular one as a single scene; a sequence from `stepIndex` with the step controls.
     * Without an explicit `stepIndex` the GM is asked which step to start from (a one-step sequence just starts).
     * Resolves to true if a scene was started, false if the GM cancelled or the preset is empty.
     */
    async launchPreset(preset, { gmOnly = false, stepIndex = null } = {}) {
        if (!VNPresets.isSequence(preset)) {
            this.createScene(gmOnly ? { ...preset, gmOnly } : preset);
            return true;
        }
        const steps = preset.steps ?? [];
        if (!steps.length) { ui.notifications.warn(game.i18n.localize('vn.sequence.emptyWarn')); return false; }

        let index = stepIndex === null || stepIndex === undefined ? (steps.length > 1 ? await VNSequence.promptStart(preset) : 0) : Number(stepIndex);
        if (index === null) return false;
        index = Math.min(Math.max(Math.trunc(index) || 0, 0), steps.length - 1);

        const step = VNSequence.resolveStep(steps, index);
        const musicUuid = step.musicUuid || VNSequence.inheritedMusic(steps, index);
        if (!this.createScene({ ...step, musicUuid, gmOnly })) return false;
        this._sequence.start(preset, index);
        return true;
    }

    _doCreateScene(payload, emit) {
        vnLog('createScene, emit:', emit);
        this._sequence.stop();
        this._atmosphere.destroy();
        this.state.reset();
        this.state.fromPayload({
            leftIds: payload.leftIds,
            centerIds: payload.centerIds,
            rightIds: payload.rightIds,
            presetActors: payload.presetActors || [],
            background: payload.background,
            backgroundOverlay: payload.backgroundOverlay ?? true,
            portraitScale: payload.portraitScale ?? VisualNovelScene.DEFAULTS.PORTRAIT_SCALE,
            particleEffect: payload.particleEffect ?? null,
            visualEffect: payload.visualEffect ?? null,
            atmosphereEffect: payload.atmosphereEffect ?? null,
            particlesLayer: resolveParticlesLayer(payload),
            particleIntensity: payload.particleIntensity ?? 1,
            speakers: payload.speakers || {},
            flipped: payload.flipped || {},
            visibility: payload.visibility || null,
            hidden: payload.hidden || null,
            charFx: payload.charFx || {},
            musicUuid: payload.musicUuid ?? null,
            soundCues: payload.soundCues || [],
            caption: payload.caption || '',
            portraitImages: payload.portraitImages || {},
            portraitNames: payload.portraitNames || {},
            portraitScales: payload.portraitScales || {},
        });

        // Normalize portrait scales and flip state: add actor-based aliases for any canvas token ID keys
        this.state.portraitScales = VisualNovelScene._normalizePortraitScales(this.state.portraitScales);
        this.state.flipped = VisualNovelScene._normalizeFlipped(this.state.flipped);

        this._gmOnly = !!(payload.gmOnly) && emit && game.user.isGM;

        if (emit && !this._gmOnly) this.emitSocketEvent('open', this.state.toPayload());

        const musicUuid = this.state.musicUuid;
        if (emit && game.user.isGM) {
            const prevMusicUuid = this._sceneMusicUuid;
            if (prevMusicUuid !== musicUuid) this._handleMusicTransition(musicUuid);
        } else {
            this._sceneMusicUuid = musicUuid;
        }

        this._closeChatPanel();

        $(VisualNovelScene.SEL.OVERLAY).remove();
        this._invalidateOverlayCache();
        this._cleanupListeners();

        const tokens = Object.fromEntries(
            VNSceneState.POSITIONS.map(pos => [pos, VisualNovelScene.resolveTokens(
                this.state[`${pos}Ids`], this.state.portraitImages, this.state.portraitNames)])
        );

        $('body').append(this._html.scene(tokens));
        this._invalidateOverlayCache();
        this._applyAllPortraitTransforms();
        QueueBridge.refreshFloating();

        document.querySelectorAll('#vn-scene-overlay .vn-character .vn-character-img').forEach(img => img.style.opacity = '0');
        this._bgManager.applyBackground(this.$overlay, this.state.background, this.state.backgroundOverlay);

        const speakersSnapshot = { ...this.state.speakers };
        setTimeout(() => {
            this.activateSceneListeners();
            this._applyAllPortraitTransforms();
            this._atmosphere.init(this.$overlay[0], this.state.particleEffect, this.state.visualEffect, this.state.particleIntensity, this.state.particlesLayer);
            this._updateAtmosphereButtons();
            this._applyParticlesLayerUI();
            this._animateInitialCharacters();
            this._restoreSpeakers(speakersSnapshot);
            this._applyAllCharFx();
            this._applyCaption();
            if (game.user.isGM) this._updateGmOnlyUI();
        }, VisualNovelScene.DEFAULTS.ANIMATION_DELAY);

        this._persistState();
    }

    updateSceneLayout(payload, emit = true) {
        if (!this.state.isActive) return;

        // A payload that carries speakers (a sequence step) replaces them; otherwise the current ones are kept
        const speakersAfter = payload.speakers
            ? Object.fromEntries(VNSceneState.POSITIONS.map(pos => [pos, payload.speakers[pos] ?? null]))
            : { ...this.state.speakers };
        for (const pos of VNSceneState.POSITIONS) this.state.speakers[pos] = speakersAfter[pos];
        if (typeof payload.caption === 'string') this.state.caption = payload.caption;
        const prevBackground = this.state.background;
        const prevCast = VNSceneState.POSITIONS.map(pos => JSON.stringify(this.state[`${pos}Ids`]));

        this.state.leftIds = payload.leftIds ? [...payload.leftIds] : [];
        this.state.centerIds = payload.centerIds ? [...payload.centerIds] : [];
        this.state.rightIds = payload.rightIds ? [...payload.rightIds] : [];
        if (payload.presetActors !== undefined) this.state.presetActors = [...(payload.presetActors || [])];
        if (payload.background != null) this.state.background = payload.background;
        if (payload.backgroundOverlay != null) this.state.backgroundOverlay = payload.backgroundOverlay;
        if (payload.flipped !== undefined && payload.flipped !== null) this.state.flipped = VisualNovelScene._normalizeFlipped({ ...payload.flipped });
        if (payload.visibility !== undefined && payload.visibility !== null) this.state.visibility = { ...payload.visibility };
        if (payload.charFx !== undefined && payload.charFx !== null) this.state.charFx = VNCharFx.normalize(payload.charFx);
        if (payload.portraitImages !== undefined && payload.portraitImages !== null) this.state.portraitImages = { ...payload.portraitImages };
        if (payload.portraitNames !== undefined && payload.portraitNames !== null) this.state.portraitNames = { ...payload.portraitNames };
        if (payload.portraitScales !== undefined && payload.portraitScales !== null) {
            this.state.portraitScales = VisualNovelScene._normalizePortraitScales({ ...payload.portraitScales });
        }
        const intensityChanged = payload.particleIntensity != null && this.state.particleIntensity !== payload.particleIntensity;
        if (intensityChanged) {
            this.state.particleIntensity = Math.min(Math.max(Math.round(payload.particleIntensity), 1), 20);
        }
        const particleChanged = payload.particleEffect != null && this.state.particleEffect !== payload.particleEffect;
        const visualChanged = payload.visualEffect != null && this.state.visualEffect !== payload.visualEffect;
        if (particleChanged) this.state.particleEffect = payload.particleEffect;
        if (visualChanged) this.state.visualEffect = payload.visualEffect;
        const newLayer = (payload.particlesLayer != null || payload.particlesForeground != null)
            ? resolveParticlesLayer(payload) : this.state.particlesLayer;
        const layerChanged = newLayer !== this.state.particlesLayer;
        const castChanged = VNSceneState.POSITIONS.some((pos, i) => JSON.stringify(this.state[`${pos}Ids`]) !== prevCast[i]);
        // `transition` is a one-shot instruction (a sequence step can pick its type/speed), not scene state: it only
        // rides along on the socket. Without it every scene change uses the default dissolve at normal speed.
        const transition = payload.transition ?? null;
        const timing = VNTransitions.timing(transition);

        // Each axis is swapped on its own: changing only the visual effect must not restart the falling particles
        // (nor the parallax drift and camera), and the other way round.
        const applyAtmosphere = () => {
            if (particleChanged || intensityChanged) {
                this.state.particlesLayer = newLayer;
                this._atmosphere.setParticles(this.state.particleEffect, this.state.particleIntensity, newLayer);
            } else if (layerChanged) {
                this.setParticlesLayer(newLayer, false);
            }
            if (visualChanged) this._atmosphere.setVisual(this.state.visualEffect);
            if (particleChanged || visualChanged || intensityChanged) {
                this._updateAtmosphereButtons();
                this._applyParticlesLayerUI();
            }
        };

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

        if (emit && !this._gmOnly) this.emitSocketEvent('updateScene', { ...this.state.toPayload(), transition });
        const queueData = QueueBridge.getQueue();

        requestAnimationFrame(async () => {
            const bgChanged = payload.background != null && payload.background !== prevBackground && prevBackground;
            const settle = () => {
                this._applyAllPortraitTransforms();
                this._applyAllVisibilityStates();
                this._applyAllCharFx();
                this._restoreSpeakers(speakersAfter);
            };
            const updateSides = (t = timing) => Promise.all(VNSceneState.POSITIONS.map(side =>
                this._updateSide(this.state[`${side}Ids`], `.vn-${side}-side`, side, queueData, t)));

            // Background, outgoing and incoming characters all run at once instead of one after another
            this._beginQuickTransition(timing);
            // Nothing starts before the new picture is decoded, so effect, background and characters stay in step
            if (bgChanged) await VNPreloader.ready(this.state.background);

            // Curtain transitions (flash / black / sweep) cover the whole stage when the cast changes along with the
            // background; under the curtain everything swaps instantly. A background-only change keeps the layer-only version.
            if (timing.cover && bgChanged && castChanged) {
                await VNTransitions.cover(this.$overlay[0], timing, async () => {
                    applyAtmosphere();
                    this._bgManager.applyBackgroundInstant(this.$overlay, this.state.background, this.state.backgroundOverlay);
                    this._applyCaption();
                    await updateSides({ ...timing, exit: 0, enter: 0, stagger: 0 });
                    settle();
                });
                return;
            }

            // The whole "look" — visual effect, effect layers, background dimming — switches in the very frame the new
            // picture starts to fade in, and within ~0.2 s (--vn-tr-fx), far ahead of the dissolve.
            // So the new picture is never shown bare and then darkened afterwards.
            applyAtmosphere();
            // Characters who stay on stage change their portrait effect together with the step, not after the dissolve
            this._applyAllCharFx();
            this._bgManager.fadeOverlay(this.$overlay, this.state.backgroundOverlay, this.state.background);

            const bgDone = bgChanged
                ? this._bgManager.switchWithTransition(this.$overlay, this.state.background, this.state.backgroundOverlay, this._atmosphere, timing)
                : Promise.resolve(this._bgManager.applyBackground(this.$overlay, this.state.background, this.state.backgroundOverlay));
            this._applyCaption();
            await updateSides();
            settle();
            await bgDone;
        });

        this._persistState();
    }

    /** Shortens the speaker-highlight / glow / nameplate / effect-layer CSS transitions while a scene change plays out. */
    _beginQuickTransition(timing) {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        overlay.style.setProperty('--vn-tr-live', `${timing.exit}ms`);
        overlay.style.setProperty('--vn-tr-fx', `${Math.min(220, Math.max(100, Math.round(timing.bg * 0.25)))}ms`);
        overlay.classList.add('vn-tr-live');
        clearTimeout(this._quickTransitionTimer);
        this._quickTransitionTimer = setTimeout(
            () => overlay.classList.remove('vn-tr-live'),
            timing.bg + timing.exit + timing.enter + 600
        );
    }

    async _updateSide(ids, sideSelector, position, queueData, timing) {
        const tokens = VisualNovelScene.resolveTokens(ids, this.state.portraitImages, this.state.portraitNames);
        const container = document.querySelector(`.vn-side${sideSelector}`);
        if (!container) return;

        const { useMultiRow } = this._html.computeRowLayout(ids.length, position);
        container.classList.toggle('vn-multi-row', useMultiRow);

        const oldChars = container.querySelectorAll('.vn-character');
        const oldIds = Array.from(oldChars).map(el => el.dataset.tokenId);
        const newIds = tokens.map(t => t.id || `actor-${t.actor.id}`);

        if (oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i])) return;

        const oldIdSet = new Set(oldIds);
        const newIdSet = new Set(newIds);
        const removingEls = Array.from(oldChars).filter(el => !newIdSet.has(el.dataset.tokenId));
        const addingIds = new Set(newIds.filter(id => !oldIdSet.has(id)));

        if (removingEls.length) await Promise.all(removingEls.map(el => VNTransitions.exitCharacter(el, timing.exit)));

        if (tokens.length) {
            // Characters that stay are moved into the new markup instead of being re-created: a rebuilt portrait
            // flickers while its image decodes and restarts its highlight transition (a speaker who stayed would
            // dim and then brighten again). Read after the exit await: another update may have run meanwhile.
            const staying = new Map(Array.from(container.querySelectorAll('.vn-character'))
                .filter(el => newIdSet.has(el.dataset.tokenId))
                .map(el => [el.dataset.tokenId, el]));
            const fresh = document.createElement('div');
            fresh.innerHTML = this._html.sideCharacters(tokens, position, queueData);
            for (const newEl of fresh.querySelectorAll('.vn-character')) {
                const kept = staying.get(newEl.dataset.tokenId);
                if (!kept) continue;
                for (const rowClass of ['vn-row-front', 'vn-row-back']) kept.classList.toggle(rowClass, newEl.classList.contains(rowClass));
                newEl.replaceWith(kept);
            }
            container.replaceChildren(...fresh.childNodes);
            container.classList.remove('empty');

            const activeSpeaker = this.state.speakers[position];
            container.querySelectorAll('.vn-character').forEach(charEl => {
                const tid = charEl.dataset.tokenId;
                const img = charEl.querySelector('.vn-character-img');
                if (img) img.style.setProperty('--flip-x', this.state.flipped[tid] ? '-1' : '1');
                if (addingIds.has(tid) && img) img.style.opacity = '0';
            });
            // Force reflow so the browser registers initial CSS state before .active
            // is applied — without this, transitions don't play on freshly inserted elements
            container.offsetHeight;
            if (activeSpeaker) {
                container.querySelector(`.vn-character[data-token-id="${activeSpeaker}"]`)
                    ?.classList.add('active');
            }

            let idx = 0;
            container.querySelectorAll('.vn-character').forEach(charEl => {
                if (addingIds.has(charEl.dataset.tokenId)) {
                    setTimeout(() => VNTransitions.enterCharacter(charEl, 'auto', timing.enter), idx++ * timing.stagger);
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
        // Nobody speaks any more (e.g. a sequence step without a speaker): release the camera focus
        if (!Object.values(this.state.speakers).some(Boolean)) {
            this._atmosphere?.onSpeakerChange(null);
            this._reapplyCameraDof();
        }
    }

    _applyCaption() {
        const box = this.$overlay?.[0]?.querySelector('.vn-caption');
        const textEl = box?.querySelector('.vn-caption-text');
        if (!box || !textEl) return;
        const text = this.state.caption || '';
        if (!text) { box.hidden = true; textEl.textContent = ''; return; }
        if (!box.hidden && textEl.textContent === text) return;
        textEl.textContent = text;
        box.hidden = false;
        box.classList.remove('vn-caption--in');
        void box.offsetWidth; // restart the entrance animation
        box.classList.add('vn-caption--in');
    }

    closeScene(emit = true) {
        if (emit && !game.user.isGM) return;
        if (this._closing) return;
        this._closing = true;
        this._handPickerOpen = false;

        if (emit) this.stopSceneMusic(true);
        this._sequence.stop();
        this._closeChatPanel();

        const $ov = this.$overlay;
        // Particles, the visual effect, parallax and camera are part of the picture: they go away together with the
        // background (the overlay fade), not at the first frame of closing while the background is still on screen
        this._cleanupListeners({ keepAtmosphere: !!$ov.length });

        if ($ov.length) {
            const overlayEl = $ov[0];
            const characters = overlayEl.querySelectorAll('.vn-character');
            characters.forEach((charEl, i) => setTimeout(() => VNTransitions.exitCharacter(charEl), i * 50));
            const exitDelay = Math.min(characters.length * 50 + 600, 900);
            setTimeout(() => {
                $ov.addClass('vn-closing');
                setTimeout(() => {
                    $ov.remove();
                    this._atmosphere.destroyFor(overlayEl);
                    this._closing = false;
                }, 600);
            }, exitDelay);
        } else {
            this._closing = false;
        }

        this._invalidateOverlayCache();
        this.state.reset();
        if (emit) this.emitSocketEvent('close', {});
        this._persistState();
        // Bring the floating queue back now that the VN scene is closed
        setTimeout(() => QueueBridge.refreshFloating(), 200);
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

        this._atmosphere?.onSpeakerChange(activated ? $char[0] : null);
        this._reapplyCameraDof();

        if (emit) {
            this.emitSocketEvent('setSpeaker', { tokenId, position, active: activated });
            this._persistStateDebounced();
        }
    }

    _applyExplicitSpeaker(tokenId, position, active) {
        this.state.speakers[position] = active ? tokenId : null;
        $(`.vn-${position}-side .vn-character`).removeClass('active');
        $(`.vn-${position}-side .vn-row`).removeClass('vn-row-promoted');
        if (active) {
            const $char = $(`.vn-character[data-token-id="${tokenId}"]`);
            $char.addClass('active');
            const $parentRow = $char.closest('.vn-row');
            if ($parentRow.length && $parentRow.hasClass('vn-back-row')) $parentRow.addClass('vn-row-promoted');
            this._atmosphere?.onSpeakerChange($char[0]);
        } else {
            this._atmosphere?.onSpeakerChange(null);
        }
        this._reapplyCameraDof();
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

        this._atmosphere?.onSpeakerChange($char[0]);
        this._reapplyCameraDof();

        if (emit) {
            this.emitSocketEvent('setExclusiveSpeaker', { tokenId });
            this._persistStateDebounced();
        }
    }

    // ══════════════════════════════════════════════════════════
    // Queue Display
    // ══════════════════════════════════════════════════════════

    /**
     * GM announced a queued player: if that player's character stands on the scene, they become the active
     * speaker and the characters of other players lose the highlight. NPCs keep whatever state they have.
     * Returns true if the scene was changed.
     */
    focusQueuedSpeaker(userId) {
        if (!game.user.isGM || !this.state.isActive) return false;

        const actorOf = (tokenId) => {
            const base = stripDupSuffix(tokenId);
            return parseActorId(base) ?? canvas.tokens?.get(base)?.actor?.id ?? null;
        };

        const targetActorId = game.users.get(userId)?.character?.id;
        if (!targetActorId) return false;

        let target = null;
        for (const pos of VNSceneState.POSITIONS) {
            const tokenId = this.state.getIdsForPosition(pos).find(id => actorOf(id) === targetActorId);
            if (tokenId) { target = { tokenId, pos }; break; }
        }
        if (!target) return false;

        const playerActorIds = new Set(game.users.map(u => u.character?.id).filter(Boolean));
        for (const pos of VNSceneState.POSITIONS) {
            const current = this.state.speakers[pos];
            if (!current || pos === target.pos) continue;
            if (playerActorIds.has(actorOf(current))) this.setActiveSpeaker(current, true, pos);
        }

        if (this.state.speakers[target.pos] !== target.tokenId) {
            this.setActiveSpeaker(target.tokenId, true, target.pos);
        }
        return true;
    }

    // Runs on every client from the `playerQueueUpdated` hook — each client already holds the queue state
    updateQueueDisplay() {
        if (!this.state.isActive) return;
        const queueData = QueueBridge.getQueue();

        // The panel is rebuilt on every queue change; keep keyboard focus on the same control
        const focused = document.activeElement?.closest?.('.vn-queue-display') ? document.activeElement : null;
        const focusSelector = !focused ? null
            : focused.matches('.vn-queue-pick') ? `.vn-queue-pick[data-priority="${focused.dataset.priority}"]`
            : focused.matches('.vn-queue-lower') ? '.vn-queue-lower'
            : focused.matches('.vn-queue-hand') ? '.vn-queue-hand' : null;

        $('.vn-queue-display').html(this._html.queueDisplay(queueData));
        if (focusSelector) document.querySelector(`.vn-queue-display ${focusSelector}`)?.focus();
        this._updateCharacterBorders();
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

            // Keep the existing badge when the priority is unchanged so its animation doesn't restart
            const mark = charEl.querySelector(':scope > .vn-queue-mark');
            if (!pd) mark?.remove();
            else if (!mark) charEl.insertAdjacentHTML('beforeend', this._html.queueMark(pd.priority));
            else if (Number(mark.dataset.priority) !== pd.priority) {
                mark.dataset.priority = pd.priority;
                mark.src = QueueBridge.getPriorityIcon(pd.priority);
            }
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
    // Scene Listeners
    // ══════════════════════════════════════════════════════════

    activateSceneListeners() {
        this._cleanupListeners();
        const ns = VisualNovelScene.NS;

        $(document).on(`click${ns}`, '.vn-close-button', () => this.closeScene(true));
        $(document).on(`click${ns}`, '.vn-chat-button', () => this._toggleChat());
        this._setupHandListeners(ns);
        this._setupMinimizedDragListener(ns);

        $(document).on(`keydown${ns}`, (e) => {
            if (e.key === 'Escape') {
                if (this._handPickerOpen) { this._setHandPicker(false, true); return; }
                const openPicker = document.querySelector('#vn-scene-overlay .vn-atmosphere-picker:not([hidden])');
                if (openPicker) { openPicker.hidden = true; return; }
                if (!this.state.minimized) this.closeScene(true);
            }
        });

        if (game.user.isGM) this._setupGMListeners(ns);
        this._setupCharacterListeners();
    }

    // Player's hand button and its priority picker. Registered for everybody (not in _setupGMListeners).
    _setupHandListeners(ns) {
        const { QUEUE_HAND } = VisualNovelScene.SEL;

        $(document).on(`click${ns}`, QUEUE_HAND, (e) => {
            e.stopPropagation();
            this._setHandPicker(!this._handPickerOpen, !this._handPickerOpen);
        });
        $(document).on(`click${ns}`, '.vn-queue-pick', (e) => {
            e.stopPropagation();
            QueueBridge.joinWithPriority(Number(e.currentTarget.dataset.priority));
            this._setHandPicker(false, true);
        });
        $(document).on(`click${ns}`, '.vn-queue-lower', (e) => {
            e.stopPropagation();
            QueueBridge.leaveQueue();
            this._setHandPicker(false, true);
        });
        // mousedown, not click: characters stop click propagation
        $(document).on(`mousedown${ns}`, (e) => {
            if (this._handPickerOpen && !e.target.closest('.vn-queue-hand-wrap')) this._setHandPicker(false);
        });
    }

    /** Opens / closes the priority picker. `moveFocus`: on open focus the first choice, on close return focus to the hand. */
    _setHandPicker(open, moveFocus = false) {
        if (this._handPickerOpen === open) return;
        this._handPickerOpen = open;
        this.updateQueueDisplay();
        if (!moveFocus) return;
        const target = open
            ? document.querySelector('.vn-queue-pick.active') ?? document.querySelector('.vn-queue-pick')
            : document.querySelector('.vn-queue-hand');
        target?.focus();
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
            '.vn-particle-cycle-btn': (e) => {
                e.stopPropagation();
                const wrap = e.currentTarget.closest('.vn-atmo-wrap');
                const picker = wrap?.querySelector('.vn-atmosphere-picker');
                if (!picker) return;
                this._setupPickerDismiss(wrap, picker, '_particleOutsideListener');
            },
            '.vn-visual-cycle-btn': (e) => {
                e.stopPropagation();
                const wrap = e.currentTarget.closest('.vn-atmo-wrap');
                const picker = wrap?.querySelector('.vn-atmosphere-picker');
                if (!picker) return;
                this._setupPickerDismiss(wrap, picker, '_visualOutsideListener');
            },
            '.vn-particles-fg-btn': () => this.cycleParticlesLayer()
        };
        for (const [sel, fn] of Object.entries(actions)) $(document).on(`click${ns}`, sel, fn);

        $(document).on(`click${ns}`, '.vn-broadcast-button', () => this.broadcastToPlayers());
        this._sequence.attachListeners(ns);

        $(document).on(`click${ns}`, '.vn-sounds-btn', (e) => {
            e.stopPropagation();
            const wrap = e.currentTarget.closest('.vn-sounds-wrap');
            const picker = wrap?.querySelector('.vn-sounds-picker');
            if (!picker) return;
            this._setupPickerDismiss(wrap, picker, '_soundsOutsideListener', () => this._updateSoundsPanel());
        });

        $(document).on(`click${ns}`, '.vn-sound-item', (e) => {
            const uuid = e.currentTarget.dataset.uuid;
            if (uuid) this.playSoundCue(uuid);
        });

        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-atmo-item[data-particle]', (e) => {
            const particle = e.currentTarget.dataset.particle;
            if (!particle) return;
            const group = e.currentTarget.closest('.vn-atmo-item-group');

            // Клик по тайлу с вариантами — только открыть/закрыть его список
            // подвариантов, не применяя ничего; выбор происходит по клику
            // на конкретный .vn-variant-option внутри.
            if (group) {
                e.currentTarget.closest('.vn-atmosphere-picker-grid')?.querySelectorAll('.vn-atmo-item-group.vn-variant-open')
                    .forEach(g => { if (g !== group) this._closeVariantGroup(g); });
                this._toggleVariantGroup(group);
                return;
            }

            this.setParticleEffect(particle);
            e.currentTarget.closest('.vn-atmosphere-picker')?.setAttribute('hidden', '');
        });

        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-variant-option', (e) => {
            e.stopPropagation();
            const group = e.currentTarget.closest('.vn-atmo-item-group');
            const base = group?.dataset.variantBase;
            const variant = e.currentTarget.dataset.variant;
            if (!base || !variant) return;
            const value = variant === 'all' ? base : `${base}:${variant}`;
            if (group.dataset.variantAxis === 'visual') this.setVisualEffect(value);
            else this.setParticleEffect(value);
            e.currentTarget.closest('.vn-atmosphere-picker')?.setAttribute('hidden', '');
        });

        $(document).on(`click${ns}`, '#vn-scene-overlay .vn-atmo-item[data-visual]', (e) => {
            const visual = e.currentTarget.dataset.visual;
            if (!visual) return;
            const group = e.currentTarget.closest('.vn-atmo-item-group');

            // Тайл с вариантами (как у частиц) — только открыть/закрыть список, выбор — по .vn-variant-option
            if (group) {
                e.currentTarget.closest('.vn-atmosphere-picker-grid')?.querySelectorAll('.vn-atmo-item-group.vn-variant-open')
                    .forEach(g => { if (g !== group) this._closeVariantGroup(g); });
                this._toggleVariantGroup(group);
                return;
            }

            this.setVisualEffect(visual);
            e.currentTarget.closest('.vn-atmosphere-picker')?.setAttribute('hidden', '');
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

    // ══════════════════════════════════════════════════════════
    // Chat Panel (delegated to VNChatPanel)
    // ══════════════════════════════════════════════════════════

    _toggleChat() { this._chatPanel.toggle(); }
    _closeChatPanel() { this._chatPanel.close(); }

    _openActorSheet(tokenId) {
        const actorId = parseActorId(tokenId);
        const actor = actorId ? game.actors.get(actorId) : canvas.tokens?.get(tokenId)?.actor;
        actor?.sheet?.render(true);
    }

    _setupCharacterListeners() {
        const ns = VisualNovelScene.NS;
        const sel = VisualNovelScene.SEL.CHARACTER;

        $(document).on(`click${ns}`, sel, (e) => {
            e.preventDefault(); e.stopPropagation();
            const tokenId = $(e.currentTarget).data('token-id');
            if (game.user.isGM && e.shiftKey) this._openActorSheet(tokenId);
            else if (e.ctrlKey) this.setExclusiveSpeaker(tokenId, true);
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
            const current = this.state.visibility[tokenId] ?? 'visible';
            const cycle = VNSceneState.VISIBILITY_CYCLE;
            const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
            this.applyVisibility(tokenId, next, true);
        });
        this._wheelListener = (e) => {
            if (!game.user.isGM || !e.altKey) return;
            const charEl = e.target.closest(sel);
            if (!charEl) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const tokenId = charEl.dataset.tokenId;
            const current = this.state.portraitScales[tokenId] ?? 1;
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            this.setCharacterScale(tokenId, current + delta);
        };
        document.addEventListener('wheel', this._wheelListener, { passive: false });
    }
}

window.VisualNovelScene = VisualNovelScene;
window.VNSceneState = VNSceneState;
window.QueueBridge = QueueBridge;
window.VNPresets = VNPresets;

export { VisualNovelScene };

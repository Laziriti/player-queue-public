// ============================================================
// visual-novel-scene.js — v4.0 (refactored core)
// ============================================================

import { VNSceneState } from './scene/vn-scene-state.js';
import { VNPresets } from './presets/vn-presets.js';
import { VNFolders } from './presets/vn-folders.js';
import { PARTICLE_LAYERS, PARTICLE_DEPTHS, isScenePayload, isParticleSettingsPatch, isVisualSettingsPatch,
    isSupportedParticleEffect, isSupportedVisualEffect, SCALE_LIMITS, SCENE_FIELDS, resolveVisualAngle } from './scene/vn-scene-contract.js';
import { VNAtmosphere } from './visual-effects/atmosphere/index.js';
import { normalizeParticleEffect } from './visual-effects/atmosphere/config/particle-types.js';
import { normalizeVisualEffect } from './visual-effects/atmosphere/config/visual-types.js';
import { QueueBridge } from './scene/vn-queue-bridge.js';
import { VNTransitions } from './visual-effects/vn-transitions.js';
import { VNDialogBuilder } from './dialog/vn-dialog-builder.js';
import { VNSocketHandler } from './scene/vn-socket-handler.js';
import { stripDupSuffix, parseActorId } from './scene/vn-id-utils.js';
import { VNSceneLayout, applySceneLayoutPayload, particleSettingsChanges } from './scene/vn-scene-layout.js';
import { VNSceneAudio } from './scene/vn-scene-audio.js';
import { VNSceneEffectsUI } from './overlay/vn-scene-effects-ui.js';
import { VNChatPanel } from './overlay/vn-chat-panel.js';
import { VNSceneHTML } from './overlay/vn-scene-html.js';
import { VNSequence } from './scene/vn-sequence.js';
import { resolveStep, inheritedMusic } from './presets/vn-sequence-model.js';
import { applyCaptionStyle, resolveCaptionStyle } from './overlay/vn-caption.js';
import { VNPresetLink } from './overlay/vn-preset-link.js';
import { VNPreloader } from './media/vn-preload.js';
import { fitNameplates } from './overlay/vn-nameplate.js';
import { VNScenePortraits } from './overlay/vn-scene-portraits.js';
import { VNMinimizedOverlay } from './overlay/vn-minimized-overlay.js';
import { VNSceneLifetime } from './scene/vn-scene-lifetime.js';
import { VNSceneChanges, SCENE_SOURCE } from './scene/vn-scene-changes.js';
import { VNSceneBackground } from './scene/vn-scene-background.js';
import { debounce } from '../utils/timing.js';
import { clamp } from '../utils/math.js';

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
        PORTRAIT_SCALE: SCENE_FIELDS.portraitScale.value,
        SCALE_LIMITS: { ...SCALE_LIMITS, STEP: 0.1 },
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
        this._background = new VNSceneBackground();
        this._portraits = new VNScenePortraits(this.state, () => this.$overlay[0]);
        this._minimizedOverlay = new VNMinimizedOverlay(VisualNovelScene.MINIMIZED_POS_KEY);
        this._dialogBuilder = new VNDialogBuilder({
            getState: () => this.state,
            actions: {
                createScene: payload => this.createScene(payload),
                updateSceneLayout: payload => this.updateSceneLayout(payload),
                launchPreset: (preset, options) => this.launchPreset(preset, options),
                isPrivate: () => this._gmOnly,
                bindPreset: preset => this.bindPreset(preset),
                syncSequence: preset => this._sequence.syncPreset(preset),
                syncPresetActors: ids => { if (this.state.isActive) this.state.presetActors = [...ids]; },
                setPortraitScale: (value, source) => this.setPortraitScale(value, source),
            },
            favorites: {
                list: () => this.favoriteActors,
                load: () => this.loadFavoriteActors(),
                add: id => this.addToFavorites(id),
                remove: id => this.removeFromFavorites(id),
            },
        });
        this._socketHandler = null; // initialized after socket is ready
        this._audio = new VNSceneAudio(this);
        this._effectsUI = new VNSceneEffectsUI(this);
        this._gmOnly = false;      // true = scene hidden from players until "broadcast"
        this._closing = false;

        this._chatPanel = new VNChatPanel(() => this.$overlay);
        this._sequence = new VNSequence(this);
        this._presetLink = new VNPresetLink(this);
        this._html = new VNSceneHTML(this, VisualNovelScene.ROW_CONFIG);
        this._layout = new VNSceneLayout({
            state: this.state, getOverlay: () => this.$overlay, html: this._html,
            resolveTokens: (...args) => VisualNovelScene.resolveTokens(...args),
            atmosphere: this._atmosphere, background: this._background, effectsUI: this._effectsUI,
            particleLook: () => this._particleLook(), applyLayerUI: () => this._applyParticlesLayerUI(),
            applyCharFx: () => this._portraits.applyEffects(),
            settlePortraits: speakers => {
                this._portraits.applyTransforms();
                this._portraits.applyAllVisibility();
                this._portraits.applyEffects();
                this._restoreSpeakers(speakers);
            },
            applyCaption: () => this._applyCaption(),
        });
        this._changes = new VNSceneChanges(this);
        this._persistStateDebounced = () => this._changes.persist(true, { defer: true });
        this._persistStateDebounced.cancel = () => this._changes.cancelPending();
    }

    // ══════════════════════════════════════════════════════════
    // Init
    // ══════════════════════════════════════════════════════════

    async initialize() {
        this._registerSettings();
        VNPresets.register();
        VNFolders.register();
        await this.loadFavoriteActors();
    }

    initSocket(socket) {
        this._socketHandler = new VNSocketHandler(this, socket);
    }

    _registerSettings() {
        for (const [key, type, def] of [['activeScene', Object, {}], ['privateActiveScene', Object, {}], ['favoriteActors', Array, []]]) {
            try {
                game.settings.register(VisualNovelScene.ID, key, {
                    name: key, scope: key === VNSceneChanges.PRIVATE_KEY ? 'client' : 'world', config: false, type, default: def
                });
            } catch { /* already registered */ }
        }
    }

    // ══════════════════════════════════════════════════════════
    // Utilities
    // ══════════════════════════════════════════════════════════

    static clamp = clamp;
    static debounce(fn, ms = 50) { return debounce(fn, ms); }

    _cancelSceneWork() {
        const overlay = this._sceneLifetime?.overlay;
        this._sceneLifetime?.dispose();
        overlay?.querySelectorAll('.vn-character').forEach(el => { el.style.visibility = ''; });
        this._sceneLifetime = null;
        this._persistStateDebounced.cancel();
        this._cancelScaleEmits();
    }

    _cancelScaleEmits() {
        for (const slot of Object.values(this._scaleEmit ?? {})) clearTimeout(slot.timer);
        this._scaleEmit = {};
    }

    _finishClosing(lifetime = this._closingLifetime) {
        if (!lifetime) return;
        lifetime.dispose();
        VNTransitions.releaseVideos(lifetime.overlay);
        lifetime.overlay?.remove();
        this._atmosphere.destroyFor(lifetime.overlay);
        if (this._closingLifetime === lifetime) {
            this._closingLifetime = null;
            this._closing = false;
        }
    }
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
        this._minimizedOverlay.detach();
        if (this._wheelListener) {
            document.removeEventListener('wheel', this._wheelListener);
            this._wheelListener = null;
        }
        this._effectsUI.detachListeners();
        this._audio.detachListeners();
        if (!keepAtmosphere) this._atmosphere.destroy();
    }

    // ══════════════════════════════════════════════════════════
    // Socket (delegated)
    // ══════════════════════════════════════════════════════════

    emitSocketEvent(action, payload, source = true) {
        return this._changes.emit(action, payload, source);
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

    /** World settings `dimInactive` / `blurInactive`: false = inactive characters are not darkened / not blurred (the GM's choice, same on every client). */
    get inactiveLook() {
        const on = key => { try { return game.settings.get(VisualNovelScene.ID, key) !== false; } catch { return true; } };
        return { dim: on('dimInactive'), blur: on('blurInactive') };
    }

    applyInactiveLook() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const { dim, blur } = this.inactiveLook;
        overlay.classList.toggle('vn-no-dim', !dim);
        overlay.classList.toggle('vn-no-blur', !blur);
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
        this._portraits.applyEffects();
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

    _persistState(source = true) { return this._changes.persist(source); }

    async restoreStateIfNeeded() {
        if (this.state.isActive) return;
        try {
            const s = this._changes.savedScene();
            if (!s || (!s.leftIds?.length && !s.centerIds?.length && !s.rightIds?.length && !s.background)) return;
            this.createScene(s, SCENE_SOURCE.RESTORE);
            if (s.sequence && game.user.isGM) this._sequence.restore(s.sequence);
            else if (s.presetLink && game.user.isGM) this._presetLink.restore(s.presetLink);
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
        if (!this._changes.canApply(emit)) return;
        if (!SCENE_FIELDS.portraitScale.check(scale)) return;
        this.state.portraitScale = SCENE_FIELDS.portraitScale.normalize(scale);
        this._portraits.applyTransforms();
        const resetBtn = document.getElementById('reset-size');
        if (resetBtn) resetBtn.textContent = Math.round(this.state.portraitScale * 100) + '%';
        this._changes.commit('setPortraitScale', { scale: this.state.portraitScale }, emit);
    }

    setCharacterScale(tokenId, scale, emit = true) {
        if (!this._changes.canApply(emit)) return;
        if (!SCENE_FIELDS.portraitScale.check(scale)) return;
        const { MIN, MAX } = VisualNovelScene.DEFAULTS.SCALE_LIMITS;
        scale = VisualNovelScene.clamp(Math.round(scale * 20) / 20, MIN, MAX);
        // Колесо упёрлось в границу: масштаб не меняется, сообщение остальным не нужно
        if (this._changes.isLocal(emit) && this.state.portraitScales[tokenId] === scale) return;
        this.state.portraitScales[tokenId] = scale;
        this._portraits.applyScale(tokenId, scale);
        if (this._changes.canBroadcast(emit)) this._emitCharacterScale(tokenId, scale);
        this._changes.commit(null, null, emit, { defer: true });
    }

    /** Колесо мыши шлёт десятки тиков в секунду: первое значение уходит сразу, остальные склеиваются в одно раз в 60 мс. */
    _emitCharacterScale(tokenId, scale) {
        const slots = (this._scaleEmit ??= {});
        if (slots[tokenId]) { slots[tokenId].pending = scale; return; }
        this.emitSocketEvent('setCharacterScale', { tokenId, scale });
        slots[tokenId] = {
            pending: null,
            timer: setTimeout(() => {
                const { pending } = slots[tokenId];
                delete slots[tokenId];
                if (pending !== null) this._emitCharacterScale(tokenId, pending);
            }, 60)
        };
    }

    // Normalize scale/flip maps: for legacy presets where scales are stored under canvas token IDs
    // instead of actor-based IDs, add actor-based aliases so character() can find the scale.
    // Handles single-actor case only — multi-instance (same actor N times) requires re-saving the preset.
    static _normalizePortraitMap(values) {
        if (!values) return {};
        const result = { ...values };
        if (!canvas?.tokens) return result;
        for (const [key, val] of Object.entries(values)) {
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

    applyFlip(tokenId, flip, source = true) {
        if (!this._changes.canApply(source)) return;
        this.state.flipped[tokenId] = flip;
        this._portraits.applyTransforms();
        this._changes.commit('flipPortrait', { tokenId, flip }, source);
    }

    applyVisibility(tokenId, visibility, emit = true) {
        if (!this._changes.canApply(emit)) return;
        if (visibility && visibility !== 'visible') this.state.visibility[tokenId] = visibility;
        else delete this.state.visibility[tokenId];
        this._portraits.applyVisibility(tokenId);
        this._changes.commit('setVisibility', { tokenId, visibility: visibility ?? 'visible' }, emit);
    }

    // Scene music and the sound toolbar are owned by VNSceneAudio.
    startSceneMusic(uuid) { if (this._changes.canPlayAudio()) return this._audio.start(uuid); }
    stopSceneMusic(resumePaused = false) { if (this._changes.canPlayAudio()) return this._audio.stop(resumePaused); }
    playSoundCue(uuid) { if (this._changes.canPlayAudio()) return this._audio.playCue(uuid); }
    _syncSceneMusic(source = true) {
        if (this._changes.canPlayAudio(source)) {
            if (this._audio.currentMusicUuid !== this.state.musicUuid) this._audio.transition(this.state.musicUuid);
        } else if (!this._gmOnly && !this._changes.isLocal(source)) this._audio.currentMusicUuid = this.state.musicUuid;
    }

    _generateSoundsWrapHTML() { return this._audio.buildToolbarHTML(); }

    // ══════════════════════════════════════════════════════════
    // Background Overlay & Atmosphere
    // ══════════════════════════════════════════════════════════

    setBackgroundOverlay(enabled, emit = true) {
        if (!this._changes.canApply(emit)) return;
        this.state.backgroundOverlay = enabled;
        this._background.setOverlay(this.$overlay, this.state.background, enabled);
        this._effectsUI.syncSettings();
        this._changes.commit('setBackgroundOverlay', { enabled }, emit);
    }

    setVignette(enabled, emit = true) {
        if (!this._changes.canApply(emit)) return;
        this.state.vignette = enabled;
        this._applyVignetteUI();
        this._changes.commit('setVignette', { enabled }, emit);
    }

    setGroundFog(enabled, emit = true) {
        if (!this._changes.canApply(emit)) return;
        this.state.groundFog = enabled;
        this._applyVignetteUI();
        this._changes.commit('setGroundFog', { enabled }, emit);
    }

    /** The vignette and ground-fog layers stay in the DOM (every visual effect restyles them); the classes only hide them. */
    _applyVignetteUI() {
        const overlay = this.$overlay?.[0];
        overlay?.classList.toggle('vn-no-vignette', this.state.vignette === false);
        overlay?.classList.toggle('vn-no-fog', this.state.groundFog === false);
        this._effectsUI.syncSettings();
    }

    setParticleIntensity(intensity, emit = true) {
        this._setParticleSetting('particleIntensity', intensity, 'setParticleIntensity', 'intensity', emit);
    }

    _particleLook() {
        const { particleDepth, particleWind, particleGusts, particleWrap, particleScale, particleOpacity,
            particleTempo, particleTintColor, particleTintStrength, particleSolidTexture, particleEffectSettings } = this.state;
        return { depth: particleDepth, wind: particleWind, gusts: particleGusts, wrap: particleWrap,
            scale: particleScale, opacity: particleOpacity, tempo: particleTempo, solidTexture: particleSolidTexture,
            tintColor: particleTintColor, tintStrength: particleTintStrength, effectSettings: particleEffectSettings };
    }

    setParticleSettings(settings, emit = true) {
        if (!this._changes.canApply(emit) || !isParticleSettingsPatch(settings)) return;
        const patch = this._applyParticleSettings(settings);
        if (patch) this._changes.commit('setParticleSettings', { settings: patch }, emit);
    }

    _setParticleSetting(key, value, action, payloadKey, source) {
        if (!this._changes.canApply(source) || !SCENE_FIELDS[key].check(value)) return;
        const patch = this._applyParticleSettings({ [key]: value });
        if (patch) this._changes.commit(action, { [payloadKey]: patch[key] }, source);
    }

    _applyParticleSettings(settings) {
        const previous = { ...this.state };
        const patch = {};
        for (const [key, value] of Object.entries(settings)) {
            const next = SCENE_FIELDS[key].normalize(value);
            if (previous[key] !== next) patch[key] = key === 'particleEffectSettings' ? structuredClone(next) : next;
        }
        if (!Object.keys(patch).length) return;
        Object.assign(this.state, patch);
        this._layout.applyParticles(particleSettingsChanges(previous, this.state));
        this._effectsUI.syncSettings();
        return patch;
    }

    setParticleDepth(depth, emit = true) {
        if (!PARTICLE_DEPTHS.includes(depth)) return;
        this._setParticleSetting('particleDepth', depth, 'setParticleDepth', 'depth', emit);
    }

    setParticleWind(wind, emit = true) {
        this._setParticleSetting('particleWind', wind, 'setParticleWind', 'wind', emit);
    }

    setParticleGusts(gusts, emit = true) {
        this._setParticleSetting('particleGusts', !!gusts, 'setParticleGusts', 'gusts', emit);
    }

    setParticleWrap(wrap, emit = true) {
        this._setParticleSetting('particleWrap', wrap, 'setParticleWrap', 'wrap', emit);
    }

    setParticleEffect(particle, emit = true) {
        if (!this._changes.canApply(emit) || typeof particle !== 'string') return;
        const effect = normalizeParticleEffect(particle);
        if (!isSupportedParticleEffect(effect)) return;
        this.state.particleEffect = effect;
        // Только частицы: параллакс, камера и визуальный эффект продолжают работать (полный _reinitAtmosphere сбрасывал зум фона и фокус камеры)
        this._atmosphere.setParticles(this.state.particleEffect, this.state.particleIntensity, this.state.particlesLayer, this._particleLook());
        this._syncAtmosphereUI();
        this._changes.commit('setParticleEffect', { particle: effect }, emit);
    }

    setVisualEffect(visual, emit = true) {
        if (!this._changes.canApply(emit)) return;
        visual = normalizeVisualEffect(visual);
        if (!isSupportedVisualEffect(visual)) return;
        this.state.visualEffect = visual;
        this._atmosphere.setVisual(this.state.visualEffect);
        this._syncAtmosphereUI();
        this._changes.commit('setVisualEffect', { visual }, emit);
    }

    setVisualAngle(angle, emit = true) {
        if (!this._changes.canApply(emit)) return;
        this.state.visualAngle = resolveVisualAngle(angle);
        this._atmosphere.setVisualAngle(this.state.visualAngle);
        this._effectsUI.syncSettings();
        this._changes.commit('setVisualAngle', { angle: this.state.visualAngle }, emit);
    }

    setVisualSettings(settings, emit = true) {
        if (!this._changes.canApply(emit) || !isVisualSettingsPatch(settings)) return;
        const patch = {};
        for (const [key, value] of Object.entries(settings)) {
            const next = SCENE_FIELDS[key].normalize(value);
            if (this.state[key] !== next) patch[key] = next;
        }
        if (!Object.keys(patch).length) return;
        Object.assign(this.state, patch);
        this._atmosphere.setVisualAppearance(this.state);
        if (Object.hasOwn(patch, 'visualAngle')) this._atmosphere.setVisualAngle(this.state.visualAngle);
        this._effectsUI.syncSettings();
        this._changes.commit('setVisualSettings', { visualSettings: patch }, emit);
    }

    setParticlesLayer(layer, emit = true) {
        if (!PARTICLE_LAYERS.includes(layer)) return;
        this._setParticleSetting('particlesLayer', layer, 'setParticlesLayer', 'layer', emit);
    }

    _applyParticlesLayerUI() {
        const overlay = this.$overlay?.[0];
        if (!overlay) return;
        const layer = this.state.particlesLayer;
        overlay.classList.toggle('vn-particles-fg', layer === 'front');
    }

    _reinitAtmosphere() {
        this._atmosphere.destroy();
        this._initAtmosphere();
    }

    _initAtmosphere() {
        const overlayEl = this.$overlay?.[0];
        if (!overlayEl) return;
        this._atmosphere.init(overlayEl, this.state.particleEffect, this.state.visualEffect, this.state.particleIntensity, this.state.particlesLayer, this._particleLook(), this.state.visualAngle, this.state);
        this._syncAtmosphereUI();
    }

    _syncAtmosphereUI() {
        this._applyParticlesLayerUI();
        this._effectsUI.syncButtons();
        this._effectsUI.syncSettings();
    }

    // ══════════════════════════════════════════════════════════
    // GM-Only mode
    // ══════════════════════════════════════════════════════════

    broadcastToPlayers() {
        if (!game.user.isGM || !this.state.isActive) return;
        this._changes.setPrivate(false);
        this._dialogBuilder.syncPrivacy();
        this._changes.commit('open', this.state.toPayload());
        this._sequence.preload();
        this._syncSceneMusic();
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
        const overlay = this.$overlay[0];
        if (value) VNTransitions.cancelStage(overlay);
        this.state.minimized = value;
        this._minimizedOverlay.setMinimized(overlay, value);
        if (forAll) this._changes.commit(value ? 'minimize' : 'maximize', {}, emit, { persist: false });
        QueueBridge.refreshFloating();
    }

    _setMinimizedSelf(value) {
        if (!game.user.isGM) return;
        this.setMinimized(value, false, false);
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
        if (this._creating || !this._changes.canApply(emit)) return false;
        if (!isScenePayload(payload)) throw new TypeError('Invalid VN scene payload');
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
            if (!this.createScene(gmOnly ? { ...preset, gmOnly } : preset)) return false;
            this._presetLink.start(preset);
            return true;
        }
        const steps = preset.steps ?? [];
        if (!steps.length) { ui.notifications.warn(game.i18n.localize('vn.sequence.emptyWarn')); return false; }

        let index = stepIndex === null || stepIndex === undefined ? (steps.length > 1 ? await VNSequence.promptStart(preset) : 0) : Number(stepIndex);
        if (index === null) return false;
        index = Math.min(Math.max(Math.trunc(index) || 0, 0), steps.length - 1);

        const step = resolveStep(steps, index);
        const musicUuid = step.musicUuid || inheritedMusic(steps, index);
        const captionStyle = resolveCaptionStyle(preset.captionStyle, step.captionStyle);
        if (!this.createScene({ ...step, captionStyle, musicUuid, gmOnly })) return false;
        this._sequence.start(preset, index);
        return true;
    }

    /** A preset was just saved from the live scene: the scene now counts as opened from it (not while a composite preset runs). */
    bindPreset(preset) {
        if (!this.state.isActive || this._sequence.active) return;
        this._presetLink.start(preset);
    }

    _doCreateScene(payload, emit) {
        if (payload.gmOnly && this._changes.isLocal(emit)) this._changes.flushPending();
        this._cancelSceneWork();
        this._finishClosing();
        this._layout.invalidate(true);
        this._sequence.stop();
        this._presetLink.stop();
        this._atmosphere.destroy();
        this.state.reset();
        this.state.fromPayload(payload);

        // Normalize portrait scales and flip state: add actor-based aliases for any canvas token ID keys
        this.state.portraitScales = VisualNovelScene._normalizePortraitMap(this.state.portraitScales);
        this.state.flipped = VisualNovelScene._normalizePortraitMap(this.state.flipped);

        this._changes.setPrivate(payload.gmOnly, emit);
        this._syncSceneMusic(emit);

        this._closeChatPanel();

        const previousOverlay = this.$overlay[0];
        if (previousOverlay) VNTransitions.releaseVideos(previousOverlay);
        $(VisualNovelScene.SEL.OVERLAY).remove();
        this._invalidateOverlayCache();
        this._cleanupListeners();

        const tokens = Object.fromEntries(
            VNSceneState.POSITIONS.map(pos => [pos, VisualNovelScene.resolveTokens(
                this.state[`${pos}Ids`], this.state.portraitImages, this.state.portraitNames)])
        );

        $('body').append(this._html.scene(tokens));
        this._invalidateOverlayCache();
        const lifetime = this._sceneLifetime = new VNSceneLifetime(this.$overlay[0]);
        fitNameplates(this.$overlay[0]);
        this._portraits.applyTransforms();
        QueueBridge.refreshFloating();

        if (this.state.initialEntrance !== 'none') {
            this.$overlay[0].querySelectorAll('.vn-character').forEach(el => el.style.visibility = 'hidden');
        }
        this._background.applyBackground(this.$overlay, this.state.background, this.state.backgroundOverlay);

        lifetime.timeout(() => {
            this.activateSceneListeners();
            this._portraits.applyTransforms();
            this._initAtmosphere();
            this._animateInitialCharacters();
            this._restoreSpeakers({ ...this.state.speakers });
            this._portraits.applyEffects();
            this._applyCaption();
            if (game.user.isGM) this._updateGmOnlyUI();
        }, VisualNovelScene.DEFAULTS.ANIMATION_DELAY);

        this._changes.commit('open', this.state.toPayload(), emit);
    }

    updateSceneLayout(payload, emit = true) {
        if (!this.state.isActive || !this._changes.canApply(emit)) return false;
        if (!isScenePayload(payload)) throw new TypeError('Invalid VN scene payload');
        const revision = this._layout.invalidate();
        const changes = this._layout.prepare(applySceneLayoutPayload(this.state, payload, VisualNovelScene._normalizePortraitMap));
        if (payload.vignette != null || payload.groundFog != null) this._applyVignetteUI();

        // A transition is a one-shot instruction, not persisted scene state.
        const transition = payload.transition ?? null;
        const timing = VNTransitions.timing(transition);
        const wasPrivate = this._gmOnly;
        if ('gmOnly' in payload && this._changes.isLocal(emit)) this._changes.setPrivate(payload.gmOnly, emit);
        if (payload.musicUuid !== undefined) this.state.musicUuid = payload.musicUuid;
        if (payload.musicUuid !== undefined || (wasPrivate && !this._gmOnly)) this._syncSceneMusic(emit);
        if (payload.soundCues != null) {
            this.state.soundCues = structuredClone(payload.soundCues);
            this._audio.updatePanel();
        }
        this._updateGmOnlyUI();
        const action = wasPrivate && !this._gmOnly ? 'open' : 'updateScene';
        this._changes.commit(action, { ...this.state.toPayload(), transition }, emit);
        const queueData = QueueBridge.getQueue();
        requestAnimationFrame(() => this._layout.render(changes, timing, revision, queueData));
        return true;
    }

    _restoreSpeakers(prevSpeakers) {
        let focused = null;
        for (const pos of VNSceneState.POSITIONS) {
            const id = prevSpeakers[pos];
            const speaker = this.state.getIdsForPosition(pos).includes(id) ? id : null;
            this.state.speakers[pos] = speaker;
            const portrait = this._renderSpeaker(pos, speaker);
            if (speaker) focused = portrait;
        }
        this._focusSpeaker(focused);
    }

    _applyCaption() {
        const box = this.$overlay?.[0]?.querySelector('.vn-caption');
        const textEl = box?.querySelector('.vn-caption-text');
        if (!box || !textEl) return;
        applyCaptionStyle(textEl, this.state.captionStyle);
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
        if (!this._changes.canApply(emit)) return;
        if (this._closing) return;
        this._cancelSceneWork();
        this._layout.invalidate(true);
        this._closing = true;
        this._handPickerOpen = false;

        if (this._changes.canPlayAudio(emit)) this.stopSceneMusic(true);
        this._sequence.stop();
        this._presetLink.stop();
        this._closeChatPanel();

        const $ov = this.$overlay;
        // Particles, the visual effect, parallax and camera are part of the picture: they go away together with the
        // background (the overlay fade), not at the first frame of closing while the background is still on screen
        this._cleanupListeners({ keepAtmosphere: !!$ov.length });

        if ($ov.length) {
            const overlayEl = $ov[0];
            const lifetime = this._closingLifetime = new VNSceneLifetime(overlayEl);
            const characters = overlayEl.querySelectorAll('.vn-character');
            characters.forEach((charEl, i) => lifetime.timeout(() => VNTransitions.exitCharacter(charEl), i * 50));
            const exitDelay = Math.min(characters.length * 50 + 600, 900);
            lifetime.timeout(() => {
                $ov.addClass('vn-closing');
                lifetime.timeout(() => this._finishClosing(lifetime), 600);
            }, exitDelay);
            lifetime.timeout(() => QueueBridge.refreshFloating(), 200);
        } else {
            this._closing = false;
        }

        this._invalidateOverlayCache();
        this.state.reset();
        this._dialogBuilder.sceneClosed();
        this._changes.commit('close', {}, emit);
        // Bring the floating queue back now that the VN scene is closed
        if (!$ov.length) QueueBridge.refreshFloating();
    }

    // ══════════════════════════════════════════════════════════
    // Active Speaker
    // ══════════════════════════════════════════════════════════

    setActiveSpeaker(tokenId, emit = true, position = null) {
        if (!this._changes.canApply(emit)) return;
        position ??= VisualNovelScene._sidePosition(this._speakerPortrait(tokenId));
        if (!VNSceneState.POSITIONS.includes(position) || !this.state.getIdsForPosition(position).includes(tokenId)) return;

        const activated = this.state.toggleSpeaker(tokenId, position);
        this._focusSpeaker(this._renderSpeaker(position, this.state.speakers[position]));
        this._changes.commit('setSpeaker', { tokenId, position, active: activated }, emit, { defer: true });
    }

    _applyExplicitSpeaker(tokenId, position, active) {
        if (!VNSceneState.POSITIONS.includes(position)) return;
        if (active && !this.state.getIdsForPosition(position).includes(tokenId)) return;
        this.state.speakers[position] = active ? tokenId : null;
        this._focusSpeaker(this._renderSpeaker(position, this.state.speakers[position]));
    }

    setExclusiveSpeaker(tokenId, emit = true) {
        if (!this._changes.canApply(emit)) return;
        const position = VisualNovelScene._sidePosition(this._speakerPortrait(tokenId));
        if (!position || !this.state.getIdsForPosition(position).includes(tokenId)) return;
        let focused;
        for (const pos of VNSceneState.POSITIONS) {
            const speaker = pos === position ? tokenId : null;
            this.state.speakers[pos] = speaker;
            const portrait = this._renderSpeaker(pos, speaker);
            if (speaker) focused = portrait;
        }
        this._focusSpeaker(focused);
        this._changes.commit('setExclusiveSpeaker', { tokenId }, emit, { defer: true });
    }

    _speakerPortrait(tokenId, $root = this.$overlay) {
        return $root.find(`.vn-character[data-token-id="${CSS.escape(tokenId)}"]`);
    }

    _renderSpeaker(position, tokenId) {
        const $side = this.$overlay.find(`.vn-${position}-side`);
        $side.find('.vn-character.active').removeClass('active');
        $side.find('.vn-row-promoted').removeClass('vn-row-promoted');
        if (!tokenId) return null;
        const $portrait = this._speakerPortrait(tokenId, $side);
        $portrait.addClass('active').closest('.vn-back-row').addClass('vn-row-promoted');
        return $portrait[0];
    }

    _focusSpeaker(portrait) {
        this._atmosphere?.onSpeakerChange(portrait ?? null);
        this._reapplyCameraDof();
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
        const entrance = this.state.initialEntrance;
        if (entrance === 'none') return;
        const revision = this._layout._revision;
        overlay.querySelectorAll('.vn-character').forEach((charEl, index) => {
            charEl.style.visibility = 'hidden';
            this._sceneLifetime?.timeout(() => {
                if (this._layout.isCurrent(revision) && charEl.isConnected) VNTransitions.enterCharacter(charEl, entrance);
                else charEl.style.visibility = '';
            }, index * staggerMs, () => { charEl.style.visibility = ''; });
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
        this._minimizedOverlay.attach(this.$overlay[0]);

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
        this._effectsUI.attachListeners(ns);
        this._audio.attachListeners(ns);
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
        };
        for (const [sel, fn] of Object.entries(actions)) $(document).on(`click${ns}`, sel, fn);

        $(document).on(`click${ns}`, '.vn-broadcast-button', () => this.broadcastToPlayers());
        this._sequence.attachListeners(ns);
        this._presetLink.attachListeners(ns);

        $(document).on(`click${ns}`, '.vn-epicrolls-button', () => {
            if (!game.modules.get('epic-rolls-5e')?.active) return;
            if (ui.EpicRolls5e?.GetRollData) new ui.EpicRolls5e.GetRollData({ actors: [], contestants: [], type: '', contest: null, options: {} }).render(true);
        });

        $(document).on(`click${ns}`, VisualNovelScene.SEL.QUEUE_ITEM, (e) => { e.stopPropagation(); QueueBridge.announceAndRemove($(e.currentTarget).data('user-id')); });
        $(document).on(`contextmenu${ns}`, VisualNovelScene.SEL.QUEUE_ITEM, (e) => { e.preventDefault(); e.stopPropagation(); QueueBridge.removeFromQueue($(e.currentTarget).data('user-id')); });

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

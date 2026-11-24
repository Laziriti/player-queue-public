import { SCENE_SOURCE } from './vn-scene-changes.js';
import { isScenePayload, isParticleSettingsPatch, isVisualSettingsPatch, SCENE_CHECKS, SCENE_POSITIONS } from './vn-scene-contract.js';
import { isString, isBoolean } from '../../utils/validation.js';

// ============================================================
// vn-socket-handler.js — сетевой слой VN-сцены
// ============================================================

const ACTION_FIELDS = {
    tokenId: isString, position: v => v == null || SCENE_POSITIONS.includes(v), active: isBoolean,
    scale: SCENE_CHECKS.portraitScale, enabled: isBoolean, flip: isBoolean,
    particle: SCENE_CHECKS.particleEffect, visual: SCENE_CHECKS.visualEffect,
    layer: SCENE_CHECKS.particlesLayer, intensity: SCENE_CHECKS.particleIntensity,
    depth: SCENE_CHECKS.particleDepth, wind: SCENE_CHECKS.particleWind,
    angle: SCENE_CHECKS.visualAngle, gusts: SCENE_CHECKS.particleGusts,
    wrap: SCENE_CHECKS.particleWrap,
    settings: isParticleSettingsPatch,
    visualSettings: isVisualSettingsPatch,
    visibility: isString, urls: Array.isArray,
};

export class VNSocketHandler {
    static SCHEMA = {
        open:                 { gmOnly: true,  required: ['leftIds', 'centerIds', 'rightIds'] },
        close:                { gmOnly: true },
        setSpeaker:           { gmOnly: true,  required: ['tokenId'] },
        updateScene:          { gmOnly: true,  required: ['leftIds', 'centerIds', 'rightIds'] },
        minimize:             { gmOnly: true },
        maximize:             { gmOnly: true },
        flipPortrait:         { gmOnly: true,  required: ['tokenId'] },
        setPortraitScale:     { gmOnly: true,  required: ['scale'] },
        setCharacterScale:    { gmOnly: true,  required: ['tokenId', 'scale'] },
        setExclusiveSpeaker:  { gmOnly: true,  required: ['tokenId'] },
        setBackgroundOverlay: { gmOnly: true,  required: ['enabled'] },
        setVignette:          { gmOnly: true,  required: ['enabled'] },
        setGroundFog:         { gmOnly: true,  required: ['enabled'] },
        setParticleEffect:    { gmOnly: true,  required: ['particle'] },
        setVisualEffect:      { gmOnly: true,  required: ['visual'] },
        setParticlesLayer: { gmOnly: true, required: ['layer'] },
        setParticleIntensity: { gmOnly: true, required: ['intensity'] },
        setParticleDepth:     { gmOnly: true,  required: ['depth'] },
        setParticleWind:      { gmOnly: true,  required: ['wind'] },
        setVisualAngle:       { gmOnly: true,  required: ['angle'] },
        setVisualSettings:    { gmOnly: true,  required: ['visualSettings'] },
        setParticleGusts:     { gmOnly: true,  required: ['gusts'] },
        setParticleWrap:      { gmOnly: true,  required: ['wrap'] },
        setParticleSettings:  { gmOnly: true,  required: ['settings'] },
        setVisibility:        { gmOnly: true,  required: ['tokenId', 'visibility'] },
        preload:              { gmOnly: true,  required: ['urls'] },
    };

    /**
     * @param {object} scene — VisualNovelScene instance
     * @param {object} socket — socketlib socket
     */
    constructor(scene, socket) {
        this._scene = scene;
        this._socket = socket;
    }

    get socket() { return this._socket; }
    set socket(s) { this._socket = s; }

    // ══════════════════════════════════════════════════════════
    // Emit
    // ══════════════════════════════════════════════════════════

    emit(action, payload = {}) {
        if (!this._socket) { console.error('VN socket not available'); return; }
        this._socket.executeForEveryone('vnScene', { action, payload, sender: game.user.id });
    }

    // ══════════════════════════════════════════════════════════
    // Receive & Validate
    // ══════════════════════════════════════════════════════════

    /**
     * @param {object} data - message body
     * @param {string} senderId - user id supplied by the server (socketlib `socketdata.userId`).
     *   The `sender` field inside `data` is client-controlled and is never trusted.
     */
    handle(data, senderId) {
        if (!senderId || !data || typeof data.action !== 'string') return;
        if (senderId === game.user.id) return;

        if (!Object.hasOwn(VNSocketHandler.SCHEMA, data.action)) {
            console.warn(`[VN] Unknown socket action: ${data.action}`);
            return;
        }
        const schema = VNSocketHandler.SCHEMA[data.action];

        // Permission check
        if (schema.gmOnly && !game.users.get(senderId)?.isGM) {
            console.warn(`[VN] Non-GM user tried to send: ${data.action}`);
            return;
        }

        const p = data.payload ?? {};
        if (typeof p !== 'object' || Array.isArray(p)) {
            console.warn(`[VN] Invalid payload for ${data.action}`);
            return;
        }

        // Required fields validation
        const missing = schema.required?.filter(key => !Object.hasOwn(p, key) || p[key] === undefined) ?? [];
        if (missing.length) {
            console.warn(`[VN] Missing fields for ${data.action}:`, missing);
            return;
        }

        const sceneAction = ['open', 'updateScene'].includes(data.action);
        const valid = sceneAction ? isScenePayload(p)
            : Object.entries(p).every(([key, value]) => !Object.hasOwn(ACTION_FIELDS, key) || ACTION_FIELDS[key](value));
        if (!valid) {
            console.warn(`[VN] Invalid payload types for ${data.action}`);
            return;
        }

        this._execute(data.action, p);
    }

    // ══════════════════════════════════════════════════════════
    // Action Dispatch
    // ══════════════════════════════════════════════════════════

    _execute(action, p) {
        const s = this._scene;
        switch (action) {
            case 'open':
                s.createScene(p, SCENE_SOURCE.SOCKET);
                break;
            case 'close':                s.closeScene(SCENE_SOURCE.SOCKET); break;
            case 'setSpeaker':
                if (p.active !== undefined) {
                    s._applyExplicitSpeaker(p.tokenId, p.position, p.active);
                } else {
                    s.setActiveSpeaker(p.tokenId, SCENE_SOURCE.SOCKET, p.position);
                }
                break;
            case 'updateScene':
                s.updateSceneLayout(p, SCENE_SOURCE.SOCKET);
                if (p.portraitScale != null) s.setPortraitScale(Number(p.portraitScale), SCENE_SOURCE.SOCKET);
                break;
            case 'minimize':             s.setMinimized(true, SCENE_SOURCE.SOCKET, true, true); break;
            case 'maximize':             s.setMinimized(false, SCENE_SOURCE.SOCKET, true, true); break;
            case 'flipPortrait':         s.applyFlip(p.tokenId, !!p.flip, SCENE_SOURCE.SOCKET); break;
            case 'setPortraitScale':     s.setPortraitScale(Number(p.scale), SCENE_SOURCE.SOCKET); break;
            case 'setCharacterScale':    s.setCharacterScale(p.tokenId, Number(p.scale), SCENE_SOURCE.SOCKET); break;
            case 'setExclusiveSpeaker':  s.setExclusiveSpeaker(p.tokenId, SCENE_SOURCE.SOCKET); break;
            case 'setBackgroundOverlay': s.setBackgroundOverlay(!!p.enabled, SCENE_SOURCE.SOCKET); break;
            case 'setVignette':          s.setVignette(!!p.enabled, SCENE_SOURCE.SOCKET); break;
            case 'setGroundFog':         s.setGroundFog(!!p.enabled, SCENE_SOURCE.SOCKET); break;
            case 'setParticleEffect':    s.setParticleEffect(p.particle, SCENE_SOURCE.SOCKET); break;
            case 'setVisualEffect':      s.setVisualEffect(p.visual, SCENE_SOURCE.SOCKET); break;
            case 'setParticlesLayer':    s.setParticlesLayer(p.layer, SCENE_SOURCE.SOCKET); break;
            case 'setParticleIntensity': s.setParticleIntensity(Number(p.intensity), SCENE_SOURCE.SOCKET); break;
            case 'setParticleDepth':     s.setParticleDepth(p.depth, SCENE_SOURCE.SOCKET); break;
            case 'setParticleWind':      s.setParticleWind(Number(p.wind), SCENE_SOURCE.SOCKET); break;
            case 'setVisualAngle':       s.setVisualAngle(p.angle, SCENE_SOURCE.SOCKET); break;
            case 'setVisualSettings':    s.setVisualSettings(p.visualSettings, SCENE_SOURCE.SOCKET); break;
            case 'setParticleGusts':     s.setParticleGusts(!!p.gusts, SCENE_SOURCE.SOCKET); break;
            case 'setParticleWrap':      s.setParticleWrap(p.wrap, SCENE_SOURCE.SOCKET); break;
            case 'setParticleSettings':  s.setParticleSettings(p.settings, SCENE_SOURCE.SOCKET); break;
            case 'setVisibility':        s.applyVisibility(p.tokenId, p.visibility, SCENE_SOURCE.SOCKET); break;
            case 'preload':
                s.preloadImages(p.urls.filter(isString).slice(0, 200));
                break;
            default: console.warn(`[VN] No handler for action: ${action}`);
        }
    }
}

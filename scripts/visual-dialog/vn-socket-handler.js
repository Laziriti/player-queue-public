// ============================================================
// vn-socket-handler.js — сетевой слой VN-сцены
// ============================================================

const VN_DEBUG = false;
const vnLog = VN_DEBUG ? (...args) => console.log('[VN:Socket]', ...args) : () => {};

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
        setParticleEffect:    { gmOnly: true,  required: ['particle'] },
        setVisualEffect:      { gmOnly: true,  required: ['visual'] },
        setParticlesLayer: { gmOnly: true, required: ['layer'] },
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
        vnLog('emit:', action);
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
        if (!senderId || !data || typeof data !== 'object') return;
        if (senderId === game.user.id) return;

        const schema = VNSocketHandler.SCHEMA[data.action];
        if (!schema) { console.warn(`[VN] Unknown socket action: ${data.action}`); return; }

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
        if (schema.required?.length) {
            const missing = schema.required.filter(key => p[key] === undefined);
            if (missing.length) {
                console.warn(`[VN] Missing fields for ${data.action}:`, missing);
                return;
            }
        }

        if (data.action === 'preload') {
            if (!Array.isArray(p.urls)) return;
            p.urls = p.urls.filter(u => typeof u === 'string').slice(0, 200);
        }

        vnLog('received:', data.action);
        this._execute(data.action, p);
    }

    // ══════════════════════════════════════════════════════════
    // Action Dispatch
    // ══════════════════════════════════════════════════════════

    _execute(action, p) {
        const s = this._scene;
        switch (action) {
            case 'open':
                s.createScene(p, false);
                break;
            case 'close':                s.closeScene(false); break;
            case 'setSpeaker':
                if (p.active !== undefined) {
                    s._applyExplicitSpeaker(p.tokenId, p.position, p.active);
                } else {
                    s.setActiveSpeaker(p.tokenId, false, p.position);
                }
                break;
            case 'updateScene':
                s.updateSceneLayout({
                    leftIds: p.leftIds,
                    centerIds: p.centerIds,
                    rightIds: p.rightIds,
                    presetActors: p.presetActors ?? null,
                    background: p.background,
                    backgroundOverlay: p.backgroundOverlay,
                    particleEffect: p.particleEffect ?? null,
                    visualEffect: p.visualEffect ?? null,
                    particleIntensity: p.particleIntensity ?? null,
                    particlesLayer: p.particlesLayer ?? null,
                    particlesForeground: p.particlesForeground ?? null,
                    flipped: p.flipped ?? null,
                    visibility: p.visibility ?? null,
                    charFx: p.charFx ?? null,
                    portraitImages: p.portraitImages ?? null,
                    portraitNames: p.portraitNames ?? null,
                    portraitScales: p.portraitScales ?? null,
                    soundCues: p.soundCues ?? null,
                    caption: p.caption ?? null,
                    speakers: p.speakers ?? null,
                    transition: p.transition ?? null,
                }, false);
                if (p.portraitScale != null) s.setPortraitScale(Number(p.portraitScale), false);
                break;
            case 'minimize':             s.setMinimized(true, false, true, true); break;
            case 'maximize':             s.setMinimized(false, false, true, true); break;
            case 'flipPortrait':         s.applyFlip(p.tokenId, !!p.flip); break;
            case 'setPortraitScale':     s.setPortraitScale(Number(p.scale), false); break;
            case 'setCharacterScale':    s.setCharacterScale(p.tokenId, Number(p.scale), false); break;
            case 'setExclusiveSpeaker':  s.setExclusiveSpeaker(p.tokenId, false); break;
            case 'setBackgroundOverlay': s.setBackgroundOverlay(!!p.enabled, false); break;
            case 'setParticleEffect':    s.setParticleEffect(p.particle, false); break;
            case 'setVisualEffect':      s.setVisualEffect(p.visual, false); break;
            case 'setParticlesLayer':    s.setParticlesLayer(p.layer, false); break;
            case 'setVisibility':        s.applyVisibility(p.tokenId, p.visibility, false); break;
            case 'preload':              s.preloadImages(p.urls); break;
            default: console.warn(`[VN] No handler for action: ${action}`);
        }
    }
}

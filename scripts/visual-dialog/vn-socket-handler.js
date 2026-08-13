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
        setAtmosphereEffect:  { gmOnly: true,  required: ['effect'] },
        setHidden:            { gmOnly: true,  required: ['tokenId', 'hidden'] },
        updateQueue:          { gmOnly: false },
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

    handle(data) {
        if (data.sender === game.user.id) return;

        const schema = VNSocketHandler.SCHEMA[data.action];
        if (!schema) { console.warn(`[VN] Unknown socket action: ${data.action}`); return; }

        // Permission check
        if (schema.gmOnly && !game.users.get(data.sender)?.isGM) {
            console.warn(`[VN] Non-GM user tried to send: ${data.action}`);
            return;
        }

        // Required fields validation
        const p = data.payload || {};
        if (schema.required?.length) {
            const missing = schema.required.filter(key => p[key] === undefined);
            if (missing.length) {
                console.warn(`[VN] Missing fields for ${data.action}:`, missing);
                return;
            }
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
            case 'setSpeaker':           s.setActiveSpeaker(p.tokenId, false, p.position); break;
            case 'updateQueue':          s.updateQueueDisplay(); break;
            case 'updateScene':
                s.updateSceneLayout({
                    leftIds: p.leftIds,
                    centerIds: p.centerIds,
                    rightIds: p.rightIds,
                    background: p.background,
                    backgroundOverlay: p.backgroundOverlay,
                    atmosphereEffect: p.atmosphereEffect ?? null,
                    hidden: p.hidden ?? null,
                    portraitScales: p.portraitScales ?? null,
                }, false);
                break;
            case 'minimize':             s.setMinimized(true, false, true, true); break;
            case 'maximize':             s.setMinimized(false, false, true, true); break;
            case 'flipPortrait':         s.applyFlip(p.tokenId, !!p.flip); break;
            case 'setPortraitScale':     s.setPortraitScale(Number(p.scale), false); break;
            case 'setCharacterScale':    s.setCharacterScale(p.tokenId, Number(p.scale), false); break;
            case 'setExclusiveSpeaker':  s.setExclusiveSpeaker(p.tokenId, false); break;
            case 'setBackgroundOverlay': s.setBackgroundOverlay(!!p.enabled, false); break;
            case 'setAtmosphereEffect':  s.setAtmosphereEffect(p.effect, false); break;
            case 'setHidden':            s.applyHidden(p.tokenId, !!p.hidden, false); break;
            default: console.warn(`[VN] No handler for action: ${action}`);
        }
    }
}

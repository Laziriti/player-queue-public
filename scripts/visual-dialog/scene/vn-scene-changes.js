// One policy for permissions, broadcast audience and persistence. DOM updates stay with their controllers.
import { MODULE_ID } from '../vn-constants.js';

export const SCENE_SOURCE = Object.freeze({ LOCAL: 'local', SOCKET: 'socket', RESTORE: 'restore', PREVIEW: 'preview' });

export function sceneSource(value = true) {
    if (value === true) return SCENE_SOURCE.LOCAL;
    if (value === false) return SCENE_SOURCE.PREVIEW; // legacy emit=false: apply without shared side effects
    if (Object.values(SCENE_SOURCE).includes(value)) return value;
    throw new TypeError('Unknown VN scene change source');
}

export class VNSceneChanges {
    static PUBLIC_KEY = 'activeScene';
    static PRIVATE_KEY = 'privateActiveScene';

    constructor(scene) {
        this.scene = scene;
        this._writes = Promise.resolve();
        this._pending = null;
        this._timer = null;
    }

    isLocal(source = true) { return sceneSource(source) === SCENE_SOURCE.LOCAL; }
    canApply(source = true) { return !this.isLocal(source) || !!game.user.isGM; }
    canBroadcast(source = true) { return this.isLocal(source) && !!game.user.isGM && !this.scene._gmOnly; }
    canPlayAudio(source = true) { return this.canBroadcast(source); }

    setPrivate(value, source = true) {
        const origin = sceneSource(source);
        const next = !!value && !!game.user.isGM && [SCENE_SOURCE.LOCAL, SCENE_SOURCE.RESTORE].includes(origin);
        const changed = next !== this.scene._gmOnly;
        if (changed) {
            this.flushPending(); // preserve the audience of an already scheduled snapshot
            this.scene._cancelScaleEmits?.();
        }
        this.scene._gmOnly = next;
        return changed;
    }

    emit(action, payload, source = true) {
        if (!this.canBroadcast(source)) return false;
        this.scene._socketHandler?.emit(action, payload);
        return true;
    }

    commit(action, payload, source = true, { defer = false, persist = true } = {}) {
        if (!this.isLocal(source) || !game.user.isGM) return;
        if (action) this.emit(action, payload, source);
        if (persist) return this.persist(source, { defer });
    }

    persist(source = true, { defer = false } = {}) {
        if (!this.isLocal(source) || !game.user.isGM) return Promise.resolve(false);
        const { scene } = this;
        const snapshot = scene.state.isActive ? {
            ...scene.state.toPayload(), sequence: scene._sequence.snapshot(), presetLink: scene._presetLink.snapshot(),
            ...(scene._gmOnly ? { gmOnly: true } : {}),
        } : {};
        const entry = { key: scene._gmOnly ? VNSceneChanges.PRIVATE_KEY : VNSceneChanges.PUBLIC_KEY, snapshot };
        if (defer) {
            this.cancelPending();
            this._pending = entry;
            this._timer = setTimeout(() => this.flushPending(), 400);
            return Promise.resolve(true);
        }
        this.cancelPending();
        return this._enqueue(entry);
    }

    _enqueue({ key, snapshot }) {
        // Capture data at commit time, so queued writes cannot pick up a later scene/audience.
        this._writes = this._writes.then(async () => {
            await game.settings.set(MODULE_ID, key, snapshot);
            if (key === VNSceneChanges.PUBLIC_KEY) await game.settings.set(MODULE_ID, VNSceneChanges.PRIVATE_KEY, {});
            return true;
        }).catch(error => {
            console.error('VN: Failed to persist scene:', error);
            return false;
        });
        return this._writes;
    }

    cancelPending() {
        clearTimeout(this._timer);
        this._timer = null;
        this._pending = null;
    }

    flushPending() {
        const entry = this._pending;
        this.cancelPending();
        return entry ? this._enqueue(entry) : this._writes;
    }

    whenIdle() { return this.flushPending(); }

    savedScene() {
        if (game.user.isGM) {
            const draft = game.settings.get(MODULE_ID, VNSceneChanges.PRIVATE_KEY);
            if (draft?.gmOnly) return draft;
        }
        return game.settings.get(MODULE_ID, VNSceneChanges.PUBLIC_KEY);
    }
}

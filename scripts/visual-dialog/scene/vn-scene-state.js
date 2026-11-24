// Runtime scene model, independent of preset persistence and media services.
import { SCENE_POSITIONS, SCALE_LIMITS, sceneDefaults, sceneSnapshot, readSceneSnapshot } from './vn-scene-contract.js';

export class VNSceneState {
    static POSITIONS = SCENE_POSITIONS;
    static SCALE_LIMITS = SCALE_LIMITS;
    static VISIBILITY_CYCLE = ['visible', 'hidden', 'name-hidden'];

    constructor() { this.reset(); }

    reset() {
        Object.assign(this, sceneDefaults(), { active: false, minimized: false });
    }

    get isActive() { return this.active; }

    toPayload() { return sceneSnapshot(this); }

    fromPayload(payload) {
        Object.assign(this, readSceneSnapshot(payload), { active: true });
    }

    getAllTokenIds() {
        return VNSceneState.POSITIONS.flatMap(p => this[`${p}Ids`]);
    }

    hasToken(tokenId) {
        return VNSceneState.POSITIONS.some(p => this[`${p}Ids`].includes(tokenId));
    }

    getIdsForPosition(position) {
        return this[`${position}Ids`] ?? [];
    }

    toggleSpeaker(tokenId, position) {
        if (this.speakers[position] === tokenId) {
            this.speakers[position] = null;
            return false;
        }
        this.speakers[position] = tokenId;
        return true;
    }

    hasAnyTokens() {
        return VNSceneState.POSITIONS.some(p => this[`${p}Ids`].length > 0);
    }
}


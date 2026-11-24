// Collection writes have one authority: the active GM. Callbacks stay on the caller;
// only data crosses the socket. A stale draft is rejected and recomputed, never merged blindly.
import { MODULE_ID, PRESETS_SETTING_KEY, FOLDERS_SETTING_KEY } from '../vn-constants.js';
import { isRecord } from '../../utils/validation.js';
const KEYS = new Set([PRESETS_SETTING_KEY, FOLDERS_SETTING_KEY]);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function sameData(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
        && keys.every(key => Object.hasOwn(b, key) && sameData(a[key], b[key]));
}

export class VNStore {
    static SKIP = Symbol('skip');
    static socket = null;
    static lastLocalWrite = 0;
    static _chains = new Map();
    static _hostChains = new Map();
    static _invalidators = new Map();

    static get isHost() { return game.users.activeGM?.id === game.user.id; }

    /** fn must be synchronous and free of side effects: conflicts re-run it on fresh data. */
    static mutate(key, fn) {
        if (!KEYS.has(key)) return Promise.reject(new Error('Unknown VN collection'));
        const previous = this._chains.get(key) ?? Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            if (!game.user.isGM) throw new Error('Only a GM can edit VN collections');
            let base;
            for (let attempt = 0; attempt < 16; attempt++) {
                if (!base) {
                    const response = await this._request({ key, read: true });
                    if (response.reason === 'not-host') continue;
                    if (!response.ok) throw new Error(`VN collection read failed: ${response.reason}`);
                    base = response.current;
                }
                const draft = structuredClone(base);
                const result = fn(draft);
                if (result?.then) throw new TypeError('VNStore mutation must be synchronous');
                // Even a no-op must check the host's snapshot: our local setting may be stale.
                const skipped = result === this.SKIP;
                const response = await this._request({ key, base, draft, skipped });
                if (response.ok) {
                    this._invalidators.get(key)?.();
                    return { draft, result: skipped ? null : result, skipped };
                }
                if (response.reason === 'conflict') { base = response.current; continue; }
                if (response.reason === 'not-host') { base = null; continue; }
                throw new Error(`VN collection write failed: ${response.reason}`);
            }
            throw new Error('VN collection changed repeatedly; retry the operation');
        });
        this._chains.set(key, run);
        return run;
    }

    static async _request(request) {
        const host = game.users.activeGM;
        if (!host) throw new Error('No active GM for VN collection write');
        if (!request.read) this.lastLocalWrite = Date.now();
        if (host.id === game.user.id) return this.handleRequest(request, game.user.id);
        if (!this.socket) throw new Error('VN collection socket is not ready');
        return this.socket.executeAsUser('vnStoreCommit', host.id, request);
    }

    /** senderId is supplied by socketlib, never by the request body. */
    static handleRequest(request, senderId) {
        if (!this.isHost) return Promise.resolve({ ok: false, reason: 'not-host' });
        if (!game.users.get(senderId)?.isGM) return Promise.resolve({ ok: false, reason: 'forbidden' });
        if (!isRecord(request) || !KEYS.has(request.key) || (request.read !== true
            && (!isRecord(request.base) || !isRecord(request.draft) || typeof request.skipped !== 'boolean'
                || Object.keys(request.draft).some(key => FORBIDDEN.has(key))))) {
            return Promise.resolve({ ok: false, reason: 'invalid' });
        }
        // Own the data before queueing it: a caller must not alter an enqueued request.
        const { key, base, draft, skipped, read } = structuredClone(request);
        const previous = this._hostChains.get(key) ?? Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            if (!this.isHost) return { ok: false, reason: 'not-host' };
            if (!game.users.get(senderId)?.isGM) return { ok: false, reason: 'forbidden' };
            const current = structuredClone(game.settings.get(MODULE_ID, key) || {});
            if (read) return { ok: true, current };
            if (!sameData(base, current)) return { ok: false, reason: 'conflict', current };
            if (!skipped) {
                this.lastLocalWrite = Date.now();
                await game.settings.set(MODULE_ID, key, draft);
            }
            return { ok: true };
        }).catch(error => {
            console.error('VN: Failed to commit collection:', key, error);
            return { ok: false, reason: 'error' };
        });
        this._hostChains.set(key, run);
        return run;
    }

    static changed(kind, onInvalidate) {
        this._invalidators.set(kind === 'presets' ? PRESETS_SETTING_KEY : FOLDERS_SETTING_KEY, onInvalidate);
        return (value, options, userId) => {
            onInvalidate();
            const remote = typeof userId === 'string' ? userId !== game.user.id : Date.now() - this.lastLocalWrite > 1500;
            Hooks.callAll('vnStoreChanged', { kind, remote });
        };
    }
}

// ============================================================
// vn-preload.js — background image / portrait preloading for sequences
// ============================================================

import { resolveActorImg, stripDupSuffix, FALLBACK_AVATAR } from './vn-id-utils.js';

const VIDEO_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i;
const MAX_CACHED = 80;
const CONCURRENCY = 2;

/**
 * Loads and decodes images in the background so a step switch finds them in the browser cache.
 * Runs on every client: the GM sends the ordered URL list over the socket (`preload` action).
 * It never throws and never rejects — a failed image is simply not cached.
 */
export class VNPreloader {
    static _cache = new Map();   // url -> { img, promise }
    static _queue = [];
    static _running = false;

    static isVideo(url) {
        return typeof url === 'string' && VIDEO_RE.test(url);
    }

    static isPreloadable(url) {
        return typeof url === 'string' && url && url !== 'none' && url !== FALLBACK_AVATAR && !VIDEO_RE.test(url);
    }

    /** Ordered, de-duplicated image URLs of the steps: from `fromIndex` forward, then the ones before it. */
    static stepUrls(steps, fromIndex = 0) {
        const order = [...steps.keys()];
        const rotated = [...order.slice(fromIndex), ...order.slice(0, fromIndex)];
        const urls = new Set();
        for (const i of rotated) {
            const step = steps[i];
            if (step.background) urls.add(step.background);
            for (const id of [...(step.leftIds ?? []), ...(step.centerIds ?? []), ...(step.rightIds ?? [])]) {
                // Same source the overlay renders from: the live actor first, the stored copy as a fallback
                let img = resolveActorImg(stripDupSuffix(id), step.portraitImages ?? {});
                if (img === FALLBACK_AVATAR) img = step.portraitImages?.[id];
                urls.add(img);
            }
        }
        return [...urls].filter(u => this.isPreloadable(u));
    }

    static load(url) {
        const cached = this._cache.get(url);
        if (cached) return cached.promise;

        const img = new Image();
        img.decoding = 'async';
        const promise = new Promise(resolve => {
            img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(resolve);
            img.onerror = () => { this._cache.delete(url); resolve(); };
        });
        img.src = url;
        this._cache.set(url, { img, promise });
        // Holding the element keeps the decoded bitmap warm; drop the oldest entries so a long session does not pile up
        if (this._cache.size > MAX_CACHED) this._cache.delete(this._cache.keys().next().value);
        return promise;
    }

    /** Resolves when the image is loaded, or after `timeoutMs` — whichever comes first. */
    static ready(url, timeoutMs = 1500) {
        if (!this.isPreloadable(url)) return Promise.resolve();
        return Promise.race([this.load(url), new Promise(resolve => setTimeout(resolve, timeoutMs))]);
    }

    static enqueue(urls) {
        for (const url of urls) {
            if (this.isPreloadable(url) && !this._cache.has(url) && !this._queue.includes(url)) this._queue.push(url);
        }
        this._pump();
    }

    static async _pump() {
        if (this._running) return;
        this._running = true;
        try {
            while (this._queue.length) {
                await Promise.all(this._queue.splice(0, CONCURRENCY).map(url => this.load(url)));
                await new Promise(resolve => setTimeout(resolve, 40)); // leave room for the render loop
            }
        } finally {
            this._running = false;
        }
    }
}

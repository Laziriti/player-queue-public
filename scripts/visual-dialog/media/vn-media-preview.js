// Shared image/video -> cover-cropped WebP -> Foundry upload pipeline.
import { isVideoSource, releaseVideo } from './vn-media-utils.js';
import { filePickerImplementation } from '../../utils/file-picker.js';

export class VNMediaPreview {
    static _ensuredDirs = new Set();

    static fileName(src) {
        let h = 0;
        for (let i = 0; i < src.length; i++) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
        const base = src.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
        return `${base}_${Math.abs(h).toString(36)}.webp`;
    }

    /** Captures the same frame/crop for thumbnails and icons; the timeout also covers WebP encoding. */
    static renderFile(src, { width = 240, height = 150, timeoutMs = 15000 } = {}) {
        return new Promise((resolve, reject) => {
            if (typeof src !== 'string' || !src || !Number.isInteger(width) || width < 1
                || !Number.isInteger(height) || height < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
                reject(new Error('invalid preview source, dimensions or timeout'));
                return;
            }
            const isVideo = isVideoSource(src);
            const media = document.createElement(isVideo ? 'video' : 'img');
            let canvas = null, settled = false, capturing = false, metadataReady = false;
            const listeners = [];
            const finish = (error, file) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                for (const [event, handler] of listeners) media.removeEventListener(event, handler);
                // Stop requests/decoding on success, error and timeout, including failed seeks and canvas draws.
                if (isVideo) releaseVideo(media);
                else media.removeAttribute('src');
                if (canvas) { canvas.width = 0; canvas.height = 0; }
                if (error) reject(error); else resolve(file);
            };
            const timer = setTimeout(() => finish(new Error('preview media timed out')), timeoutMs);
            const listen = (event, handler) => {
                listeners.push([event, handler]);
                media.addEventListener(event, handler);
            };
            const capture = () => {
                if (settled || capturing || (isVideo && (!metadataReady || media.seeking || media.readyState < 2))) return;
                capturing = true;
                try {
                    const w = isVideo ? media.videoWidth : media.naturalWidth;
                    const h = isVideo ? media.videoHeight : media.naturalHeight;
                    if (!w || !h) throw new Error('no preview media dimensions');
                    canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    const scale = Math.max(width / w, height / h);
                    const sw = w * scale, sh = h * scale;
                    ctx.drawImage(media, (width - sw) / 2, (height - sh) / 2, sw, sh);
                    canvas.toBlob(blob => {
                        if (settled) return;
                        try {
                            if (!blob) throw new Error('toBlob failed');
                            finish(null, new File([blob], this.fileName(src), { type: 'image/webp' }));
                        } catch (error) { finish(error); }
                    }, 'image/webp', 0.82);
                } catch (error) { finish(error); }
            };
            media.crossOrigin = 'anonymous';
            listen('error', () => finish(new Error('failed to load preview media')));
            if (isVideo) {
                media.muted = true;
                media.playsInline = true;
                media.preload = 'auto';
                listen('loadedmetadata', () => {
                    try {
                        metadataReady = true;
                        media.currentTime = Math.min(0.5, (media.duration || 1) * 0.25);
                    } catch (error) { finish(error); }
                });
                listen('seeked', capture);
                listen('loadeddata', capture); // Includes zero-time captures where no seeked event fires.
            } else listen('load', capture);
            try { media.src = src; } catch (error) { finish(error); }
        });
    }

    static async _ensureDirectory(picker, dir) {
        if (this._ensuredDirs.has(dir)) return;
        let current = '';
        for (const segment of dir.split('/').filter(Boolean)) {
            current = current ? `${current}/${segment}` : segment;
            try { await picker.createDirectory('data', current, {}); } catch { /* exists */ }
        }
        this._ensuredDirs.add(dir);
    }

    static async upload(src, { directory, width = 240, height = 150, reuse = false, timeoutMs = 15000 }) {
        const picker = filePickerImplementation();
        if (reuse) {
            try {
                const existing = await picker.browse('data', directory);
                const path = `${directory}/${this.fileName(src)}`;
                if ((existing.files || []).includes(path)) return path;
            } catch { /* directory doesn't exist yet */ }
        }
        const file = await this.renderFile(src, { width, height, timeoutMs });
        await this._ensureDirectory(picker, directory);
        const result = await picker.upload('data', directory, file, {}, { notify: false });
        if (!result?.path) throw new Error('preview upload returned no path');
        return result.path;
    }
}

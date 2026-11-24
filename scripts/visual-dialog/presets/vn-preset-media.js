// Preview generation and portrait metadata refresh; no collection persistence.
import { MODULE_ID } from '../vn-constants.js';
import { VNMediaPreview } from '../media/vn-media-preview.js';
import { parseActorId } from '../scene/vn-id-utils.js';
import { decodePath } from '../../utils/paths.js';

export class VNPresetMedia {
    static makeThumbnail(src, w = 240, h = 150) {
        return VNMediaPreview.upload(src, { directory: this.thumbnailDir(), width: w, height: h });
    }

    /** Where thumbnails are written: the `thumbnailFolder` setting (any folder in Data, e.g. inside a module) or a per-world default. */
    static thumbnailDir() {
        let custom = '';
        try { custom = String(game.settings.get(MODULE_ID, 'thumbnailFolder') || ''); } catch {}
        custom = decodePath(custom);
        custom = custom.trim().replace(/^\/+|\/+$/g, '');
        return custom || `worlds/${game.world.id}/player-queue-thumbnails`;
    }

    static makeIcon(src, size = 128) {
        return VNMediaPreview.upload(src, {
            directory: `worlds/${game.world.id}/player-queue-macro-icons`,
            width: size, height: size, reuse: true,
        });
    }

    static async regenerateEntry(p, makeThumbnail = src => this.makeThumbnail(src)) {
        let thumbnailData = null;
        if (p.background && p.background !== 'none') {
            try { thumbnailData = await makeThumbnail(p.background); } catch {}
        }

        // Refresh portrait images/names from current game state (preserves old data as fallback)
        const portraitImages = { ...(p.portraitImages || {}) };
        const portraitNames  = { ...(p.portraitNames  || {}) };
        const allIds = [...(p.leftIds || []), ...(p.centerIds || []), ...(p.rightIds || [])];
        for (const tokenId of allIds) {
            const aid = parseActorId(tokenId);
            if (aid) {
                const actor = game.actors?.get(aid);
                if (actor) {
                    portraitImages[tokenId] = actor.img || actor.prototypeToken?.texture?.src || portraitImages[tokenId] || '';
                    portraitNames[tokenId]  = actor.name;
                }
            } else {
                const token = canvas?.tokens?.get(tokenId);
                if (token) {
                    portraitImages[tokenId] = token.actor?.img || token.document?.texture?.src || portraitImages[tokenId] || '';
                    portraitNames[tokenId]  = token.name || portraitNames[tokenId] || '';
                }
            }
        }

        return { background: p.background ?? null, thumbnailData, portraitImages, portraitNames };
    }

}

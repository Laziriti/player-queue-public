// Shared media classification and video element lifecycle.
export const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const VIDEO_EXTENSIONS = Object.freeze(['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v']);

/** Ignore URL queries/fragments, except the filename hint used for extensionless blob URLs. */
export function mediaExtension(source) {
    if (typeof source !== 'string') return '';
    const path = source.startsWith('blob:') && source.includes('#')
        ? source.slice(source.indexOf('#') + 1).split('?', 1)[0]
        : source.split(/[?#]/, 1)[0];
    const file = path.split('/').pop();
    const dot = file.lastIndexOf('.');
    return dot < 0 ? '' : file.slice(dot + 1).toLowerCase();
}

export function isVideoSource(source) {
    return VIDEO_EXTENSIONS.includes(mediaExtension(source));
}

export function createBackgroundVideo(src) {
    const video = Object.assign(document.createElement('video'), {
        className: 'vn-bg-video', src, autoplay: true, loop: true, muted: true, playsInline: true,
    });
    video.setAttribute('playsinline', '');
    video.setAttribute('disablepictureinpicture', '');
    return video;
}

export function releaseVideo(video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
}

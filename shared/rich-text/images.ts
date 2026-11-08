import type { ImageNode, RichTextNode } from './types.ts';

export const BODY_IMAGE_MAX_BYTES = 1024 * 1024;
export const BODY_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const BODY_IMAGE_PREFIX = '/api/body-images/';

/** Normalize same-origin image endpoint URLs before checking ownership. External URLs stay external. */
export function managedImagePath(src: string, origin: string): string | null {
    try {
        const url = new URL(src, origin);
        if (url.origin !== origin) return null;
        const path = decodeURIComponent(url.pathname);
        return path.startsWith(BODY_IMAGE_PREFIX) ? path : null;
    } catch { return null; }
}

export function* documentImages(node: RichTextNode): Generator<ImageNode> {
    if (node.type === 'image') yield node;
    else if ('content' in node && node.content) {
        for (const child of node.content) yield* documentImages(child);
    }
}
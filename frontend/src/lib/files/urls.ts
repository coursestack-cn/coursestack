const previewUrls = new Set<string>();

function internalPath(src: string): boolean {
    return src.startsWith("/") && !src.startsWith("//") && !/[\u0000-\u0020\u007f\\]/u.test(src);
}

/** Only URLs minted through this module are trusted as this page's local previews. */
export function createPreviewUrl(file: File): string {
    const url = URL.createObjectURL(file);
    previewUrls.add(url);
    return url;
}

export function isPreviewUrl(url: string): boolean {
    return url.startsWith("blob:") && previewUrls.has(url);
}

export function revokePreviewUrl(url: string): void {
    if (previewUrls.delete(url)) URL.revokeObjectURL(url);
}

export function isInlinePreviewUrl(src: string): boolean {
    return internalPath(src) || isPreviewUrl(src);
}

/** Preserve signed URL bytes rather than applying a rich-text URL length or normalization. */
export function safeDownloadHref(href: string): string | null {
    if (internalPath(href) || isPreviewUrl(href)) return href;
    if (!/^https?:\/\/[^/]/iu.test(href) || /[\u0000-\u0020\u007f\\]/u.test(href)) return null;
    try {
        const url = new URL(href);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? href : null;
    } catch {
        return null;
    }
}

/** Upload tickets may target a same-origin endpoint or a signed HTTP(S) object URL. */
export function safeUploadUrl(url: string): boolean {
    return !url.startsWith("blob:") && safeDownloadHref(url) !== null;
}
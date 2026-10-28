const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compactUuid = /^[0-9a-f]{32}$/i;

/** Public page paths and fragments use the same UUID without separators. */
export function urlId(id: string): string {
    return uuid.test(id) || compactUuid.test(id) ? id.replaceAll("-", "").toLowerCase() : id;
}

/** Keep the API/database identity intact when reading a page URL. */
export function entityId(id: string): string {
    if (!compactUuid.test(id)) return uuid.test(id) ? id.toLowerCase() : id;
    const value = id.toLowerCase();
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function normalizeContentHash(hash: string): string {
    try {
        const match = /^#(answer|comment)-(.+)$/.exec(decodeURIComponent(hash));
        if (match && (uuid.test(match[2]!) || compactUuid.test(match[2]!))) return `#${match[1]}-${urlId(match[2]!)}`;
    } catch { /* Preserve malformed fragments for the page's unavailable state. */ }
    return hash;
}
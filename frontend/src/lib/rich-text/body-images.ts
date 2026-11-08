import { Plugin } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { api, ApiError } from "$lib/api/client";
import { BODY_IMAGE_MAX_BYTES, BODY_IMAGE_MIMES, BODY_IMAGE_PREFIX, documentImages, managedImagePath } from "../../../../shared/rich-text/images";
import type { RichTextDoc } from "./index";

type DraftImage = { source: Blob | string; snapshot?: Promise<Blob | null>; preview?: string; uploaded?: string };

async function readImage(src: string, signal: AbortSignal) {
    const response = await fetch(src, { signal, credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new ApiError(response.status, "BODY_IMAGE_UNAVAILABLE", "无法复制原图片");
    return response.blob();
}
// Other editors on the same page can copy a local image before its author publishes.
const previews = new Map<string, DraftImage>();

export function imageFileError(file: File) {
    if (file.size > BODY_IMAGE_MAX_BYTES) return "单张图片不能超过 1 MiB。";
    if (!BODY_IMAGE_MIMES.some(mime => mime === file.type)) return "请选择 PNG、JPEG、GIF 或 WebP 图片。";
    return "";
}

export class BodyImageDrafts {
    private entries = new Map<string, DraftImage>();
    private lifetime = new AbortController();
    private originals = new Set<string>();

    load(body: RichTextDoc | null) {
        this.originals.clear();
        if (body) for (const image of documentImages(body)) {
            const path = managedImagePath(image.attrs.src, location.origin);
            if (path) this.originals.add(path);
        }
    }

    private register(entry: DraftImage) {
        const key = BODY_IMAGE_PREFIX + crypto.randomUUID().replaceAll("-", "");
        this.entries.set(key, entry);
        previews.set(key, entry);
        return key;
    }

    add(file: File) {
        return this.register({ source: file });
    }

    preview(src: string) {
        const entry = previews.get(src);
        if (!entry) return src;
        if (entry.preview) return entry.preview;
        if (typeof entry.source !== "string") return entry.preview = URL.createObjectURL(entry.source);
        const source = entry.source;
        return entry.snapshot?.then(bytes => bytes && previews.has(src)
            ? entry.preview ??= URL.createObjectURL(bytes) : source) ?? source;
    }

    private copy(path: string) {
        const local = previews.get(path);
        const source = local?.source ?? path;
        // Capture a saved binary while it is still readable, even if the original is later deleted.
        const snapshot = typeof source === "string"
            ? local?.snapshot ?? readImage(source, this.lifetime.signal).catch(() => null)
            : undefined;
        return this.register({ source, snapshot });
    }

    // Preserve the mapped original on moves, including when a copy is inserted before it.
    // Pasted HTML, Markdown, and drag-and-drop all pass through the same transaction.
    ownershipPlugin() {
        return new Plugin({
            appendTransaction: (transactions, before, after) => {
                if (!transactions.some(tr => tr.docChanged)) return null;
                const positions = new Map<string, number[]>();
                after.doc.descendants((node, pos) => {
                    if (node.type.name !== "image") return;
                    const path = managedImagePath(node.attrs.src, location.origin);
                    if (!path) return;
                    const existing = positions.get(path);
                    if (existing) existing.push(pos); else positions.set(path, [pos]);
                });
                if (!positions.size) return null;
                const mapping = new Mapping();
                for (const tr of transactions) mapping.appendMapping(tr.mapping);
                const retained = new Map<string, number>();
                before.doc.descendants((node, pos) => {
                    if (node.type.name !== "image") return;
                    const path = node.attrs.src as string, mapped = mapping.map(pos);
                    if (positions.get(path)?.includes(mapped)) retained.set(path, mapped);
                });
                const tr = after.tr;
                for (const [path, occurrences] of positions) {
                    const own = this.originals.has(path) || this.entries.has(path);
                    const keep = own ? retained.get(path) ?? occurrences[0] : -1;
                    for (const pos of occurrences) {
                        const node = after.doc.nodeAt(pos)!;
                        const src = pos === keep ? path : this.copy(path);
                        if (src !== node.attrs.src) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src });
                    }
                }
                return tr.docChanged ? tr : null;
            }
        });
    }

    async prepare(body: RichTextDoc, signal: AbortSignal): Promise<RichTextDoc> {
        const ready: RichTextDoc = JSON.parse(JSON.stringify(body));
        for (const image of documentImages(ready)) {
            const entry = this.entries.get(image.attrs.src);
            if (!entry) continue;
            if (!entry.uploaded) {
                const bytes = typeof entry.source === "string"
                    ? await entry.snapshot ?? await readImage(entry.source, signal)
                    : entry.source;
                const result = await api.post<{ src: string }>("/api/body-images", undefined, {
                    rawBody: bytes, signal, headers: { "Content-Type": bytes.type }
                });
                entry.uploaded = result.src;
            }
            image.attrs.src = entry.uploaded;
        }
        return ready;
    }

    resetUploads() {
        for (const entry of this.entries.values()) entry.uploaded = undefined;
    }

    dispose() {
        this.lifetime.abort();
        for (const [key, entry] of this.entries) {
            if (entry.preview) URL.revokeObjectURL(entry.preview);
            previews.delete(key);
        }
        this.entries.clear();
    }
}
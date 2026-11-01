export const AVATAR_ACCEPT = ".png,.jpg,.jpeg,.webp";
export const AVATAR_SIZE = 512;
const uploadLimit = 2 * 1024 * 1024;

export type Crop = { x: number; y: number; size: number };
export class AvatarImageError extends Error {}

export function squareCrop(width: number, height: number, zoom: number, centerX: number, centerY: number): Crop {
    const size = Math.min(width, height) / Math.max(1, zoom);
    return { size, x: Math.max(0, Math.min(width - size, centerX * width - size / 2)),
        y: Math.max(0, Math.min(height - size, centerY * height - size / 2)) };
}

export function drawAvatar(source: HTMLCanvasElement, canvas: HTMLCanvasElement, crop: Crop): void {
    const context = canvas.getContext("2d");
    if (!context) throw new AvatarImageError("当前浏览器无法处理图片，换一个浏览器后重试。");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
}

export async function readAvatar(file: File, signal: AbortSignal): Promise<HTMLCanvasElement> {
    const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
    const expected = types[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
    if (!expected || (file.type && file.type !== "application/octet-stream" && file.type !== expected)) {
        throw new AvatarImageError("选择 PNG、JPEG 或 WebP 图片。");
    }
    if (!file.size) throw new AvatarImageError("图片为空，重新选择一张图片。");
    const image = new Image();
    const url = URL.createObjectURL(file);
    try {
        await new Promise<void>((resolve, reject) => {
            const finish = (error?: Error) => {
                image.onload = image.onerror = null;
                signal.removeEventListener("abort", abort);
                if (error) reject(error); else resolve();
            };
            const abort = () => { image.removeAttribute("src"); finish(new DOMException("Cancelled", "AbortError")); };
            image.onload = () => finish();
            image.onerror = () => finish(new AvatarImageError("无法读取这张图片，换一张 PNG、JPEG 或 WebP 图片后重试。"));
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort(); else image.src = url;
        });
        const width = image.naturalWidth, height = image.naturalHeight;
        if (!width || !height) {
            throw new AvatarImageError("无法读取图片尺寸，重新选择一张图片。");
        }
        // Use the browser's EXIF-oriented image and freeze animated inputs to the previewed frame.
        const scale = Math.min(1, 2048 / Math.max(width, height));
        const source = document.createElement("canvas");
        source.width = Math.max(1, Math.round(width * scale));
        source.height = Math.max(1, Math.round(height * scale));
        const context = source.getContext("2d");
        if (!context || typeof source.toBlob !== "function") {
            throw new AvatarImageError("当前浏览器无法处理图片，换一个浏览器后重试。");
        }
        context.drawImage(image, 0, 0, source.width, source.height);
        return source;
    } finally {
        image.removeAttribute("src");
        URL.revokeObjectURL(url);
    }
}

export async function exportAvatar(source: HTMLCanvasElement, crop: Crop): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_SIZE;
    drawAvatar(source, canvas, crop);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob || !blob.size) {
        throw new AvatarImageError("无法生成头像，重新选择图片后重试。");
    }
    if (blob.size > uploadLimit) throw new AvatarImageError("头像不能超过 2MiB。");
    return blob;
}
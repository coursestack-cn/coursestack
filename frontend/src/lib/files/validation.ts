import type { FileKind } from "./types.js";
import { formatBytes } from "./format-bytes.js";

type FileType = { kind: FileKind; label: string; mime: string; aliases?: readonly string[] };
const fileTypes: Readonly<Record<string, FileType>> = {
    pdf: { kind: "pdf", label: "PDF 文档", mime: "application/pdf" },
    png: { kind: "image", label: "PNG 图片", mime: "image/png" },
    jpg: { kind: "image", label: "JPEG 图片", mime: "image/jpeg" },
    jpeg: { kind: "image", label: "JPEG 图片", mime: "image/jpeg" },
    webp: { kind: "image", label: "WebP 图片", mime: "image/webp" },
    gif: { kind: "image", label: "GIF 图片", mime: "image/gif" },
    doc: { kind: "document", label: "Word 文档", mime: "application/msword" },
    docx: { kind: "document", label: "Word 文档", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ppt: { kind: "presentation", label: "PowerPoint 演示文稿", mime: "application/vnd.ms-powerpoint" },
    pptx: { kind: "presentation", label: "PowerPoint 演示文稿", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    xls: { kind: "spreadsheet", label: "Excel 表格", mime: "application/vnd.ms-excel" },
    xlsx: { kind: "spreadsheet", label: "Excel 表格", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    zip: { kind: "archive", label: "ZIP 压缩包", mime: "application/zip", aliases: ["application/x-zip-compressed"] },
};

export const SUPPORTED_FILE_ACCEPT = Object.keys(fileTypes).map(extension => `.${extension}`).join(",");
export const SUPPORTED_FILE_DESCRIPTION = "PDF、PNG/JPEG/WebP/GIF 图片、Word/PowerPoint/Excel 文档和 ZIP";

function extensionOf(name: string): string {
    const position = name.lastIndexOf(".");
    return position >= 0 ? name.slice(position + 1).toLowerCase() : "";
}

function normalizedMime(mime: string): string {
    return mime.split(";", 1)[0]!.trim().toLowerCase();
}

function recognizedType(name: string, mime = ""): FileType | undefined {
    const extension = extensionOf(name);
    if (!Object.hasOwn(fileTypes, extension)) return undefined;
    const type = fileTypes[extension]!;
    const value = normalizedMime(mime);
    if (!value || value === "application/octet-stream" || value === "binary/octet-stream") return type;
    return value === type.mime || type.aliases?.includes(value) ? type : undefined;
}

export function classifyFile(name: string, mime = ""): FileKind {
    return recognizedType(name, mime)?.kind ?? "other";
}

export function fileTypeLabel(name: string, mime = ""): string {
    return recognizedType(name, mime)?.label ?? "其他文件";
}

export type FileValidation =
    | { ok: true; kind: FileKind; mime: string }
    | { ok: false; code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "MIME_MISMATCH" | "INVALID_FILE_SIZE"; message: string };

export function validateFile(file: Pick<File, "name" | "size" | "type">, maxBytes: number): FileValidation {
    const guidance = `支持 ${SUPPORTED_FILE_DESCRIPTION}，单个文件不超过 ${formatBytes(maxBytes)}。`;
    if (!Number.isSafeInteger(file.size) || file.size < 0) return { ok: false, code: "INVALID_FILE_SIZE", message: `无法读取文件大小。${guidance}` };
    if (file.size === 0) return { ok: false, code: "EMPTY_FILE", message: `不能上传空文件。${guidance}` };
    if (file.size > maxBytes) return { ok: false, code: "FILE_TOO_LARGE", message: `文件超过大小上限。${guidance}` };
    if (!Object.hasOwn(fileTypes, extensionOf(file.name))) return { ok: false, code: "UNSUPPORTED_TYPE", message: `不支持此文件类型。${guidance}` };
    const type = recognizedType(file.name, file.type);
    if (!type) return { ok: false, code: "MIME_MISMATCH", message: `文件类型与扩展名不一致。${guidance}` };
    return { ok: true, kind: type.kind, mime: type.mime };
}

/** An accept filter can narrow the supported set, but cannot enable SVG or unknown formats. */
export function matchesAccept(file: Pick<File, "name" | "type">, accept = SUPPORTED_FILE_ACCEPT): boolean {
    const type = recognizedType(file.name, file.type);
    if (!type) return false;
    const choices = accept.split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
    if (choices.length === 0) return true;
    const extension = `.${extensionOf(file.name)}`;
    return choices.some(choice => {
        if (choice.startsWith(".")) return choice === extension;
        if (choice.endsWith("/*")) return type.mime.startsWith(choice.slice(0, -1));
        return choice === type.mime || type.aliases?.includes(choice) === true;
    });
}
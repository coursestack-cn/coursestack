import { z } from 'zod';
import { type Env } from '../env.ts';
import { HttpError, idSchema, tagsSchema } from '../http.ts';
import { bodySchema } from '../discussions/body.ts';

export const filenameSchema = z.string().trim().min(1).max(200)
    .refine(name => !/[\u0000-\u001f\u007f/\\]/.test(name) && name !== '.' && name !== '..', '文件名不能包含路径或控制字符');
export const materialMimes = [
    'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip',
] as const;
const file = z.object({ size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), type: z.enum(materialMimes) }).strict();
export const uploadInput = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('create'), courseId: idSchema, title: filenameSchema, body: bodySchema,
        tags: tagsSchema.nullable().default(null), file }).strict(),
    z.object({ mode: z.literal('version'), materialId: idSchema, file }).strict(),
]);
export const materialEditInput = z.object({ title: filenameSchema.optional(), body: bodySchema.optional(),
    tags: tagsSchema.nullable().optional() }).strict();
export const now = () => Math.floor(Date.now() / 1000);
export const newId = () => crypto.randomUUID().replaceAll('-', '');
export const urlId = (id: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? id.replaceAll('-', '').toLowerCase() : id;
export const materialId = (id: string) => urlId(id);
export function expandedId(id: string) {
    return /^[\da-f]{32}$/i.test(id) ? id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5').toLowerCase() : id;
}
export function versionNumber(value: string | undefined) {
    if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new HttpError(400, 'INVALID_VERSION', '版本号必须是正整数');
    }
    return Number(value);
}
export function maxBytes(env: Env) {
    const size = Number(env.MATERIAL_MAX_BYTES ?? 100 * 1024 * 1024);
    if (!Number.isSafeInteger(size) || size < 1 || size > 100 * 1024 * 1024) {
        throw new HttpError(503, 'MATERIAL_CONFIG_INVALID', '资料大小限制配置无效');
    }
    return size;
}
export function previewKind(mime: string): 'pdf' | 'image' | null {
    return mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : null;
}
export function matchesFileHeader(bytes: Uint8Array, mime: string) {
    const begins = (...values: number[]) => values.every((value, index) => bytes[index] === value);
    const text = (offset: number, value: string) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    if (mime === 'application/pdf') return text(0, '%PDF-');
    if (mime === 'image/png') return begins(137, 80, 78, 71, 13, 10, 26, 10);
    if (mime === 'image/jpeg') return begins(255, 216, 255);
    if (mime === 'image/gif') return text(0, 'GIF87a') || text(0, 'GIF89a');
    if (mime === 'image/webp') return text(0, 'RIFF') && text(8, 'WEBP');
    if (mime.includes('openxmlformats') || mime === 'application/zip') return begins(80, 75, 3, 4) || begins(80, 75, 5, 6) || begins(80, 75, 7, 8);
    return begins(208, 207, 17, 224, 161, 177, 26, 225);
}
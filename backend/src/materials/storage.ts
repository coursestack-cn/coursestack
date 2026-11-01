import { AwsClient } from 'aws4fetch';
import { type Env } from '../env.ts';
import { HttpError } from '../http.ts';
import { matchesFileHeader } from './validation.ts';

export const objectKeys = (id: string) => ({ staging: `materials/staging/${id}`, sealed: `materials/objects/${id}` });
export function requireStorage(env: Env) {
    if (env.APP_ENV === 'local') return;
    if (!env.R2_ACCOUNT_ID || !/^[a-f\d]{32}$/i.test(env.R2_ACCOUNT_ID) || !env.R2_BUCKET_NAME
        || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME)
        || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
        throw new HttpError(503, 'MATERIAL_STORAGE_UNCONFIGURED', '资料上传存储尚未配置');
    }
}
export async function uploadTicket(env: Env, origin: string, id: string, size: number, mime: string, expiresAt: number, at: number) {
    const headers = { 'Content-Type': mime };
    if (env.APP_ENV === 'local') return { uploadId: id, url: `${origin}/api/local/material-uploads/${id}/file`, headers, expiresAt };
    requireStorage(env);
    const client = new AwsClient({ service: 's3', region: 'auto', accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! });
    const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${objectKeys(id).staging}`);
    url.searchParams.set('X-Amz-Expires', String(expiresAt - at));
    // Content-Length is supplied by the browser for the raw File/Blob, not set by frontend code.
    const signed = await client.sign(url, { method: 'PUT', headers: { ...headers, 'Content-Length': String(size) }, aws: { signQuery: true, allHeaders: true } });
    return { uploadId: id, url: signed.url, headers, expiresAt };
}

// Local transport uses the same upload session and publication checks as R2 direct uploads.
// Multipart writes keep memory bounded even when a test/runtime stream has no known length.
export async function receiveFile(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>, expectedSize: number, mime: string) {
    const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
    const reader = body.getReader(), parts: R2UploadedPart[] = [];
    const capacity = 5 * 1024 * 1024;
    let buffer = new Uint8Array(Math.min(capacity, expectedSize)), used = 0, total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > expectedSize) throw new HttpError(413, 'UPLOAD_SIZE_MISMATCH', '文件大小与上传申请不一致');
            let offset = 0;
            while (offset < value.byteLength) {
                const count = Math.min(buffer.length - used, value.byteLength - offset);
                buffer.set(value.subarray(offset, offset + count), used); used += count; offset += count;
                if (used === buffer.length) {
                    parts.push(await upload.uploadPart(parts.length + 1, buffer));
                    used = 0; buffer = new Uint8Array(capacity);
                }
            }
        }
        if (total !== expectedSize) throw new HttpError(400, 'UPLOAD_SIZE_MISMATCH', '文件大小与上传申请不一致');
        if (used) parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, used)));
        await upload.complete(parts);
    } catch (error) {
        await reader.cancel().catch(() => {});
        await upload.abort().catch(() => {});
        throw error;
    } finally { reader.releaseLock(); }
}

export async function sealFile(env: Env, id: string, size: number, mime: string) {
    const keys = objectKeys(id), existing = await env.FILES.head(keys.sealed);
    if (existing) {
        if (existing.size !== size || existing.httpMetadata?.contentType !== mime || existing.customMetadata?.uploadId !== id) {
            throw new HttpError(409, 'UPLOAD_OBJECT_CONFLICT', '上传对象状态不一致');
        }
        return keys.sealed;
    }
    const head = await env.FILES.head(keys.staging);
    if (!head) throw new HttpError(409, 'UPLOAD_INCOMPLETE', '文件尚未上传完成');
    if (head.size !== size) throw new HttpError(400, 'UPLOAD_SIZE_MISMATCH', '实际文件大小与上传申请不一致');
    if (head.httpMetadata?.contentType !== mime) throw new HttpError(415, 'UPLOAD_TYPE_MISMATCH', '文件类型与上传申请不一致');
    const sample = await env.FILES.get(keys.staging, { onlyIf: { etagMatches: head.etag }, range: { offset: 0, length: Math.min(32, size) } });
    if (!sample || !('body' in sample)) throw new HttpError(409, 'UPLOAD_CHANGED', '上传文件已改变，请重试确认');
    if (!matchesFileHeader(new Uint8Array(await new Response(sample.body).arrayBuffer()), mime)) throw new HttpError(415, 'UPLOAD_TYPE_MISMATCH', '文件内容与声明类型不一致');
    const source = await env.FILES.get(keys.staging, { onlyIf: { etagMatches: head.etag } });
    if (!source || !('body' in source)) throw new HttpError(409, 'UPLOAD_CHANGED', '上传文件已改变，请重试确认');
    const stream = source.body;
    try {
        await env.FILES.put(keys.sealed, stream, { onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: mime }, customMetadata: { uploadId: id } });
    } finally { await stream.cancel().catch(() => {}); }
    const sealed = await env.FILES.head(keys.sealed);
    if (!sealed || sealed.size !== size || sealed.httpMetadata?.contentType !== mime || sealed.customMetadata?.uploadId !== id) {
        throw new HttpError(409, 'UPLOAD_OBJECT_CONFLICT', '无法确认正式文件');
    }
    return keys.sealed;
}
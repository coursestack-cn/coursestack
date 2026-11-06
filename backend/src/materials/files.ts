import { rawContent } from '../discussions/service.ts';
import { requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import { type Ctx } from '../discussions/types.ts';
import { HttpError } from '../http.ts';
import { materialContent, selectedVersion } from './service.ts';
import { materialId, previewKind, versionNumber } from './validation.ts';

function byteRange(value: string, size: number) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) return null;
    const first = match[1] ? Number(match[1]) : null, last = match[2] ? Number(match[2]) : null;
    if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
    const start = first ?? Math.max(0, size - (last ?? 0));
    const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
    if (start >= size || start > end || (first === null && last === 0)) return null;
    return { offset: start, length: end - start + 1 };
}
function disposition(name: string, inline: boolean) {
    const safe = new TextDecoder().decode(new TextEncoder().encode(name)).replace(/[\u0000-\u001f\u007f/\\]/g, '_');
    const ascii = safe.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download';
    const utf8 = encodeURIComponent(safe).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
export async function serveMaterialFile(c: Ctx, inline: boolean, review = false) {
    actor(c);
    const material = review ? await rawContent(c, materialId(c.req.param('id')!), 'material') : await materialContent(c, c.req.param('id')!);
    if (review) await requireManagement(c, material.course_id);
    if (material.status === 'deleted') throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容已删除');
    const version = await selectedVersion(c, material.id, versionNumber(c.req.param('version')));
    if (!version) throw new HttpError(404, 'FILE_VERSION_UNAVAILABLE', '文件版本不可用');
    if (inline && !previewKind(version.mime)) throw new HttpError(415, 'FILE_PREVIEW_UNSUPPORTED', '此文件不支持在线预览，请下载查看');
    const object = await c.env.FILES.head(version.storage_key);
    if (!object || object.size !== version.size) throw new HttpError(404, 'FILE_UNAVAILABLE', '文件暂不可用');
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Content-Type': version.mime,
        'Content-Disposition': disposition(material.title!, inline), 'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes', 'ETag': object.httpEtag, 'Last-Modified': object.uploaded.toUTCString(),
        'Vary': 'Cookie', 'X-Request-Id': c.get('requestId') });
    const condition = c.req.header('If-None-Match');
    if (condition?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === object.httpEtag)) {
        return new Response(null, { status: 304, headers });
    }
    const range = c.req.method === 'GET' ? c.req.header('Range') : undefined;
    const ifRange = c.req.header('If-Range');
    const useRange = range && (!ifRange || ifRange === object.httpEtag ||
        (!ifRange.startsWith('"') && !ifRange.startsWith('W/') && Math.floor(Date.parse(ifRange) / 1000) >= Math.floor(object.uploaded.getTime() / 1000)));
    const selected = useRange ? byteRange(range, object.size) : undefined;
    if (selected === null) {
        headers.set('Content-Range', `bytes */${object.size}`);
        return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Length', String(selected?.length ?? object.size));
    if (selected) headers.set('Content-Range', `bytes ${selected.offset}-${selected.offset + selected.length - 1}/${object.size}`);
    if (c.req.method === 'HEAD') return new Response(null, { headers });
    const result = await c.env.FILES.get(version.storage_key, { onlyIf: { etagMatches: object.etag }, ...(selected ? { range: selected } : {}) });
    if (!result || !('body' in result)) throw new HttpError(404, 'FILE_UNAVAILABLE', '文件暂不可用');
    return new Response(result.body, { status: selected ? 206 : 200, headers });
}
export class HttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new HttpError(415, 'JSON_REQUIRED', '请求必须使用 JSON');
    }
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'INVALID_INPUT', '请求体不能为空');
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8192) {
            await reader.cancel();
            throw new HttpError(413, 'BODY_TOO_LARGE', '请求体过大');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try {
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        return body;
    } catch {
        throw new HttpError(400, 'INVALID_INPUT', '请求体必须是有效 JSON 对象');
    }
}

export function requireSameOrigin(request: Request) {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
        throw new HttpError(403, 'ORIGIN_DENIED', '请求来源不被允许');
    }
}

export function stringField(body: Record<string, unknown>, name: string, max = 80): string {
    const value = body[name];
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new HttpError(400, 'INVALID_INPUT', `${name} 格式不正确`);
    }
    return value.trim();
}
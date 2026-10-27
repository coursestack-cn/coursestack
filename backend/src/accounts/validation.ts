import { HttpError } from '../http.ts';

export function allowFields(body: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(body).some(key => !allowed.includes(key))) {
        throw new HttpError(400, 'UNKNOWN_FIELD', '请求包含不允许修改的字段');
    }
}

export function optionalProfileField(value: unknown, label: string, max = 120): string | null {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > max) {
        throw new HttpError(400, 'INVALID_PROFILE_FIELD', `${label}必须是最多 ${max} 字的文本`);
    }
    return value.trim() || null;
}

export function pagination(url: URL) {
    const number = (key: string, fallback: number, max: number) => {
        const raw = url.searchParams.get(key);
        if (raw === null) return fallback;
        if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > max) throw new HttpError(400, 'INVALID_PAGINATION', '分页参数不正确');
        return Number(raw);
    };
    const page = number('page', 1, 100000), pageSize = number('pageSize', 20, 100);
    return { page, pageSize, offset: (page - 1) * pageSize };
}

export function conflict(error: unknown): never {
    const messages: string[] = [];
    for (let cause: unknown = error, depth = 0; cause instanceof Error && depth < 5; depth++, cause = cause.cause) messages.push(cause.message);
    if (/UNIQUE constraint failed.*accounts.school_number/.test(messages.join(' '))) {
        throw new HttpError(409, 'SCHOOL_NUMBER_EXISTS', '该学工号已存在');
    }
    throw error;
}
import { HttpError } from '../http.ts';

export function allowFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, 'UNKNOWN_FIELD', '请求包含不允许修改的字段');
  }
}

export function revisionField(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new HttpError(400, 'INVALID_REVISION', '需要有效的 revision');
  return value as number;
}

export function emailField(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_EMAIL', '邮箱格式不正确');
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)) {
    throw new HttpError(400, 'INVALID_EMAIL', '邮箱格式不正确');
  }
  return normalized;
}

export function pagination(url: URL) {
  const number = (key: string, fallback: number, max: number) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > max) throw new HttpError(400, 'INVALID_PAGINATION', '分页参数不正确');
    return Number(raw);
  };
  const page = number('page', 1, 100000);
  const pageSize = number('pageSize', 20, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function conflict(error: unknown): never {
  if (error instanceof Error && /UNIQUE constraint failed.*(?:credentials.school_number|student_records.student_number)/.test(error.message)) {
    throw new HttpError(409, 'SCHOOL_NUMBER_EXISTS', '该学工号已存在');
  }
  if (error instanceof Error && /UNIQUE constraint failed.*account_private.email/.test(error.message)) {
    throw new HttpError(409, 'EMAIL_EXISTS', '该邮箱已被使用');
  }
  if (error instanceof Error && /FOREIGN KEY constraint/.test(error.message)) {
    throw new HttpError(409, 'RELATED_RECORDS_EXIST', '账号存在关联记录，不能变更身份');
  }
  throw error;
}
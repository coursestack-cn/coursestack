import { compare, hash, truncates } from 'bcryptjs';
import { HttpError } from '../http.ts';

export function passwordField(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || truncates(value)) {
        throw new HttpError(400, 'INVALID_PASSWORD', '密码不能为空，UTF-8 编码不超过 72 字节');
    }
    return value;
}

// Only passwords chosen by the user have a minimum length. Login and trusted
// provisioning must also accept existing short passwords.
export function newPasswordField(value: unknown): string {
    const password = passwordField(value);
    if (Array.from(password).length < 8) {
        throw new HttpError(400, 'INVALID_PASSWORD', '新密码至少 8 个字符，UTF-8 编码不超过 72 字节');
    }
    return password;
}

export const hashPassword = (password: string) => hash(passwordField(password), 12);
export const verifyPassword = (password: string, passwordHash: string) => compare(password, passwordHash);

export function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function digest(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
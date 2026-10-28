import { HttpError } from '../http.ts';

// Workers rejects PBKDF2 above 100000 iterations, and the free plan allows
// 10 ms of CPU per request, so the count stays well below both.
const PBKDF2_ITERATIONS = 30_000;
const PBKDF2_MAX_ITERATIONS = 100_000;
const PASSWORD_HASH = /^pbkdf2-sha256\$([1-9]\d{0,5})\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=)$/;
const encoder = new TextEncoder();

export function passwordField(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || encoder.encode(value).length > 72) {
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

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await pbkdf2(passwordField(password), salt, PBKDF2_ITERATIONS);
    return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

// A missing or unreadable hash still runs one derivation, so an unknown
// account takes as long to reject as a wrong password.
export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
    const match = PASSWORD_HASH.exec(passwordHash ?? '');
    const usable = match !== null && Number(match[1]) <= PBKDF2_MAX_ITERATIONS;
    const derived = await pbkdf2(password, usable ? fromBase64(match[2]) : new Uint8Array(16),
        usable ? Number(match[1]) : PBKDF2_ITERATIONS);
    if (!usable) return false;
    const expected = fromBase64(match[3]);
    let difference = 0;
    for (let i = 0; i < derived.length; i++) difference |= derived[i] ^ expected[i];
    return difference === 0;
}

export function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function digest(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
import type { Definition } from '../openapi.ts';

type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
    ({ type: 'object', properties, required, additionalProperties: false });
const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const nullableText = (maxLength: number) => ({ type: ['string', 'null'], maxLength });
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const query = (name: string, schema: Schema) => ({ name, in: 'query', required: false, schema });
const id = { type: 'string' }, bool = { type: 'boolean' }, integer = { type: 'integer' };
const memberRole = enumeration('student', 'teacher'), role = enumeration('admin', 'student', 'teacher');
const status = enumeration('active', 'disabled'), schoolNumber = { type: 'string', minLength: 1, maxLength: 64 };
const password = { type: 'string', minLength: 1, maxLength: 64, format: 'password', writeOnly: true };
const existingPassword = { ...password, maxLength: 72, description: '最多64个字符，兼容旧密码的72字节上限' };
const profile = { nickname: nullableText(80), name: nullableText(80), department: nullableText(120), major: nullableText(120), grade: nullableText(40) };
const avatarUrl = { type: ['string', 'null'] }, avatarMimes = ['image/png', 'image/jpeg', 'image/webp'];
const account = { id, ...profile, role, status, schoolNumber: nullableText(64), avatarUrl, mustChangePassword: bool,
    createdAt: integer, lastLoginAt: { type: ['integer', 'null'] } };
const details = ref('AccountDetail'), session = ref('SessionProfile');

export const accountSchemas = {
    SessionProfile: object({ id, nickname: profile.nickname, role, mustChangePassword: bool }),
    AccountDetail: object(account),
    AccountPage: object({ items: { type: 'array', items: details }, page: integer, pageSize: integer, total: integer }),
    UpdatedAccount: object({ ...account, previousId: id }, Object.keys(account)),
    ResetAccount: object({ ...account, generatedPassword: { type: 'string', readOnly: true } }, Object.keys(account)),
    PublicProfile: object({ id, nickname: profile.nickname, avatarUrl, isDeleted: bool }),
};

export const accountDefinitions: Definition[] = [
    { method: 'post', path: '/auth/login', summary: '师生使用学工号和密码登录', request: { ...object({ schoolNumber, password: existingPassword }), additionalProperties: true },
        response: session, sessionCookie: 'set', rateLimited: true },
    { method: 'post', path: '/auth/admin/login', summary: '管理员使用密码登录', request: { ...object({ password: existingPassword }), additionalProperties: true },
        response: session, sessionCookie: 'set', rateLimited: true },
    { method: 'post', path: '/auth/logout', summary: '退出当前会话，可重复调用', response: object({ loggedOut: { const: true } }), sessionCookie: 'clear' },
    { method: 'get', path: '/auth/me', summary: '读取当前会话身份，首次改密前也可使用', auth: 'session', response: session },
    { method: 'post', path: '/auth/password', summary: '核对原密码并修改本人密码，撤销全部会话', auth: 'session',
        request: object({ oldPassword: existingPassword, newPassword: { ...password, minLength: 8 } }),
        response: object({ passwordChanged: { const: true } }), sessionCookie: 'clear', rateLimited: true },
    { method: 'get', path: '/admin/accounts', summary: '管理员分页查询账号，可按身份、状态及个人资料筛选', auth: 'session',
        parameters: [query('page', { ...integer, minimum: 1, maximum: 100000, default: 1 }), query('pageSize', { ...integer, minimum: 1, maximum: 100, default: 20 }),
            query('role', role), query('status', status), query('q', { type: 'string', maxLength: 100 })], response: ref('AccountPage') },
    { method: 'post', path: '/admin/accounts', summary: '管理员创建师生账号，提供幂等键可安全重试', auth: 'session', create: true, idempotencyKeyRequired: false,
        request: object({ role: memberRole, schoolNumber, password, ...profile, mustChangePassword: bool }, ['role', 'schoolNumber', 'password']), response: details },
    { method: 'get', path: '/admin/accounts/{id}', summary: '管理员读取未删除账号的完整资料', auth: 'session', response: details },
    { method: 'patch', path: '/admin/accounts/{id}', summary: '管理员修改账号资料，切换师生身份时返回新身份及 previousId', auth: 'session',
        request: { ...object({ role: memberRole, schoolNumber, status, ...profile }, []), minProperties: 1 }, response: ref('UpdatedAccount') },
    { method: 'delete', path: '/admin/accounts/{id}', summary: '管理员删除师生账号并撤销会话', auth: 'session', response: object({ id, deleted: { const: true } }) },
    { method: 'post', path: '/admin/accounts/{id}/password', summary: '管理员重置师生密码，省略或留空时返回生成的临时密码', auth: 'session',
        request: object({ newPassword: { ...password, minLength: 0 }, mustChangePassword: bool }, []), response: ref('ResetAccount') },
    { method: 'get', path: '/me/profile', summary: '读取本人完整资料', auth: 'session', response: details },
    { method: 'patch', path: '/me/profile', summary: '修改或清空本人昵称', auth: 'session', request: object({ nickname: profile.nickname }), response: details },
    { method: 'put', path: '/me/avatar', summary: '上传最多2 MiB的原始图片并替换本人头像', auth: 'session',
        requestMimes: avatarMimes, request: { type: 'string', format: 'binary' }, response: details },
    { method: 'delete', path: '/me/avatar', summary: '清除本人头像', auth: 'session', response: details },
    { method: 'get', path: '/profiles/{id}', summary: '读取公开资料，已删除账号显示占位身份', response: ref('PublicProfile') },
    { method: 'get', path: '/profiles/{id}/avatar', summary: '读取有效账号的头像文件', responseMimes: avatarMimes },
];
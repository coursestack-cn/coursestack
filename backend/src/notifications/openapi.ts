import { type Definition } from '../openapi.ts';
type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positiveId = { ...integer, minimum: 1 };
const text = { type: 'string' }, nullableText = { type: ['string', 'null'] };
const nullableInteger = { type: ['integer', 'null'] }, bool = { type: 'boolean' };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const q = (name: string, schema: Schema, required = false) => ({ name, in: 'query', schema, required });
export const notificationDefinitions: Definition[] = [
    { method: 'get', path: '/notifications', summary: '本人通知，默认未读，按ID倒序游标加载，每批最多20条', auth: 'session', response: ref('NotificationPage'),
        parameters: [q('status', { type: 'string', enum: ['unread', 'read', 'all'], default: 'unread' }), q('beforeId', positiveId), q('pageSize', { type: 'integer', minimum: 1, maximum: 20, default: 20 })] },
    { method: 'get', path: '/notifications/count', summary: '只返回本人未读总数与账号标识', auth: 'session', response: object({ viewer: text, unreadCount: integer }) },
    { method: 'get', path: '/notifications/state', summary: '按ID检查本人已加载通知的阅读状态及当前可见性，每批最多20条', auth: 'session',
        parameters: [q('ids', { type: 'string', pattern: '^[1-9]\\d*(,[1-9]\\d*){0,19}$' }, true)], response: object({ viewer: text, items: { type: 'array', items: ref('Notification') } }) },
    { method: 'put', path: '/notifications/read', summary: '按固定通知ID上限将本人通知全部标为已读；不影响其后到达的新通知', auth: 'session',
        request: object({ throughId: positiveId }), response: object({ throughId: positiveId, changed: integer, unreadCount: integer }) },
    { method: 'put', path: '/notifications/{id}/read', summary: '本人单条通知标记已读；幂等保留首次阅读时间', auth: 'session',
        response: object({ id: positiveId, read: { const: true }, readAt: integer, unreadCount: integer }) },
];
export const notificationSchemas = {
    Notification: object({ id: positiveId, type: { type: 'string', enum: ['answer', 'comment', 'reply', 'accepted', 'unaccepted', 'moderation', 'bonus', 'favorite'] },
        contentId: nullableText, kind: { type: ['string', 'null'], enum: ['question', 'answer', 'comment', 'material', null] },
        title: nullableText, eventType: nullableText, newAnswerId: nullableText, oldAnswerId: nullableText, courseId: text, courseName: text, createdAt: integer, readAt: nullableInteger,
        available: bool, isPublic: bool, status: nullableText, contentStatus: nullableText, version: nullableInteger,
        reason: text, deltaPoints: nullableInteger, href: nullableText }),
    NotificationPage: object({ viewer: text, items: { type: 'array', maxItems: 20, items: ref('Notification') }, unreadCount: integer,
        nextCursor: nullableInteger, hasMore: bool, readThroughId: nullableInteger }),
};
import { type Definition } from '../openapi.ts';
type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' }, integer: Schema = { type: 'integer' }, bool: Schema = { type: 'boolean' };
const positive: Schema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] });
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: Schema): Schema => ({ type: 'array', items });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const query = (name: string, schema: Schema, required = false) => ({ name, in: 'query', required, schema });
const targetType: Schema = { type: 'string', enum: ['course', 'material', 'question'] };
const pageFields = { page: positive, pageSize: positive, total: { type: 'integer', minimum: 0 } };
const pagination = [query('page', { ...positive, maximum: 10000, default: 1 }), query('pageSize', { ...positive, maximum: 50, default: 20 })];
const status = object({ type: targetType, id: string, favorited: bool, createdAt: nullable(integer) });
export const favoriteSchemas = {
    FavoriteStatus: status,
    FavoritePage: object({ viewer: string, ...pageFields,
        items: array(object({ favoriteId: positive, type: targetType, targetId: string, createdAt: integer,
            available: bool, title: nullable(string), description: nullable(string), courseId: string, courseName: string })),
        counts: object({ all: integer, course: integer, material: integer, question: integer }),
        courses: array(object({ id: string, name: string })) }),
    CourseFeed: object({ viewer: string, ...pageFields, items: array(object({ id: positive,
        type: { type: 'string', enum: ['question_created', 'material_created', 'material_version'] },
        contentId: string, kind: { type: 'string', enum: ['question', 'material'] }, title: string,
        version: nullable(positive), createdAt: integer, courseId: string, courseName: string })) }),
};
export const favoriteDefinitions: Definition[] = [
    { method: 'get', path: '/me/favorites', auth: 'session', summary: '本人统一收藏，按收藏时间倒序；失效内容保留无标题占位', response: ref('FavoritePage'),
        parameters: [...pagination, query('type', { type: 'string', enum: ['all','course','material','question'], default: 'all' }), query('courseId', ref('CourseId'))] },
    { method: 'get', path: '/me/favorites/status', auth: 'session', summary: '批量查询本人收藏状态，每次1至50个对象',
        parameters: [query('targets', { type: 'string', maxLength: 12000, description: 'JSON数组：[{"type":"course|material|question","id":"目标ID"}]；内容使用API ID，课程号保持原值' }, true)],
        response: object({ viewer: string, items: array(status) }) },
    { method: 'put', path: '/me/favorites/{type}/{targetId}', auth: 'session', summary: '幂等收藏公开对象，重复请求不改变收藏时间', response: status },
    { method: 'delete', path: '/me/favorites/{type}/{targetId}', auth: 'session', summary: '幂等取消本人收藏，包括已下架或删除的对象；不撤回既有通知', response: status },
    { method: 'get', path: '/me/feed', auth: 'session', summary: '本学期修读/授课与收藏课程的发布动态，按课程去重，读取时过滤不可公开内容', parameters: pagination, response: ref('CourseFeed') },
];
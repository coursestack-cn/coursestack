import type { Definition } from '../openapi.ts';
type Schema = Record<string, unknown>;
const text: Schema = { type: 'string' };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const kind = enumeration('course', 'material', 'question', 'answer');
const type = enumeration('all', 'course', 'material', 'question', 'answer');
const sort = enumeration('relevance', 'updated');
const count: Schema = { type: 'integer', minimum: 0 };
const ranges: Schema = { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2, items: count },
    description: '原字符串的 UTF-16 起止偏移，右端不含；按起点排列且不重叠，安全渲染文本和 mark，不包含 HTML' };
const item = object({ id: text, kind, title: text, excerpt: { type: 'string', maxLength: 162 },
    course: object({ id: { $ref: '#/components/schemas/CourseId' }, name: text }),
    tags: { type: 'array', items: text }, questionId: nullable(text), updatedAt: count,
    author: nullable(object({ id: nullable(text), nickname: nullable(text), isTeacher: { type: 'boolean' }, isDeleted: { type: 'boolean' }, avatarUrl: nullable(text) })),
    highlights: object({ title: ranges, excerpt: ranges }) });
const page: Schema = { type: 'integer', minimum: 1, maximum: 10000, default: 1 };
const pageSize: Schema = { type: 'integer', minimum: 1, maximum: 50, default: 20 };
export const searchSchemas = { SearchItem: item, SearchPage: object({
    items: { type: 'array', items: { $ref: '#/components/schemas/SearchItem' } }, total: count, page, pageSize, q: text, type, sort,
}) };
export const searchDefinitions: Definition[] = [{
    method: 'get', path: '/search', summary: '公开全站搜索：空白分隔关键词取交集，ASCII 不区分大小写，支持中文短词；空 q 返回空列表',
    response: { $ref: '#/components/schemas/SearchPage' },
    parameters: Object.entries({
        q: { type: 'string', maxLength: 100, description: '去首尾空白，最多8个空白分隔词；按连续子串匹配，%和_为普通字符' },
        type: { ...type, default: 'all' }, course: { $ref: '#/components/schemas/CourseId' },
        tag: { type: 'string', maxLength: 30, description: '标签子串；回答继承问题标签，课程类型不支持标签' },
        sort: { ...sort, default: 'relevance' }, page, pageSize,
    }).map(([name, schema]) => ({ name, in: 'query', schema })),
}];
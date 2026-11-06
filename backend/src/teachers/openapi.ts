import type { Definition } from '../openapi.ts';

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const text: Schema = { type: 'string' }, bool: Schema = { type: 'boolean' }, count: Schema = { type: 'integer', minimum: 0 };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const kinds = enumeration('course', 'material', 'question', 'answer', 'comment');
const page = (items: Schema): Schema => object({ kind: kinds, items: { type: 'array', items }, total: count,
    page: { type: 'integer', minimum: 1, maximum: 10000 }, pageSize: { type: 'integer', minimum: 1, maximum: 50 } });

export const teacherSchemas = {
    TeacherProfile: object({ id: text, nickname: nullable(text), avatarUrl: nullable(text), isTeacher: { const: true }, isDeleted: { const: false } }),
    TeacherCounts: object({ courses: count, materials: count, questions: count, answers: count, comments: count }),
    TeacherCourse: object({ kind: { const: 'course' }, id: ref('CourseId'), name: text, introduction: text,
        terms: { type: 'array', items: ref('Term') } }),
    TeacherContent: { allOf: [ref('Content'), { type: 'object', properties: {
        courseName: text, root: object({ id: text, kind: enumeration('question', 'material'), title: text }),
        quote: nullable(object({ kind: enumeration('answer', 'comment'), available: bool,
            author: nullable(object({ nickname: nullable(text), isDeleted: bool })), excerpt: nullable({ type: 'string', maxLength: 161 }) })),
    }, required: ['courseName', 'root', 'quote'] }] },
    TeacherActivityPage: page({ oneOf: [ref('TeacherCourse'), ref('TeacherContent')] }),
};
export const teacherDefinitions: Definition[] = [
    { method: 'get', path: '/teachers/{id}', summary: '公开教师头像、昵称和教师标识；非正常教师账号返回404', response: ref('TeacherProfile') },
    { method: 'get', path: '/teachers/{id}/counts', summary: '公开教师五类数量；授课课程去重，内容只统计当前公开项', response: ref('TeacherCounts') },
    { method: 'get', path: '/teachers/{id}/activity', summary: '教师主页分页；课程按当期优先并去重，内容按发布时间倒序，批量提供公开上下文', response: ref('TeacherActivityPage'),
        parameters: [
            { name: 'kind', in: 'query', schema: { ...kinds, default: 'course' } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        ] },
];
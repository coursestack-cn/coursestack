import { type Definition } from '../openapi.ts';
import { materialMimes } from './validation.ts';

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const str = (maxLength = 100): Schema => ({ type: 'string', minLength: 1, maxLength });
const id = str(), integer: Schema = { type: 'integer' }, bool: Schema = { type: 'boolean' };
const positive: Schema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const query = (name: string, schema: Schema = str()) => ({ name, in: 'query', required: false, schema });
const pagination = [query('page', { ...positive, maximum: 10000, default: 1 }), query('pageSize', { ...positive, maximum: 50, default: 20 })];
const paged = (item: Schema): Schema => object({ items: { type: 'array', items: item }, page: positive, pageSize: positive, total: { type: 'integer', minimum: 0 } });
const filename: Schema = { ...str(200), description: '资料级统一文件名，也是标题；禁止路径分隔符和控制字符，各版本共用' };
const metadata = { title: filename, body: ref('ProseMirrorDocument'), tags: nullable({ type: 'array', maxItems: 8, items: str(30) }) };
const file = object({ size: positive, type: enumeration(...materialMimes) });
const version = object({ version: positive, size: positive, mime: enumeration(...materialMimes),
    uploadedBy: id, createdAt: integer, previewKind: nullable(enumeration('pdf', 'image')),
    previewUrl: nullable(str(300)), downloadUrl: str(300) });
const result = object({ materialId: id, version: positive });
const state = object({ uploadId: id, status: enumeration('pending', 'confirming', 'published', 'cancelled', 'expired'), expiresAt: integer, result: nullable(result) });
const versionPage = paged(ref('FileVersion'));
export const materialSchemas = {
    CourseAuthor: object({ id, nickname: nullable({ type: 'string', maxLength: 80 }), avatarUrl: nullable(str(300)), isDeleted: bool, isTeacher: bool, isCourseTeacher: bool,
        shortId: { ...nullable(str()), description: '重名、未设置昵称或已删除账号的公开区分标识；短前缀冲突时使用完整账号ID' } }),
    CourseAuthorPage: paged(ref('CourseAuthor')),
    FileVersion: version,
    MaterialUploadResult: result,
    MaterialUploadStatus: state,
    MaterialUploadTicket: object({ uploadId: id, status: { const: 'pending' }, url: { type: 'string', format: 'uri' },
        headers: { type: 'object', additionalProperties: { type: 'string' } }, expiresAt: integer }),
    MaterialVersionPage: versionPage,
    MaterialDetail: { allOf: [ref('Content'), { type: 'object', properties: { kind: { const: 'material' },
        latestVersion: nullable(ref('FileVersion')), selectedVersion: nullable(ref('FileVersion')), versions: versionPage,
        permissions: object({ canEdit: bool, canUploadVersion: bool, canDeleteVersion: bool, canManage: bool, requiresLoginForFile: bool }) },
        required: ['latestVersion', 'selectedVersion', 'versions', 'permissions'] }] },
    CourseContentPage: paged({ allOf: [ref('Content'), { type: 'object', properties: { kind: enumeration('question', 'material'), latestVersion: nullable(ref('FileVersion')) },
        if: { properties: { kind: { const: 'material' } } }, then: { required: ['latestVersion'] } }] }),
};
export const materialDefinitions: Definition[] = [
    { method: 'get', path: '/courses/{id}/content-authors', summary: '该课程全部学期公开问题和资料的发布人，按最近发布及账号ID排序；不包含仅回答或评论的参与者',
        response: ref('CourseAuthorPage'), parameters: [...pagination, query('authorId', { ...id, pattern: '^[a-zA-Z0-9_-]+$', description: '精确回显所选发布人；无公开内容时返回空列表' }),
            query('q', { type: 'string', maxLength: 80, description: '去首尾空白后匹配公开昵称连续子串，ASCII忽略大小写，%和_按普通字符；已删除账号不匹配原昵称' })] },
    { method: 'get', path: '/courses/{id}/contents', summary: '资料与问题统一分页、标题与标签关键词、发布学期及发布人筛选；state 和 score 排序仅限 kind=question', response: ref('CourseContentPage'),
        parameters: [...pagination, query('authorId', { ...id, pattern: '^[a-zA-Z0-9_-]+$', description: '发布人账号ID，与其他条件取交集；省略为全部' }), query('termId', { ...id, pattern: '^[a-zA-Z0-9_-]+$' }), query('kind', enumeration('all', 'question', 'material')), query('title', { type: 'string', maxLength: 200, description: '去首尾空白后匹配标题中的连续子串，ASCII 英文字母忽略大小写，% 和 _ 按普通字符匹配；空值不筛选，与标签等条件取交集' }), query('tag', { type: 'string', maxLength: 30, description: '去首尾空白后匹配任意一个标签中的连续子串，ASCII 英文字母忽略大小写，% 和 _ 按普通字符匹配；空值不筛选，与标题等条件取交集' }), query('state', enumeration('all', 'unresolved', 'solved')), query('sort', enumeration('active', 'newest', 'score'))] },
    { method: 'get', path: '/materials/policy', summary: '单文件上传限制和登录要求', response: object({ maxBytes: positive, mimeTypes: { type: 'array', items: enumeration(...materialMimes) },
        filesPerVersion: { const: 1 }, fileAccessRequiresLogin: { const: true }, uploadUrlLifetimeSeconds: { const: 600 }, uploadLifetimeSeconds: { const: 86400 } }) },
    { method: 'get', path: '/materials/{id}', summary: '资料介绍、默认或指定版本、前50个现存版本；游客仅能读取元数据', parameters: [query('version', positive)], response: ref('MaterialDetail') },
    { method: 'patch', path: '/materials/{id}', summary: '编辑统一文件名、富文本介绍与标签；不改变版本文件', auth: 'session', request: object(metadata, []), response: ref('MaterialDetail') },
    { method: 'get', path: '/materials/{id}/versions', summary: '现存版本分页，版本号降序', parameters: pagination, response: ref('MaterialVersionPage') },
    { method: 'get', path: '/materials/{id}/versions/{version}', summary: '指定现存版本与资料级统一文件名', response: object({ materialId: id, title: filename, ...(version.properties as Record<string, Schema>) }) },
    ...['preview', 'download'].flatMap(action => ['get', 'head'].map(method => ({ method, path: `/materials/{id}/versions/{version}/${action}`,
        summary: action === 'preview' ? '登录后读取 PDF/图片；不支持预览的类型返回415' : '登录后下载指定版本，文件名来自资料标题', auth: 'session' as const, binary: true,
        parameters: [{ name: 'Range', in: 'header', required: false, schema: { type: 'string', description: 'GET 支持单一字节区间；无效范围返回416' } },
            ...['If-Range', 'If-None-Match'].map(name => ({ name, in: 'header', required: false, schema: { type: 'string' } }))] }))),
    { method: 'post', path: '/material-uploads', summary: '本学期修读或任教者及管理员可申请上传新资料，已有资料的作者可跨学期上传新版本。幂等重试可刷新票据或返回已发布结果', auth: 'session', create: true,
        request: { oneOf: [object({ mode: { const: 'create' }, courseId: ref('CourseId'), ...metadata, file }, ['mode', 'courseId', 'title', 'body', 'file']),
            object({ mode: { const: 'version' }, materialId: id, file }, ['mode', 'materialId', 'file'])] },
        response: { oneOf: [ref('MaterialUploadTicket'), { allOf: [ref('MaterialUploadStatus'), { type: 'object', properties: { status: { const: 'published' }, result } }] }] } },
    { method: 'get', path: '/material-uploads/{id}', summary: '上传者查询处理状态与发布结果', auth: 'session', response: ref('MaterialUploadStatus') },
    { method: 'delete', path: '/material-uploads/{id}', summary: '取消未发布上传；正在确认时返回409，已发布后不能通过上传接口删除资料', auth: 'session', response: ref('MaterialUploadStatus') },
    { method: 'post', path: '/material-uploads/{id}/confirm', summary: '核验、封存并发布文件；相同上传重复确认返回同一个版本，不重复计分', auth: 'session', response: ref('MaterialUploadResult') },
    ...['preview', 'download'].flatMap(action => ['get', 'head'].map(method => ({ method, path: `/moderation/materials/{id}/versions/{version}/${action}`,
        summary: '仅当前课程教师或管理员审查文件，包括下架资料；权限先于 Range 和条件响应检查', auth: 'session' as const, binary: true }))),
    { method: 'get', path: '/moderation/materials/{id}/versions', summary: '当前课程教师或管理员查询资料的现存版本，包括整体下架的资料', auth: 'session', parameters: pagination, response: ref('MaterialVersionPage') },
    { method: 'delete', path: '/materials/{id}/versions/{version}', summary: '所有者或管理者删除版本；管理者删除他人版本可选填reason。最后一个版本一律返回409，应改为删除整份资料；撤回对应奖励且版本号不复用', auth: 'session',
        requestRequired: false, request: object({ reason: { type: 'string', maxLength: 1000 } }, []),
        response: object({ materialId: id, version: positive, deleted: { const: true } }) },
];
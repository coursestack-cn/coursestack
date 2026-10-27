type Schema = Record<string, unknown>;
const str = (maxLength = 100): Schema => ({ type: 'string', minLength: 1, maxLength });
const id: Schema = { ...str(), pattern: '^[a-zA-Z0-9_-]+$' };
const revision: Schema = { type: 'integer', minimum: 1 };
const points: Schema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const signedPoints: Schema = { type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, not: { const: 0 } };
const nickname: Schema = { type: ['string', 'null'], maxLength: 80 };
const bonusPolicy = { questionPoints: points, answerPoints: points, acceptancePoints: points, commentPoints: points, materialPoints: points, materialPerVersion: { type: 'boolean' } };
const body: Schema = { $ref: '#/components/schemas/ProseMirrorDocument' };
const nullableBody: Schema = { anyOf: [body, { type: 'null' }] };
const tags: Schema = { type: ['array', 'null'], maxItems: 8, items: str(30), description: '仅问题和资料允许标签；回答和评论为 null' };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const courseFields = { name: str(120), code: str(40), department: { type: 'string', maxLength: 120 }, introduction: { type: 'string', maxLength: 5000 } };
const qFields = { title: str(200), body, tags };
const q = (name: string, schema: Schema = { type: 'string' }, required = false) => ({ name, in: 'query', required, schema });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const pagination = [q('page', { type: 'integer', minimum: 1, maximum: 10000, default: 1 }),
    q('pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 20 })];
type Definition = { method: string; path: string; summary: string; auth?: 'optional' | 'session' | 'internal';
    request?: Schema; create?: boolean; parameters?: unknown[]; response?: Schema };
const defs: Definition[] = [
    { method: 'get', path: '/courses', summary: '课程列表', parameters: [...pagination, q('q')], response: ref('CoursePage') },
    { method: 'post', path: '/courses', summary: '创建当前学期课程：教师任教，管理员须指定 teacherId', auth: 'session', create: true, request: object({ ...courseFields, teacherId: id }, ['name', 'code']) },
    { method: 'get', path: '/courses/{id}', summary: '课程详情', response: ref('Course') },
    { method: 'patch', path: '/courses/{id}', summary: '当前课程教师或管理员编辑课程', auth: 'session', request: object({ ...courseFields, revision }, ['revision']), response: ref('Course') },
    { method: 'put', path: '/courses/{id}/bonus-policy', summary: '配置五类整数积分及资料版本计分，历史奖励不重算', auth: 'session', request: object({ revision, ...bonusPolicy }), response: ref('Course') },
    { method: 'get', path: '/courses/{id}/entry', summary: '课程内容入口与公开统计' },
    { method: 'get', path: '/courses/{id}/activity', summary: '当前仍可见的课程近期动态', parameters: pagination },
    { method: 'get', path: '/courses/{id}/questions', summary: '问题分页、未解决、活跃和标签筛选', response: ref('ContentPage'), parameters: [...pagination,
        q('state', enumeration('all', 'unresolved', 'solved')), q('sort', enumeration('newest', 'active', 'score')), q('tag')] },
    { method: 'post', path: '/courses/{id}/questions', summary: '发布问题，资料引用使用 ProseMirror JSON 正文中的链接', auth: 'session', create: true, request: object(qFields, ['title', 'body']) },
    { method: 'get', path: '/questions/{id}', summary: '问题详情；已删除问题返回关联占位', response: { oneOf: [ref('Content'), ref('Tombstone')] } },
    { method: 'get', path: '/questions/{id}/answers', summary: '采纳置顶，其余净赞数降序，时间及ID稳定排序', response: ref('ContentPage'), parameters: pagination },
    { method: 'post', path: '/questions/{id}/answers', summary: '发布回答', auth: 'session', create: true, request: object({ body }) },
    { method: 'get', path: '/comments', summary: '资料、问题、回答下的评论与回复', response: ref('ContentPage'), parameters: [...pagination, q('targetKind', enumeration('material', 'question', 'answer', 'comment'), true), q('targetId', id, true), q('sort', enumeration('oldest', 'score'))] },
    { method: 'post', path: '/comments', summary: '发布评论或回复评论；target 指向直接父内容', auth: 'session', create: true,
        request: object({ targetKind: enumeration('material', 'question', 'answer', 'comment'), targetId: id, body }, ['targetKind', 'targetId', 'body']) },
    { method: 'get', path: '/contents/{id}', summary: '内容详情；已删除内容仅返回占位信息', response: { oneOf: [ref('Content'), ref('Tombstone')] } },
    { method: 'patch', path: '/contents/{id}', summary: '编辑内容，revision 防止覆盖并发修改', auth: 'session', request: { anyOf: [object({ revision, ...qFields }, ['revision']), object({ revision, body })] }, response: ref('Content') },
    { method: 'delete', path: '/contents/{id}', summary: '清空正文并保留关联占位；相关采纳及加分在同一事务撤回', auth: 'session', request: object({ revision }) },
    { method: 'put', path: '/contents/{id}/vote', summary: '问题、回答、评论设置赞踩：1赞、-1踩、0撤销；禁止自投', auth: 'session', request: object({ value: { type: 'integer', enum: [-1, 0, 1] } }) },
    { method: 'put', path: '/questions/{id}/acceptance', summary: '当期课程教师或管理员采纳、更换或取消；answerId=null 取消', auth: 'session', request: object({ answerId: { anyOf: [id, { type: 'null' }] } }) },
    { method: 'post', path: '/courses/{id}/bonus-adjustments', summary: '当前课程教师或管理员为指定课程、学期、学生手动加减整数分', auth: 'session', create: true,
        request: object({ studentId: id, termId: id, deltaPoints: signedPoints, reason: str(500) }), response: ref('LedgerEntry') },
    { method: 'get', path: '/courses/{id}/bonus-ledger', summary: '教师查询本课程加分流水', auth: 'session', parameters: [...pagination, q('termId', id)] },
    { method: 'get', path: '/courses/{id}/bonus-summary', summary: '教师查询学生按学期的净加分', auth: 'session', parameters: [...pagination, q('termId', id)] },
    { method: 'get', path: '/me/bonus-ledger', summary: '本人加分流水', auth: 'session', parameters: [...pagination, q('termId', id), q('courseId', id)] },
    { method: 'get', path: '/me/activity', summary: '个人空间：自己的可见资料、问题、回答及评论', auth: 'session', response: ref('ContentPage'), parameters: [...pagination, q('kind', enumeration('material', 'question', 'answer', 'comment')), q('courseId', id)] },
    { method: 'post', path: '/contents/{id}/reports', summary: '举报资料、问题、回答或评论；同一目标只保留一个待处理举报', auth: 'session', create: true, request: object({ reason: { ...str(1000), minLength: 3 } }) },
    { method: 'get', path: '/moderation/reports', summary: '权限范围内的举报队列', auth: 'session', parameters: [...pagination, q('courseId', id), q('status', enumeration('pending', 'resolved', 'dismissed', 'all'))] },
    { method: 'patch', path: '/moderation/reports/{id}', summary: '记录举报处理结果；下架通过 moderation 接口执行', auth: 'session', request: object({ revision, status: enumeration('resolved', 'dismissed'), resolution: { ...str(1000), minLength: 3 } }) },
    { method: 'get', path: '/moderation/contents/{id}', summary: '教师审查原文，包括下架内容', auth: 'session' },
    { method: 'put', path: '/contents/{id}/moderation', summary: '下架撤回相应积分；恢复后按原值、原学期补回并恢复采纳可见性', auth: 'session', request: object({ revision, action: enumeration('hide', 'restore'), reason: { ...str(1000), minLength: 3 } }) },
    { method: 'get', path: '/moderation/actions', summary: '内容下架及恢复审查记录', auth: 'session', parameters: [...pagination, q('courseId', id)] },
    { method: 'get', path: '/internal/events', summary: '内部服务拉取事务内业务事件，按 eventId 去重', auth: 'internal', parameters: [q('after', { type: 'integer', minimum: 0 }), q('limit', { type: 'integer', minimum: 1, maximum: 100 })] },
    { method: 'post', path: '/internal/events/ack', summary: '消费者成功持久化后确认事件；不删除事件', auth: 'internal', request: object({ eventIds: { type: 'array', minItems: 1, maxItems: 100, items: str(180) } }) },
    { method: 'get', path: '/internal/documents', summary: '课程、资料、问题、回答的可见搜索文档，分页后重放首个 watermark 之后的事件', auth: 'internal', parameters: [q('after'), q('limit', { type: 'integer', minimum: 1, maximum: 100 })] },
    { method: 'get', path: '/internal/contents/{id}', summary: '按当前可见性获取内容；不可用只返回 available=false', auth: 'internal' },
];

const timestamp: Schema = { type: 'integer', description: 'Unix 秒' };
const nullableId: Schema = { anyOf: [id, { type: 'null' }] };
const nullableKind: Schema = { anyOf: [enumeration('material', 'question', 'answer', 'comment'), { type: 'null' }] };
const bool: Schema = { type: 'boolean' };
const integer: Schema = { type: 'integer' };
const paged = (item: Schema): Schema => object({ items: { type: 'array', items: item }, page: revision, pageSize: revision, total: { type: 'integer', minimum: 0 } });
const ledger = object({ id: revision, operation: enumeration('award','revoke','restore','manual'), courseId: id,
    studentId: id, termId: id, deltaPoints: signedPoints, sourceKind: enumeration('question','answer','acceptance','comment','material','manual'),
    sourceId: { ...str(160), description: '内容 ID、采纳答案 ID、materialId@version 或手动调整幂等键' }, operatorId: id,
    reason: str(1000), reversesId: { anyOf: [revision, { type: 'null' }] }, createdAt: timestamp });
const report = object({ id, contentId: id, reporterId: id, reason: str(1000), status: enumeration('pending','resolved','dismissed'),
    revision, createdAt: timestamp, resolution: { type: ['string','null'] }, handledBy: nullableId, handledAt: { type: ['integer','null'] }, courseId: id });
function responseFor(path: string): Schema {
    switch (path) {
        case '/courses/{id}/entry': return object({ course: ref('Course'), summary: object({ questions: integer, unresolved: integer, answers: integer }),
            permissions: object({ canManage: bool }), links: object({ questions: str(300), activity: str(300), materials: str(300) }) });
        case '/courses/{id}/activity': return paged(object({ seq: integer, type: str(), contentId: id, kind: str(), title: { type: ['string','null'] }, createdAt: timestamp }));
        case '/courses/{id}/bonus-ledger': case '/me/bonus-ledger': return paged(ledger);
        case '/courses/{id}/bonus-summary': return paged(object({ studentId: id, nickname, termId: id, totalPoints: integer }));
        case '/moderation/reports': return paged(report);
        case '/moderation/actions': return paged(object({ id: integer, contentId: id, actorId: id, oldStatus: str(), newStatus: str(), reason: str(1000), createdAt: timestamp }));
        case '/moderation/reports/{id}': return object({ id, status: str(), revision });
        case '/contents/{id}/vote': return object({ id, score: integer, myVote: { type: 'integer', enum: [-1,0,1] } });
        case '/contents/{id}': return object({ id, status: { const: 'deleted' }, revision });
        case '/contents/{id}/moderation': return object({ id, status: str(), revision, changed: bool });
        case '/questions/{id}/acceptance': return { allOf: [ref('Content'), { type: 'object', properties: { changed: bool }, required: ['changed'] }] };
        case '/moderation/contents/{id}': return object({ id, kind: str(), courseId: id, authorId: id, title: { type: ['string','null'] }, body: nullableBody,
            status: str(), revision, targetKind: nullableKind, targetId: nullableId, createdAt: timestamp, updatedAt: timestamp });
        case '/internal/events': return object({ items: { type: 'array', items: object({ seq: integer, eventId: str(180), type: str(), courseId: id,
            contentId: nullableId, actorId: id, payload: { type: 'object' }, createdAt: timestamp, acknowledgedAt: { type: ['integer','null'] } }) }, nextCursor: integer, hasMore: bool });
        case '/internal/events/ack': return object({ acknowledged: integer });
        case '/internal/documents': return object({ items: { type: 'array', items: object({ documentId: str(160), id, kind: enumeration('course','material','question','answer'),
            courseId: id, title: { type: ['string','null'] }, body: { anyOf: [{ type: 'string' }, body, { type: 'null' }] }, format: enumeration('text', 'prosemirror'), tags, targetKind: nullableKind, targetId: nullableId, revision, updatedAt: timestamp }) },
            nextCursor: { type: 'string' }, hasMore: bool, watermark: { type: 'integer', description: '记录第一页的值，所有分页完成后重放大于该值的事件' } });
        case '/internal/contents/{id}': return { oneOf: [object({ id, available: { const: false } }), { allOf: [ref('Content'), { type: 'object', properties: { available: { const: true } }, required: ['available'] }] }] };
        default: throw new Error('Missing response schema: ' + path);
    }
}

const paths: Record<string, Record<string, unknown>> = {};
for (const d of defs) {
    const path = `/api${d.path}`;
    const parameters = [...Array.from(path.matchAll(/\{(\w+)\}/g), m => ({ name: m[1], in: 'path', required: true, schema: id })), ...(d.parameters ?? [])];
    if (d.auth !== 'internal' && !['get', 'head', 'options'].includes(d.method)) parameters.push({ name: 'Origin', in: 'header', required: true, schema: { type: 'string', format: 'uri' } });
    if (d.create) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' } });
    const security = d.auth === 'internal' ? [{ internalBearer: [] }] : d.auth === 'session'
        ? [{ sessionCookie: [] }] : [{}, { sessionCookie: [] }];
    paths[path] ??= {};
    paths[path][d.method] = {
        summary: d.summary, operationId: `${d.method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`, security, parameters,
        ...(d.request ? { requestBody: { required: true, content: { 'application/json': { schema: d.request } } } } : {}),
        responses: {
            [d.create ? '201' : '200']: { description: '成功', content: { 'application/json': { schema: object({ data: d.response ?? (d.create ? object({ id }) : responseFor(d.path)) }) } } },
            ...Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 500, 503].map(status => [String(status),
                { description: ({ 400: '参数错误', 401: '登录失效', 403: '权限不足', 404: '内容不可用', 409: '状态冲突或重复操作', 413: '正文过大', 415: '需要JSON', 500: '服务错误', 503: '内部接口未配置' } as Record<number, string>)[status],
                    content: { 'application/json': { schema: ref('Error') } } }]))
        },
    };
}
export const openapi = {
    openapi: '3.1.0', info: { title: 'CourseStack 课程与讨论 API', version: '4.0.0',
        description: '正文使用 Tiptap / ProseMirror JSON 对象，由前端按编辑器扩展配置安全渲染。公开数据不包含学工号、姓名、院系、专业或年级。写入需登录，创建需幂等键，课程和内容编辑需当前 revision；账户修改和独立采纳关系不使用 revision；积分为课程、学期、学生维度的整数。Cookie 写请求需可信 Origin。' },
    servers: [{ url: 'http://127.0.0.1:8787', description: '本地开发' }], paths,
    components: {
        securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: 'coursestack_session', description: '所有环境均使用同名的 HttpOnly、SameSite=Strict Cookie，HTTPS 下加 Secure' },
            internalBearer: { type: 'http', scheme: 'bearer', description: '内部服务专用凭据，不得放入前端' },
        },
        schemas: {
            Error: object({ error: object({ code: str(80), message: { type: 'string' } }) }),
            ProseMirrorMark: object({ type: { type: 'string', minLength: 1 }, attrs: { type: 'object', additionalProperties: true } }, ['type']),
            ProseMirrorNode: object({ type: { type: 'string', minLength: 1 }, attrs: { type: 'object', additionalProperties: true },
                text: { type: 'string', minLength: 1 }, content: { type: 'array', items: ref('ProseMirrorNode') },
                marks: { type: 'array', items: ref('ProseMirrorMark') } }, ['type']),
            ProseMirrorDocument: { allOf: [ref('ProseMirrorNode'), { type: 'object', properties: { type: { const: 'doc' } } }],
                description: 'JSON 序列化后最多 30000 字符、节点最多嵌套 64 层。text 节点须包含非空 text 且不能有 content；其他节点不含 text。具体节点、标记和属性由 Tiptap 扩展配置确定。' },
            BonusPolicy: object(bonusPolicy),
            LedgerEntry: ledger,
            Course: object({ id, ...courseFields, code: { type: 'string', maxLength: 40 }, bonusPolicy: ref('BonusPolicy'), revision, createdAt: { type: 'integer' }, updatedAt: { type: 'integer' } }),
            Content: { type: 'object', required: ['id', 'kind', 'courseId', 'author', 'body', 'revision', 'score', 'targetKind', 'targetId'],
                properties: { id, kind: enumeration('material', 'question', 'answer', 'comment'), courseId: id,
                    author: object({ id, nickname, isDeleted: { type: 'boolean' }, isTeacher: { type: 'boolean' }, isCourseTeacher: { type: 'boolean' } }),
                    title: { type: ['string', 'null'] }, body: nullableBody, format: { const: 'prosemirror' }, tags,
                    targetKind: nullableKind, targetId: nullableId, acceptedAnswerId: { type: ['string', 'null'] }, solved: { type: 'boolean' },
                    isAccepted: { type: 'boolean' }, revision, score: { type: 'integer' }, myVote: { type: 'integer', enum: [-1, 0, 1] }, createdAt: { type: 'integer' }, updatedAt: { type: 'integer' } } },
            Tombstone: object({ id, kind: enumeration('material', 'question', 'answer', 'comment'), courseId: id, targetKind: nullableKind, targetId: nullableId, status: { const: 'deleted' }, body: { type: 'null' }, revision }),
            ContentPage: object({ items: { type: 'array', items: ref('Content') }, page: revision, pageSize: revision, total: { type: 'integer', minimum: 0 } }),
            CoursePage: object({ items: { type: 'array', items: ref('Course') }, page: revision, pageSize: revision, total: { type: 'integer', minimum: 0 } }),
        },
    },
};
type Schema = Record<string, unknown>;
const str = (maxLength = 100): Schema => ({ type: 'string', minLength: 1, maxLength });
const id: Schema = { ...str(), pattern: '^[a-zA-Z0-9_-]+$' };
const revision: Schema = { type: 'integer', minimum: 1 };
const points: Schema = { type: 'number', minimum: 0, maximum: 100, multipleOf: 0.01 };
const body = str(30000);
const tags: Schema = { type: 'array', maxItems: 8, items: str(30) };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const courseFields = { name: str(120), code: str(40), department: { type: 'string', maxLength: 120 }, introduction: { type: 'string', maxLength: 5000 } };
const qFields = { title: str(200), body, tags, fileVersionId: { anyOf: [id, { type: 'null' }] } };
const q = (name: string, schema: Schema = { type: 'string' }, required = false) => ({ name, in: 'query', required, schema });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const pagination = [q('page', { type: 'integer', minimum: 1, maximum: 10000, default: 1 }),
  q('pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 20 })];
type Definition = { method: string; path: string; summary: string; auth?: 'optional' | 'session' | 'internal';
  request?: Schema; create?: boolean; parameters?: unknown[]; response?: Schema };
const defs: Definition[] = [
  { method: 'get', path: '/courses', summary: '课程列表', parameters: [...pagination, q('q')], response: ref('CoursePage') },
  { method: 'post', path: '/courses', summary: '教师创建课程，并建立本人当期授课关系', auth: 'session', create: true, request: object(courseFields, ['name', 'code']) },
  { method: 'get', path: '/courses/{id}', summary: '课程详情', response: ref('Course') },
  { method: 'patch', path: '/courses/{id}', summary: '当前课程教师或管理员编辑课程', auth: 'session', request: object({ ...courseFields, revision }, ['revision']), response: ref('Course') },
  { method: 'put', path: '/courses/{id}/bonus-policy', summary: '配置采纳加分，历史采纳不重算', auth: 'session', request: object({ revision, enabled: { type: 'boolean' }, bonusPoints: points }), response: ref('Course') },
  { method: 'get', path: '/courses/{id}/entry', summary: '课程内容入口与公开统计' },
  { method: 'get', path: '/courses/{id}/activity', summary: '当前仍可见的课程近期动态', parameters: pagination },
  { method: 'get', path: '/courses/{id}/questions', summary: '问题分页、未解决、活跃、标签和具体版本筛选', response: ref('ContentPage'), parameters: [...pagination,
    q('state', enumeration('all', 'unresolved', 'solved')), q('sort', enumeration('newest', 'active', 'score')), q('tag'), q('fileVersionId', id)] },
  { method: 'post', path: '/courses/{id}/questions', summary: '发布问题，关联固定的文件版本', auth: 'session', create: true, request: object(qFields, ['title', 'body']) },
  { method: 'get', path: '/questions/{id}', summary: '问题及关联文件可用状态', response: { allOf: [ref('Content'), { type: 'object', properties: { file: { anyOf: [object({ id, available: { type: 'boolean' }, materialId: id, filename: str(300), version: { type: 'integer' } }, ['id', 'available']), { type: 'null' }] } }, required: ['file'] }] } },
  { method: 'get', path: '/questions/{id}/answers', summary: '采纳置顶，其余净赞数降序，时间及ID稳定排序', response: ref('ContentPage'), parameters: pagination },
  { method: 'post', path: '/questions/{id}/answers', summary: '发布回答', auth: 'session', create: true, request: object({ body }) },
  { method: 'get', path: '/comments', summary: '资料、问题、回答下的评论与回复', response: ref('ContentPage'), parameters: [...pagination, q('targetKind', enumeration('material', 'question', 'answer'), true), q('targetId', id, true), q('sort', enumeration('oldest', 'score'))] },
  { method: 'post', path: '/comments', summary: '发布评论或回复同一目标下的评论', auth: 'session', create: true,
    request: object({ targetKind: enumeration('material', 'question', 'answer'), targetId: id, body, replyToId: { anyOf: [id, { type: 'null' }] } }, ['targetKind', 'targetId', 'body']) },
  { method: 'get', path: '/contents/{id}', summary: '内容详情；已删除内容仅返回占位信息', response: { oneOf: [ref('Content'), ref('Tombstone')] } },
  { method: 'patch', path: '/contents/{id}', summary: '编辑内容，revision 防止覆盖并发修改', auth: 'session', request: { anyOf: [object({ revision, ...qFields }, ['revision']), object({ revision, body })] }, response: ref('Content') },
  { method: 'delete', path: '/contents/{id}', summary: '软删除；相关采纳及加分在同一事务撤回', auth: 'session', request: object({ revision }) },
  { method: 'put', path: '/contents/{id}/vote', summary: '设置赞踩：1赞、-1踩、0撤销；禁止自投', auth: 'session', request: object({ value: { type: 'integer', enum: [-1, 0, 1] } }) },
  { method: 'put', path: '/questions/{id}/acceptance', summary: '当期课程教师采纳、更换或取消；answerId=null 取消', auth: 'session', request: object({ revision, answerId: { anyOf: [id, { type: 'null' }] } }) },
  { method: 'patch', path: '/questions/{id}/award', summary: '有理由地调整已采纳学生加分，保留冲销及新奖分流水', auth: 'session', request: object({ revision, bonusPoints: points, reason: { ...str(500), minLength: 3 } }) },
  { method: 'get', path: '/courses/{id}/bonus-ledger', summary: '教师查询本课程加分流水', auth: 'session', parameters: [...pagination, q('semesterId', id)] },
  { method: 'get', path: '/courses/{id}/bonus-summary', summary: '教师查询学生按学期的净加分', auth: 'session', parameters: [...pagination, q('semesterId', id)] },
  { method: 'get', path: '/me/bonus-ledger', summary: '本人加分流水', auth: 'session', parameters: [...pagination, q('semesterId', id), q('courseId', id)] },
  { method: 'get', path: '/me/activity', summary: '个人空间：自己的可见问题、回答及评论', auth: 'session', response: ref('ContentPage'), parameters: [...pagination, q('kind', enumeration('question', 'answer', 'comment')), q('courseId', id)] },
  { method: 'post', path: '/contents/{id}/reports', summary: '举报问题、回答或评论；同一目标只保留一个待处理举报', auth: 'session', create: true, request: object({ reason: { ...str(1000), minLength: 3 } }) },
  { method: 'get', path: '/moderation/reports', summary: '权限范围内的举报队列', auth: 'session', parameters: [...pagination, q('courseId', id), q('status', enumeration('pending', 'resolved', 'dismissed', 'all'))] },
  { method: 'patch', path: '/moderation/reports/{id}', summary: '记录举报处理结果；下架通过 moderation 接口执行', auth: 'session', request: object({ revision, status: enumeration('resolved', 'dismissed'), resolution: { ...str(1000), minLength: 3 } }) },
  { method: 'get', path: '/moderation/contents/{id}', summary: '教师审查原文，包括下架内容', auth: 'session' },
  { method: 'put', path: '/contents/{id}/moderation', summary: '下架或恢复；恢复不自动恢复采纳与加分', auth: 'session', request: object({ revision, action: enumeration('hide', 'restore'), reason: { ...str(1000), minLength: 3 } }) },
  { method: 'get', path: '/moderation/actions', summary: '内容下架及恢复审查记录', auth: 'session', parameters: [...pagination, q('courseId', id)] },
  { method: 'get', path: '/internal/events', summary: '组员4拉取事务内业务事件，按 eventId 去重', auth: 'internal', parameters: [q('after', { type: 'integer', minimum: 0 }), q('limit', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'post', path: '/internal/events/ack', summary: '消费者成功持久化后确认事件；不删除事件', auth: 'internal', request: object({ eventIds: { type: 'array', minItems: 1, maxItems: 100, items: str(180) } }) },
  { method: 'get', path: '/internal/documents', summary: '课程、问题、回答的可见搜索文档，分页后重放首个 watermark 之后的事件', auth: 'internal', parameters: [q('after'), q('limit', { type: 'integer', minimum: 1, maximum: 100 })] },
  { method: 'get', path: '/internal/contents/{id}', summary: '按当前可见性获取内容；不可用只返回 available=false', auth: 'internal' },
];
const paths: Record<string, Record<string, unknown>> = {};
for (const d of defs) {
  const path = d.path.startsWith('/internal') ? d.path : `/api${d.path}`;
  const parameters = [...Array.from(path.matchAll(/\{(\w+)\}/g), m => ({ name: m[1], in: 'path', required: true, schema: id })), ...(d.parameters ?? [])];
  if (d.create) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' } });
  const security = d.auth === 'internal' ? [{ internalBearer: [] }] : d.auth === 'session'
    ? [{ sessionBearer: [] }, { sessionCookie: [] }] : [{}, { sessionBearer: [] }, { sessionCookie: [] }];
  paths[path] ??= {};
  paths[path][d.method] = {
    summary: d.summary, operationId: `${d.method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`, security, parameters,
    ...(d.request ? { requestBody: { required: true, content: { 'application/json': { schema: d.request } } } } : {}),
    responses: {
      [d.create ? '201' : '200']: { description: '成功', content: { 'application/json': { schema: d.create ? object({ id }) : d.response ?? { type: 'object' } } } },
      ...Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 500, 503].map(status => [String(status),
        { description: ({ 400: '参数错误', 401: '登录失效', 403: '权限不足', 404: '内容不可用', 409: '状态冲突或重复操作', 413: '正文过大', 415: '需要JSON', 500: '服务错误', 503: '内部接口未配置' } as Record<number, string>)[status],
          content: { 'application/json': { schema: ref('Error') } } }]))
    },
  };
}
export const openapi = {
  openapi: '3.1.0', info: { title: 'CourseStack 组员3：课程与互动后端', version: '1.0.0',
    description: 'Markdown 原文由前端安全渲染。公开数据不包含邮箱、学号、真实姓名。写入需登录，创建需幂等键，编辑需当前 revision。Cookie 写请求需可信 Origin。' },
  servers: [{ url: 'http://127.0.0.1:8787', description: '本地开发' }], paths,
  components: {
    securitySchemes: {
      sessionBearer: { type: 'http', scheme: 'bearer', description: '组员1签发的随机不透明会话令牌' },
      sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Host-coursestack_session', description: '生产使用此名称；仅本地使用 coursestack_session' },
      internalBearer: { type: 'http', scheme: 'bearer', description: '内部服务专用凭据，不得放入前端' },
    },
    schemas: {
      Error: object({ error: object({ code: str(80), message: { type: 'string' }, requestId: str(80) }) }),
      Course: object({ id, ...courseFields, bonusEnabled: { type: 'boolean' }, bonusPoints: points, revision, createdAt: str(), updatedAt: str() }),
      Content: { type: 'object', required: ['id', 'kind', 'courseId', 'author', 'body', 'revision', 'score'],
        properties: { id, kind: enumeration('question', 'answer', 'comment'), courseId: id,
          author: object({ id, displayName: str(120), isTeacher: { type: 'boolean' }, isCourseTeacher: { type: 'boolean' } }),
          title: { type: ['string', 'null'] }, body, format: { const: 'markdown' }, tags,
          questionId: { type: ['string', 'null'] }, targetKind: { type: ['string', 'null'] }, targetId: { type: ['string', 'null'] }, replyToId: { type: ['string', 'null'] },
          fileVersionId: { type: ['string', 'null'] }, acceptedAnswerId: { type: ['string', 'null'] }, solved: { type: 'boolean' },
          isAccepted: { type: 'boolean' }, revision, score: { type: 'integer' }, myVote: { type: 'integer', enum: [-1, 0, 1] }, createdAt: str(), updatedAt: str() } },
      Tombstone: object({ id, kind: enumeration('question', 'answer', 'comment'), status: { const: 'deleted' }, body: { type: 'null' }, revision }),
      ContentPage: object({ items: { type: 'array', items: ref('Content') }, page: revision, pageSize: revision, hasMore: { type: 'boolean' } }),
      CoursePage: object({ items: { type: 'array', items: ref('Course') }, page: revision, pageSize: revision, hasMore: { type: 'boolean' } }),
    },
  },
};
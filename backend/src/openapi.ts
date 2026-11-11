import { favoriteDefinitions, favoriteSchemas } from './favorites/openapi.ts';
import { BODY_IMAGE_MIMES } from '../../shared/rich-text/images.ts';
import { richTextSchemas } from '../../shared/rich-text/schema.ts';
import { accountColumns } from '../../shared/accounts/import.ts';
import { accountDefinitions, accountSchemas } from './accounts/openapi.ts';
import { materialDefinitions, materialSchemas } from './materials/openapi.ts';
import { searchDefinitions, searchSchemas } from './search/openapi.ts';
import { teacherDefinitions, teacherSchemas } from './teachers/openapi.ts';
import { notificationDefinitions, notificationSchemas } from './notifications/openapi.ts';
type Schema = Record<string, unknown>;
const str = (maxLength = 100): Schema => ({ type: 'string', minLength: 1, maxLength });
const id: Schema = { ...str(), pattern: '^[a-zA-Z0-9_-]+$' };
const courseId: Schema = { ...str(40), not: { enum: ['.', '..'] }, pattern: '^[^\\u0000-\\u001f\\u007f]+$', description: '课程号，保持原值，URL 路径需编码' };
const classPath = '/courses/{id}/terms/{termId}/teachers/{teacherId}';
const positiveInteger: Schema = { type: 'integer', minimum: 1 };
const points: Schema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const signedPoints: Schema = { type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, not: { const: 0 } };
const bonusReason: Schema = { anyOf: [str(500), { type: 'null' }], description: '可选补充说明；自动积分为 null' };
const optionalReason: Schema = { type: 'string', maxLength: 1000, description: '选填；省略或留空时保存为空字符串' };
const nickname: Schema = { type: ['string', 'null'], maxLength: 80 };
const bonusPolicy = { pointsQuestion: points, pointsAnswer: points, pointsAcceptance: points, pointsComment: points,
    pointsMaterial: { ...points, description: '首次上传（版本 1）的积分' },
    pointsMaterialVersion: { ...points, description: '后续每个新版本的积分，与首次上传分值分别计分' } };
const body: Schema = { $ref: '#/components/schemas/ProseMirrorDocument' };
const nullableBody: Schema = { anyOf: [body, { type: 'null' }] };
const tags: Schema = { type: ['array', 'null'], maxItems: 8, items: str(30), description: '仅问题和资料允许标签；回答和评论为 null' };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const courseFields = { name: str(120), introduction: { type: 'string', maxLength: 5000 } };
const qFields = { title: str(200), body, tags };
const q = (name: string, schema: Schema = { type: 'string' }, required = false) => ({ name, in: 'query', required, schema });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const pagination = [q('page', { type: 'integer', minimum: 1, maximum: 10000, default: 1 }),
    q('pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 20 })];
const paged = (item: Schema): Schema => object({ items: { type: 'array', items: item }, page: positiveInteger, pageSize: positiveInteger, total: { type: 'integer', minimum: 0 } });
export type Definition = { method: string; path: string; summary: string; auth?: 'optional' | 'session' | 'internal';
    request?: Schema; requestRequired?: boolean; create?: boolean; idempotencyKeyRequired?: boolean; sessionCookie?: 'set' | 'clear'; rateLimited?: boolean;
    parameters?: unknown[]; response?: Schema; binary?: boolean; requestMimes?: readonly string[]; responseMimes?: readonly string[] };
const defs: Definition[] = [
    ...favoriteDefinitions,
    ...materialDefinitions,
    { method: 'post', path: '/body-images', auth: 'session', summary: '上传一个独立的正文图片对象，每张最多 1 MiB，临时图片 24 小时内可绑定',
        request: { type: 'string', format: 'binary' }, requestMimes: BODY_IMAGE_MIMES, response: object({ src: { type: 'string', pattern: '^/api/body-images/[0-9a-f]{32}$' } }) },
    { method: 'get', path: '/body-images/{id}', summary: '读取可见正文中的图片，临时图片仅上传者可读', responseMimes: BODY_IMAGE_MIMES },
    ...teacherDefinitions,
    ...searchDefinitions,
    ...notificationDefinitions,
    { method: 'post', path: '/admin/accounts/import/preview', summary: '管理员预检最多500条账号资料；无写入，不回传密码，最终创建仍需复核唯一性', auth: 'session',
        request: object({ rows: { type: 'array', minItems: 1, maxItems: 500, items: object({
            line: { type: 'integer', minimum: 1, maximum: 2097152 }, values: object(Object.fromEntries(accountColumns.map(({ key }) => [key, { type: 'string' }]))) }) } }),
        response: object({ items: { type: 'array', items: object({ line: positiveInteger, status: enumeration('ready', 'existing', 'invalid', 'duplicate'), message: { type: 'string' } }) } }) },
    { method: 'get', path: '/me/courses', summary: '本人修读或授课的课程，区分当前学期与历史学期，同一课程去重', auth: 'session',
        parameters: [...pagination, q('scope', { ...enumeration('current', 'history'), default: 'current' }), q('q', { type: 'string', maxLength: 100 })], response: ref('MyCoursePage') },
    { method: 'get', path: '/courses', summary: '按课程号升序列出课程，id 精确匹配课程号，termId 筛选管理员已安排开设的课程', parameters: [...pagination, q('q'), q('id', courseId), q('termId', id)], response: ref('CoursePage') },
    { method: 'post', path: '/courses', summary: '管理员建立长期课程，无需学期或任课教师', auth: 'session', create: true, request: object({ id: courseId, ...courseFields }, ['id', 'name']), response: object({ id: courseId }) },
    { method: 'get', path: '/courses/{id}', summary: '课程详情及本学期全部任课教师', response: ref('Course') },
    { method: 'patch', path: '/courses/{id}', summary: '管理员编辑课程名称及简介；课程号不可修改', auth: 'session', request: object(courseFields, []), response: ref('Course') },
    { method: 'get', path: '/terms', summary: '学期列表，当前学期优先', response: { type: 'array', items: ref('Term') } },
    { method: 'put', path: '/terms/current', summary: '管理员切换当前学期，可切回历年学期，不能清除；保留所有历史关系', auth: 'session', request: object({ termId: id }), response: object({ termId: id }) },
    { method: 'put', path: '/terms/{termId}', summary: '管理员建立或重命名学期；ID 不可为 current', auth: 'session', request: object({ name: str(120) }), response: object({ id, name: str(120) }) },
    { method: 'get', path: '/courses/{id}/terms', summary: '课程已安排开设的学期', response: { type: 'array', items: ref('Term') } },
    { method: 'put', path: '/courses/{id}/terms/{termId}', summary: '管理员安排课程在指定学期开设，可重复调用', auth: 'session', response: object({ courseId, termId: id }) },
    { method: 'delete', path: '/courses/{id}/terms/{termId}', summary: '管理员撤销尚无教学班的开课安排；已有教学班返回409', auth: 'session', response: object({ courseId, termId: id }) },
    { method: 'put', path: '/courses/{id}/terms/{termId}/teachers/me', summary: '教师直接加入本学期已开设课程，创建本人教学班；重复加入返回同一班', auth: 'session', response: ref('TeachingClass') },
    { method: 'get', path: '/teaching-classes', summary: '教师只见本人当期教学班，管理员可见全部教学班', auth: 'session', parameters: [...pagination, q('courseId', courseId), q('termId', id)], response: paged(ref('TeachingClass')) },
    { method: 'get', path: '/admin/roster-events', summary: '管理员查询教学班建立、删除及学生加入、移除、转班记录，按记录 ID 倒序；teacherId 同时匹配转出和转入教师', auth: 'session',
        parameters: [...pagination, q('courseId', courseId), q('termId', id), q('teacherId', id), q('studentId', id)], response: paged(ref('RosterEvent')) },
    { method: 'get', path: classPath, summary: '本人当期教学班或管理员读取教学班详情', auth: 'session', response: ref('TeachingClass') },
    { method: 'delete', path: classPath, summary: '管理员删除指定学期的教学班，清除留班学生的修读记录和积分', auth: 'session', response: object({ courseId, termId: id, teacherId: id }) },
    { method: 'put', path: `${classPath}/bonus-policy`, summary: '本人当期教学班教师或管理员配置本班六项积分规则，不重算历史流水', auth: 'session', request: object(bonusPolicy), response: ref('TeachingClass') },
    { method: 'get', path: `${classPath}/students`, summary: '本人当期教学班教师或管理员读取学生名单、必要学籍信息与本班净积分', auth: 'session', parameters: pagination, response: paged(ref('ClassStudent')) },
    { method: 'post', path: `${classPath}/students`, summary: '按已有学号加入当前学期教学班；同班重复请求不重复写入，已属其他教师班返回409', auth: 'session', request: object({ schoolNumber: str(80) }), response: object({ studentId: id }) },
    { method: 'delete', path: `${classPath}/students/{studentId}`, summary: '教师从本人当前教学班移除学生，管理员可操作任意学期。清除该次修读和积分', auth: 'session', response: object({ studentId: id }) },
    { method: 'put', path: `${classPath}/students/{studentId}/transfer`, summary: '管理员将学生转入同课程同学期的已有教学班，保留积分与流水。已在目标班时可重复调用', auth: 'session',
        request: object({ targetTeacherId: id }), response: object({ studentId: id, teacherId: id }) },
    { method: 'post', path: `${classPath}/students/import`, summary: '本人当期教学班教师或管理员批量导入已有学号；有效项添加，同班跳过，错误逐项返回', auth: 'session',
        request: object({ schoolNumbers: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string' },
            description: '保留前导零；去首尾空白、忽略空项、按首次出现顺序去重。全空输入返回400，去空前最多500项，超过80字符的学号逐项失败' } }), response: ref('StudentImportResult') },
    { method: 'get', path: '/courses/{id}/entry', summary: '课程内容入口、本人修读或授课学期与公开统计；termId 选择具体开课学期', parameters: [q('termId', id)] },
    { method: 'get', path: '/courses/{id}/activity', summary: '当前可见内容按更新时间排列，每项内容只出现一次', parameters: pagination },
    { method: 'get', path: '/courses/{id}/questions', summary: '问题分页、未解决、活跃和标签筛选', response: ref('ContentPage'), parameters: [...pagination,
        q('state', enumeration('all', 'unresolved', 'solved')), q('sort', enumeration('newest', 'active', 'score')), q('tag'), q('termId', id)] },
    { method: 'post', path: '/courses/{id}/questions', summary: '本学期修读或教授该课程的师生及管理员可提问，资料引用使用 ProseMirror JSON 正文中的链接', auth: 'session', create: true, request: object(qFields, ['title', 'body']) },
    { method: 'get', path: '/questions/{id}', summary: '问题详情；已删除或下架的问题返回 404', response: ref('Content') },
    { method: 'get', path: '/questions/{id}/answers', summary: '采纳置顶，其余净赞数降序，时间及ID稳定排序', response: ref('ContentPage'), parameters: pagination },
    { method: 'post', path: '/questions/{id}/answers', summary: '发布回答', auth: 'session', create: true, request: object({ body }) },
    { method: 'get', path: '/comments', summary: '资料、问题、回答下的评论与回复，平铺排列；已删除评论仅在仍有可见回复时以占位出现',
        response: paged({ oneOf: [ref('Content'), ref('Tombstone')] }), parameters: [...pagination, q('targetKind', enumeration('material', 'question', 'answer', 'comment'), true), q('targetId', id, true), q('sort', enumeration('oldest', 'score'))] },
    { method: 'post', path: '/comments', summary: '发布评论或回复；回复评论时服务端将所属对象归一到问题、回答或资料，另存回复引用', auth: 'session', create: true,
        request: object({ targetKind: enumeration('material', 'question', 'answer', 'comment'), targetId: id, body }, ['targetKind', 'targetId', 'body']) },
    { method: 'get', path: '/contents/{id}', summary: '内容详情；已删除评论返回占位，已删除的问题、资料、回答及其下内容返回 404', response: { oneOf: [ref('Content'), ref('Tombstone')] } },
    { method: 'patch', path: '/contents/{id}', summary: '仅所有者编辑，包括下架内容且保持其状态；仅标题、正文或标签实际变化时更新 editedAt，按最终写入顺序生效，省略字段保持原值', auth: 'session', request: { anyOf: [object(qFields, []), object({ body })] }, response: ref('Content') },
    { method: 'delete', path: '/contents/{id}', summary: '所有者删除：已有未删除回答、评论或采纳时返回409（包括下架讨论）；评论回复不阻止删除；资料同时删除版本并撤回奖励', auth: 'session' },
    { method: 'put', path: '/contents/{id}/vote', summary: '资料、问题、回答、评论设置赞踩：1赞、-1踩、0撤销；禁止自投', auth: 'session', request: object({ value: { type: 'integer', enum: [-1, 0, 1] } }) },
    { method: 'put', path: '/questions/{id}/acceptance', summary: '当期课程教师或管理员采纳、更换或取消；answerId=null 取消', auth: 'session', request: object({ answerId: { anyOf: [id, { type: 'null' }] } }) },
    { method: 'post', path: `${classPath}/bonus-adjustments`, summary: '本人当期教学班教师或管理员为本班学生手动加减整数分', auth: 'session', create: true,
        request: object({ studentId: id, deltaPoints: signedPoints, reason: bonusReason }, ['studentId', 'deltaPoints']), response: ref('LedgerEntry') },
    { method: 'get', path: `${classPath}/bonus-ledger`, summary: '本人当期教学班教师或管理员查询本班流水', auth: 'session', parameters: pagination },
    { method: 'get', path: `${classPath}/bonus-summary`, summary: '本人当期教学班教师或管理员查询本班学生净加分', auth: 'session', parameters: pagination },
    { method: 'get', path: '/me/bonus-ledger', summary: '本人加分流水及筛选范围内的净积分，按流水 ID 倒序', auth: 'session', parameters: [...pagination, q('termId', id), q('courseId', courseId)], response: ref('MyBonusLedgerPage') },
    { method: 'get', path: '/me/bonus-policy', summary: '学生读取本人当前学期所属教学班的规则；未修读时 membership 为 null', auth: 'session', parameters: [q('courseId', courseId, true)], response: ref('MyBonusPolicy') },
    { method: 'get', path: '/me/bonus-events', summary: '本人积分增量，按 ID 升序；省略 afterId 只返回当前游标，不重放历史', auth: 'session',
        parameters: [q('afterId', { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), pagination[1]], response: ref('BonusEventPage') },
    { method: 'get', path: '/me/activity', summary: '个人空间：自己的未删除内容，包括下架内容和不可公开的分支', auth: 'session', response: ref('ContentPage'), parameters: [...pagination, q('kind', enumeration('material', 'question', 'answer', 'comment')), q('courseId', courseId)] },
    { method: 'post', path: '/contents/{id}/reports', summary: '举报资料、问题、回答或评论；同一目标只保留一个待处理举报', auth: 'session', create: true, request: object({ reason: optionalReason }, []) },
    { method: 'get', path: '/me/contents/{id}', summary: '仅所有者查看自己的内容及上下架原因；删除后只保留状态与记录', auth: 'session', response: ref('ReviewContent') },
    { method: 'get', path: '/moderation/contents', summary: '管理者查看授权课程的内容，包括下架内容', auth: 'session', response: ref('ContentPage'), parameters: [...pagination, q('courseId', courseId), q('termId', id), q('status', enumeration('visible', 'hidden', 'deleted', 'all')), q('kind', enumeration('material', 'question', 'answer', 'comment'))] },
    { method: 'get', path: '/moderation/reports', summary: '权限范围内的举报队列', auth: 'session', parameters: [...pagination, q('courseId', courseId), q('status', enumeration('pending', 'resolved', 'dismissed', 'deleted', 'all'))] },
    { method: 'patch', path: '/moderation/reports/{id}', summary: '举报可维持现状、下架或连带删除；内容、自动积分、审查记录与处理结果在同一事务提交', auth: 'session', request: object({ action: enumeration('none', 'hide', 'delete'), resolution: optionalReason }, ['action']) },
    { method: 'get', path: '/moderation/contents/{id}', summary: '教师审查原文，包括下架内容', auth: 'session' },
    { method: 'put', path: '/contents/{id}/moderation', summary: '管理者下架或删除整个所属分支并撤回自动奖励；删除不可恢复；上架按各内容原学期重新计分，手工调分保留', auth: 'session', request: object({ action: enumeration('hide', 'restore', 'delete'), reason: optionalReason }, ['action']) },
    { method: 'get', path: '/moderation/actions', summary: '内容上下架、删除及版本删除审查记录', auth: 'session', parameters: [...pagination, q('courseId', courseId)] },
    { method: 'get', path: '/internal/documents', summary: '分页读取当前可见课程、资料、问题和回答；不提供跨页快照或增量重放', auth: 'internal', parameters: [q('after'), q('limit', { type: 'integer', minimum: 1, maximum: 100 })] },
    { method: 'get', path: '/internal/contents/{id}', summary: '按当前可见性获取内容；不可用只返回 available=false', auth: 'internal' },
    ...accountDefinitions,
];

const timestamp: Schema = { type: 'integer', description: 'Unix 秒' };
const nullableId: Schema = { anyOf: [id, { type: 'null' }] };
const nullableKind: Schema = { anyOf: [enumeration('material', 'question', 'answer', 'comment'), { type: 'null' }] };
const bool: Schema = { type: 'boolean' };
const integer: Schema = { type: 'integer' };
const contentMetadata = {
    termId: { ...nullableId, description: '首次发布时的当前学期；旧内容或当时未设置当前学期为 null，后续编辑和版本不改变' },
    editedAt: { type: ['integer', 'null'], description: 'Unix 秒；null 表示从未编辑。仅内容 PATCH 实际改变标题、正文或标签时更新；前端仅以是否为 null 判断已编辑。' },
    replyTo: { anyOf: [ref('ReplyTo'), { type: 'null' }], description: '回答的所属问题或评论的回复目标摘要；回复评论时与 targetId 所属对象分开。被回复评论删除后仍保留摘要。' },
    commentCount: { type: 'integer', minimum: 0, description: '所属评论区可见评论数量；评论本身返回直接回复引用数。不合并回答评论区。列表 total 另包含有可见直接回复的删除占位。' },
};
const answerCount: Schema = { type: 'integer', minimum: 0, description: '仅问题返回；与问题的公开回答列表 total 一致。' };
const questionCounts = { if: { properties: { kind: { const: 'question' } }, required: ['kind'] }, then: { required: ['answerCount'] } };
const ledger = object({ id: positiveInteger, courseId: courseId,
    studentId: id, studentNickname: nickname, termId: id, teacherId: id, deltaPoints: signedPoints, sourceKind: enumeration('question','answer','acceptance','comment','material','manual'),
    sourceId: { ...str(160), description: '内容 ID、采纳答案 ID、materialId@version 或手动调整幂等键' }, operatorId: id,
    reason: bonusReason, reversesId: { anyOf: [positiveInteger, { type: 'null' }] }, createdAt: timestamp });
const report = object({ id, contentId: id, reporterId: id, reason: optionalReason, status: enumeration('pending','resolved','dismissed','deleted'),
    createdAt: timestamp, resolution: { type: ['string','null'] }, handledBy: nullableId, handledAt: { type: ['integer','null'] }, courseId: courseId });
function responseFor(path: string): Schema {
    switch (path) {
        case '/courses/{id}/entry': return object({ course: ref('Course'), term: { anyOf: [ref('Term'), { type: 'null' }] },
            terms: { type: 'array', items: ref('Term') }, myTerms: { type: 'array', items: ref('Term') },
            teachers: { type: 'array', items: object({ id, nickname, isDeleted: bool }) }, summary: object({ questions: integer, unresolved: integer, answers: integer }),
            permissions: object({ canPublishContent: { ...bool, description: '能否在当前学期提出问题或首次上传资料' }, canManageContent: bool, canManageCourse: bool }),
            links: object({ questions: str(300), activity: str(300), materials: str(300), contents: str(300) }) });
        case '/courses/{id}/activity': return paged(object({ contentId: id, kind: str(), title: { type: ['string','null'] }, createdAt: timestamp, updatedAt: timestamp }));
        case `${classPath}/bonus-ledger`: return paged(ledger);
        case `${classPath}/bonus-summary`: return paged(object({ studentId: id, nickname, termId: id, teacherId: id, totalPoints: integer }));
        case '/moderation/reports': return paged(report);
        case '/moderation/actions': return paged(object({ id: integer, version: { type: ['integer', 'null'] }, contentId: id, actorId: id, oldStatus: str(), newStatus: str(), reason: optionalReason, createdAt: timestamp }));
        case '/moderation/reports/{id}': return object({ id, status: str() });
        case '/contents/{id}/vote': return object({ id, score: integer, myVote: { type: 'integer', enum: [-1,0,1] } });
        case '/contents/{id}': return object({ id, status: { const: 'deleted' } });
        case '/contents/{id}/moderation': return object({ id, status: str(), changed: bool });
        case '/questions/{id}/acceptance': return { allOf: [ref('Content'), { type: 'object', properties: { changed: bool }, required: ['changed'] }] };
        case '/moderation/contents/{id}': return ref('ReviewContent');
        case '/internal/documents': return object({ items: { type: 'array', items: object({ documentId: str(160), id: str(), kind: enumeration('course','material','question','answer'),
            courseId: courseId, title: { type: ['string','null'] }, body: { anyOf: [{ type: 'string' }, body, { type: 'null' }] }, format: enumeration('text', 'prosemirror'), tags, targetKind: nullableKind, targetId: nullableId, updatedAt: timestamp }) },
            nextCursor: { type: 'string' }, hasMore: bool });
        case '/internal/contents/{id}': return { oneOf: [object({ id, available: { const: false } }), { allOf: [ref('Content'), { type: 'object', properties: { available: { const: true } }, required: ['available'] }] }] };
        default: throw new Error('Missing response schema: ' + path);
    }
}

const paths: Record<string, Record<string, unknown>> = {};
const methodNotAllowed = { description: '路径存在，请求方法不支持', headers: { Allow: { required: true, schema: { type: 'string' } } } };
for (const d of defs) {
    const path = `/api${d.path}`;
    const parameters = [...Array.from(path.matchAll(/\{(\w+)\}/g), m => ({ name: m[1], in: 'path', required: true, schema: m[1] === 'type' && d.path.startsWith('/me/favorites/') ? enumeration('course','material','question') : m[1] === 'targetId' ? { anyOf: [courseId, id] } : m[1] === 'version' ? positiveInteger : m[1] === 'id' && d.path.startsWith('/courses/') ? courseId : id })), ...(d.parameters ?? [])];
    if (d.auth !== 'internal' && !['get', 'head', 'options'].includes(d.method)) parameters.push({ name: 'Origin', in: 'header', required: true, schema: { type: 'string', format: 'uri' } });
    if (d.create) parameters.push({ name: 'Idempotency-Key', in: 'header', required: d.idempotencyKeyRequired ?? true, schema: { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' } });
    const security = d.auth === 'internal' ? [{ internalBearer: [] }] : d.auth === 'session'
        ? [{ sessionCookie: [] }] : [{}, { sessionCookie: [] }];
    paths[path] ??= {};
    paths[path][d.method] = {
        summary: d.summary, operationId: `${d.method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`, security, parameters,
        ...(d.request ? { requestBody: { required: d.requestRequired ?? true, content: Object.fromEntries((d.requestMimes ?? ['application/json']).map(mime => [mime, { schema: d.request }])) } } : {}),
        responses: {
            ...(d.responseMimes ? { '200': { description: '图片文件', content: Object.fromEntries(d.responseMimes.map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) } } : d.binary ? {
                '200': { description: '文件响应；HEAD 仅返回响应头', ...(d.method === 'head' ? {} : { content: { '*/*': { schema: { type: 'string', format: 'binary' } } } }) },
                ...(d.method === 'head' ? {} : { '206': { description: '单一字节范围', content: { '*/*': { schema: { type: 'string', format: 'binary' } } } }, '416': { description: '无效范围，Content-Range 为 bytes */总大小' } }),
                '304': { description: '文件未变化，仍校验登录及当前可见性' },
            } : { [d.create ? '201' : '200']: { description: '成功',
                ...(d.sessionCookie ? { headers: { 'Set-Cookie': { description: d.sessionCookie === 'set' ? '设置会话 Cookie' : '清除会话 Cookie', schema: { type: 'string' } } } } : {}),
                content: { 'application/json': { schema: object({ data: d.response ?? (d.create ? object({ id }) : responseFor(d.path)) }) } } } }),
            '405': d.method === 'head' ? methodNotAllowed : { $ref: '#/components/responses/MethodNotAllowed' },
            ...(d.rateLimited ? { '429': { description: '尝试次数过多', content: { 'application/json': { schema: ref('Error') } } } } : {}),
            ...Object.fromEntries([400, 401, 403, 404, 409, 410, 413, 415, 500, 503].map(status => [String(status),
                { description: ({ 400: '参数错误', 401: '登录失效', 403: '权限不足', 404: '内容不可用', 409: '状态冲突或重复操作', 410: '上传过期', 413: '请求或文件过大', 415: '请求或文件类型不支持', 500: '服务错误', 503: '服务尚未配置' } as Record<number, string>)[status],
                    ...(d.method === 'head' ? {} : { content: { 'application/json': { schema: ref('Error') } } }) }]))
        },
    };
}
export const openapi = {
    openapi: '3.1.0', info: { title: 'CourseStack API', version: '6.1.0',
        description: '正文使用 Tiptap / ProseMirror JSON 对象，由前端按编辑器扩展配置安全渲染。公开资料不含学工号、姓名、院系、专业或年级。各接口标明会话和幂等键要求。课程和内容编辑按最终写入顺序生效，局部更新仅覆盖提交字段。课程号即课程 ID，课程与开课安排分离。积分和学生名单按课程、学期、教师的教学班管理。Cookie 写请求需可信 Origin。' },
    servers: [{ url: 'http://127.0.0.1:8787', description: '本地开发' }], paths,
    components: {
        responses: { MethodNotAllowed: { ...methodNotAllowed,
            content: { 'application/json': { schema: ref('Error') } } } },
        securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: 'coursestack_session', description: '所有环境均使用同名的 HttpOnly、SameSite=Strict Cookie，HTTPS 下加 Secure。写请求可带 X-Expected-Account 声明页面显示的账号 ID，与 Cookie 对应的账号不一致时返回 409 ACCOUNT_CHANGED' },
            internalBearer: { type: 'http', scheme: 'bearer', description: '内部服务专用凭据，不得放入前端' },
        },
        schemas: {
            Error: object({ error: object({ code: str(80), message: { type: 'string' } }) }),
            ...accountSchemas,
            ...favoriteSchemas,
            ...richTextSchemas,
            ...materialSchemas,
            ...teacherSchemas,
            ...searchSchemas,
            ...notificationSchemas,
            CourseId: courseId,
            BonusPolicy: object(bonusPolicy),
            LedgerEntry: ledger,
            MyLedgerEntry: object({ ...(ledger.properties as Record<string, Schema>), courseName: str(120), termName: str(120) }),
            MyBonusLedgerPage: object({ ...(paged(ref('MyLedgerEntry')).properties as Record<string, Schema>), totalPoints: integer }),
            MyBonusPolicy: object({ courseId, currentTerm: { anyOf: [object({ id, name: str(120) }), { type: 'null' }] },
                membership: { anyOf: [object({ teacher: object({ id, nickname, isDeleted: bool }), bonusPolicy: ref('BonusPolicy') }), { type: 'null' }] } }),
            BonusEventPage: object({ items: { type: 'array', items: ref('MyLedgerEntry') }, nextCursor: { type: 'integer', minimum: 0 }, hasMore: bool }),
            Term: object({ id, name: str(120), current: bool }),
            TeachingClass: object({ courseId, termId: id, teacherId: id, course: object({ id: courseId, name: str(120) }), term: ref('Term'),
                teacher: object({ id, nickname, isDeleted: bool }), studentCount: { type: 'integer', minimum: 0 }, bonusPolicy: ref('BonusPolicy') }),
            RosterEvent: object({ id: positiveInteger,
                action: enumeration('class_created', 'class_deleted', 'student_added', 'student_removed', 'student_transferred'),
                course: object({ id: courseId, name: str(120) }), term: object({ id, name: str(120) }),
                teacher: { ...object({ id, nickname, isDeleted: bool }), description: '变更所在教学班的教师；转班时为转出班教师' },
                targetTeacher: { anyOf: [object({ id, nickname, isDeleted: bool }), { type: 'null' }], description: '仅转班时为转入班教师' },
                student: { anyOf: [object({ id, schoolNumber: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, isDeleted: bool }), { type: 'null' }],
                    description: '教学班建立、删除时为 null；删除教学班时，留班学生各有一条移除记录' },
                operator: object({ id, nickname, isDeleted: bool, role: enumeration('student', 'teacher', 'admin') }), createdAt: timestamp }),
            ClassStudent: object({ studentId: id, nickname, status: enumeration('active', 'disabled', 'deleted'),
                totalPoints: { ...integer, description: '该学生在路径指定教学班全部流水的净积分，无记录为 0，可为负数' },
                ...Object.fromEntries(['schoolNumber', 'name', 'department', 'major', 'grade'].map(key => [key, { type: ['string', 'null'] }])) }),
            StudentImportResult: object({
                ...Object.fromEntries(['addedCount', 'existingCount', 'failedCount', 'duplicateCount'].map(key => [key, { type: 'integer', minimum: 0 }])),
                items: { type: 'array', maxItems: 500, items: { oneOf: [
                    object({ schoolNumber: { type: 'string' }, status: enumeration('added', 'existing') }),
                    object({ schoolNumber: { type: 'string' }, status: { const: 'failed' },
                        code: enumeration('INVALID_SCHOOL_NUMBER', 'STUDENT_NOT_FOUND', 'STUDENT_ASSIGNMENT_CONFLICT'), message: { type: 'string' } }),
                ] } },
            }),
            Course: object({ id: courseId, ...courseFields,
                currentTerm: { anyOf: [object({ id, name: str(120) }), { type: 'null' }] }, offeredInCurrentTerm: bool,
                currentTeachers: { type: 'array', items: object({ id, nickname, isDeleted: bool }) }, createdAt: timestamp, updatedAt: timestamp }),
            ReplyTo: object({ id, author: object({ nickname, isDeleted: bool }), isDeleted: bool }),
            Content: { type: 'object', required: ['id', 'kind', 'courseId', 'status', 'isPublic', 'canDelete', 'author', 'body', 'score', 'targetKind', 'targetId', ...Object.keys(contentMetadata)],
                allOf: [questionCounts],
                properties: { id, kind: enumeration('material', 'question', 'answer', 'comment'), courseId: courseId, status: enumeration('visible', 'hidden', 'deleted'), isPublic: bool, canDelete: { ...bool, description: '当前所有者是否可直接删除，包含隐藏讨论及采纳限制；管理者删除使用专门审查接口' },
                    author: object({ id, nickname, avatarUrl: { type: ['string', 'null'], description: '当前头像的同源 Worker 地址；未设置、禁用或已删除账号为 null' }, isDeleted: { type: 'boolean' }, isTeacher: { type: 'boolean' }, isCourseTeacher: { type: 'boolean' } }),
                    title: { type: ['string', 'null'] }, body: nullableBody, format: { const: 'prosemirror' }, tags, latestVersion: { anyOf: [ref('FileVersion'), { type: 'null' }] },
                    targetKind: nullableKind, targetId: nullableId, ...contentMetadata, answerCount, acceptedAnswerId: { type: ['string', 'null'] }, solved: { type: 'boolean' },
                    isAccepted: { type: 'boolean' }, score: { type: 'integer' }, myVote: { type: 'integer', enum: [-1, 0, 1] }, createdAt: { type: 'integer' }, updatedAt: { type: 'integer' } } },
            Tombstone: object({ id, kind: { const: 'comment' }, courseId: courseId, targetKind: enumeration('material', 'question', 'answer', 'comment'), targetId: id,
                status: { const: 'deleted' }, body: { type: 'null' }, ...contentMetadata }),
            ReviewContent: { allOf: [ref('Content'), { type: 'object', properties: { actions: { type: 'array', items: object({
                id: integer, version: { type: ['integer', 'null'] }, actorId: id, oldStatus: str(), newStatus: str(), reason: optionalReason, createdAt: timestamp }, ['id', 'oldStatus', 'newStatus', 'reason', 'createdAt']) } }, required: ['actions'] }] },
            ContentPage: object({ items: { type: 'array', items: ref('Content') }, page: positiveInteger, pageSize: positiveInteger, total: { type: 'integer', minimum: 0 } }),
            CoursePage: object({ items: { type: 'array', items: ref('Course') }, page: positiveInteger, pageSize: positiveInteger, total: { type: 'integer', minimum: 0 } }),
            MyCoursePage: object({ items: { type: 'array', items: object({ course: ref('Course'),
                terms: { type: 'array', items: object({ id, name: { type: 'string' }, current: bool }) } }) },
                page: positiveInteger, pageSize: positiveInteger, total: { type: 'integer', minimum: 0 }, scope: enumeration('current', 'history'),
                currentTerm: { anyOf: [object({ id, name: { type: 'string' } }), { type: 'null' }] } }),
        },
    },
};
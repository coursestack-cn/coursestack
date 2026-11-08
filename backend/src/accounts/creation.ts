import { HttpError, stringField } from '../http.ts';
import { digest, hashPassword, passwordField, verifyPassword } from '../auth/crypto.ts';
import { allowFields } from './validation.ts';
import { accountDetail, profileValues } from './service.ts';
import { type Session } from './mutations.ts';

type CreationRequest = { accountId: string; requestHash: string; password: string | null; version: number; status: string };
export async function createMember(binding: D1Database, session: Session, body: Record<string, unknown>, key?: string) {
    if (session.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
    allowFields(body, ['role', 'schoolNumber', 'nickname', 'name', 'password', 'department', 'major', 'grade', 'mustChangePassword']);
    if (body.role !== 'student' && body.role !== 'teacher') throw new HttpError(400, 'INVALID_ROLE', '只能创建学生或教师账号');
    if (body.mustChangePassword !== undefined && typeof body.mustChangePassword !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'mustChangePassword必须是布尔值');
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, 'INVALID_REQUEST_KEY', '创建请求标识格式不正确');
    const schoolNumber = stringField(body, 'schoolNumber', 64), profile = profileValues(body), password = passwordField(body.password);
    const fields = { role: body.role, schoolNumber, nickname: profile.nickname ?? null, name: profile.name ?? null,
        department: profile.department ?? null, major: profile.major ?? null, grade: profile.grade ?? null, mustChangePassword: body.mustChangePassword === true };
    // Never store a fast hash of a password in the idempotency record. Replays verify the account's salted password hash instead.
    const fingerprint = key ? await digest(JSON.stringify(fields)) : '';
    const lookup = () => binding.prepare(`SELECT r.account_id AS accountId,r.request_hash AS requestHash,
        a.password,a.credential_version AS version,a.status FROM account_creation_requests r JOIN accounts a ON a.id=r.account_id
        WHERE r.actor_id=? AND r.request_key=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND status<>'deleted')`)
        .bind(session.id, key, session.id).first<CreationRequest>();
    const replay = async (request: CreationRequest) => {
        if (request.requestHash !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同的创建内容');
        if (request.status === 'deleted' || request.version !== 1) throw new HttpError(409, 'CREATED_ACCOUNT_CHANGED', '该请求已创建账号，但账号身份或凭据已变化，请核对账号列表');
        if (!await verifyPassword(password, request.password)) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同的创建内容');
        return accountDetail(binding, request.accountId);
    };
    if (key) { const previous = await lookup(); if (previous) return replay(previous); }
    const id = crypto.randomUUID(), passwordHash = await hashPassword(password);
    const gate = `EXISTS(SELECT 1 FROM accounts WHERE id=? AND status<>'deleted')`;
    const result = await binding.batch([
        binding.prepare(`SELECT 1 AS allowed WHERE ${gate}`).bind(session.id),
        binding.prepare(`INSERT INTO accounts(id,nickname,role,school_number,password,name,department,major,grade,must_change_password)
            SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}
            ${key ? 'AND NOT EXISTS(SELECT 1 FROM account_creation_requests WHERE actor_id=? AND request_key=?)' : ''}
            ON CONFLICT DO NOTHING`)
            .bind(id, fields.nickname, fields.role, schoolNumber, passwordHash, fields.name, fields.department, fields.major, fields.grade,
                fields.mustChangePassword ? 1 : 0, session.id, ...(key ? [session.id, key] : [])),
        ...(key ? [binding.prepare(`INSERT INTO account_creation_requests(actor_id,request_key,account_id,request_hash)
            SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=?)`).bind(session.id, key, id, fingerprint, id)] : []),
    ]);
    if (!result[0].results.length) throw new HttpError(409, 'ACCOUNT_DELETED', '操作者身份已变更');
    if (result[1].meta.changes === 1) return accountDetail(binding, id);
    if (key) { const previous = await lookup(); if (previous) return replay(previous); }
    throw new HttpError(409, 'SCHOOL_NUMBER_EXISTS', '该学工号已存在');
}
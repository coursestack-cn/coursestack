import { digest, hashPassword, passwordField, randomToken } from '../auth/crypto.ts';
import { HttpError, stringField } from '../http.ts';
import { mutateAccount, type Session } from './mutations.ts';
import { allowFields, optionalProfileField, pagination } from './validation.ts';

type AccountRow = {
    id: string; nickname: string; role: 'student' | 'teacher' | 'admin'; status: 'active' | 'disabled';
    createdAt: number; lastLoginAt: number | null; avatarKey: string | null; mustChangePassword: number;
    schoolNumber: string | null; name: string | null; department: string | null; major: string | null; grade: string | null;
};
const projection = `id, nickname, role, status, created_at AS createdAt, last_login_at AS lastLoginAt,
    avatar_key AS avatarKey, must_change_password AS mustChangePassword, school_number AS schoolNumber,
    name, department, major, grade`;
function accountDto({ avatarKey, mustChangePassword, ...row }: AccountRow) {
    return { ...row, mustChangePassword: Boolean(mustChangePassword),
        avatarUrl: avatarKey ? `/api/profiles/${encodeURIComponent(row.id)}/avatar` : null };
}
export async function accountDetail(binding: D1Database, id: string) {
    const row = await binding.prepare(`SELECT ${projection} FROM accounts WHERE id = ? AND status <> 'deleted'`).bind(id).first<AccountRow>();
    if (!row) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    return accountDto(row);
}
export async function listAccounts(binding: D1Database, url: URL) {
    const { page, pageSize, offset } = pagination(url);
    const role = url.searchParams.get('role'), status = url.searchParams.get('status'), q = url.searchParams.get('q')?.trim();
    if (role && !['student', 'teacher', 'admin'].includes(role)) throw new HttpError(400, 'INVALID_ROLE', '身份筛选不正确');
    if (status && !['active', 'disabled'].includes(status)) throw new HttpError(400, 'INVALID_STATUS', '状态筛选不正确');
    if (q && q.length > 100) throw new HttpError(400, 'INVALID_QUERY', '查询文字过长');
    const conditions = ["status <> 'deleted'"], values: string[] = [];
    if (role) { conditions.push('role = ?'); values.push(role); }
    if (status) { conditions.push('status = ?'); values.push(status); }
    if (q) {
        conditions.push("instr(lower(nickname || ' ' || coalesce(school_number, '') || ' ' || coalesce(name, '') || ' ' || coalesce(department, '') || ' ' || coalesce(major, '') || ' ' || coalesce(grade, '')), lower(?)) > 0");
        values.push(q);
    }
    const where = conditions.join(' AND ');
    const result = await binding.prepare(`SELECT ${projection} FROM accounts WHERE ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
        .bind(...values, pageSize, offset).all<AccountRow>();
    const total = await binding.prepare(`SELECT count(*) AS total FROM accounts WHERE ${where}`).bind(...values).first<number>('total');
    return { items: result.results.map(accountDto), page, pageSize, total };
}

const columns: Record<string, string> = { nickname: 'nickname', schoolNumber: 'school_number', name: 'name',
    department: 'department', major: 'major', grade: 'grade', status: 'status' };
export function profileValues(body: Record<string, unknown>) {
    const values: Record<string, string | null> = {};
    for (const key of ['nickname', 'schoolNumber']) if (body[key] !== undefined) values[key] = stringField(body, key, key === 'nickname' ? 80 : 64);
    for (const [key, label, max] of [['name', '姓名', 80], ['department', '院系', 120], ['major', '专业', 120], ['grade', '年级', 40]] as const) {
        if (body[key] !== undefined) values[key] = optionalProfileField(body[key], label, max);
    }
    if (body.status !== undefined) {
        if (body.status !== 'active' && body.status !== 'disabled') throw new HttpError(400, 'INVALID_STATUS', '状态不正确');
        values.status = body.status;
    }
    return values;
}
const eraseIdentity = `nickname = '已删除', school_number = NULL, password = NULL, must_change_password = 0,
    name = NULL, department = NULL, major = NULL, grade = NULL, avatar_key = NULL, last_login_at = NULL, status = 'deleted'`;

export async function updateAccount(binding: D1Database, session: Session, id: string, body: Record<string, unknown>) {
    allowFields(body, ['nickname', 'status', 'role', 'schoolNumber', 'name', 'department', 'major', 'grade']);
    if (!Object.keys(body).length) throw new HttpError(400, 'EMPTY_UPDATE', '没有需要修改的字段');
    if (body.role !== undefined && body.role !== 'student' && body.role !== 'teacher') throw new HttpError(400, 'INVALID_ROLE', '只能设置学生或教师身份');
    const current = await accountDetail(binding, id), values = profileValues(body);
    if (current.role === 'admin' && ['status', 'role', 'schoolNumber'].some(key => body[key] !== undefined)) {
        throw new HttpError(403, 'ADMIN_PROTECTED', '不能禁用、变更唯一管理员身份或设置管理员学工号');
    }
    if ((body.role ?? current.role) === 'student' && (values.name === null || !(values.name ?? current.name) || !(values.schoolNumber ?? current.schoolNumber))) {
        throw new HttpError(400, 'STUDENT_IDENTITY_REQUIRED', '学生需要姓名和学号');
    }
    if (body.role && body.role !== current.role) {
        const replacementId = crypto.randomUUID();
        // The copy and retirement share a transaction. No business rows are moved or deleted.
        const copy = (key: string) => Object.hasOwn(values, key) ? '?' : columns[key];
        const copyKeys = ['nickname', 'status', 'name', 'department', 'major', 'grade'];
        await mutateAccount(binding, session, id, 'account.replace', Object.keys(body), true, gate => [
            binding.prepare(`INSERT INTO accounts (id, nickname, role, status, school_number, password, must_change_password,
                credential_version, data_generation, name, department, major, grade, created_at, last_login_at, avatar_key)
                SELECT ?, ${copy('nickname')}, ?, ${copy('status')}, NULL, password, must_change_password,
                    credential_version + 1, 1, ${copy('name')}, ${copy('department')}, ${copy('major')}, ${copy('grade')},
                    created_at, last_login_at, avatar_key FROM accounts WHERE id = ? AND ${gate}`)
                .bind(replacementId, ...(Object.hasOwn(values, 'nickname') ? [values.nickname] : []), body.role as string,
                    ...copyKeys.filter(key => key !== 'nickname' && Object.hasOwn(values, key)).map(key => values[key]), id),
            binding.prepare(`UPDATE accounts SET status = 'disabled', credential_version = credential_version + 1,
                data_generation = data_generation + 1 WHERE id = ? AND ${gate}`).bind(id),
            binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`).bind(id),
            binding.prepare(`UPDATE accounts SET status = 'deleted' WHERE id = ? AND ${gate}`).bind(id),
            binding.prepare(`UPDATE accounts SET school_number = ${Object.hasOwn(values, 'schoolNumber') ? '?' : '(SELECT school_number FROM accounts WHERE id = ?)'}
                WHERE id = ? AND ${gate}`).bind(Object.hasOwn(values, 'schoolNumber') ? values.schoolNumber : id, replacementId),
            binding.prepare(`UPDATE accounts SET ${eraseIdentity} WHERE id = ? AND ${gate}`).bind(id),
        ]);
        return { ...await accountDetail(binding, replacementId), previousId: id };
    }
    const entries = Object.entries(values);
    const revoke = body.schoolNumber !== undefined || body.status !== undefined;
    await mutateAccount(binding, session, id, 'account.update', Object.keys(body), true, gate => [
        ...(entries.length ? [binding.prepare(`UPDATE accounts SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE id = ? AND ${gate}`)
            .bind(...entries.map(([, value]) => value), id)] : []),
        ...(revoke ? [binding.prepare(`UPDATE accounts SET credential_version = credential_version + 1 WHERE id = ? AND ${gate}`).bind(id),
            binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`).bind(id)] : []),
    ]);
    return accountDetail(binding, id);
}

export async function deleteAccount(binding: D1Database, session: Session, id: string) {
    const current = await accountDetail(binding, id);
    if (current.role === 'admin') throw new HttpError(403, 'ADMIN_PROTECTED', '不能删除唯一管理员');
    const result = await mutateAccount(binding, session, id, 'account.delete', ['identity'], true, gate => [
        binding.prepare(`SELECT avatar_key FROM accounts WHERE id = ? AND ${gate}`).bind(id),
        binding.prepare(`UPDATE accounts SET status = 'disabled', credential_version = credential_version + 1,
            data_generation = data_generation + 1 WHERE id = ? AND ${gate}`).bind(id),
        binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`).bind(id),
        binding.prepare(`UPDATE accounts SET ${eraseIdentity} WHERE id = ? AND ${gate}`).bind(id),
    ]);
    return { id, deleted: true, avatarKey: (result[1].results[0] as { avatar_key: string | null } | undefined)?.avatar_key ?? null };
}

export async function resetMemberPassword(binding: D1Database, session: Session, id: string, body: Record<string, unknown>) {
    allowFields(body, ['newPassword', 'mustChangePassword']);
    if (body.mustChangePassword !== undefined && typeof body.mustChangePassword !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'mustChangePassword 必须是布尔值');
    const generatedPassword = body.newPassword === undefined || body.newPassword === '' ? randomToken().slice(0, 24) : undefined;
    const passwordHash = await hashPassword(passwordField(generatedPassword ?? body.newPassword));
    const current = await accountDetail(binding, id);
    if (current.role === 'admin') throw new HttpError(403, 'ADMIN_PROTECTED', '管理员密码只能通过改密或外部重置命令修改');
    if (!current.schoolNumber) throw new HttpError(409, 'CREDENTIALS_REQUIRED', '该账号尚未设置学工号');
    const throttles = [await digest(`member:${current.schoolNumber}`), await digest(`password:${id}`)];
    await mutateAccount(binding, session, id, 'password.reset', ['password', 'mustChangePassword'], true, gate => [
        binding.prepare(`UPDATE accounts SET password = ?, credential_version = credential_version + 1, must_change_password = ? WHERE id = ? AND ${gate}`)
            .bind(passwordHash, body.mustChangePassword ? 1 : 0, id),
        binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`).bind(id),
        binding.prepare(`DELETE FROM login_attempts WHERE key IN (?, ?) AND ${gate}`).bind(...throttles),
    ]);
    return { ...await accountDetail(binding, id), ...(generatedPassword ? { generatedPassword } : {}) };
}

export async function updateNickname(binding: D1Database, session: Session, body: Record<string, unknown>) {
    allowFields(body, ['nickname']);
    const nickname = stringField(body, 'nickname');
    await mutateAccount(binding, session, session.id, 'profile.update', ['nickname'], false,
        gate => [binding.prepare(`UPDATE accounts SET nickname = ? WHERE id = ? AND ${gate}`).bind(nickname, session.id)]);
    return accountDetail(binding, session.id);
}

export async function accountHistory(binding: D1Database, id: string, url: URL) {
    if (!await binding.prepare('SELECT 1 FROM accounts WHERE id = ?').bind(id).first()) {
        throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    }
    const { page, pageSize, offset } = pagination(url);
    const rows = await binding.prepare(`SELECT id, actor_id AS actorId, target_id AS targetId, action, fields, created_at AS createdAt
        FROM account_audit WHERE target_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(id, pageSize, offset).all();
    const total = await binding.prepare('SELECT count(*) AS total FROM account_audit WHERE target_id = ?').bind(id).first<number>('total');
    return { items: rows.results.map(row => ({ ...row, fields: JSON.parse(row.fields as string) })), total, page, pageSize };
}
import { HttpError, stringField } from '../http.ts';
import { mutateAccount, type Session } from './mutations.ts';
import { allowFields, emailField, pagination, revisionField } from './validation.ts';

type AccountRow = {
  id: string; publicName: string; status: 'active' | 'disabled'; revision: number;
  createdAt: number; lastLoginAt: number | null; avatarKey: string | null;
  schoolNumber: string | null; realName: string | null; email: string | null;
  emailVerifiedAt: number | null; roles: string;
};

const projection = `a.id, a.public_name AS publicName, a.status, a.revision,
  a.created_at AS createdAt, a.last_login_at AS lastLoginAt, a.avatar_key AS avatarKey,
  c.school_number AS schoolNumber, COALESCE(p.real_name, sr.real_name) AS realName,
  p.email, p.email_verified_at AS emailVerifiedAt,
  (SELECT json_group_array(role) FROM account_roles WHERE account_id = a.id) AS roles`;
const tables = `accounts a LEFT JOIN credentials c ON c.account_id = a.id
  LEFT JOIN account_private p ON p.account_id = a.id LEFT JOIN student_records sr ON sr.account_id = a.id`;

function accountDto(row: AccountRow) {
  const { avatarKey, roles, ...rest } = row;
  return { ...rest, avatarUrl: avatarKey ? `/api/profiles/${encodeURIComponent(row.id)}/avatar` : null, roles: JSON.parse(roles) as string[] };
}

export async function accountDetail(binding: D1Database, id: string) {
  const row = await binding.prepare(`SELECT ${projection} FROM ${tables} WHERE a.id = ?`).bind(id).first<AccountRow>();
  if (!row) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
  return accountDto(row);
}

export async function listAccounts(binding: D1Database, url: URL) {
  const { page, pageSize, offset } = pagination(url);
  const role = url.searchParams.get('role');
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (role && !['student', 'teacher', 'admin'].includes(role)) throw new HttpError(400, 'INVALID_ROLE', '身份筛选不正确');
  if (status && !['active', 'disabled'].includes(status)) throw new HttpError(400, 'INVALID_STATUS', '状态筛选不正确');
  if (q.length > 100) throw new HttpError(400, 'INVALID_QUERY', '查询文字过长');
  const conditions: string[] = [];
  const values: string[] = [];
  if (role) { conditions.push('EXISTS (SELECT 1 FROM account_roles WHERE account_id = a.id AND role = ?)'); values.push(role); }
  if (status) { conditions.push('a.status = ?'); values.push(status); }
  if (q) {
    conditions.push("instr(lower(a.public_name || ' ' || coalesce(c.school_number, '') || ' ' || coalesce(p.real_name, sr.real_name, '') || ' ' || coalesce(p.email, '')), lower(?)) > 0");
    values.push(q);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await binding.prepare(`SELECT ${projection} FROM ${tables} ${where} ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, offset).all<AccountRow>();
  const total = await binding.prepare(`SELECT count(*) AS total FROM ${tables} ${where}`).bind(...values).first<number>('total');
  return { items: result.results.map(accountDto), page, pageSize, total };
}

export async function updateAccount(binding: D1Database, session: Session, id: string, body: Record<string, unknown>) {
  allowFields(body, ['revision', 'status', 'role', 'schoolNumber', 'realName', 'email']);
  const revision = revisionField(body.revision);
  const fields = Object.keys(body).filter((key) => key !== 'revision');
  if (!fields.length) throw new HttpError(400, 'EMPTY_UPDATE', '没有需要修改的字段');
  const current = await accountDetail(binding, id);
  if (current.roles.includes('admin') && fields.some((key) => ['status', 'role', 'schoolNumber'].includes(key))) {
    throw new HttpError(403, 'ADMIN_PROTECTED', '不能禁用、变更唯一管理员身份或设置管理员学工号');
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') throw new HttpError(400, 'INVALID_STATUS', '状态不正确');
  if (body.role !== undefined && body.role !== 'student' && body.role !== 'teacher') throw new HttpError(400, 'INVALID_ROLE', '只能设置学生或教师身份');
  const role = body.role as 'student' | 'teacher' | undefined;
  const roleChanged = role !== undefined && !current.roles.includes(role);
  if (roleChanged) {
    const related = await binding.prepare(`SELECT 1 FROM enrollments WHERE student_id = ?
      UNION ALL SELECT 1 FROM teaching_assignments WHERE teacher_id = ? LIMIT 1`).bind(id, id).first();
    if (related || current.roles.length !== 1) throw new HttpError(409, 'RELATED_RECORDS_EXIST', '账号存在授课、修读或多重身份记录，不能直接切换身份');
  }
  const schoolNumber = body.schoolNumber === undefined ? current.schoolNumber : stringField(body, 'schoolNumber', 64);
  const realName = body.realName === undefined ? current.realName : stringField(body, 'realName');
  const email = body.email === undefined ? current.email : emailField(body.email);
  const student = role === 'student' || (!role && current.roles.includes('student'));
  if (student && (!realName || !schoolNumber)) throw new HttpError(400, 'STUDENT_IDENTITY_REQUIRED', '学生需要真实姓名和学号');
  const numberChanged = schoolNumber !== current.schoolNumber;
  if (numberChanged && !current.schoolNumber) throw new HttpError(409, 'CREDENTIALS_REQUIRED', '该账号尚未建立登录凭据');
  const emailChanged = email !== current.email;
  const statusChanged = body.status !== undefined && body.status !== current.status;
  await mutateAccount(binding, session, id, revision, 'account.update', fields, true, (gate) => [
    ...(body.status !== undefined ? [binding.prepare(`UPDATE accounts SET status = ? WHERE id = ? AND ${gate}`).bind(body.status, id)] : []),
    binding.prepare(`INSERT INTO account_private (account_id, real_name, email)
      SELECT ?, ?, ? WHERE ${gate} ON CONFLICT(account_id) DO UPDATE SET
      real_name = excluded.real_name, email = excluded.email,
      email_verified_at = CASE WHEN email IS excluded.email THEN email_verified_at ELSE NULL END,
      email_version = email_version + CASE WHEN email IS excluded.email THEN 0 ELSE 1 END`).bind(id, realName, email),
    ...(roleChanged ? [
      binding.prepare(`DELETE FROM student_records WHERE account_id = ? AND ${gate}`).bind(id),
      binding.prepare(`DELETE FROM account_roles WHERE account_id = ? AND ${gate}`).bind(id),
      binding.prepare(`INSERT INTO account_roles (account_id, role) SELECT ?, ? WHERE ${gate}`).bind(id, role!),
    ] : []),
    ...(student ? [binding.prepare(`INSERT INTO student_records (account_id, student_number, real_name)
      SELECT ?, ?, ? WHERE ${gate} ON CONFLICT(account_id) DO UPDATE SET student_number = excluded.student_number, real_name = excluded.real_name`)
      .bind(id, schoolNumber, realName)] : []),
    ...(numberChanged || roleChanged || statusChanged || emailChanged ? [
      binding.prepare(`UPDATE credentials SET school_number = ?, version = version + 1 WHERE account_id = ? AND ${gate}`).bind(schoolNumber, id),
      binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`).bind(id),
      binding.prepare(`DELETE FROM email_tokens WHERE account_id = ? AND ${gate}`).bind(id),
    ] : []),
  ]);
  return accountDetail(binding, id);
}

export async function updatePublicName(binding: D1Database, session: Session, body: Record<string, unknown>) {
  allowFields(body, ['revision', 'publicName']);
  const revision = revisionField(body.revision);
  const name = stringField(body, 'publicName');
  await mutateAccount(binding, session, session.id, revision, 'profile.update', ['publicName'], false,
    (gate) => [binding.prepare(`UPDATE accounts SET public_name = ? WHERE id = ? AND ${gate}`).bind(name, session.id)]);
  return accountDetail(binding, session.id);
}

export async function accountHistory(binding: D1Database, id: string, url: URL) {
  await accountDetail(binding, id);
  const { page, pageSize, offset } = pagination(url);
  const rows = await binding.prepare(`SELECT id, actor_id AS actorId, target_id AS targetId, action, fields, created_at AS createdAt
    FROM account_audit WHERE target_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(id, pageSize, offset).all();
  const total = await binding.prepare('SELECT count(*) AS total FROM account_audit WHERE target_id = ?').bind(id).first<number>('total');
  return { items: rows.results.map((row) => ({ ...row, fields: JSON.parse(row.fields as string) })), total, page, pageSize };
}
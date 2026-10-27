import type { requireSession } from '../auth/service.ts';
import { HttpError } from '../http.ts';
import { conflict } from './validation.ts';

export type Session = Awaited<ReturnType<typeof requireSession>>;

// Entry authentication admits a request. Only identity retirement fences its writes.
export async function mutateAccount(
    binding: D1Database, session: Session, targetId: string,
    action: string, fields: string[], adminOnly: boolean,
    statements: (gate: string) => D1PreparedStatement[],
) {
    if (adminOnly ? session.role !== 'admin' : session.id !== targetId) {
        throw new HttpError(403, 'FORBIDDEN', '没有修改此账号的权限');
    }
    const receipt = crypto.randomUUID();
    const gate = `EXISTS (SELECT 1 FROM account_audit WHERE id = '${receipt}')`;
    try {
        const result = await binding.batch([
            binding.prepare(`INSERT INTO account_audit (id, actor_id, target_id, action, fields)
                SELECT ?, actor.id, target.id, ?, ? FROM accounts target
                JOIN accounts actor ON actor.id = ? AND actor.data_generation = ?
                WHERE target.id = ? AND target.status <> 'deleted' AND actor.status <> 'deleted'`)
                .bind(receipt, action, JSON.stringify(fields), session.id, session.dataGeneration, targetId),
            ...statements(gate),
        ]);
        if (result[0].meta.changes !== 1) throw new HttpError(409, 'ACCOUNT_RETIRED', '账号身份已变更或删除，请重新登录或刷新账号列表');
        return result;
    } catch (error) { conflict(error); }
}
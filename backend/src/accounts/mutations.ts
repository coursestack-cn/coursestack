import type { requireSession } from '../auth/service.ts';
import { HttpError } from '../http.ts';
import { conflict } from './validation.ts';

export type Session = Awaited<ReturnType<typeof requireSession>>;

// Every mutation revalidates the session inside the D1 transaction. A unique audit
// receipt gates all subsequent writes, making stale revisions a complete no-op.
export async function mutateAccount(
  binding: D1Database, session: Session, targetId: string, revision: number,
  action: string, fields: string[], adminOnly: boolean,
  statements: (gate: string) => D1PreparedStatement[],
) {
  const receipt = crypto.randomUUID();
  const gate = `EXISTS (SELECT 1 FROM account_audit WHERE id = '${receipt}')`;
  const authorization = adminOnly
    ? "EXISTS (SELECT 1 FROM account_roles WHERE account_id = actor.id AND role = 'admin')"
    : 'actor.id = target.id';
  try {
    const result = await binding.batch([
      binding.prepare(`INSERT INTO account_audit (id, actor_id, target_id, action, fields)
        SELECT ?, actor.id, target.id, ?, ? FROM accounts target
        JOIN accounts actor ON actor.id = ? AND actor.status = 'active'
        JOIN credentials c ON c.account_id = actor.id
        JOIN sessions s ON s.account_id = actor.id AND s.credential_version = c.version
        WHERE target.id = ? AND target.revision = ? AND s.token_hash = ?
          AND s.expires_at > unixepoch() AND ${authorization}`)
        .bind(receipt, action, JSON.stringify(fields), session.id, targetId, revision, session.tokenHash),
      ...statements(gate),
      binding.prepare(`UPDATE accounts SET revision = revision + 1 WHERE id = ? AND ${gate}`).bind(targetId),
    ]);
    if (result[0].meta.changes !== 1) throw new HttpError(409, 'ACCOUNT_CHANGED', '账号或会话已变化，请刷新后重试');
  } catch (error) { conflict(error); }
}
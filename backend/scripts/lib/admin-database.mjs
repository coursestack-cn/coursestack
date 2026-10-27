import { HttpError } from '../../src/http.ts';

export function validateRemoteTarget(target) {
    if (!target || !/^[a-f0-9]{32}$/i.test(target.accountId ?? '')
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target.databaseId ?? '')
        || /^00000000-0000-0000-0000-/.test(target.databaseId)
        || Object.keys(target).some((key) => !['accountId', 'databaseId'].includes(key))) {
        throw new HttpError(400, 'INVALID_TARGET', '远程配置只能包含有效的 accountId、databaseId，不能使用本地占位 ID');
    }
    return target;
}

// A deliberately small adapter for maintenance queries. One batch is one HTTP
// request; splitting it into individual writes would break atomic revocation.
export function remoteAdminDatabase(target, token, request = fetch) {
    validateRemoteTarget(target);
    if (!token?.trim()) throw new HttpError(400, 'TOKEN_REQUIRED', '需要具有目标 D1 写权限的 Cloudflare API Token');
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/${target.databaseId}/query`;
    const payloads = new WeakMap();
    async function execute(statements) {
        let response;
        let payload;
        try {
            response = await request(endpoint, {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ batch: statements }),
            });
            payload = await response.json();
        } catch {
            throw new HttpError(503, 'REMOTE_RESULT_UNKNOWN', '未能确认远程操作结果，请先核对管理员状态及凭据版本，不要直接重复写入');
        }
        if (response.status === 401 || response.status === 403) {
            throw new HttpError(403, 'CLOUDFLARE_FORBIDDEN', 'Cloudflare 拒绝访问，请检查账号、数据库和 API Token 的 D1 权限');
        }
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.result)
            || payload.result.length !== statements.length
            || payload.result.some((result) => result.success !== true || !Array.isArray(result.results) || !result.meta)) {
            // Provider errors can include SQL or parameters. Never print them.
            throw new HttpError(503, 'D1_OPERATION_FAILED', 'D1 操作未确认成功，请核对数据库结构、管理员状态及凭据版本；未自动重试');
        }
        return payload.result;
    }
    function prepare(sql, params = []) {
        const statement = {
            bind(...values) { return prepare(sql, values.map((value) => value === null ? null : String(value))); },
            async first(column) {
                const [result] = await execute([payloads.get(statement)]);
                const row = result.results[0] ?? null;
                return column === undefined ? row : row?.[column] ?? null;
            },
        };
        payloads.set(statement, { sql, params });
        return statement;
    }
    return {
        prepare,
        batch(statements) {
            const queries = statements.map((statement) => payloads.get(statement));
            if (queries.some((query) => !query)) throw new Error('Unknown maintenance statement');
            return execute(queries);
        },
    };
}
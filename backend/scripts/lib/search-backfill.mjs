import { validateDoc } from '../../../shared/rich-text/index.ts';
import { bodySearchText } from '../../src/search/text.ts';

// The original body is part of every update predicate: a concurrent edit always wins.
export async function backfillSearchText(database, { check = false, batchSize = 50 } = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new RangeError('batchSize must be 1–100');
    let after = '', scanned = 0, mismatches = 0, updated = 0;
    while (true) {
        const [page] = await database.batch([database.prepare(`SELECT id,body,body_text FROM contents
            WHERE kind IN ('material','question','answer') AND status<>'deleted' AND id>?
            ORDER BY id LIMIT ?`).bind(after, batchSize)]);
        if (!page.results.length) break;
        const writes = [];
        for (const row of page.results) {
            scanned++;
            let document = null;
            if (row.body !== null) {
                const parsed = validateDoc(JSON.parse(row.body));
                if (!parsed.ok) throw new Error('Cannot extract an unsupported rich-text document');
                document = parsed.doc;
            }
            const text = bodySearchText(document);
            if (text === row.body_text) continue;
            mismatches++;
            if (!check) writes.push(database.prepare(`UPDATE contents SET body_text=?
                WHERE id=? AND body IS ? AND status<>'deleted' AND body_text IS NOT ?`).bind(text, row.id, row.body, text));
        }
        if (writes.length) {
            const results = await database.batch(writes);
            updated += results.reduce((sum, result) => sum + result.meta.changes, 0);
        }
        after = page.results.at(-1).id;
    }
    return { scanned, mismatches, updated };
}
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, idSchema } from '../http.ts';
import { management, requireManagement } from '../permissions.ts';
import type { AppEnv } from './types.ts';
import { publicDetail, visibleContent } from './service.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';

export const acceptanceRoutes = new Hono<AppEnv>();
acceptanceRoutes.put('/questions/:id/acceptance', async c => {
    const q = await visibleContent(c, c.req.param('id'), 'question'), actor = await requireManagement(c, q.course_id);
    const data = await input(c, z.object({ answerId: idSchema.nullable() }).strict());
    if (q.acceptedAnswerId === data.answerId) return respond(c, { ...await publicDetail(c, q.id), changed: false });
    const gate = sql`EXISTS(SELECT 1 FROM public_contents q WHERE q.id=${q.id} AND ${management(actor, sql`q.course_id`)})`;
    if (data.answerId === null) {
        // Save the actual cancelling operator before deleting the relation in this transaction.
        const result = await c.env.DB.batch([
            sql`UPDATE acceptances SET operator_id=${actor.id} WHERE question_id=${q.id} AND ${gate}`,
            sql`DELETE FROM acceptances WHERE question_id=${q.id} AND ${gate}`,
        ].map(statement => prepareStatement(c.env.DB, statement)));
        assertChanged(result[1]);
    } else {
        const answer = await visibleContent(c, data.answerId, 'answer');
        if (answer.target_id !== q.id) throw new HttpError(400, 'ANSWER_QUESTION_MISMATCH', '答案不属于此问题');
        const term = await createDatabase(c.env.DB).get<{ id: string }>(sql`SELECT id FROM terms WHERE current=1`);
        if (!term) throw new HttpError(409, 'NO_CURRENT_TERM', '采纳需指定当前学期');
        const result = await createDatabase(c.env.DB).run(sql`INSERT INTO acceptances(question_id,answer_id,operator_id,created_at)
            SELECT ${q.id},${answer.id},${actor.id},unixepoch() WHERE ${gate}
                AND EXISTS(SELECT 1 FROM terms WHERE id=${term.id} AND current=1)
            ON CONFLICT(question_id) DO UPDATE SET answer_id=excluded.answer_id,operator_id=excluded.operator_id,created_at=excluded.created_at
                WHERE acceptances.answer_id<>excluded.answer_id`);
        if (!result.meta.changes) {
            const current = await visibleContent(c, q.id, 'question');
            if (current.acceptedAnswerId !== answer.id) assertChanged(result);
            return respond(c, { ...await publicDetail(c, q.id), changed: false });
        }
    }
    return respond(c, { ...await publicDetail(c, q.id), changed: true });
});
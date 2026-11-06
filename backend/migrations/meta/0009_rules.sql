-- Deleted comments stay as thread placeholders; any other deleted or hidden content closes its branch.
CREATE VIEW accessible_contents AS
WITH RECURSIVE reachable(id) AS (
    SELECT id FROM contents WHERE target_id IS NULL AND status='visible'
    UNION ALL
    SELECT c.id FROM contents c JOIN reachable p ON c.target_id=p.id
    WHERE c.status='visible' OR (c.status='deleted' AND c.kind='comment')
)
SELECT c.* FROM contents c JOIN reachable r ON r.id=c.id;
--> statement-breakpoint
CREATE VIEW public_contents AS SELECT * FROM accessible_contents WHERE status='visible';
--> statement-breakpoint
-- Automatic rewards require a publicly available source; deletion and hiding both retract the affected branch.
CREATE VIEW rewardable_contents AS SELECT * FROM public_contents;
--> statement-breakpoint
CREATE VIEW public_acceptances AS
SELECT a.* FROM acceptances a JOIN public_contents q ON q.id=a.question_id JOIN public_contents answer ON answer.id=a.answer_id;
--> statement-breakpoint
CREATE VIEW bonus_sources AS
SELECT kind AS source_kind,id AS source_id FROM rewardable_contents WHERE kind IN ('question','answer','comment')
UNION ALL SELECT 'acceptance',answer_id FROM public_acceptances
UNION ALL SELECT 'material',f.material_id||'@'||f.version FROM file_versions f
    JOIN rewardable_contents m ON m.id=f.material_id;
--> statement-breakpoint
CREATE VIEW bonus_state AS
SELECT l.* FROM bonus_ledger l WHERE l.source_kind<>'manual'
    AND NOT EXISTS(SELECT 1 FROM bonus_ledger next WHERE next.reverses_id=l.id);
--> statement-breakpoint
-- Restoration uses the content's own term, never the current term. Legacy rows may use their original award's term.
CREATE VIEW bonus_recalculation AS
WITH sources AS (
    SELECT c.id AS content_id,c.kind AS source_kind,c.id AS source_id,c.course_id,c.term_id,c.author_id AS student_id,0 AS version
      FROM public_contents c WHERE c.kind IN ('question','answer','comment')
    UNION ALL SELECT c.id,'acceptance',c.id,c.course_id,c.term_id,c.author_id,0
      FROM public_acceptances a JOIN public_contents c ON c.id=a.answer_id
    UNION ALL SELECT c.id,'material',c.id||'@'||f.version,c.course_id,c.term_id,f.uploaded_by,f.version
      FROM public_contents c JOIN file_versions f ON f.material_id=c.id
), term_sources AS (
    SELECT s.*,COALESCE(s.term_id,(SELECT l.term_id FROM bonus_ledger l
      WHERE l.source_kind=s.source_kind AND l.source_id=s.source_id AND l.reverses_id IS NULL)) AS reward_term
    FROM sources s
)
SELECT s.content_id,s.source_kind,s.source_id,s.course_id,s.reward_term AS term_id,s.student_id,e.teacher_id,
    CASE s.source_kind WHEN 'question' THEN r.points_question WHEN 'answer' THEN r.points_answer
      WHEN 'comment' THEN r.points_comment WHEN 'acceptance' THEN r.points_acceptance
      ELSE CASE WHEN s.version=1 THEN r.points_material ELSE r.points_material_version END END AS points
FROM term_sources s JOIN accounts a ON a.id=s.student_id AND a.role='student'
JOIN class_students e ON e.course_id=s.course_id AND e.term_id=s.reward_term AND e.student_id=s.student_id
JOIN class_bonus_rules r ON r.course_id=e.course_id AND r.term_id=e.term_id AND r.teacher_id=e.teacher_id;
--> statement-breakpoint
CREATE TRIGGER account_role_immutable BEFORE UPDATE OF role ON accounts
WHEN NEW.role <> OLD.role
BEGIN SELECT RAISE(ABORT, 'replace_account_identity'); END;
--> statement-breakpoint
CREATE TRIGGER content_identity_immutable BEFORE UPDATE ON contents
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.course_id<>OLD.course_id OR NEW.author_id<>OLD.author_id
    OR NEW.target_id IS NOT OLD.target_id OR NEW.reply_to_id IS NOT OLD.reply_to_id OR NEW.term_id IS NOT OLD.term_id
BEGIN SELECT RAISE(ABORT,'content_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER content_insert_guard BEFORE INSERT ON contents
WHEN NEW.target_id IS NOT NULL OR NEW.reply_to_id IS NOT NULL BEGIN
    SELECT RAISE(ABORT,'invalid_content_target') WHERE NOT EXISTS (
        SELECT 1 FROM public_contents p WHERE p.id=NEW.target_id AND p.course_id=NEW.course_id
            AND ((NEW.kind='answer' AND p.kind='question') OR (NEW.kind='comment' AND p.kind IN ('question','answer','material'))));
    SELECT RAISE(ABORT,'invalid_comment_reply') WHERE NEW.reply_to_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public_contents reply WHERE reply.id=NEW.reply_to_id AND reply.kind='comment'
            AND reply.target_id=NEW.target_id AND reply.course_id=NEW.course_id);
END;
--> statement-breakpoint
CREATE TRIGGER moderation_version_guard BEFORE INSERT ON moderation_actions
WHEN NEW.version IS NOT NULL AND (NEW.version<=0 OR NEW.new_status<>'deleted'
  OR NOT EXISTS(SELECT 1 FROM contents WHERE id=NEW.content_id AND kind='material'))
BEGIN SELECT RAISE(ABORT,'invalid_moderation_version'); END;
--> statement-breakpoint
CREATE TRIGGER course_creator_guard BEFORE INSERT ON courses
WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.created_by AND role='admin' AND status<>'deleted')
BEGIN SELECT RAISE(ABORT,'course_admin_required'); END;
--> statement-breakpoint
CREATE TRIGGER course_identity_immutable BEFORE UPDATE OF id ON courses WHEN NEW.id<>OLD.id
BEGIN SELECT RAISE(ABORT,'course_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER course_term_identity_immutable BEFORE UPDATE ON course_terms
WHEN NEW.course_id<>OLD.course_id OR NEW.term_id<>OLD.term_id
BEGIN SELECT RAISE(ABORT,'course_term_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER teaching_class_insert_guard BEFORE INSERT ON teaching_classes BEGIN
  SELECT RAISE(ABORT,'invalid_class_teacher') WHERE NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=NEW.teacher_id AND role='teacher' AND status<>'deleted');
  SELECT RAISE(ABORT,'current_term_required') WHERE NOT EXISTS(SELECT 1 FROM terms WHERE id=NEW.term_id AND current=1);
END;
--> statement-breakpoint
CREATE TRIGGER teaching_class_identity_immutable BEFORE UPDATE ON teaching_classes
WHEN NEW.course_id<>OLD.course_id OR NEW.term_id<>OLD.term_id OR NEW.teacher_id<>OLD.teacher_id
BEGIN SELECT RAISE(ABORT,'teaching_class_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER class_bonus_rules_created AFTER INSERT ON teaching_classes BEGIN
  INSERT INTO class_bonus_rules(course_id,term_id,teacher_id) VALUES(NEW.course_id,NEW.term_id,NEW.teacher_id);
END;
--> statement-breakpoint
CREATE TRIGGER class_student_insert_guard BEFORE INSERT ON class_students BEGIN
  SELECT RAISE(ABORT,'invalid_class_student') WHERE NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=NEW.student_id AND role='student' AND status<>'deleted');
  SELECT RAISE(ABORT,'current_term_required') WHERE NOT EXISTS(SELECT 1 FROM terms WHERE id=NEW.term_id AND current=1);
END;
--> statement-breakpoint
CREATE TRIGGER class_student_identity_immutable BEFORE UPDATE ON class_students
WHEN NEW.course_id<>OLD.course_id OR NEW.term_id<>OLD.term_id OR NEW.student_id<>OLD.student_id OR NEW.teacher_id<>OLD.teacher_id
BEGIN SELECT RAISE(ABORT,'class_student_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER content_created_bonus AFTER INSERT ON contents
WHEN NEW.kind IN ('question','answer','comment') BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT NEW.course_id,t.id,r.teacher_id,NEW.author_id,
    CASE NEW.kind WHEN 'question' THEN r.points_question WHEN 'answer' THEN r.points_answer ELSE r.points_comment END,
    NEW.kind,NEW.id,NEW.updated_by,NEW.created_at
  FROM class_bonus_rules r JOIN terms t ON t.id=r.term_id AND t.current=1
  JOIN accounts student ON student.id=NEW.author_id AND student.role='student' AND student.status<>'deleted'
  JOIN class_students e ON e.course_id=r.course_id AND e.term_id=t.id AND e.teacher_id=r.teacher_id AND e.student_id=student.id
  WHERE r.course_id=NEW.course_id AND NEW.id IN (SELECT id FROM public_contents)
    AND CASE NEW.kind WHEN 'question' THEN r.points_question WHEN 'answer' THEN r.points_answer ELSE r.points_comment END>0;
END;
--> statement-breakpoint
-- Keep deletion terminal, including on private owner routes.
CREATE TRIGGER content_deleted_terminal BEFORE UPDATE OF status ON contents
WHEN OLD.status='deleted' AND NEW.status<>'deleted'
BEGIN SELECT RAISE(ABORT,'deleted_content'); END;
--> statement-breakpoint
CREATE TRIGGER content_deleted_cascade AFTER UPDATE OF status ON contents
WHEN NEW.status='deleted' AND OLD.status<>'deleted' BEGIN
  UPDATE contents SET status='deleted',title=NULL,body=NULL,tags=NULL,updated_at=NEW.updated_at,updated_by=NEW.updated_by
    WHERE status<>'deleted' AND id IN (WITH RECURSIVE branch(id) AS (
      SELECT id FROM contents WHERE target_id=NEW.id
      UNION ALL SELECT child.id FROM contents child JOIN branch parent ON child.target_id=parent.id
    ) SELECT id FROM branch);
  UPDATE file_versions SET updated_by=NEW.updated_by WHERE material_id=NEW.id;
  UPDATE material_upload_sessions SET cleaned_at=NULL WHERE material_id=NEW.id AND status='published';
  DELETE FROM file_versions WHERE material_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER content_status_bonus AFTER UPDATE OF status ON contents WHEN NEW.status<>OLD.status BEGIN
  UPDATE acceptances SET operator_id=NEW.updated_by
    WHERE NEW.status='deleted' AND (question_id=NEW.id OR answer_id=NEW.id);
  DELETE FROM acceptances WHERE NEW.status='deleted' AND (question_id=NEW.id OR answer_id=NEW.id);
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.updated_by,NEW.updated_at,l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=NEW.course_id AND (l.delta_points>0 AND s.source_id IS NULL);
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT r.course_id,r.term_id,r.teacher_id,r.student_id,r.points,r.source_kind,r.source_id,NEW.updated_by,NEW.updated_at,l.id
  FROM bonus_recalculation r LEFT JOIN bonus_state l ON l.source_kind=r.source_kind AND l.source_id=r.source_id
  WHERE OLD.status='hidden' AND NEW.status='visible' AND r.points>0 AND (l.id IS NULL OR l.delta_points<0)
    AND r.content_id IN (WITH RECURSIVE branch(id) AS (
      SELECT NEW.id UNION ALL SELECT c.id FROM contents c JOIN branch p ON c.target_id=p.id
    ) SELECT id FROM branch);
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_insert_guard BEFORE INSERT ON acceptances BEGIN
  SELECT RAISE(ABORT,'invalid_acceptance') WHERE NOT EXISTS(
    SELECT 1 FROM public_contents q JOIN public_contents a ON a.id=NEW.answer_id
    WHERE q.id=NEW.question_id AND q.kind='question' AND a.kind='answer'
      AND a.target_id=q.id AND a.course_id=q.course_id);
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_update_guard BEFORE UPDATE OF question_id,answer_id ON acceptances BEGIN
  SELECT RAISE(ABORT,'acceptance_question_immutable') WHERE NEW.question_id<>OLD.question_id;
  SELECT RAISE(ABORT,'invalid_acceptance') WHERE NOT EXISTS(
    SELECT 1 FROM public_contents q JOIN public_contents a ON a.id=NEW.answer_id
    WHERE q.id=NEW.question_id AND q.kind='question' AND a.kind='answer'
      AND a.target_id=q.id AND a.course_id=q.course_id);
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_created AFTER INSERT ON acceptances BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT q.course_id,t.id,r.teacher_id,answer.author_id,r.points_acceptance,'acceptance',answer.id,NEW.operator_id,NEW.created_at
  FROM public_contents q JOIN public_contents answer ON answer.id=NEW.answer_id
  JOIN class_bonus_rules r ON r.course_id=q.course_id JOIN terms t ON t.id=r.term_id AND t.current=1
  JOIN accounts student ON student.id=answer.author_id AND student.role='student' AND student.status<>'deleted'
  JOIN class_students e ON e.course_id=q.course_id AND e.term_id=t.id AND e.teacher_id=r.teacher_id AND e.student_id=student.id
  WHERE q.id=NEW.question_id AND r.points_acceptance>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.operator_id,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL AND l.source_kind='acceptance' AND l.source_id=NEW.answer_id));
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_changed AFTER UPDATE OF answer_id ON acceptances WHEN NEW.answer_id<>OLD.answer_id BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT q.course_id,t.id,r.teacher_id,answer.author_id,r.points_acceptance,'acceptance',answer.id,NEW.operator_id,NEW.created_at
  FROM public_contents q JOIN public_contents answer ON answer.id=NEW.answer_id
  JOIN class_bonus_rules r ON r.course_id=q.course_id JOIN terms t ON t.id=r.term_id AND t.current=1
  JOIN accounts student ON student.id=answer.author_id AND student.role='student' AND student.status<>'deleted'
  JOIN class_students e ON e.course_id=q.course_id AND e.term_id=t.id AND e.teacher_id=r.teacher_id AND e.student_id=student.id
  WHERE q.id=NEW.question_id AND r.points_acceptance>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.operator_id,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL AND l.source_kind='acceptance' AND l.source_id=NEW.answer_id));
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_removed AFTER DELETE ON acceptances BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,OLD.operator_id,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=OLD.question_id) AND (l.delta_points>0 AND s.source_id IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER file_version_insert_guard BEFORE INSERT ON file_versions BEGIN
  SELECT RAISE(ABORT,'invalid_material') WHERE NOT EXISTS(SELECT 1 FROM contents WHERE id=NEW.material_id AND kind='material' AND status<>'deleted');
  SELECT RAISE(ABORT,'invalid_file_actor') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.uploaded_by AND status<>'deleted')
    OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.updated_by AND status<>'deleted');
END;
--> statement-breakpoint
CREATE TRIGGER file_version_identity_immutable BEFORE UPDATE ON file_versions BEGIN
  SELECT RAISE(ABORT,'file_version_identity_immutable') WHERE NEW.material_id<>OLD.material_id OR NEW.version<>OLD.version OR NEW.uploaded_by<>OLD.uploaded_by
    OR NEW.storage_key<>OLD.storage_key OR NEW.size<>OLD.size OR NEW.mime<>OLD.mime OR NEW.created_at<>OLD.created_at;
  SELECT RAISE(ABORT,'invalid_file_actor') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.updated_by AND status<>'deleted');
END;
--> statement-breakpoint
CREATE TRIGGER file_version_created_bonus AFTER INSERT ON file_versions BEGIN
  INSERT INTO material_next_versions(material_id,next_version) VALUES(NEW.material_id,NEW.version+1)
    ON CONFLICT(material_id) DO UPDATE SET next_version=MAX(next_version,excluded.next_version);
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT m.course_id,t.id,r.teacher_id,NEW.uploaded_by,
    CASE WHEN NEW.version=1 THEN r.points_material ELSE r.points_material_version END,'material',NEW.material_id||'@'||NEW.version,
    NEW.updated_by,NEW.created_at
  FROM public_contents m JOIN class_bonus_rules r ON r.course_id=m.course_id JOIN terms t ON t.id=r.term_id AND t.current=1
  JOIN accounts student ON student.id=NEW.uploaded_by AND student.role='student' AND student.status<>'deleted'
  JOIN class_students e ON e.course_id=m.course_id AND e.term_id=t.id AND e.teacher_id=r.teacher_id AND e.student_id=student.id
  WHERE m.id=NEW.material_id
    AND CASE WHEN NEW.version=1 THEN r.points_material ELSE r.points_material_version END>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.updated_by,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.material_id) AND (l.delta_points>0 AND s.source_id IS NULL);
END;
--> statement-breakpoint
-- The last version can only be removed as part of deleting the entire material.
CREATE TRIGGER file_version_keep_one BEFORE DELETE ON file_versions
WHEN EXISTS(SELECT 1 FROM contents WHERE id=OLD.material_id AND status<>'deleted')
  AND NOT EXISTS(SELECT 1 FROM file_versions WHERE material_id=OLD.material_id AND version<>OLD.version)
BEGIN SELECT RAISE(ABORT,'material_last_version'); END;
--> statement-breakpoint
CREATE TRIGGER file_version_deleted_bonus AFTER DELETE ON file_versions BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,OLD.updated_by,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=OLD.material_id) AND (l.delta_points>0 AND s.source_id IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER bonus_ledger_guard BEFORE INSERT ON bonus_ledger BEGIN
  SELECT RAISE(ABORT,'invalid_bonus_class') WHERE NEW.reverses_id IS NULL AND NOT EXISTS(
    SELECT 1 FROM class_students WHERE course_id=NEW.course_id AND term_id=NEW.term_id
      AND teacher_id=NEW.teacher_id AND student_id=NEW.student_id);
  SELECT RAISE(ABORT,'invalid_bonus_student') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.student_id AND role='student');
  SELECT RAISE(ABORT,'invalid_bonus_reversal') WHERE NEW.reverses_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM bonus_ledger previous WHERE previous.id=NEW.reverses_id AND previous.source_kind<>'manual'
      AND previous.course_id=NEW.course_id AND previous.student_id=NEW.student_id
      AND previous.source_kind=NEW.source_kind AND previous.source_id=NEW.source_id
      AND ((previous.term_id=NEW.term_id AND previous.teacher_id=NEW.teacher_id AND previous.delta_points=-NEW.delta_points)
        OR (previous.delta_points<0 AND NEW.delta_points>0 AND EXISTS(
          SELECT 1 FROM bonus_recalculation r WHERE r.source_kind=NEW.source_kind AND r.source_id=NEW.source_id
            AND r.course_id=NEW.course_id AND r.term_id=NEW.term_id AND r.teacher_id=NEW.teacher_id
            AND r.student_id=NEW.student_id AND r.points=NEW.delta_points))));
END;
--> statement-breakpoint
-- Deliver direct interactions once even when the parent and replied-to author are the same person.
CREATE TRIGGER content_notifications AFTER INSERT ON contents
WHEN NEW.kind IN ('answer','comment') BEGIN
  INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id,created_at)
  SELECT recipient.id,NEW.author_id,CASE WHEN NEW.kind='answer' THEN 'answer'
      WHEN recipient.id=(SELECT author_id FROM contents WHERE id=NEW.reply_to_id) THEN 'reply' ELSE 'comment' END,
      NEW.id,NEW.id,NEW.created_at
  FROM accounts recipient WHERE recipient.id<>NEW.author_id AND recipient.status<>'deleted'
    AND recipient.id IN (SELECT author_id FROM contents WHERE id=NEW.target_id OR id=NEW.reply_to_id)
    AND NEW.id IN (SELECT id FROM public_contents)
  ON CONFLICT DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_notification_created AFTER INSERT ON acceptances BEGIN
  INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id)
  SELECT c.author_id,NEW.operator_id,'accepted',lower(hex(randomblob(16))),c.id
  FROM contents c JOIN accounts a ON a.id=c.author_id
  WHERE c.id=NEW.answer_id AND c.author_id<>NEW.operator_id AND a.status<>'deleted';
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_notification_changed AFTER UPDATE OF answer_id ON acceptances
WHEN NEW.answer_id<>OLD.answer_id BEGIN
  INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id)
  SELECT c.author_id,NEW.operator_id,CASE WHEN c.id=NEW.answer_id THEN 'accepted' ELSE 'unaccepted' END,
      lower(hex(randomblob(16))),c.id
  FROM contents c JOIN accounts a ON a.id=c.author_id
  WHERE c.id IN (OLD.answer_id,NEW.answer_id) AND c.author_id<>NEW.operator_id AND a.status<>'deleted';
END;
--> statement-breakpoint
-- Deleting a content branch already delivers moderation notices; it is not an explicit cancellation.
CREATE TRIGGER acceptance_notification_removed AFTER DELETE ON acceptances BEGIN
  INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id)
  SELECT c.author_id,OLD.operator_id,'unaccepted',lower(hex(randomblob(16))),c.id
  FROM public_contents c JOIN accounts a ON a.id=c.author_id
  WHERE c.id=OLD.answer_id AND c.author_id<>OLD.operator_id AND a.status<>'deleted'
    AND EXISTS(SELECT 1 FROM public_contents WHERE id=OLD.question_id);
END;
--> statement-breakpoint
CREATE TRIGGER moderation_notification_created AFTER INSERT ON moderation_actions BEGIN
  INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id,created_at)
  SELECT c.author_id,NEW.actor_id,'moderation',CAST(NEW.id AS TEXT),c.id,NEW.created_at
  FROM contents c JOIN accounts a ON a.id=c.author_id
  WHERE c.id=NEW.content_id AND c.author_id<>NEW.actor_id AND a.status<>'deleted'
  ON CONFLICT DO NOTHING;
END;
--> statement-breakpoint
-- Own-operation rewards remain toast-only; all external adjustments have a durable inbox entry.
CREATE TRIGGER bonus_notification_created AFTER INSERT ON bonus_ledger
WHEN NEW.operator_id<>NEW.student_id BEGIN
  INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id,created_at)
  SELECT NEW.student_id,NEW.operator_id,'bonus',CAST(NEW.id AS TEXT),
      CASE WHEN NEW.source_kind='manual' THEN NULL WHEN NEW.source_kind='material'
        THEN substr(NEW.source_id,1,instr(NEW.source_id,'@')-1) ELSE NEW.source_id END,NEW.created_at
  FROM accounts a WHERE a.id=NEW.student_id AND a.status<>'deleted'
  ON CONFLICT DO NOTHING;
END;
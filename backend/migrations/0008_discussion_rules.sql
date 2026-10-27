CREATE VIEW public_contents AS
SELECT c.* FROM contents c WHERE c.status='visible' AND (
  c.kind='question'
  OR (c.kind='answer' AND EXISTS(SELECT 1 FROM contents q WHERE q.id=c.question_id AND q.kind='question' AND q.status='visible'))
  OR (c.kind='comment' AND (
    (c.target_kind='material' AND EXISTS(SELECT 1 FROM materials m WHERE m.id=c.target_id AND m.status='visible'))
    OR (c.target_kind='question' AND EXISTS(SELECT 1 FROM contents q WHERE q.id=c.target_id AND q.kind='question' AND q.status='visible'))
    OR (c.target_kind='answer' AND EXISTS(SELECT 1 FROM contents a JOIN contents q ON q.id=a.question_id
         WHERE a.id=c.target_id AND a.kind='answer' AND a.status='visible' AND q.status='visible'))
  ))
);
--> statement-breakpoint
CREATE TRIGGER content_insert_guard BEFORE INSERT ON contents BEGIN
  SELECT RAISE(ABORT,'invalid_answer_parent') WHERE NEW.kind='answer' AND NOT EXISTS(
    SELECT 1 FROM contents q WHERE q.id=NEW.question_id AND q.kind='question' AND q.course_id=NEW.course_id AND q.status='visible');
  SELECT RAISE(ABORT,'invalid_comment_target') WHERE NEW.kind='comment' AND NOT (
    (NEW.target_kind='material' AND EXISTS(SELECT 1 FROM materials m WHERE m.id=NEW.target_id AND m.course_id=NEW.course_id AND m.status='visible'))
    OR (NEW.target_kind IN ('question','answer') AND EXISTS(SELECT 1 FROM public_contents p
        WHERE p.id=NEW.target_id AND p.kind=NEW.target_kind AND p.course_id=NEW.course_id)));
  SELECT RAISE(ABORT,'invalid_reply') WHERE NEW.reply_to_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public_contents p WHERE p.id=NEW.reply_to_id AND p.kind='comment'
      AND p.target_kind=NEW.target_kind AND p.target_id=NEW.target_id AND p.course_id=NEW.course_id);
  SELECT RAISE(ABORT,'invalid_file_version') WHERE NEW.file_version_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM file_versions v JOIN materials m ON m.id=v.material_id
    WHERE v.id=NEW.file_version_id AND v.status='visible' AND m.status='visible' AND m.course_id=NEW.course_id);
END;
--> statement-breakpoint
CREATE TRIGGER content_identity_immutable BEFORE UPDATE ON contents
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.course_id<>OLD.course_id OR NEW.author_id<>OLD.author_id
  OR NEW.question_id IS NOT OLD.question_id OR NEW.target_kind IS NOT OLD.target_kind
  OR NEW.target_id IS NOT OLD.target_id OR NEW.reply_to_id IS NOT OLD.reply_to_id
BEGIN SELECT RAISE(ABORT,'content_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER content_file_guard BEFORE UPDATE OF file_version_id ON contents
WHEN NEW.file_version_id IS NOT OLD.file_version_id AND NEW.file_version_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'invalid_file_version') WHERE NOT EXISTS(
    SELECT 1 FROM file_versions v JOIN materials m ON m.id=v.material_id
    WHERE v.id=NEW.file_version_id AND v.status='visible' AND m.status='visible' AND m.course_id=NEW.course_id);
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_guard BEFORE UPDATE ON contents WHEN NEW.accepted_answer_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'invalid_acceptance') WHERE NEW.kind<>'question' OR NEW.status<>'visible' OR NOT EXISTS(
    SELECT 1 FROM contents a WHERE a.id=NEW.accepted_answer_id AND a.kind='answer'
      AND a.question_id=NEW.id AND a.course_id=NEW.course_id AND a.status='visible');
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_ledger AFTER UPDATE ON contents
WHEN OLD.acceptance_id IS NOT NEW.acceptance_id BEGIN
  INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,
    term_id,teacher_id,operator_id,delta_cents,reason,created_at)
  SELECT OLD.acceptance_id,'revoke',OLD.course_id,OLD.id,OLD.accepted_answer_id,a.author_id,
    OLD.accepted_term_id,OLD.accepted_by,NEW.updated_by,-OLD.award_cents,NEW.change_reason,NEW.updated_at
    FROM contents a WHERE a.id=OLD.accepted_answer_id AND OLD.award_cents>0;
  INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,
    term_id,teacher_id,operator_id,delta_cents,reason,created_at)
  SELECT NEW.acceptance_id,'award',NEW.course_id,NEW.id,NEW.accepted_answer_id,a.author_id,
    NEW.accepted_term_id,NEW.accepted_by,NEW.updated_by,NEW.award_cents,NEW.change_reason,NEW.updated_at
    FROM contents a WHERE a.id=NEW.accepted_answer_id AND NEW.award_cents>0;
END;
--> statement-breakpoint
CREATE TRIGGER answer_unavailable AFTER UPDATE OF status ON contents
WHEN NEW.kind='answer' AND NEW.status<>'visible' AND OLD.status='visible' BEGIN
  UPDATE contents SET accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,
    accepted_term_id=NULL,acceptance_id=NULL,award_cents=0,award_eligible=0,
    revision=revision+1,updated_at=NEW.updated_at,updated_by=NEW.updated_by,change_reason='answer.'||NEW.status
    WHERE accepted_answer_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER moderation_audit AFTER UPDATE OF status ON contents
WHEN OLD.status<>NEW.status AND (OLD.status='hidden' OR NEW.status='hidden') BEGIN
  INSERT INTO moderation_actions(content_id,actor_id,old_status,new_status,reason,created_at)
  VALUES(NEW.id,NEW.updated_by,OLD.status,NEW.status,NEW.change_reason,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER content_created_event AFTER INSERT ON contents BEGIN
  INSERT INTO business_events(event_id,type,course_id,content_id,actor_id,payload,created_at)
  VALUES('content:'||NEW.id||':1',NEW.kind||'.created',NEW.course_id,NEW.id,NEW.updated_by,
    json_object('id',NEW.id,'kind',NEW.kind,'courseId',NEW.course_id,'authorId',NEW.author_id,
      'questionId',NEW.question_id,'targetKind',NEW.target_kind,'targetId',NEW.target_id,'replyToId',NEW.reply_to_id,
      'questionAuthorId',(SELECT author_id FROM contents WHERE id=NEW.question_id),
      'targetAuthorId',CASE WHEN NEW.target_kind='material' THEN (SELECT author_id FROM materials WHERE id=NEW.target_id)
        ELSE (SELECT author_id FROM contents WHERE id=NEW.target_id) END,
      'replyAuthorId',(SELECT author_id FROM contents WHERE id=NEW.reply_to_id),
      'revision',NEW.revision,'status',NEW.status),NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER content_updated_event AFTER UPDATE ON contents WHEN NEW.revision<>OLD.revision BEGIN
  INSERT INTO business_events(event_id,type,course_id,content_id,actor_id,payload,created_at)
  VALUES('content:'||NEW.id||':'||NEW.revision,
    CASE WHEN OLD.accepted_answer_id IS NOT NEW.accepted_answer_id THEN 'question.acceptance_changed'
      WHEN OLD.award_cents<>NEW.award_cents THEN 'question.award_adjusted'
      WHEN OLD.status<>NEW.status THEN NEW.kind||'.'||NEW.status ELSE NEW.kind||'.updated' END,
    NEW.course_id,NEW.id,NEW.updated_by,
    json_object('id',NEW.id,'kind',NEW.kind,'courseId',NEW.course_id,'authorId',NEW.author_id,
      'questionId',NEW.question_id,'targetKind',NEW.target_kind,'targetId',NEW.target_id,'replyToId',NEW.reply_to_id,
      'questionAuthorId',(SELECT author_id FROM contents WHERE id=NEW.question_id),
      'targetAuthorId',CASE WHEN NEW.target_kind='material' THEN (SELECT author_id FROM materials WHERE id=NEW.target_id)
        ELSE (SELECT author_id FROM contents WHERE id=NEW.target_id) END,
      'replyAuthorId',(SELECT author_id FROM contents WHERE id=NEW.reply_to_id),
      'acceptedAnswerId',NEW.accepted_answer_id,'previousAcceptedAnswerId',OLD.accepted_answer_id,
      'answerAuthorId',(SELECT author_id FROM contents WHERE id=NEW.accepted_answer_id),
      'previousAnswerAuthorId',(SELECT author_id FROM contents WHERE id=OLD.accepted_answer_id),
      'revision',NEW.revision,'status',NEW.status),NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER course_created_event AFTER INSERT ON courses WHEN NEW.created_by IS NOT NULL BEGIN
  INSERT INTO business_events(event_id,type,course_id,actor_id,payload,created_at)
  VALUES('course:'||NEW.id||':1','course.created',NEW.id,NEW.created_by,
    json_object('id',NEW.id,'revision',NEW.revision),NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER course_updated_event AFTER UPDATE ON courses WHEN NEW.revision<>OLD.revision AND NEW.updated_by IS NOT NULL BEGIN
  INSERT INTO business_events(event_id,type,course_id,actor_id,payload,created_at)
  VALUES('course:'||NEW.id||':'||NEW.revision,'course.updated',NEW.id,NEW.updated_by,
    json_object('id',NEW.id,'revision',NEW.revision),NEW.updated_at);
END;
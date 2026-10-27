-- Refuse ambiguous teachers or incompatible tags instead of silently discarding data.
CREATE TABLE __academic_merge_guard (ok INTEGER CONSTRAINT academic_merge_conflict CHECK(ok=1));
--> statement-breakpoint
INSERT INTO __academic_merge_guard
WITH members AS (
    SELECT course_id,term_id,teacher_id AS account_id FROM teaching_assignments
    UNION ALL SELECT course_id,term_id,student_id FROM enrollments
)
SELECT 0 FROM members m JOIN accounts a ON a.id=m.account_id
GROUP BY m.course_id,m.term_id HAVING SUM(a.role='teacher')<>1;
--> statement-breakpoint
INSERT INTO __academic_merge_guard SELECT 0 FROM courses c
WHERE NOT EXISTS(SELECT 1 FROM teaching_assignments t WHERE t.course_id=c.id);
--> statement-breakpoint
INSERT INTO __academic_merge_guard SELECT 0 FROM contents
WHERE json_type(tags)<>'array' OR (kind NOT IN ('question','material') AND json_array_length(tags)>0);
--> statement-breakpoint
DROP TABLE __academic_merge_guard;
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
ALTER TABLE terms ADD COLUMN current INTEGER NOT NULL DEFAULT 0 CONSTRAINT terms_current CHECK(current IN (0,1));
--> statement-breakpoint
UPDATE terms SET current=1 WHERE id=(SELECT current_term_id FROM academic_settings WHERE id=1);
--> statement-breakpoint
CREATE UNIQUE INDEX terms_one_current ON terms(current) WHERE current=1;
--> statement-breakpoint
DROP TABLE academic_settings;
--> statement-breakpoint
CREATE TABLE `__new_enrollments` (
	`course_id` text NOT NULL,
	`term_id` text NOT NULL,
	`account_id` text NOT NULL,
	PRIMARY KEY(`course_id`, `term_id`, `account_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO __new_enrollments SELECT course_id,term_id,teacher_id FROM teaching_assignments
UNION ALL SELECT course_id,term_id,student_id FROM enrollments;
--> statement-breakpoint
DROP TABLE teaching_assignments;
--> statement-breakpoint
DROP TABLE enrollments;
--> statement-breakpoint
ALTER TABLE __new_enrollments RENAME TO enrollments;
--> statement-breakpoint
CREATE INDEX enrollments_account_term ON enrollments(account_id,term_id,course_id);
--> statement-breakpoint
DROP VIEW public_contents;
--> statement-breakpoint
DROP VIEW accessible_contents;
--> statement-breakpoint
DROP TRIGGER file_version_material_insert;
--> statement-breakpoint
DROP TRIGGER file_version_material_update;
--> statement-breakpoint
CREATE TABLE `__new_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`course_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`tags` text,
	`target_kind` text,
	`target_id` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text NOT NULL,
	`accepted_answer_id` text,
	`accepted_by` text,
	`accepted_at` integer,
	`accepted_term_id` text,
	`acceptance_id` text,
	`award_cents` integer DEFAULT 0 NOT NULL,
	`award_eligible` integer DEFAULT 0 NOT NULL,
	`request_key` text,
	`request_hash` text,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_answer_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contents_kind" CHECK("__new_contents"."kind" IN ('material', 'question', 'answer', 'comment')),
	CONSTRAINT "contents_tags" CHECK("__new_contents"."tags" IS NULL OR ("__new_contents"."kind" IN ('question', 'material') AND json_valid("__new_contents"."tags") AND json_type("__new_contents"."tags") = 'array')),
	CONSTRAINT "contents_target_kind" CHECK("__new_contents"."target_kind" IN ('material', 'question', 'answer', 'comment')),
	CONSTRAINT "contents_status" CHECK("__new_contents"."status" IN ('visible', 'hidden', 'deleted')),
	CONSTRAINT "contents_award_cents" CHECK("__new_contents"."award_cents" BETWEEN 0 AND 10000),
	CONSTRAINT "contents_award_eligible" CHECK("__new_contents"."award_eligible" IN (0, 1)),
	CONSTRAINT "contents_shape" CHECK(("__new_contents"."kind" IN ('material', 'question') AND "__new_contents"."title" IS NOT NULL AND "__new_contents"."target_kind" IS NULL AND "__new_contents"."target_id" IS NULL)
        OR ("__new_contents"."kind" = 'answer' AND "__new_contents"."title" IS NULL AND "__new_contents"."target_kind" IS 'question' AND "__new_contents"."target_id" IS NOT NULL)
        OR ("__new_contents"."kind" = 'comment' AND "__new_contents"."title" IS NULL AND "__new_contents"."target_kind" IS NOT NULL AND "__new_contents"."target_id" IS NOT NULL)),
	CONSTRAINT "contents_question_fields" CHECK("__new_contents"."kind" = 'question' OR ("__new_contents"."accepted_answer_id" IS NULL AND "__new_contents"."award_cents" = 0)),
	CONSTRAINT "contents_request_pair" CHECK(("__new_contents"."request_key" IS NULL AND "__new_contents"."request_hash" IS NULL) OR ("__new_contents"."request_key" IS NOT NULL AND "__new_contents"."request_hash" IS NOT NULL)),
	CONSTRAINT "contents_acceptance" CHECK(("__new_contents"."accepted_answer_id" IS NULL AND "__new_contents"."accepted_by" IS NULL AND "__new_contents"."acceptance_id" IS NULL AND "__new_contents"."award_cents" = 0)
        OR ("__new_contents"."accepted_answer_id" IS NOT NULL AND "__new_contents"."accepted_by" IS NOT NULL AND "__new_contents"."accepted_at" IS NOT NULL
        AND "__new_contents"."accepted_term_id" IS NOT NULL AND "__new_contents"."acceptance_id" IS NOT NULL)),
	CONSTRAINT "contents_award_qualification" CHECK("__new_contents"."award_cents" = 0 OR "__new_contents"."award_eligible" = 1)
);
--> statement-breakpoint
INSERT INTO __new_contents(id,kind,course_id,author_id,title,body,tags,target_kind,target_id,status,revision,
    created_at,updated_at,updated_by,accepted_answer_id,accepted_by,accepted_at,accepted_term_id,
    acceptance_id,award_cents,award_eligible,request_key,request_hash)
SELECT id,kind,course_id,author_id,title,body,CASE WHEN json_array_length(tags)=0 THEN NULL ELSE tags END,
    target_kind,target_id,status,revision,created_at,updated_at,updated_by,accepted_answer_id,accepted_by,accepted_at,accepted_term_id,
    acceptance_id,award_cents,award_eligible,request_key,request_hash FROM contents;
--> statement-breakpoint
DROP TABLE contents;
--> statement-breakpoint
ALTER TABLE __new_contents RENAME TO contents;
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_request_unique` ON `contents` (`author_id`,`request_key`);
--> statement-breakpoint
CREATE INDEX `contents_course_kind_time` ON `contents` (`course_id`,`kind`,`status`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `contents_target` ON `contents` (`target_kind`,`target_id`,`status`);
--> statement-breakpoint
CREATE INDEX `contents_author` ON `contents` (`author_id`,`kind`,`created_at`,`id`);
--> statement-breakpoint
CREATE VIEW accessible_contents AS
WITH RECURSIVE reachable(id) AS (
    SELECT id FROM contents WHERE target_id IS NULL AND status IN ('visible','deleted')
    UNION ALL
    SELECT c.id FROM contents c JOIN reachable p ON c.target_id=p.id WHERE c.status IN ('visible','deleted')
)
SELECT c.* FROM contents c JOIN reachable r ON r.id=c.id;
--> statement-breakpoint
CREATE VIEW public_contents AS SELECT * FROM accessible_contents WHERE status='visible';
--> statement-breakpoint
CREATE TRIGGER content_insert_guard BEFORE INSERT ON contents
WHEN NEW.target_id IS NOT NULL BEGIN
    SELECT RAISE(ABORT,'invalid_content_target') WHERE NOT EXISTS (
        SELECT 1 FROM public_contents p WHERE p.id=NEW.target_id AND p.kind=NEW.target_kind AND p.course_id=NEW.course_id);
END;
--> statement-breakpoint
CREATE TRIGGER content_identity_immutable BEFORE UPDATE ON contents
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.course_id<>OLD.course_id OR NEW.author_id<>OLD.author_id
    OR NEW.target_kind IS NOT OLD.target_kind OR NEW.target_id IS NOT OLD.target_id
BEGIN SELECT RAISE(ABORT,'content_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER file_version_material_insert BEFORE INSERT ON file_versions
WHEN NOT EXISTS (SELECT 1 FROM contents WHERE id=NEW.material_id AND kind='material')
BEGIN SELECT RAISE(ABORT,'invalid_material'); END;
--> statement-breakpoint
CREATE TRIGGER file_version_material_update BEFORE UPDATE OF material_id ON file_versions
WHEN NOT EXISTS (SELECT 1 FROM contents WHERE id=NEW.material_id AND kind='material')
BEGIN SELECT RAISE(ABORT,'invalid_material'); END;
--> statement-breakpoint
CREATE TRIGGER acceptance_guard BEFORE UPDATE ON contents WHEN NEW.accepted_answer_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'invalid_acceptance') WHERE NEW.kind<>'question' OR NEW.status<>'visible' OR NOT EXISTS(
    SELECT 1 FROM contents a WHERE a.id=NEW.accepted_answer_id AND a.kind='answer'
      AND a.target_kind='question' AND a.target_id=NEW.id AND a.course_id=NEW.course_id AND a.status='visible');
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_ledger AFTER UPDATE ON contents WHEN OLD.acceptance_id IS NOT NEW.acceptance_id BEGIN
  INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,
    term_id,teacher_id,operator_id,delta_cents,reason,created_at)
  SELECT OLD.acceptance_id,'revoke',OLD.course_id,OLD.id,OLD.accepted_answer_id,a.author_id,
    OLD.accepted_term_id,OLD.accepted_by,NEW.updated_by,-OLD.award_cents,
    CASE WHEN NEW.status<>'visible' THEN 'question.'||NEW.status
      WHEN a.status<>'visible' THEN 'answer.'||a.status
      WHEN NEW.accepted_answer_id IS NULL THEN 'acceptance.cancelled'
      WHEN OLD.accepted_answer_id IS NEW.accepted_answer_id THEN 'award.adjusted' ELSE 'acceptance.changed' END,
    NEW.updated_at FROM contents a WHERE a.id=OLD.accepted_answer_id AND OLD.award_cents>0
    ON CONFLICT(acceptance_id,operation) DO NOTHING;
  INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,
    term_id,teacher_id,operator_id,delta_cents,reason,created_at)
  SELECT NEW.acceptance_id,'award',NEW.course_id,NEW.id,NEW.accepted_answer_id,a.author_id,
    NEW.accepted_term_id,NEW.accepted_by,NEW.updated_by,NEW.award_cents,
    CASE WHEN OLD.accepted_answer_id IS NEW.accepted_answer_id THEN 'award.adjusted' ELSE 'acceptance.changed' END,
    NEW.updated_at FROM contents a WHERE a.id=NEW.accepted_answer_id AND NEW.award_cents>0
    ON CONFLICT(acceptance_id,operation) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER answer_unavailable AFTER UPDATE OF status ON contents
WHEN NEW.kind='answer' AND NEW.status<>'visible' AND OLD.status='visible' BEGIN
  UPDATE contents SET accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,
    accepted_term_id=NULL,acceptance_id=NULL,award_cents=0,award_eligible=0,
    revision=revision+1,updated_at=NEW.updated_at,updated_by=NEW.updated_by
    WHERE accepted_answer_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER content_created_event AFTER INSERT ON contents BEGIN
  INSERT INTO business_events(event_id,type,course_id,content_id,actor_id,payload,created_at)
  VALUES('content:'||NEW.id||':1',NEW.kind||'.created',NEW.course_id,NEW.id,NEW.updated_by,
    json_object('id',NEW.id,'kind',NEW.kind,'courseId',NEW.course_id,'authorId',NEW.author_id,
      'targetKind',NEW.target_kind,'targetId',NEW.target_id,
      'targetAuthorId',(SELECT author_id FROM contents WHERE id=NEW.target_id),
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
      'targetKind',NEW.target_kind,'targetId',NEW.target_id,
      'targetAuthorId',(SELECT author_id FROM contents WHERE id=NEW.target_id),
      'revision',NEW.revision,'status',NEW.status,'acceptedAnswerId',NEW.accepted_answer_id,'previousAcceptedAnswerId',OLD.accepted_answer_id,
      'answerAuthorId',(SELECT author_id FROM contents WHERE id=NEW.accepted_answer_id),
      'previousAnswerAuthorId',(SELECT author_id FROM contents WHERE id=OLD.accepted_answer_id)),NEW.updated_at);
END;
--> statement-breakpoint
-- The teacher row represents a course instance. Its account role is immutable.
CREATE TRIGGER enrollment_identity_insert BEFORE INSERT ON enrollments BEGIN
  SELECT RAISE(ABORT,'invalid_enrollment_identity') WHERE NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=NEW.account_id AND role IN ('teacher','student') AND status<>'deleted');
  SELECT RAISE(ABORT,'current_term_required') WHERE NOT EXISTS(
    SELECT 1 FROM enrollments WHERE course_id=NEW.course_id AND term_id=NEW.term_id)
    AND NOT EXISTS(SELECT 1 FROM terms WHERE id=NEW.term_id AND current=1);
  SELECT RAISE(ABORT,'enrollment_teacher_unique') WHERE (SELECT role FROM accounts WHERE id=NEW.account_id)='teacher'
    AND EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher'
      WHERE e.course_id=NEW.course_id AND e.term_id=NEW.term_id AND e.account_id<>NEW.account_id);
  SELECT RAISE(ABORT,'enrollment_teacher_required') WHERE (SELECT role FROM accounts WHERE id=NEW.account_id)='student'
    AND NOT EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher'
      WHERE e.course_id=NEW.course_id AND e.term_id=NEW.term_id);
END;
--> statement-breakpoint
CREATE TRIGGER enrollment_identity_update BEFORE UPDATE ON enrollments BEGIN
  SELECT RAISE(ABORT,'enrollment_instance_immutable') WHERE NEW.course_id<>OLD.course_id OR NEW.term_id<>OLD.term_id;
  SELECT RAISE(ABORT,'invalid_enrollment_identity') WHERE NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=NEW.account_id AND role IN ('teacher','student') AND status<>'deleted');
  SELECT RAISE(ABORT,'enrollment_teacher_unique') WHERE (SELECT role FROM accounts WHERE id=NEW.account_id)='teacher'
    AND EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher'
      WHERE e.course_id=NEW.course_id AND e.term_id=NEW.term_id AND e.account_id<>OLD.account_id);
  SELECT RAISE(ABORT,'enrollment_teacher_required') WHERE (SELECT role FROM accounts WHERE id=NEW.account_id)='student'
    AND NOT EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher'
      WHERE e.course_id=NEW.course_id AND e.term_id=NEW.term_id AND e.account_id<>OLD.account_id);
END;
--> statement-breakpoint
CREATE TRIGGER enrollment_teacher_delete BEFORE DELETE ON enrollments
WHEN (SELECT role FROM accounts WHERE id=OLD.account_id)='teacher' BEGIN
  SELECT RAISE(ABORT,'enrollment_teacher_required') WHERE EXISTS(
    SELECT 1 FROM enrollments WHERE course_id=OLD.course_id AND term_id=OLD.term_id AND account_id<>OLD.account_id);
  SELECT RAISE(ABORT,'course_requires_teacher') WHERE EXISTS(SELECT 1 FROM courses WHERE id=OLD.course_id)
    AND NOT EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher'
      WHERE e.course_id=OLD.course_id AND (e.term_id<>OLD.term_id OR e.account_id<>OLD.account_id));
END;
--> statement-breakpoint
CREATE TRIGGER course_teacher_insert BEFORE INSERT ON courses
WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.id)
  AND NOT EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher' AND a.status<>'deleted'
    JOIN terms t ON t.id=e.term_id AND t.current=1 WHERE e.course_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'course_requires_teacher'); END;
--> statement-breakpoint
CREATE TABLE __academic_foreign_key_guard (ok INTEGER CONSTRAINT academic_foreign_key_conflict CHECK(ok=1));
--> statement-breakpoint
INSERT INTO __academic_foreign_key_guard SELECT 0 FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE __academic_foreign_key_guard;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
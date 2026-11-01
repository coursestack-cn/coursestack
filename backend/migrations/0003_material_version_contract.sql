-- Review data copies, required-column backfills and foreign-key actions before applying.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- Do not make previously hidden file versions public when their status column is removed.
CREATE TABLE __material_visibility_guard (hidden_count INTEGER NOT NULL CONSTRAINT material_versions_require_no_hidden_rows CHECK (hidden_count = 0)) STRICT;
--> statement-breakpoint
INSERT INTO __material_visibility_guard SELECT COUNT(*) FROM file_versions WHERE status='hidden';
--> statement-breakpoint
DROP TABLE __material_visibility_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "bonus_ledger_guard";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_version_deleted_bonus";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_version_status_bonus";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_version_created_bonus";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_version_identity_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_version_insert_guard";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "acceptance_removed";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "acceptance_changed";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "acceptance_created";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "acceptance_update_guard";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "acceptance_insert_guard";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "content_status_bonus";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "content_created_bonus";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_no_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_no_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "enrollment_teacher_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "enrollment_identity_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "enrollment_identity_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "course_teacher_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "course_bonus_rules_created";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "content_insert_guard";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "content_identity_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "account_role_immutable";
--> statement-breakpoint
DROP VIEW IF EXISTS "bonus_state";
--> statement-breakpoint
DROP VIEW IF EXISTS "bonus_sources";
--> statement-breakpoint
DROP VIEW IF EXISTS "public_acceptances";
--> statement-breakpoint
DROP VIEW IF EXISTS "rewardable_contents";
--> statement-breakpoint
DROP VIEW IF EXISTS "public_contents";
--> statement-breakpoint
DROP VIEW IF EXISTS "accessible_contents";
--> statement-breakpoint
DROP TABLE `file_version_actions`;
--> statement-breakpoint
CREATE TABLE `__new_material_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`course_id` text NOT NULL,
	`material_id` text NOT NULL,
	`mode` text NOT NULL,
	`creation_draft` text,
	`expected_size` integer NOT NULL,
	`mime` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_version` integer,
	`lease_token` text,
	`lease_until` integer,
	`put_expires_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`cleaned_at` integer,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_upload_sessions_mode" CHECK("__new_material_upload_sessions"."mode" IN ('create', 'version')),
	CONSTRAINT "material_upload_sessions_status" CHECK("__new_material_upload_sessions"."status" IN ('pending', 'confirming', 'published', 'cancelled', 'expired')),
	CONSTRAINT "material_upload_sessions_size" CHECK("__new_material_upload_sessions"."expected_size" > 0 AND "__new_material_upload_sessions"."expected_size" <= 9007199254740991),
	CONSTRAINT "material_upload_sessions_creation_draft" CHECK("__new_material_upload_sessions"."creation_draft" IS NULL OR json_valid("__new_material_upload_sessions"."creation_draft")),
	CONSTRAINT "material_upload_sessions_result" CHECK(("__new_material_upload_sessions"."status" = 'published') = ("__new_material_upload_sessions"."result_version" IS NOT NULL) AND ("__new_material_upload_sessions"."result_version" IS NULL OR "__new_material_upload_sessions"."result_version" > 0)),
	CONSTRAINT "material_upload_sessions_lease" CHECK(("__new_material_upload_sessions"."status" = 'confirming') = ("__new_material_upload_sessions"."lease_token" IS NOT NULL AND "__new_material_upload_sessions"."lease_until" IS NOT NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_material_upload_sessions`("id", "owner_id", "course_id", "material_id", "mode", "creation_draft", "expected_size", "mime", "status", "result_version", "lease_token", "lease_until", "put_expires_at", "expires_at", "created_at", "cleaned_at", "request_key", "request_hash") SELECT "id", "owner_id", "course_id", "material_id", "mode", "payload", "expected_size", "mime", "status", "result_version", "lease_token", "lease_until", "put_expires_at", "expires_at", "created_at", "cleaned_at", "request_key", "request_hash" FROM `material_upload_sessions`;
--> statement-breakpoint
DROP TABLE `material_upload_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_material_upload_sessions` RENAME TO `material_upload_sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `material_upload_sessions_request_unique` ON `material_upload_sessions` (`owner_id`,`request_key`);
--> statement-breakpoint
CREATE INDEX `material_upload_sessions_cleanup` ON `material_upload_sessions` (`expires_at`,`cleaned_at`);
--> statement-breakpoint
CREATE TABLE `__new_file_versions` (
	`material_id` text NOT NULL,
	`version` integer NOT NULL,
	`storage_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`material_id`, `version`),
	FOREIGN KEY (`material_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_versions_version" CHECK("__new_file_versions"."version" > 0),
	CONSTRAINT "file_versions_size" CHECK("__new_file_versions"."size" > 0 AND "__new_file_versions"."size" <= 9007199254740991)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_file_versions`("material_id", "version", "storage_key", "size", "mime", "uploaded_by", "updated_by", "created_at") SELECT "material_id", "version", "storage_key", "size", "mime", "uploaded_by", "updated_by", "created_at" FROM `file_versions`;
--> statement-breakpoint
DROP TABLE `file_versions`;
--> statement-breakpoint
ALTER TABLE `__new_file_versions` RENAME TO `file_versions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `file_versions_storage_unique` ON `file_versions` (`storage_key`);
--> statement-breakpoint
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
-- Rewards follow moderation only: deleting a parent hides its branch but keeps points already earned below it.
CREATE VIEW rewardable_contents AS
WITH RECURSIVE unhidden(id) AS (
    SELECT id FROM contents WHERE target_id IS NULL AND status IN ('visible','deleted')
    UNION ALL
    SELECT c.id FROM contents c JOIN unhidden p ON c.target_id=p.id WHERE c.status IN ('visible','deleted')
)
SELECT c.* FROM contents c JOIN unhidden u ON u.id=c.id WHERE c.status='visible';
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
CREATE TRIGGER account_role_immutable BEFORE UPDATE OF role ON accounts
WHEN NEW.role <> OLD.role
BEGIN SELECT RAISE(ABORT, 'replace_account_identity'); END;
--> statement-breakpoint
CREATE TRIGGER content_identity_immutable BEFORE UPDATE ON contents
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.course_id<>OLD.course_id OR NEW.author_id<>OLD.author_id
    OR NEW.target_id IS NOT OLD.target_id
BEGIN SELECT RAISE(ABORT,'content_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER content_insert_guard BEFORE INSERT ON contents
WHEN NEW.target_id IS NOT NULL BEGIN
    SELECT RAISE(ABORT,'invalid_content_target') WHERE NOT EXISTS (
        SELECT 1 FROM public_contents p WHERE p.id=NEW.target_id AND p.course_id=NEW.course_id
            AND (NEW.kind<>'answer' OR p.kind='question'));
END;
--> statement-breakpoint
CREATE TRIGGER course_bonus_rules_created AFTER INSERT ON courses BEGIN
  INSERT INTO course_bonus_rules(id) VALUES(NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER course_teacher_insert BEFORE INSERT ON courses
WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.id)
  AND NOT EXISTS(SELECT 1 FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher' AND a.status<>'deleted'
    JOIN terms t ON t.id=e.term_id AND t.current=1 WHERE e.course_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'course_requires_teacher'); END;
--> statement-breakpoint
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
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER content_created_bonus AFTER INSERT ON contents
WHEN NEW.kind IN ('question','answer','comment') BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT NEW.course_id,t.id,NEW.author_id,
    CASE NEW.kind WHEN 'question' THEN r.points_question WHEN 'answer' THEN r.points_answer ELSE r.points_comment END,
    NEW.kind,NEW.id,NEW.updated_by,NEW.created_at
  FROM course_bonus_rules r JOIN terms t ON t.current=1
  JOIN accounts student ON student.id=NEW.author_id AND student.role='student' AND student.status<>'deleted'
  JOIN enrollments e ON e.course_id=r.id AND e.term_id=t.id AND e.account_id=student.id
  WHERE r.id=NEW.course_id AND NEW.id IN (SELECT id FROM public_contents)
    AND CASE NEW.kind WHEN 'question' THEN r.points_question WHEN 'answer' THEN r.points_answer ELSE r.points_comment END>0;
END;
--> statement-breakpoint
CREATE TRIGGER content_status_bonus AFTER UPDATE OF status ON contents WHEN NEW.status<>OLD.status BEGIN
  UPDATE acceptances SET operator_id=NEW.updated_by
    WHERE NEW.status='deleted' AND (question_id=NEW.id OR answer_id=NEW.id);
  DELETE FROM acceptances WHERE NEW.status='deleted' AND (question_id=NEW.id OR answer_id=NEW.id);
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.updated_by,NEW.updated_at,l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=NEW.course_id AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
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
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT q.course_id,t.id,answer.author_id,r.points_acceptance,'acceptance',answer.id,NEW.operator_id,NEW.created_at
  FROM public_contents q JOIN public_contents answer ON answer.id=NEW.answer_id
  JOIN course_bonus_rules r ON r.id=q.course_id JOIN terms t ON t.current=1
  JOIN accounts student ON student.id=answer.author_id AND student.role='student' AND student.status<>'deleted'
  JOIN enrollments e ON e.course_id=q.course_id AND e.term_id=t.id AND e.account_id=student.id
  WHERE q.id=NEW.question_id AND r.points_acceptance>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.operator_id,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_changed AFTER UPDATE OF answer_id ON acceptances WHEN NEW.answer_id<>OLD.answer_id BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT q.course_id,t.id,answer.author_id,r.points_acceptance,'acceptance',answer.id,NEW.operator_id,NEW.created_at
  FROM public_contents q JOIN public_contents answer ON answer.id=NEW.answer_id
  JOIN course_bonus_rules r ON r.id=q.course_id JOIN terms t ON t.current=1
  JOIN accounts student ON student.id=answer.author_id AND student.role='student' AND student.status<>'deleted'
  JOIN enrollments e ON e.course_id=q.course_id AND e.term_id=t.id AND e.account_id=student.id
  WHERE q.id=NEW.question_id AND r.points_acceptance>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.operator_id,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_removed AFTER DELETE ON acceptances BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,OLD.operator_id,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=OLD.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER file_version_insert_guard BEFORE INSERT ON file_versions BEGIN
  SELECT RAISE(ABORT,'invalid_material') WHERE NOT EXISTS(SELECT 1 FROM contents WHERE id=NEW.material_id AND kind='material');
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
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT m.course_id,t.id,NEW.uploaded_by,
    CASE WHEN NEW.version=1 THEN r.points_material ELSE r.points_material_version END,'material',NEW.material_id||'@'||NEW.version,
    NEW.updated_by,NEW.created_at
  FROM public_contents m JOIN course_bonus_rules r ON r.id=m.course_id JOIN terms t ON t.current=1
  JOIN accounts student ON student.id=NEW.uploaded_by AND student.role='student' AND student.status<>'deleted'
  JOIN enrollments e ON e.course_id=m.course_id AND e.term_id=t.id AND e.account_id=student.id
  WHERE m.id=NEW.material_id
    AND CASE WHEN NEW.version=1 THEN r.points_material ELSE r.points_material_version END>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.updated_by,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.material_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER file_version_deleted_bonus AFTER DELETE ON file_versions BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,OLD.updated_by,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=OLD.material_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER bonus_ledger_guard BEFORE INSERT ON bonus_ledger BEGIN
  SELECT RAISE(ABORT,'invalid_bonus_student') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.student_id AND role='student');
  SELECT RAISE(ABORT,'invalid_bonus_reversal') WHERE NEW.reverses_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM bonus_ledger previous WHERE previous.id=NEW.reverses_id AND previous.source_kind<>'manual'
      AND previous.course_id=NEW.course_id AND previous.term_id=NEW.term_id AND previous.student_id=NEW.student_id
      AND previous.source_kind=NEW.source_kind AND previous.source_id=NEW.source_id AND previous.delta_points=-NEW.delta_points);
END;
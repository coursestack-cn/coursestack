-- Map every course reference before reinstalling triggers; never replay old rewards.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE __academic_migration_guard (
        invalid_members INTEGER NOT NULL CONSTRAINT academic_valid_member_roles CHECK(invalid_members=0),
        unresolved_classes INTEGER NOT NULL CONSTRAINT academic_unique_legacy_teacher CHECK(unresolved_classes=0),
        missing_rules INTEGER NOT NULL CONSTRAINT academic_legacy_rules_required CHECK(missing_rules=0)
    ) STRICT;
--> statement-breakpoint
INSERT INTO __academic_migration_guard SELECT
        (SELECT COUNT(*) FROM enrollments e LEFT JOIN accounts a ON a.id=e.account_id WHERE a.id IS NULL OR a.role NOT IN ('teacher','student')),
        (SELECT COUNT(*) FROM (SELECT course_id,term_id FROM enrollments UNION SELECT course_id,term_id FROM bonus_ledger) instance
            WHERE (SELECT COUNT(*) FROM enrollments e JOIN accounts a ON a.id=e.account_id AND a.role='teacher'
                WHERE e.course_id=instance.course_id AND e.term_id=instance.term_id)<>1),
        (SELECT COUNT(*) FROM courses c WHERE NOT EXISTS(SELECT 1 FROM course_bonus_rules r WHERE r.id=c.id));
--> statement-breakpoint
DROP TABLE __academic_migration_guard;
--> statement-breakpoint
CREATE TABLE __academic_id_map (
    old_id TEXT PRIMARY KEY NOT NULL, new_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, created_at INTEGER NOT NULL, introduction TEXT NOT NULL, created_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO __academic_id_map SELECT id,code,name,created_at,introduction,created_by,updated_at,request_key,request_hash FROM courses;
--> statement-breakpoint
CREATE TABLE __academic_members (course_id TEXT NOT NULL,term_id TEXT NOT NULL,account_id TEXT NOT NULL,role TEXT NOT NULL,teacher_id TEXT NOT NULL) STRICT;
--> statement-breakpoint
INSERT INTO __academic_members SELECT m.new_id,e.term_id,e.account_id,a.role,
        (SELECT teacher.account_id FROM enrollments teacher JOIN accounts identity ON identity.id=teacher.account_id AND identity.role='teacher'
            WHERE teacher.course_id=e.course_id AND teacher.term_id=e.term_id)
        FROM enrollments e JOIN accounts a ON a.id=e.account_id JOIN __academic_id_map m ON m.old_id=e.course_id;
--> statement-breakpoint
CREATE TABLE __academic_rules (course_id TEXT PRIMARY KEY NOT NULL,points_question INTEGER NOT NULL,points_answer INTEGER NOT NULL,points_acceptance INTEGER NOT NULL,points_comment INTEGER NOT NULL,points_material INTEGER NOT NULL,points_material_version INTEGER NOT NULL) STRICT;
--> statement-breakpoint
INSERT INTO __academic_rules SELECT m.new_id,r.points_question,r.points_answer,r.points_acceptance,r.points_comment,r.points_material,r.points_material_version FROM course_bonus_rules r JOIN __academic_id_map m ON m.old_id=r.id;
--> statement-breakpoint
CREATE TABLE __academic_ledger_sequence (value INTEGER NOT NULL) STRICT;
--> statement-breakpoint
INSERT INTO __academic_ledger_sequence SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='bonus_ledger'),0);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "bonus_ledger_guard";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_version_deleted_bonus";
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
CREATE TABLE `__new_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`introduction` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "courses_name" CHECK(length(trim("__new_courses"."name")) > 0),
	CONSTRAINT "courses_id" CHECK(length(trim("__new_courses"."id")) > 0)
) STRICT;
--> statement-breakpoint
DROP TABLE enrollments;
--> statement-breakpoint
DROP TABLE course_bonus_rules;
--> statement-breakpoint
DROP TABLE courses;
--> statement-breakpoint
ALTER TABLE __new_courses RENAME TO courses;
--> statement-breakpoint
-- Insert into the final parent table so SQLite resolves deferred references even when old IDs and new course numbers overlap.
INSERT INTO courses(id,name,created_at,introduction,created_by,updated_at,request_key,request_hash)
SELECT new_id,name,created_at,introduction,created_by,updated_at,request_key,request_hash FROM __academic_id_map;
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_request_unique` ON `courses` (`created_by`,`request_key`);
--> statement-breakpoint
UPDATE contents SET course_id=(SELECT new_id FROM __academic_id_map WHERE old_id=contents.course_id);
--> statement-breakpoint
UPDATE material_upload_sessions SET course_id=(SELECT new_id FROM __academic_id_map WHERE old_id=material_upload_sessions.course_id);
--> statement-breakpoint
CREATE TABLE `course_terms` (
	`course_id` text NOT NULL,
	`term_id` text NOT NULL,
	PRIMARY KEY(`course_id`, `term_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE INDEX `course_terms_term` ON `course_terms` (`term_id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `teaching_classes` (
	`course_id` text NOT NULL,
	`term_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	PRIMARY KEY(`course_id`, `term_id`, `teacher_id`),
	FOREIGN KEY (`teacher_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`,`term_id`) REFERENCES `course_terms`(`course_id`,`term_id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE INDEX `teaching_classes_teacher_term` ON `teaching_classes` (`teacher_id`,`term_id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `class_students` (
	`course_id` text NOT NULL,
	`term_id` text NOT NULL,
	`student_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	PRIMARY KEY(`course_id`, `term_id`, `student_id`),
	FOREIGN KEY (`student_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`,`term_id`,`teacher_id`) REFERENCES `teaching_classes`(`course_id`,`term_id`,`teacher_id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE INDEX `class_students_student_term` ON `class_students` (`student_id`,`term_id`,`course_id`);
--> statement-breakpoint
CREATE INDEX `class_students_class` ON `class_students` (`course_id`,`term_id`,`teacher_id`,`student_id`);
--> statement-breakpoint
CREATE TABLE `class_bonus_rules` (
	`course_id` text NOT NULL,
	`term_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`points_question` integer DEFAULT 0 NOT NULL,
	`points_answer` integer DEFAULT 0 NOT NULL,
	`points_acceptance` integer DEFAULT 0 NOT NULL,
	`points_comment` integer DEFAULT 0 NOT NULL,
	`points_material` integer DEFAULT 0 NOT NULL,
	`points_material_version` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`course_id`, `term_id`, `teacher_id`),
	FOREIGN KEY (`course_id`,`term_id`,`teacher_id`) REFERENCES `teaching_classes`(`course_id`,`term_id`,`teacher_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "class_bonus_rules_points_question" CHECK("class_bonus_rules"."points_question" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "class_bonus_rules_points_answer" CHECK("class_bonus_rules"."points_answer" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "class_bonus_rules_points_acceptance" CHECK("class_bonus_rules"."points_acceptance" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "class_bonus_rules_points_comment" CHECK("class_bonus_rules"."points_comment" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "class_bonus_rules_points_material" CHECK("class_bonus_rules"."points_material" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "class_bonus_rules_points_material_version" CHECK("class_bonus_rules"."points_material_version" BETWEEN 0 AND 9007199254740991)
) STRICT;
--> statement-breakpoint
INSERT INTO course_terms SELECT DISTINCT course_id,term_id FROM __academic_members;
--> statement-breakpoint
INSERT INTO teaching_classes SELECT course_id,term_id,account_id FROM __academic_members WHERE role='teacher';
--> statement-breakpoint
INSERT INTO class_students SELECT course_id,term_id,account_id,teacher_id FROM __academic_members WHERE role='student';
--> statement-breakpoint
INSERT INTO class_bonus_rules SELECT c.course_id,c.term_id,c.teacher_id,r.points_question,r.points_answer,r.points_acceptance,r.points_comment,r.points_material,r.points_material_version
        FROM teaching_classes c JOIN __academic_rules r ON r.course_id=c.course_id;
--> statement-breakpoint
CREATE TABLE `__new_bonus_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` text NOT NULL,
	`term_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`student_id` text NOT NULL,
	`delta_points` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`operator_id` text NOT NULL,
	`reason` text,
	`reverses_id` integer,
	`request_hash` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operator_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_id`) REFERENCES `__new_bonus_ledger`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`,`term_id`,`teacher_id`) REFERENCES `teaching_classes`(`course_id`,`term_id`,`teacher_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bonus_ledger_source_kind" CHECK("__new_bonus_ledger"."source_kind" IN ('question', 'answer', 'acceptance', 'comment', 'material', 'manual')),
	CONSTRAINT "bonus_ledger_delta" CHECK("__new_bonus_ledger"."delta_points" <> 0 AND abs("__new_bonus_ledger"."delta_points") <= 9007199254740991),
	CONSTRAINT "bonus_ledger_shape" CHECK(("__new_bonus_ledger"."source_kind" = 'manual' AND "__new_bonus_ledger"."reverses_id" IS NULL AND "__new_bonus_ledger"."request_hash" IS NOT NULL)
        OR ("__new_bonus_ledger"."source_kind" <> 'manual' AND "__new_bonus_ledger"."request_hash" IS NULL
            AND ("__new_bonus_ledger"."reverses_id" IS NOT NULL OR "__new_bonus_ledger"."delta_points" > 0)))
) STRICT;
--> statement-breakpoint
INSERT INTO __new_bonus_ledger(id,course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,reason,reverses_id,request_hash,created_at)
        SELECT l.id,m.new_id,l.term_id,c.teacher_id,l.student_id,l.delta_points,l.source_kind,l.source_id,l.operator_id,l.reason,l.reverses_id,l.request_hash,l.created_at
        FROM bonus_ledger l JOIN __academic_id_map m ON m.old_id=l.course_id
        JOIN teaching_classes c ON c.course_id=m.new_id AND c.term_id=l.term_id;
--> statement-breakpoint
DROP TABLE bonus_ledger;
--> statement-breakpoint
ALTER TABLE __new_bonus_ledger RENAME TO bonus_ledger;
--> statement-breakpoint
UPDATE sqlite_sequence SET seq=MAX(seq,(SELECT value FROM __academic_ledger_sequence)) WHERE name='bonus_ledger';
--> statement-breakpoint
CREATE UNIQUE INDEX `bonus_original_award` ON `bonus_ledger` (`source_kind`,`source_id`) WHERE "bonus_ledger"."source_kind" <> 'manual' AND "bonus_ledger"."reverses_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `bonus_reversal_once` ON `bonus_ledger` (`reverses_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bonus_manual_request` ON `bonus_ledger` (`operator_id`,`source_id`) WHERE "bonus_ledger"."source_kind" = 'manual';
--> statement-breakpoint
CREATE INDEX `bonus_course_term_student` ON `bonus_ledger` (`course_id`,`term_id`,`student_id`);
--> statement-breakpoint
CREATE INDEX `bonus_class_student` ON `bonus_ledger` (`course_id`,`term_id`,`teacher_id`,`student_id`);
--> statement-breakpoint
DROP TABLE __academic_id_map;
--> statement-breakpoint
DROP TABLE __academic_members;
--> statement-breakpoint
DROP TABLE __academic_rules;
--> statement-breakpoint
DROP TABLE __academic_ledger_sequence;
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
CREATE TRIGGER content_status_bonus AFTER UPDATE OF status ON contents WHEN NEW.status<>OLD.status BEGIN
  UPDATE acceptances SET operator_id=NEW.updated_by
    WHERE NEW.status='deleted' AND (question_id=NEW.id OR answer_id=NEW.id);
  DELETE FROM acceptances WHERE NEW.status='deleted' AND (question_id=NEW.id OR answer_id=NEW.id);
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.updated_by,NEW.updated_at,l.id
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
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
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
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.question_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER acceptance_removed AFTER DELETE ON acceptances BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,OLD.operator_id,unixepoch(),l.id
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
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.material_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER file_version_deleted_bonus AFTER DELETE ON file_versions BEGIN
  INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.teacher_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,OLD.updated_by,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=OLD.material_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER bonus_ledger_guard BEFORE INSERT ON bonus_ledger BEGIN
  SELECT RAISE(ABORT,'invalid_bonus_class') WHERE NEW.reverses_id IS NULL AND NOT EXISTS(
    SELECT 1 FROM class_students WHERE course_id=NEW.course_id AND term_id=NEW.term_id
      AND teacher_id=NEW.teacher_id AND student_id=NEW.student_id);
  SELECT RAISE(ABORT,'invalid_bonus_student') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.student_id AND role='student');
  SELECT RAISE(ABORT,'invalid_bonus_reversal') WHERE NEW.reverses_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM bonus_ledger previous WHERE previous.id=NEW.reverses_id AND previous.source_kind<>'manual'
      AND previous.course_id=NEW.course_id AND previous.term_id=NEW.term_id AND previous.teacher_id=NEW.teacher_id AND previous.student_id=NEW.student_id
      AND previous.source_kind=NEW.source_kind AND previous.source_id=NEW.source_id AND previous.delta_points=-NEW.delta_points);
END;
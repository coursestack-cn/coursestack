-- Preserve both namespaces without silently changing IDs if legacy data collides.
CREATE TABLE __content_merge_guard (ok INTEGER CONSTRAINT content_identity_merge_conflict CHECK (ok = 1));
--> statement-breakpoint
INSERT INTO __content_merge_guard SELECT 0 FROM materials m JOIN contents c ON c.id=m.id;
--> statement-breakpoint
DROP TABLE __content_merge_guard;
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
DROP VIEW public_contents;
--> statement-breakpoint
CREATE TABLE `__new_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`course_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`target_kind` text,
	`target_id` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text NOT NULL,
	`change_reason` text DEFAULT 'created' NOT NULL,
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
	CONSTRAINT "contents_tags" CHECK(json_valid("__new_contents"."tags")),
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
    created_at,updated_at,updated_by,change_reason,accepted_answer_id,accepted_by,accepted_at,accepted_term_id,
    acceptance_id,award_cents,award_eligible,request_key,request_hash)
SELECT c.id,c.kind,c.course_id,c.author_id,
    CASE WHEN c.status='deleted' AND c.title IS NOT NULL THEN '' ELSE c.title END,
    CASE WHEN c.status='deleted' THEN '' WHEN c.file_version_id IS NULL THEN c.body
      ELSE c.body || char(10) || char(10) || '[关联资料版本](/materials/' || v.material_id || '/versions/' || v.id || ')' END,
    CASE WHEN c.status='deleted' THEN '[]' ELSE c.tags END,
    CASE WHEN c.kind='answer' THEN 'question' WHEN c.kind='comment' AND c.reply_to_id IS NOT NULL THEN 'comment' ELSE c.target_kind END,
    CASE WHEN c.kind='answer' THEN c.question_id WHEN c.kind='comment' THEN COALESCE(c.reply_to_id,c.target_id) ELSE NULL END,
    c.status,c.revision,c.created_at,c.updated_at,c.updated_by,c.change_reason,c.accepted_answer_id,c.accepted_by,
    c.accepted_at,c.accepted_term_id,c.acceptance_id,c.award_cents,c.award_eligible,c.request_key,c.request_hash
FROM contents c LEFT JOIN file_versions v ON v.id=c.file_version_id;
--> statement-breakpoint
-- The old material table has no timestamps, body, or creation request identity.
-- Preserve its metadata; new timestamps record the migration, not a reconstructed upload time.
INSERT INTO __new_contents(id,kind,course_id,author_id,title,body,status,updated_by)
SELECT id,'material',course_id,author_id,CASE WHEN status='deleted' THEN '' ELSE title END,'',status,author_id FROM materials;
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
CREATE TABLE `__new_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`filename` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_versions_version" CHECK("__new_file_versions"."version" > 0),
	CONSTRAINT "file_versions_status" CHECK("__new_file_versions"."status" IN ('visible', 'hidden', 'deleted'))
);
--> statement-breakpoint
INSERT INTO __new_file_versions SELECT id,material_id,filename,version,status FROM file_versions;
--> statement-breakpoint
DROP TABLE file_versions;
--> statement-breakpoint
ALTER TABLE __new_file_versions RENAME TO file_versions;
--> statement-breakpoint
CREATE UNIQUE INDEX `file_versions_material_version` ON `file_versions` (`material_id`,`version`);
--> statement-breakpoint
DROP TABLE materials;
--> statement-breakpoint
-- Normalize retained event payloads to the same direct-parent contract as new events.
UPDATE business_events SET payload=json_remove(json_set(payload,
    '$.targetKind',CASE WHEN json_extract(payload,'$.kind')='answer' THEN 'question'
      WHEN json_extract(payload,'$.replyToId') IS NOT NULL THEN 'comment' ELSE json_extract(payload,'$.targetKind') END,
    '$.targetId',CASE WHEN json_extract(payload,'$.kind')='answer' THEN json_extract(payload,'$.questionId')
      ELSE COALESCE(json_extract(payload,'$.replyToId'),json_extract(payload,'$.targetId')) END,
    '$.targetAuthorId',CASE WHEN json_extract(payload,'$.kind')='answer' THEN json_extract(payload,'$.questionAuthorId')
      WHEN json_extract(payload,'$.replyToId') IS NOT NULL THEN json_extract(payload,'$.replyAuthorId') ELSE json_extract(payload,'$.targetAuthorId') END),
    '$.questionId','$.replyToId','$.fileVersionId','$.questionAuthorId','$.replyAuthorId') WHERE content_id IS NOT NULL;
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
CREATE TABLE __content_foreign_key_guard (ok INTEGER CONSTRAINT content_foreign_key_conflict CHECK (ok = 1));
--> statement-breakpoint
INSERT INTO __content_foreign_key_guard SELECT 0 FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE __content_foreign_key_guard;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
CREATE TABLE `bonus_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`acceptance_id` text NOT NULL,
	`operation` text NOT NULL,
	`course_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`student_id` text NOT NULL,
	`term_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`operator_id` text NOT NULL,
	`delta_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answer_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operator_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bonus_ledger_operation" CHECK("bonus_ledger"."operation" IN ('award', 'revoke')),
	CONSTRAINT "bonus_ledger_delta" CHECK("bonus_ledger"."delta_cents" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bonus_ledger_acceptance_operation` ON `bonus_ledger` (`acceptance_id`,`operation`);--> statement-breakpoint
CREATE INDEX `bonus_course_term_student` ON `bonus_ledger` (`course_id`,`term_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `business_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`course_id` text NOT NULL,
	`content_id` text,
	`actor_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`acknowledged_at` integer,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "business_events_payload" CHECK(json_valid("business_events"."payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_events_event_unique` ON `business_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `events_course_sequence` ON `business_events` (`course_id`,`seq`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`course_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`question_id` text,
	`target_kind` text,
	`target_id` text,
	`reply_to_id` text,
	`file_version_id` text,
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
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_version_id`) REFERENCES `file_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_answer_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contents_kind" CHECK("contents"."kind" IN ('question', 'answer', 'comment')),
	CONSTRAINT "contents_tags" CHECK(json_valid("contents"."tags")),
	CONSTRAINT "contents_target_kind" CHECK("contents"."target_kind" IN ('material', 'question', 'answer')),
	CONSTRAINT "contents_status" CHECK("contents"."status" IN ('visible', 'hidden', 'deleted')),
	CONSTRAINT "contents_award_cents" CHECK("contents"."award_cents" BETWEEN 0 AND 10000),
	CONSTRAINT "contents_award_eligible" CHECK("contents"."award_eligible" IN (0, 1)),
	CONSTRAINT "contents_shape" CHECK(("contents"."kind" = 'question' AND "contents"."title" IS NOT NULL AND "contents"."question_id" IS NULL AND "contents"."target_id" IS NULL)
        OR ("contents"."kind" = 'answer' AND "contents"."title" IS NULL AND "contents"."question_id" IS NOT NULL AND "contents"."target_id" IS NULL)
        OR ("contents"."kind" = 'comment' AND "contents"."title" IS NULL AND "contents"."question_id" IS NULL AND "contents"."target_kind" IS NOT NULL AND "contents"."target_id" IS NOT NULL)),
	CONSTRAINT "contents_question_fields" CHECK("contents"."kind" = 'question' OR ("contents"."accepted_answer_id" IS NULL AND "contents"."file_version_id" IS NULL AND "contents"."award_cents" = 0)),
	CONSTRAINT "contents_acceptance" CHECK(("contents"."accepted_answer_id" IS NULL AND "contents"."accepted_by" IS NULL AND "contents"."acceptance_id" IS NULL AND "contents"."award_cents" = 0)
        OR ("contents"."accepted_answer_id" IS NOT NULL AND "contents"."accepted_by" IS NOT NULL AND "contents"."accepted_at" IS NOT NULL
        AND "contents"."accepted_term_id" IS NOT NULL AND "contents"."acceptance_id" IS NOT NULL)),
	CONSTRAINT "contents_award_qualification" CHECK("contents"."award_cents" = 0 OR "contents"."award_eligible" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_request_unique` ON `contents` (`author_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `contents_course_kind_time` ON `contents` (`course_id`,`kind`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `contents_question` ON `contents` (`question_id`,`status`);--> statement-breakpoint
CREATE INDEX `contents_target` ON `contents` (`target_kind`,`target_id`,`status`);--> statement-breakpoint
CREATE INDEX `contents_author` ON `contents` (`author_id`,`kind`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `contents_version` ON `contents` (`file_version_id`,`status`);--> statement-breakpoint
CREATE TABLE `file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`filename` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_versions_version" CHECK("file_versions"."version" > 0),
	CONSTRAINT "file_versions_status" CHECK("file_versions"."status" IN ('visible', 'hidden', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_versions_material_version` ON `file_versions` (`material_id`,`version`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "materials_status" CHECK("materials"."status" IN ('visible', 'hidden', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE `moderation_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`old_status` text NOT NULL,
	`new_status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolution` text,
	`handled_by` text,
	`handled_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handled_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reports_status" CHECK("reports"."status" IN ('pending', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_request_unique` ON `reports` (`reporter_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_pending_report` ON `reports` (`content_id`,`reporter_id`) WHERE "reports"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `reports_queue` ON `reports` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`content_id` text NOT NULL,
	`user_id` text NOT NULL,
	`value` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`content_id`, `user_id`),
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "votes_value" CHECK("votes"."value" IN (-1, 1))
);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN code text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN department text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN introduction text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN created_by text REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN updated_by text REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN bonus_enabled integer NOT NULL DEFAULT 0 CONSTRAINT courses_bonus_enabled CHECK(bonus_enabled IN (0,1));
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN bonus_cents integer NOT NULL DEFAULT 200 CONSTRAINT courses_bonus_cents CHECK(bonus_cents BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN revision integer NOT NULL DEFAULT 1 CONSTRAINT courses_revision CHECK(revision > 0);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN updated_at integer;
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN request_key text;
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN request_hash text;
--> statement-breakpoint
UPDATE courses SET updated_at=created_at WHERE updated_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `courses_code_unique` ON `courses` (`code`) WHERE "courses"."code" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `courses_request_unique` ON `courses` (`created_by`,`request_key`) WHERE "courses"."request_key" IS NOT NULL;
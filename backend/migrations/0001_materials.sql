-- Add material uploads and versions without resetting existing application data.
-- No real file versions existed before this feature. Abort if unexpected legacy rows need metadata backfill.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE __materials_empty_guard (version_count INTEGER NOT NULL CONSTRAINT materials_require_empty_file_versions CHECK (version_count = 0)) STRICT;
--> statement-breakpoint
INSERT INTO __materials_empty_guard SELECT COUNT(*) FROM file_versions;
--> statement-breakpoint
DROP TABLE __materials_empty_guard;
--> statement-breakpoint
DROP TABLE file_versions;
--> statement-breakpoint
CREATE TABLE `file_version_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`old_status` text NOT NULL,
	`new_status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_version_actions_version" CHECK("file_version_actions"."version" > 0),
	CONSTRAINT "file_version_actions_status" CHECK("file_version_actions"."old_status" IN ('visible', 'hidden') AND "file_version_actions"."new_status" IN ('visible', 'hidden'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `file_versions` (
	`material_id` text NOT NULL,
	`version` integer NOT NULL,
	`storage_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`change_note` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`uploaded_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`material_id`, `version`),
	FOREIGN KEY (`material_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_versions_version" CHECK("file_versions"."version" > 0),
	CONSTRAINT "file_versions_status" CHECK("file_versions"."status" IN ('visible', 'hidden')),
	CONSTRAINT "file_versions_size" CHECK("file_versions"."size" > 0 AND "file_versions"."size" <= 9007199254740991)
) STRICT;
--> statement-breakpoint
CREATE TABLE `material_counters` (
	`material_id` text PRIMARY KEY NOT NULL,
	`next_version` integer NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_counters_version" CHECK("material_counters"."next_version" > 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `material_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`course_id` text NOT NULL,
	`material_id` text NOT NULL,
	`mode` text NOT NULL,
	`payload` text,
	`expected_size` integer NOT NULL,
	`mime` text NOT NULL,
	`change_note` text,
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
	CONSTRAINT "material_uploads_mode" CHECK("material_uploads"."mode" IN ('create', 'version')),
	CONSTRAINT "material_uploads_status" CHECK("material_uploads"."status" IN ('pending', 'confirming', 'published', 'cancelled', 'expired')),
	CONSTRAINT "material_uploads_size" CHECK("material_uploads"."expected_size" > 0 AND "material_uploads"."expected_size" <= 9007199254740991),
	CONSTRAINT "material_uploads_payload" CHECK("material_uploads"."payload" IS NULL OR json_valid("material_uploads"."payload")),
	CONSTRAINT "material_uploads_result" CHECK(("material_uploads"."status" = 'published') = ("material_uploads"."result_version" IS NOT NULL) AND ("material_uploads"."result_version" IS NULL OR "material_uploads"."result_version" > 0)),
	CONSTRAINT "material_uploads_lease" CHECK(("material_uploads"."status" = 'confirming') = ("material_uploads"."lease_token" IS NOT NULL AND "material_uploads"."lease_until" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE INDEX `file_version_actions_material` ON `file_version_actions` (`material_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_versions_storage_unique` ON `file_versions` (`storage_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_uploads_request_unique` ON `material_uploads` (`owner_id`,`request_key`);
--> statement-breakpoint
CREATE INDEX `material_uploads_cleanup` ON `material_uploads` (`expires_at`,`cleaned_at`);
--> statement-breakpoint
CREATE TRIGGER file_version_insert_guard BEFORE INSERT ON file_versions BEGIN
  SELECT RAISE(ABORT,'invalid_material') WHERE NOT EXISTS(SELECT 1 FROM contents WHERE id=NEW.material_id AND kind='material');
  SELECT RAISE(ABORT,'invalid_file_actor') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.uploaded_by AND status<>'deleted')
    OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.updated_by AND status<>'deleted');
END;
--> statement-breakpoint
CREATE TRIGGER file_version_identity_immutable BEFORE UPDATE ON file_versions BEGIN
  SELECT RAISE(ABORT,'file_version_identity_immutable') WHERE NEW.material_id<>OLD.material_id OR NEW.version<>OLD.version OR NEW.uploaded_by<>OLD.uploaded_by
    OR NEW.storage_key<>OLD.storage_key OR NEW.size<>OLD.size OR NEW.mime<>OLD.mime OR NEW.change_note IS NOT OLD.change_note OR NEW.created_at<>OLD.created_at;
  SELECT RAISE(ABORT,'invalid_file_actor') WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.updated_by AND status<>'deleted');
END;
--> statement-breakpoint
CREATE TRIGGER file_version_created_bonus AFTER INSERT ON file_versions BEGIN
  INSERT INTO material_counters(material_id,next_version) VALUES(NEW.material_id,NEW.version+1)
    ON CONFLICT(material_id) DO UPDATE SET next_version=MAX(next_version,excluded.next_version);
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at)
  SELECT m.course_id,t.id,NEW.uploaded_by,
    CASE WHEN NEW.version=1 THEN r.points_material ELSE r.points_material_version END,'material',NEW.material_id||'@'||NEW.version,
    NEW.updated_by,NEW.created_at
  FROM public_contents m JOIN course_bonus_rules r ON r.id=m.course_id JOIN terms t ON t.current=1
  JOIN accounts student ON student.id=NEW.uploaded_by AND student.role='student' AND student.status<>'deleted'
  JOIN enrollments e ON e.course_id=m.course_id AND e.term_id=t.id AND e.account_id=student.id
  WHERE m.id=NEW.material_id AND NEW.status='visible'
    AND CASE WHEN NEW.version=1 THEN r.points_material ELSE r.points_material_version END>0 ON CONFLICT DO NOTHING;
  INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,created_at,reverses_id)
  SELECT l.course_id,l.term_id,l.student_id,-l.delta_points,l.source_kind,l.source_id,NEW.updated_by,unixepoch(),l.id
  FROM bonus_state l LEFT JOIN bonus_sources s ON s.source_kind=l.source_kind AND s.source_id=l.source_id
  WHERE l.course_id=(SELECT course_id FROM contents WHERE id=NEW.material_id) AND ((l.delta_points>0 AND s.source_id IS NULL) OR (l.delta_points<0 AND s.source_id IS NOT NULL));
END;
--> statement-breakpoint
CREATE TRIGGER file_version_status_bonus AFTER UPDATE OF status ON file_versions WHEN NEW.status<>OLD.status BEGIN
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
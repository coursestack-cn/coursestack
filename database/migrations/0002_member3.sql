CREATE TABLE courses (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE, department TEXT NOT NULL DEFAULT '', introduction TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id),
  bonus_enabled INTEGER NOT NULL DEFAULT 0 CHECK(bonus_enabled IN (0,1)),
  bonus_cents INTEGER NOT NULL DEFAULT 200 CHECK(bonus_cents BETWEEN 0 AND 10000),
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(created_by,request_key)
);
CREATE TABLE contents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('question','answer','comment')),
  course_id TEXT NOT NULL REFERENCES courses(id), author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
  question_id TEXT REFERENCES contents(id), target_kind TEXT CHECK(target_kind IN ('material','question','answer')),
  target_id TEXT, reply_to_id TEXT REFERENCES contents(id), file_version_id TEXT REFERENCES file_versions(id),
  status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden','deleted')),
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id), change_reason TEXT NOT NULL DEFAULT 'created',
  accepted_answer_id TEXT REFERENCES contents(id), accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT, accepted_semester_id TEXT REFERENCES semesters(id), acceptance_id TEXT,
  award_cents INTEGER NOT NULL DEFAULT 0 CHECK(award_cents BETWEEN 0 AND 10000),
  award_eligible INTEGER NOT NULL DEFAULT 0 CHECK(award_eligible IN (0,1)),
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(author_id,request_key),
  CHECK((kind='question' AND title IS NOT NULL AND question_id IS NULL AND target_id IS NULL)
     OR (kind='answer' AND title IS NULL AND question_id IS NOT NULL AND target_id IS NULL)
     OR (kind='comment' AND title IS NULL AND question_id IS NULL AND target_kind IS NOT NULL AND target_id IS NOT NULL)),
  CHECK(kind='question' OR (accepted_answer_id IS NULL AND file_version_id IS NULL AND award_cents=0)),
  CHECK((accepted_answer_id IS NULL AND accepted_by IS NULL AND acceptance_id IS NULL AND award_cents=0)
     OR (accepted_answer_id IS NOT NULL AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL
         AND accepted_semester_id IS NOT NULL AND acceptance_id IS NOT NULL)),
  CHECK(award_cents=0 OR award_eligible=1)
);
CREATE INDEX contents_course_kind_time ON contents(course_id,kind,status,created_at,id);
CREATE INDEX contents_question ON contents(question_id,status);
CREATE INDEX contents_target ON contents(target_kind,target_id,status);
CREATE INDEX contents_author ON contents(author_id,kind,created_at,id);
CREATE INDEX contents_version ON contents(file_version_id,status);
CREATE TABLE votes (
  content_id TEXT NOT NULL REFERENCES contents(id), user_id TEXT NOT NULL REFERENCES users(id),
  value INTEGER NOT NULL CHECK(value IN (-1,1)), updated_at TEXT NOT NULL,
  PRIMARY KEY(content_id,user_id)
);
CREATE TABLE bonus_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acceptance_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('award','revoke')),
  course_id TEXT NOT NULL REFERENCES courses(id), question_id TEXT NOT NULL REFERENCES contents(id),
  answer_id TEXT NOT NULL REFERENCES contents(id), student_id TEXT NOT NULL REFERENCES users(id),
  semester_id TEXT NOT NULL REFERENCES semesters(id), teacher_id TEXT NOT NULL REFERENCES users(id),
  operator_id TEXT NOT NULL REFERENCES users(id), delta_cents INTEGER NOT NULL CHECK(delta_cents<>0),
  reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(acceptance_id,operation)
);
CREATE INDEX bonus_course_term_student ON bonus_ledger(course_id,semester_id,student_id);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id),
  reporter_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  resolution TEXT, handled_by TEXT REFERENCES users(id), handled_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(reporter_id,request_key)
);
CREATE UNIQUE INDEX one_pending_report ON reports(content_id,reporter_id) WHERE status='pending';
CREATE INDEX reports_queue ON reports(status,created_at,id);
CREATE TABLE moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, content_id TEXT NOT NULL REFERENCES contents(id),
  actor_id TEXT NOT NULL REFERENCES users(id), old_status TEXT NOT NULL, new_status TEXT NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE business_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, course_id TEXT NOT NULL REFERENCES courses(id),
  content_id TEXT REFERENCES contents(id), actor_id TEXT NOT NULL REFERENCES users(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL,
  acknowledged_at TEXT
);
CREATE INDEX events_course_sequence ON business_events(course_id,seq);

-- All public readers, including member 4's search, use this visibility predicate.
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

-- Enforce target invariants at the database boundary, not only in preflight reads.
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
CREATE TRIGGER content_identity_immutable BEFORE UPDATE ON contents
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.course_id<>OLD.course_id OR NEW.author_id<>OLD.author_id
  OR NEW.question_id IS NOT OLD.question_id OR NEW.target_kind IS NOT OLD.target_kind
  OR NEW.target_id IS NOT OLD.target_id OR NEW.reply_to_id IS NOT OLD.reply_to_id
BEGIN SELECT RAISE(ABORT,'content_identity_immutable'); END;
CREATE TRIGGER content_file_guard BEFORE UPDATE OF file_version_id ON contents
WHEN NEW.file_version_id IS NOT OLD.file_version_id AND NEW.file_version_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'invalid_file_version') WHERE NOT EXISTS(
    SELECT 1 FROM file_versions v JOIN materials m ON m.id=v.material_id
    WHERE v.id=NEW.file_version_id AND v.status='visible' AND m.status='visible' AND m.course_id=NEW.course_id);
END;
CREATE TRIGGER acceptance_guard BEFORE UPDATE ON contents WHEN NEW.accepted_answer_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'invalid_acceptance') WHERE NEW.kind<>'question' OR NEW.status<>'visible' OR NOT EXISTS(
    SELECT 1 FROM contents a WHERE a.id=NEW.accepted_answer_id AND a.kind='answer'
      AND a.question_id=NEW.id AND a.course_id=NEW.course_id AND a.status='visible');
END;

-- An acceptance/adjustment is one guarded UPDATE. Both ledger entries and outbox
-- events are committed in that same SQLite transaction; there is no read/write gap.
CREATE TRIGGER acceptance_ledger AFTER UPDATE ON contents
WHEN OLD.acceptance_id IS NOT NEW.acceptance_id BEGIN
  INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,
    semester_id,teacher_id,operator_id,delta_cents,reason,created_at)
  SELECT OLD.acceptance_id,'revoke',OLD.course_id,OLD.id,OLD.accepted_answer_id,a.author_id,
    OLD.accepted_semester_id,OLD.accepted_by,NEW.updated_by,-OLD.award_cents,NEW.change_reason,NEW.updated_at
    FROM contents a WHERE a.id=OLD.accepted_answer_id AND OLD.award_cents>0;
  INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,
    semester_id,teacher_id,operator_id,delta_cents,reason,created_at)
  SELECT NEW.acceptance_id,'award',NEW.course_id,NEW.id,NEW.accepted_answer_id,a.author_id,
    NEW.accepted_semester_id,NEW.accepted_by,NEW.updated_by,NEW.award_cents,NEW.change_reason,NEW.updated_at
    FROM contents a WHERE a.id=NEW.accepted_answer_id AND NEW.award_cents>0;
END;
CREATE TRIGGER answer_unavailable AFTER UPDATE OF status ON contents
WHEN NEW.kind='answer' AND NEW.status<>'visible' AND OLD.status='visible' BEGIN
  UPDATE contents SET accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,
    accepted_semester_id=NULL,acceptance_id=NULL,award_cents=0,award_eligible=0,
    revision=revision+1,updated_at=NEW.updated_at,updated_by=NEW.updated_by,change_reason='answer.'||NEW.status
    WHERE accepted_answer_id=NEW.id;
END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON bonus_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
CREATE TRIGGER moderation_audit AFTER UPDATE OF status ON contents
WHEN OLD.status<>NEW.status AND (OLD.status='hidden' OR NEW.status='hidden') BEGIN
  INSERT INTO moderation_actions(content_id,actor_id,old_status,new_status,reason,created_at)
  VALUES(NEW.id,NEW.updated_by,OLD.status,NEW.status,NEW.change_reason,NEW.updated_at);
END;
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
CREATE TRIGGER course_created_event AFTER INSERT ON courses BEGIN
  INSERT INTO business_events(event_id,type,course_id,actor_id,payload,created_at)
  VALUES('course:'||NEW.id||':1','course.created',NEW.id,NEW.created_by,
    json_object('id',NEW.id,'revision',NEW.revision),NEW.created_at);
END;
-- Creating a course also registers its teacher in the current semester.
-- This trigger, the course row and its event share one atomic statement.
CREATE TRIGGER course_creator_teaching AFTER INSERT ON courses
WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND role='teacher') BEGIN
  INSERT INTO course_teachers(course_id,user_id,semester_id)
  SELECT NEW.id,NEW.created_by,id FROM semesters WHERE status='active';
END;
CREATE TRIGGER course_updated_event AFTER UPDATE ON courses WHEN NEW.revision<>OLD.revision BEGIN
  INSERT INTO business_events(event_id,type,course_id,actor_id,payload,created_at)
  VALUES('course:'||NEW.id||':'||NEW.revision,'course.updated',NEW.id,NEW.updated_by,
    json_object('id',NEW.id,'revision',NEW.revision),NEW.updated_at);
END;
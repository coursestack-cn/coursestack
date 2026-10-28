-- Fictional terms only. Demo accounts, courses and teaching relations come from scripts/prepare-demo.mjs.
INSERT INTO terms (id, name) VALUES ('demo-current', '演示当前学期'), ('demo-previous', '演示历年学期')
ON CONFLICT(id) DO NOTHING;
UPDATE terms SET current = 1 WHERE id = 'demo-current' AND NOT EXISTS (SELECT 1 FROM terms WHERE current=1);
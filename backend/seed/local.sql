-- Fictional terms initialized by scripts/demo.mjs before demo accounts, courses and teaching relations.
INSERT INTO terms (id, name) VALUES ('26-1', '2026秋'), ('25-2', '2026春')
ON CONFLICT(id) DO NOTHING;
UPDATE terms SET current = 1 WHERE id = '26-1' AND NOT EXISTS (SELECT 1 FROM terms WHERE current=1);
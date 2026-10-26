-- LOCAL DEMO ONLY. Never execute this fixture against a real shared/production DB.
INSERT OR IGNORE INTO semesters VALUES ('term-active','2026秋','active'),('term-old','2026春','archived');
INSERT OR IGNORE INTO users VALUES ('student-a','学习者甲','student',1);
INSERT OR IGNORE INTO sessions VALUES ('ad5b2a295d0777eb9e671c7317ef89626b5d2cbaff782036637116e12f68e275','student-a','2099-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO users VALUES ('student-b','学习者乙','student',1);
INSERT OR IGNORE INTO sessions VALUES ('247d1af299b223cb5966a6867657771a2b03a66369ffb09363b7823cb59e4acb','student-b','2099-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO users VALUES ('visitor','旁听者','student',1);
INSERT OR IGNORE INTO sessions VALUES ('73b3c73175297efad60934ca3009ceafa1f3ad1b59db208f1bdb7e8a3a0f044a','visitor','2099-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO users VALUES ('teacher-a','数学教师','teacher',1);
INSERT OR IGNORE INTO sessions VALUES ('cfc0410b141698095318eaa7bd56fb7ab31279d68157a05b3e5940919dfc2fc9','teacher-a','2099-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO users VALUES ('teacher-b','物理教师','teacher',1);
INSERT OR IGNORE INTO sessions VALUES ('37f0756b4a19157447a9aba431bd030e9faa4d795006a1821886c185c81b598f','teacher-b','2099-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO users VALUES ('admin','站点管理员','admin',1);
INSERT OR IGNORE INTO sessions VALUES ('e973dc1a365f26a915a6d43036c421d191235e740df4487c9cb00f81bd2a9cb3','admin','2099-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO courses(id,name,code,department,introduction,created_by,updated_by,created_at,updated_at,request_key,request_hash)
VALUES ('course-a','高等数学','MATH101','数学学院','微积分与线性代数','teacher-a','teacher-a','2026-10-21T00:00:00.000Z','2026-10-21T00:00:00.000Z','seed-course-a','fixture'),
('course-b','大学物理','PHYS101','物理学院','力学与电磁学','teacher-b','teacher-b','2026-10-21T00:00:00.000Z','2026-10-21T00:00:00.000Z','seed-course-b','fixture');
INSERT OR IGNORE INTO course_teachers VALUES ('course-a','teacher-a','term-active'),('course-b','teacher-b','term-active'),('course-a','teacher-b','term-old');
INSERT OR IGNORE INTO enrollments VALUES ('course-a','student-a','term-active'),('course-a','student-b','term-active'),('course-b','student-b','term-active'),('course-a','visitor','term-old');
INSERT OR IGNORE INTO materials VALUES ('material-a','course-a','student-a','微积分讲义','visible'),('material-b','course-b','teacher-b','物理讲义','visible');
INSERT OR IGNORE INTO file_versions VALUES ('version-a1','material-a','微积分-v1.pdf',1,'visible'),('version-a2','material-a','微积分-v2.pdf',2,'visible'),('version-a-hidden','material-a','内部版本.pdf',3,'hidden'),('version-b1','material-b','物理-v1.pdf',1,'visible');
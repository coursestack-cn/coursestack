import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountColumns, accountTemplate, parseAccountCsv, failedAccountsCsv, accountCredentialsCsv, accountErrors, AccountCsvError } from '../../shared/accounts/import.ts';

const values = extra => ({ role: 'student', schoolNumber: '00123', name: '', department: '', major: '', grade: '', nickname: '', password: '', ...extra });

test('CSV template is header-only UTF-8 BOM with all supported fields', () => {
    assert.equal(accountTemplate(), '\uFEFF身份,学工号,姓名,院系,专业,年级,昵称,初始密码');
    assert.throws(() => parseAccountCsv(accountTemplate()), /只有表头/);
});

test('CSV handles BOM, reordered optional columns, quotes, multiline values and physical line numbers', () => {
    const rows = parseAccountCsv('\uFEFF学工号,姓名,身份,初始密码\r\n\r\n00123,"虚构,甲""乙\r\n丙", 学生 ,"  a  "\r\nT001,,教师,\r\n,,,\r\n');
    assert.deepEqual(rows, [
        { line: 3, values: values({ name: '虚构,甲"乙\r\n丙', password: '  a  ' }) },
        { line: 5, values: values({ role: 'teacher', schoolNumber: 'T001' }) },
    ]);
    assert.equal(parseAccountCsv('身份,学工号\rstudent,AbC\rstudent,abc')[1].values.schoolNumber, 'abc');
});

test('CSV rejects malformed structures and headers without guessing column mappings', () => {
    for (const source of ['', '\n,\n', '姓名\n虚构甲', '身份,学工号,学工号\n学生,01,01', '身份,学工号,多余列\n学生,01,x',
        '身份,学工号\n学生,01,extra', '身份,学工号\n学生', '身份,学工号\n学生,"01', '身份,学工号\n学生,"01"x',
        '身份,学工号\n学生,0"1', '身份,学工号\n学生,01\0']) assert.throws(() => parseAccountCsv(source), AccountCsvError, source);
});

test('CSV enforces 500 nonempty data rows and field limits without trimming passwords', () => {
    const csv = '身份,学工号\n' + Array.from({ length: 500 }, (_, i) => `学生,${i}`).join('\n\n');
    assert.equal(parseAccountCsv(csv).length, 500);
    assert.throws(() => parseAccountCsv(csv + '\n学生,501'), /500/);
    assert.deepEqual(accountErrors(values({ password: '😀'.repeat(64) })), []);
    assert.match(accountErrors(values({ password: '😀'.repeat(65) })).join(), /初始密码最多64/);
    assert.match(accountErrors(values({ schoolNumber: '', name: 'a'.repeat(81), role: 'admin' })).join(), /身份须为学生或教师.*学工号不能为空.*姓名最多80/);
    assert.equal(parseAccountCsv('身份,学工号,初始密码\n学生,001,   ')[0].values.password, '   ');
    for (const role of ['constructor', '__proto__', 'toString']) {
        const parsed = parseAccountCsv(`身份,学工号\n${role},001`)[0];
        assert.equal(parsed.values.role, role);
        assert.match(accountErrors(parsed.values).join(), /身份须为学生或教师/);
    }
});

test('failed-row CSV roundtrips every field and protects formulas, quotes and leading zeros', () => {
    const rows = ['=1+1', ' +SUM(1,2)', '@command', '-1', "'original", '00012', '\t001', 'a,"b"\nc', '  pass  ', '😀'].map((password, i) => ({
        line: i + 17, values: values({ password, schoolNumber: `00${i}`, name: '=1+1', department: "'学院", nickname: '虚构,人' }), message: '=错误',
    }));
    const csv = failedAccountsCsv(rows);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('"\'=1+1"'));
    assert.ok(csv.includes('"\'\'学院"'));
    assert.deepEqual(parseAccountCsv(csv).map(row => row.values), rows.map(row => row.values));
    assert.equal(accountColumns.length, 8);
});

test('credential CSV exports only requested fields and protects spreadsheet expressions', () => {
    const csv = accountCredentialsCsv([{ line: 2, values: values({ password: ' =1+1', name: '虚构甲', nickname: 'private-nickname' }) }]);
    assert.equal(csv, '\uFEFF"学工号","身份","姓名","初始密码"\n"\'00123","学生","虚构甲","\' =1+1"');
    assert.ok(!csv.includes('private-nickname'));
});
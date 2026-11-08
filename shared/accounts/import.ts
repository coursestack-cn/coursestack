export const ACCOUNT_IMPORT_LIMIT = 500;
export const ACCOUNT_IMPORT_BYTES = 2 * 1024 * 1024;
export const accountColumns = [
    { key: 'role', label: '身份', max: 20 }, { key: 'schoolNumber', label: '学工号', max: 64 },
    { key: 'name', label: '姓名', max: 80 }, { key: 'department', label: '院系', max: 120 },
    { key: 'major', label: '专业', max: 120 }, { key: 'grade', label: '年级', max: 40 },
    { key: 'nickname', label: '昵称', max: 80 }, { key: 'password', label: '初始密码', max: 64 },
] as const;
export type AccountField = typeof accountColumns[number]['key'];
export type AccountInput = Record<AccountField, string>;
export type ImportRow = { line: number; values: AccountInput };
export type PreviewItem = { line: number; status: 'ready' | 'existing' | 'invalid' | 'duplicate'; message: string };
export const roleLabel = (role: string) => role === 'student' ? '学生' : role === 'teacher' ? '教师' : role;

export function normalizeAccount(values: AccountInput): AccountInput {
    const result = Object.fromEntries(accountColumns.map(({ key }) => [key, key === 'password' ? values[key] : values[key].trim()])) as AccountInput;
    result.role = result.role === '学生' ? 'student' : result.role === '教师' ? 'teacher' : result.role;
    return result;
}
export function accountErrors(values: AccountInput): string[] {
    const errors: string[] = [];
    if (!['student', 'teacher'].includes(values.role)) errors.push('身份须为学生或教师');
    if (!values.schoolNumber) errors.push('学工号不能为空');
    for (const { key, label, max } of accountColumns) {
        const length = key === 'password' ? Array.from(values[key]).length : values[key].length;
        if (length > max) errors.push(`${label}最多${max}个字符`);
        if (values[key].includes('\0')) errors.push(`${label}不能包含空字符`);
    }
    return errors;
}

export class AccountCsvError extends Error {}
export function parseAccountCsv(source: string): ImportRow[] {
    if (source.startsWith('\uFEFF')) source = source.slice(1);
    if (source.includes('\0')) throw new AccountCsvError('CSV包含空字符，请另存为CSV UTF-8格式。');
    const records: { line: number; cells: string[] }[] = [];
    let cells: string[] = [], value = '', quoted = false, closed = false, line = 1, startLine = 1;
    const pushCell = () => { cells.push(value); value = ''; closed = false; };
    const pushRow = () => {
        pushCell();
        if (cells.some(cell => cell.trim())) records.push({ line: startLine, cells });
        cells = [];
        if (records.length > ACCOUNT_IMPORT_LIMIT + 1) throw new AccountCsvError('每个文件最多500条非空数据，请分批导入。');
    };
    for (let i = 0; i < source.length; i++) {
        const char = source[i]!;
        if (quoted) {
            if (char === '"') {
                if (source[i + 1] === '"') { value += '"'; i++; }
                else { quoted = false; closed = true; }
            } else {
                value += char;
                if (char === '\n' || (char === '\r' && source[i + 1] !== '\n')) line++;
            }
        } else if (char === ',') pushCell();
        else if (char === '\r' || char === '\n') {
            pushRow();
            if (char === '\r' && source[i + 1] === '\n') i++;
            line++; startLine = line;
        } else if (char === '"' && !value && !closed) quoted = true;
        else {
            if (closed || char === '"') throw new AccountCsvError(`第${line}行的引号格式不正确。`);
            value += char;
        }
    }
    if (quoted) throw new AccountCsvError(`第${startLine}行开始的引号没有闭合。`);
    if (value || closed || cells.length) pushRow();
    const header = records.shift();
    if (!header) throw new AccountCsvError('文件为空，请使用下载的CSV模板。');
    const labels = header.cells.map(cell => cell.trim());
    const allowed = new Set<string>([...accountColumns.map(column => column.label), '原行号', '错误原因']);
    if (new Set(labels).size !== labels.length) throw new AccountCsvError('表头有重复列，请检查模板。');
    if (labels.some(label => !allowed.has(label))) throw new AccountCsvError('表头含有空列或未知列，请使用下载的模板。');
    if (!labels.includes('身份') || !labels.includes('学工号')) throw new AccountCsvError('表头必须包含“身份”和“学工号”。');
    if (!records.length) throw new AccountCsvError('文件只有表头，没有可导入的数据。');
    // Our failed-row export protects every nonempty cell with an apostrophe. The two metadata columns identify that format.
    const report = labels.includes('原行号') && labels.includes('错误原因');
    return records.map(record => {
        if (record.cells.length !== labels.length) throw new AccountCsvError(`第${record.line}行的列数与表头不一致。`);
        const values = Object.fromEntries(accountColumns.map(({ key, label }) => {
            let cell = record.cells[labels.indexOf(label)] ?? '';
            if (report && cell.startsWith("'")) cell = cell.slice(1);
            return [key, cell];
        })) as AccountInput;
        return { line: record.line, values: normalizeAccount(values) };
    });
}

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const protectedCell = (value: string, all: boolean) => value && (all || /^[\s\uFEFF]*[=+\-@]|^[\t\r\n']|^0\d/.test(value)) ? "'" + value : value;
export function accountTemplate(): string {
    return '\uFEFF' + accountColumns.map(column => column.label).join(',');
}
export function failedAccountsCsv(rows: (ImportRow & { message: string })[]): string {
    const header = [...accountColumns.map(column => column.label), '原行号', '错误原因'];
    return '\uFEFF' + [header, ...rows.map(row => [
        ...accountColumns.map(({ key }) => protectedCell(key === 'role' ? roleLabel(row.values.role) : row.values[key], true)),
        String(row.line), protectedCell(row.message, true),
    ])].map(cells => cells.map(quote).join(',')).join('\n');
}
export function accountCredentialsCsv(rows: ImportRow[]): string {
    return '\uFEFF' + [['学工号', '身份', '姓名', '初始密码'], ...rows.map(({ values }) =>
        [values.schoolNumber, roleLabel(values.role), values.name, values.password].map(value => protectedCell(value, false)))]
        .map(cells => cells.map(quote).join(',')).join('\n');
}
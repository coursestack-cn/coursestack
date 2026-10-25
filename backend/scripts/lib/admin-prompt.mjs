import { HttpError } from '../../src/http.ts';

export function terminalPrompt(message, { input = process.stdin, output = process.stdout, hidden = false } = {}) {
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
        throw new HttpError(400, 'TERMINAL_REQUIRED', '请在交互终端运行；密码和 Token 不接受命令行参数或管道输入');
    }
    return new Promise((resolve, reject) => {
        let value = '';
        let finished = false;
        const wasRaw = input.isRaw ?? false;
        const finish = (error) => {
            if (finished) return;
            finished = true;
            input.off('data', onData);
            input.off('end', onEnd);
            input.off('error', onEnd);
            input.setRawMode(wasRaw);
            input.pause();
            output.write('\n');
            if (error) reject(error); else resolve(value);
        };
        const cancelled = () => new HttpError(400, 'CANCELLED', '操作已取消');
        const onEnd = () => finish(cancelled());
        const onData = (chunk) => {
            for (const character of chunk) {
                if (character === '\u0003' || character === '\u0004') { finish(cancelled()); return; }
                if (character === '\r' || character === '\n') { finish(); return; }
                if (character === '\u007f' || character === '\b') {
                    if (value && !hidden) output.write('\b \b');
                    value = Array.from(value).slice(0, -1).join('');
                } else if (character >= ' ' && value.length < 4096) {
                    value += character;
                    if (!hidden) output.write(character);
                }
            }
        };
        input.setEncoding('utf8');
        input.setRawMode(true);
        input.on('data', onData);
        input.once('end', onEnd);
        input.once('error', onEnd);
        output.write(message);
        input.resume();
    });
}
import type {
    CodeLanguage, DocValidation, MarkValidation, NodeValidation, RichTextDoc,
    RichTextMark, RichTextNode, RichTextNodeType, ShallowRichTextNode,
    ValidationFailure, ValidationReason,
} from './types.js';

export type * from './types.js';

export const CONTENT_REQUEST_MAX_BYTES = 384 * 1024;

export const RICH_TEXT_LIMITS = Object.freeze({
    maxChars: 30_000,
    maxBytes: 368 * 1024,
    maxNestingDepth: 16,
    maxHrefLength: 2048,
    maxImageAltChars: 300,
    maxLatexChars: 4000,
});

export const CODE_LANGUAGES = [
    'c', 'cpp', 'java', 'python', 'javascript', 'typescript', 'sql', 'bash',
    'json', 'xml', 'css', 'go', 'rust', 'csharp', 'matlab',
] as const satisfies readonly CodeLanguage[];

export const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

const languages: ReadonlySet<string> = new Set(CODE_LANGUAGES);
const inlineTypes: ReadonlySet<string> = new Set(['text', 'hardBreak', 'inlineMath']);
const blockTypes: ReadonlySet<string> = new Set([
    'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote',
    'codeBlock', 'horizontalRule', 'image', 'blockMath',
]);
const nodeTypes: ReadonlySet<string> = new Set(['doc', 'listItem', ...inlineTypes, ...blockTypes]);
const markTypes: ReadonlySet<string> = new Set(['bold', 'italic', 'strike', 'code', 'link']);
const nestedTypes: ReadonlySet<string> = new Set(['bulletList', 'orderedList', 'blockquote']);
const containerTypes: ReadonlySet<string> = new Set([
    'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock',
]);
const requiredContent: ReadonlySet<string> = new Set(['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote']);
const attributeKeys: Partial<Record<RichTextNodeType, readonly string[]>> = {
    heading: ['level'],
    orderedList: ['start'],
    codeBlock: ['language'],
    image: ['src', 'alt'],
    inlineMath: ['latex'],
    blockMath: ['latex'],
};

function failure(path: string, reason: ValidationReason): ValidationFailure {
    return { ok: false, path, reason };
}

function record(input: unknown): input is Record<string, unknown> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
}

function codePoints(value: string): number {
    let count = 0;
    for (const _point of value) count += 1;
    return count;
}

function joinPath(parent: string, child: string): string {
    return parent ? (child ? `${parent}.${child}` : parent) : child;
}

function exactFields(input: Record<string, unknown>, allowed: readonly string[], path = ''): ValidationFailure | null {
    for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) return failure(joinPath(path, key), 'unexpected-field');
    }
    return null;
}

/** Internal paths are kept verbatim. Backslashes and raw controls are never URLs. */
export function isInternalPath(input: string): boolean {
    return typeof input === 'string'
        && input.startsWith('/') && !input.startsWith('//')
        && !/[\u0000-\u0020\u007f\\]/u.test(input)
        && codePoints(input) <= RICH_TEXT_LIMITS.maxHrefLength;
}

/** Trim form input, then canonicalize HTTP(S) addresses. Invalid input returns null. */
export function normalizeHref(href: string): string | null {
    if (typeof href !== 'string') return null;
    const value = href.trim();
    if (!value || codePoints(value) > RICH_TEXT_LIMITS.maxHrefLength) return null;
    if (isInternalPath(value)) return value;
    if (!/^https?:\/\/[^/]/iu.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
    try {
        const url = new URL(value);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
        const normalized = url.href;
        return codePoints(normalized) <= RICH_TEXT_LIMITS.maxHrefLength ? normalized : null;
    } catch {
        return null;
    }
}

export function validateMark(input: unknown): MarkValidation {
    if (!record(input)) return failure('', 'invalid-type');
    if (typeof input.type !== 'string' || !markTypes.has(input.type)) return failure('type', 'unknown-mark');
    const fields = exactFields(input, input.type === 'link' ? ['type', 'attrs'] : ['type']);
    if (fields) return fields;
    if (input.type === 'link') {
        if (!Object.hasOwn(input, 'attrs')) return failure('attrs', 'missing-field');
        if (!record(input.attrs)) return failure('attrs', 'invalid-type');
        const attributes = exactFields(input.attrs, ['href'], 'attrs');
        if (attributes) return attributes;
        if (!Object.hasOwn(input.attrs, 'href')) return failure('attrs.href', 'missing-field');
        const href = input.attrs.href;
        if (typeof href !== 'string' || href !== href.trim() || normalizeHref(href) === null) {
            return failure('attrs.href', 'invalid-href');
        }
    }
    return { ok: true, mark: input as RichTextMark };
}

function validateMarks(input: unknown): ValidationFailure | null {
    if (!Array.isArray(input)) return failure('marks', 'invalid-type');
    const seen = new Set<string>();
    for (let index = 0; index < input.length; index += 1) {
        const result = validateMark(input[index]);
        if (!result.ok) return failure(joinPath(`marks[${index}]`, result.path), result.reason);
        if (seen.has(result.mark.type)) return failure(`marks[${index}]`, 'duplicate-mark');
        seen.add(result.mark.type);
    }
    if (seen.has('code') && seen.size > 1) return failure('marks', 'exclusive-code-mark');
    return null;
}

/** Validate this node only. Renderers can recover from bad descendants and marks. */
export function validateNodeShallow(input: unknown, options: { ignoreMarks?: boolean } = {}): NodeValidation {
    if (!record(input)) return failure('', 'invalid-type');
    if (typeof input.type !== 'string' || !nodeTypes.has(input.type)) return failure('type', 'unknown-node');
    const type = input.type as RichTextNodeType;
    const keys = ['type'];
    if (containerTypes.has(type)) keys.push('content');
    if (inlineTypes.has(type)) keys.push('marks');
    if (type === 'text') keys.push('text');
    const attributes = attributeKeys[type];
    if (attributes) keys.push('attrs');
    const fields = exactFields(input, keys);
    if (fields) return fields;

    if (attributes) {
        if (!Object.hasOwn(input, 'attrs')) return failure('attrs', 'missing-field');
        if (!record(input.attrs)) return failure('attrs', 'invalid-type');
        const extra = exactFields(input.attrs, attributes, 'attrs');
        if (extra) return extra;
        for (const key of attributes) {
            if (!Object.hasOwn(input.attrs, key)) return failure(`attrs.${key}`, 'missing-field');
        }
        const attrs = input.attrs;
        if (type === 'heading' && attrs.level !== 2 && attrs.level !== 3 && attrs.level !== 4) {
            return failure('attrs.level', 'invalid-attribute');
        }
        if (type === 'orderedList' && (typeof attrs.start !== 'number' || !Number.isSafeInteger(attrs.start) || attrs.start < 1)) {
            return failure('attrs.start', 'invalid-attribute');
        }
        if (type === 'codeBlock' && attrs.language !== null && (typeof attrs.language !== 'string' || !languages.has(attrs.language))) {
            return failure('attrs.language', 'invalid-attribute');
        }
        if (type === 'image') {
            if (typeof attrs.src !== 'string' || !isInternalPath(attrs.src)) return failure('attrs.src', 'invalid-image-src');
            if (attrs.alt !== null && (typeof attrs.alt !== 'string' || codePoints(attrs.alt) > RICH_TEXT_LIMITS.maxImageAltChars)) {
                return failure('attrs.alt', 'invalid-attribute');
            }
        }
        if ((type === 'inlineMath' || type === 'blockMath') && (typeof attrs.latex !== 'string' || codePoints(attrs.latex) > RICH_TEXT_LIMITS.maxLatexChars)) {
            return failure('attrs.latex', 'invalid-attribute');
        }
    }

    if (type === 'text') {
        if (!Object.hasOwn(input, 'text')) return failure('text', 'missing-field');
        if (typeof input.text !== 'string') return failure('text', 'invalid-type');
        if (input.text.length === 0) return failure('text', 'empty-text');
    }
    if (Object.hasOwn(input, 'marks') && !options.ignoreMarks) {
        const marks = validateMarks(input.marks);
        if (marks) return marks;
    }
    if (requiredContent.has(type) && !Object.hasOwn(input, 'content')) return failure('content', 'missing-field');
    if (Object.hasOwn(input, 'content')) {
        if (!Array.isArray(input.content)) return failure('content', 'invalid-type');
        if (requiredContent.has(type) && input.content.length === 0) return failure('content', 'invalid-content');
    }
    return { ok: true, node: input as unknown as ShallowRichTextNode };
}

export function isAllowedChild(parent: RichTextNodeType, child: string, index: number): boolean {
    if (parent === 'doc' || parent === 'blockquote') return blockTypes.has(child);
    if (parent === 'paragraph' || parent === 'heading') return inlineTypes.has(child);
    if (parent === 'bulletList' || parent === 'orderedList') return child === 'listItem';
    if (parent === 'listItem') return index === 0 ? child === 'paragraph' : blockTypes.has(child);
    return parent === 'codeBlock' && child === 'text';
}

function validateDocument(input: unknown, checkSizeLimits: boolean): DocValidation {
    if (!record(input)) return failure('', 'invalid-type');
    if (input.type !== 'doc') return failure('type', 'invalid-content');
    const ancestors = new Set<object>();
    let characters = 0;

    function visit(value: unknown, path: string, nesting: number): ValidationFailure | null {
        if (typeof value === 'object' && value !== null && ancestors.has(value)) return failure(path, 'cyclic-content');
        const shallow = validateNodeShallow(value);
        if (!shallow.ok) return failure(joinPath(path, shallow.path), shallow.reason);
        const node = shallow.node;
        const depth = nesting + Number(nestedTypes.has(node.type));
        if (depth > RICH_TEXT_LIMITS.maxNestingDepth) return failure(path, 'nesting-limit');
        if (node.type === 'text') characters += codePoints(node.text!);
        if (node.type === 'inlineMath' || node.type === 'blockMath') characters += codePoints(node.attrs!.latex as string);
        if (node.type === 'image' || node.type === 'hardBreak' || node.type === 'horizontalRule') characters += 1;
        if (checkSizeLimits && characters > RICH_TEXT_LIMITS.maxChars) return failure(path, 'character-limit');

        ancestors.add(value as object);
        for (let index = 0; index < (node.content?.length ?? 0); index += 1) {
            const child = node.content![index];
            const childPath = joinPath(path, `content[${index}]`);
            if (!record(child)) return failure(childPath, 'invalid-type');
            if (typeof child.type !== 'string' || !nodeTypes.has(child.type)) return failure(`${childPath}.type`, 'unknown-node');
            if (!isAllowedChild(node.type, child.type, index)) return failure(`${childPath}.type`, 'invalid-content');
            if (node.type === 'codeBlock' && Object.hasOwn(child, 'marks') && (!Array.isArray(child.marks) || child.marks.length > 0)) {
                return failure(`${childPath}.marks`, 'invalid-code-content');
            }
            const error = visit(child, childPath, depth);
            if (error) return error;
        }
        ancestors.delete(value as object);
        return null;
    }

    const error = visit(input, '', 0);
    if (error) return error;
    if (checkSizeLimits) {
        const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
        if (bytes > RICH_TEXT_LIMITS.maxBytes) return failure('', 'byte-limit');
    }
    return { ok: true, doc: input as unknown as RichTextDoc };
}

export function validateDoc(input: unknown): DocValidation {
    return validateDocument(input, true);
}

/** For editor transactions only: still checks every schema rule and nesting depth. */
export function validateDocStructure(input: unknown): DocValidation {
    return validateDocument(input, false);
}

/** These helpers take validated documents; they do not repair untrusted JSON. */
export function countChars(doc: RichTextDoc): number {
    const pending: RichTextNode[] = [doc];
    let count = 0;
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.type === 'text') count += codePoints(node.text);
        else if (node.type === 'inlineMath' || node.type === 'blockMath') count += codePoints(node.attrs.latex);
        else if (node.type === 'image' || node.type === 'hardBreak' || node.type === 'horizontalRule') count += 1;
        if ('content' in node && node.content) pending.push(...node.content);
    }
    return count;
}

export function isEmptyDoc(doc: RichTextDoc): boolean {
    const pending: RichTextNode[] = [doc];
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.type === 'text' && node.text.trim() !== '') return false;
        if (node.type === 'image' || node.type === 'inlineMath' || node.type === 'blockMath' || node.type === 'horizontalRule') return false;
        if ('content' in node && node.content) pending.push(...node.content);
    }
    return true;
}

export function toPlainText(doc: RichTextDoc, options: { maxChars?: number } = {}): string {
    function render(node: RichTextNode): string {
        if (node.type === 'text') return node.text;
        if (node.type === 'hardBreak') return '\n';
        if (node.type === 'image') return '[图片]';
        if (node.type === 'inlineMath' || node.type === 'blockMath') return '[公式]';
        if (node.type === 'horizontalRule') return '—';
        const inline = node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock';
        return (node.content ?? []).map(render).join(inline ? '' : '\n');
    }
    const text = render(doc);
    if (options.maxChars === undefined) return text;
    if (!Number.isSafeInteger(options.maxChars) || options.maxChars < 0) {
        throw new RangeError('maxChars must be a non-negative safe integer');
    }
    const points = Array.from(text);
    return points.length > options.maxChars ? `${points.slice(0, options.maxChars).join('')}…` : text;
}
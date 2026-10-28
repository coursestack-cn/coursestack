import { CODE_LANGUAGES, CONTENT_REQUEST_MAX_BYTES, RICH_TEXT_LIMITS } from './index.ts';

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
    type: 'object', properties, required, additionalProperties: false,
});
const array = (items: Schema, minItems = 0): Schema => ({ type: 'array', items, minItems });
const text = (maxLength: number): Schema => ({ type: 'string', maxLength });
const marks: Schema = { ...array(ref('ProseMirrorMark')), uniqueItems: true,
    description: '标记类型不可重复；code 必须独占，不与其他标记共存。' };
const leaf = (type: string, properties: Record<string, Schema> = {}, optional: string[] = []) =>
    object({ type: { const: type }, ...properties }, ['type', ...Object.keys(properties).filter(key => !optional.includes(key))]);
const inline = (type: string, properties: Record<string, Schema> = {}) => leaf(type, { ...properties, marks }, ['marks']);
const container = (type: string, children: Schema, minItems = 0, attrs?: Schema) =>
    leaf(type, { ...(attrs ? { attrs } : {}), content: array(children, minItems) }, minItems === 0 ? ['content'] : []);
const internalPath: Schema = { ...text(RICH_TEXT_LIMITS.maxHrefLength), pattern: '^/(?!/)',
    description: '站内路径；拒绝反斜杠、原始空白及控制字符。文件访问另由服务端授权。' };
const paragraph = container('paragraph', ref('ProseMirrorInline'));
const codeText = leaf('text', { text: { type: 'string', minLength: 1 }, marks: { type: 'array', maxItems: 0 } }, ['marks']);

/** Structural OpenAPI schema; shared validateDoc also enforces semantic counts and URL rules. */
export const richTextSchemas: Record<string, Schema> = {
    ProseMirrorMark: { oneOf: [object({ type: { enum: ['bold', 'italic', 'strike', 'code'] } }),
        leaf('link', { attrs: object({ href: { ...text(RICH_TEXT_LIMITS.maxHrefLength),
            description: '完整 http(s) URL 或单斜杠开头的站内路径；拒绝空白、控制字符、反斜杠和其他协议。' } }) })] },
    ProseMirrorInline: { oneOf: [inline('text', { text: { type: 'string', minLength: 1 } }), inline('hardBreak'),
        inline('inlineMath', { attrs: object({ latex: text(RICH_TEXT_LIMITS.maxLatexChars) }) })] },
    ProseMirrorParagraph: paragraph,
    ProseMirrorListItem: leaf('listItem', { content: { type: 'array', minItems: 1,
        prefixItems: [ref('ProseMirrorParagraph')], items: ref('ProseMirrorBlock') } }),
    ProseMirrorBlock: { oneOf: [paragraph,
        container('heading', ref('ProseMirrorInline'), 0, object({ level: { enum: [2, 3, 4] } })),
        container('bulletList', ref('ProseMirrorListItem'), 1),
        container('orderedList', ref('ProseMirrorListItem'), 1, object({ start: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } })),
        container('blockquote', ref('ProseMirrorBlock'), 1),
        container('codeBlock', codeText, 0, object({ language: { enum: [...CODE_LANGUAGES, null] } })),
        leaf('horizontalRule'), leaf('image', { attrs: object({ src: internalPath, alt: { type: ['string', 'null'], maxLength: RICH_TEXT_LIMITS.maxImageAltChars } }) }),
        leaf('blockMath', { attrs: object({ latex: text(RICH_TEXT_LIMITS.maxLatexChars) }) })] },
    ProseMirrorDocument: { ...container('doc', ref('ProseMirrorBlock'), 1),
        description: '严格节点、标记及属性白名单。最多 30000 个语义 Unicode 码点、紧凑 JSON UTF-8 368 KiB；列表与引用沿祖先链累计最多 16 层。内容写请求整体最多 384 KiB。规范空正文为含一个空段落的 doc。详细规则以 shared/rich-text/index.ts 的 validateDoc 为准。',
        'x-max-semantic-code-points': RICH_TEXT_LIMITS.maxChars, 'x-max-json-bytes': RICH_TEXT_LIMITS.maxBytes,
        'x-max-nesting-depth': RICH_TEXT_LIMITS.maxNestingDepth, 'x-max-request-bytes': CONTENT_REQUEST_MAX_BYTES },
    ProseMirrorNode: { anyOf: [ref('ProseMirrorDocument'), ref('ProseMirrorBlock'), ref('ProseMirrorInline'), ref('ProseMirrorListItem')] },
};
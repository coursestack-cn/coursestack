export type CodeLanguage =
    | 'c' | 'cpp' | 'java' | 'python' | 'javascript' | 'typescript' | 'sql'
    | 'bash' | 'json' | 'xml' | 'css' | 'go' | 'rust' | 'csharp' | 'matlab';

export type RichTextMark =
    | { type: 'bold' | 'italic' | 'strike' | 'code' }
    | { type: 'link'; attrs: { href: string } };

export interface TextNode {
    type: 'text';
    text: string;
    marks?: RichTextMark[];
}

export interface HardBreakNode {
    type: 'hardBreak';
    marks?: RichTextMark[];
}

export interface InlineMathNode {
    type: 'inlineMath';
    attrs: { latex: string };
    marks?: RichTextMark[];
}

export type InlineNode = TextNode | HardBreakNode | InlineMathNode;

export interface ParagraphNode {
    type: 'paragraph';
    content?: InlineNode[];
}

export interface HeadingNode {
    type: 'heading';
    attrs: { level: 2 | 3 | 4 };
    content?: InlineNode[];
}

export interface BulletListNode {
    type: 'bulletList';
    content: ListItemNode[];
}

export interface OrderedListNode {
    type: 'orderedList';
    attrs: { start: number };
    content: ListItemNode[];
}

export interface ListItemNode {
    type: 'listItem';
    content: [ParagraphNode, ...BlockNode[]];
}

export interface BlockquoteNode {
    type: 'blockquote';
    content: BlockNode[];
}

export interface CodeBlockNode {
    type: 'codeBlock';
    attrs: { language: CodeLanguage | null };
    content?: Array<{ type: 'text'; text: string; marks?: [] }>;
}

export interface HorizontalRuleNode {
    type: 'horizontalRule';
}

export interface ImageNode {
    type: 'image';
    attrs: { src: string; alt: string | null };
}

export interface BlockMathNode {
    type: 'blockMath';
    attrs: { latex: string };
}

export type BlockNode =
    | ParagraphNode | HeadingNode | BulletListNode | OrderedListNode
    | BlockquoteNode | CodeBlockNode | HorizontalRuleNode | ImageNode | BlockMathNode;

export interface RichTextDoc {
    type: 'doc';
    content: BlockNode[];
}

export type RichTextNode = RichTextDoc | BlockNode | ListItemNode | InlineNode;
export type RichTextNodeType = RichTextNode['type'];

/** Only the current node has been checked; descendants remain untrusted. */
export interface ShallowRichTextNode {
    type: RichTextNodeType;
    attrs?: Record<string, unknown>;
    text?: string;
    content?: unknown[];
    marks?: unknown[];
}

export type ValidationReason =
    | 'invalid-type' | 'unknown-node' | 'unknown-mark' | 'unexpected-field'
    | 'missing-field' | 'invalid-content' | 'invalid-attribute' | 'invalid-href'
    | 'invalid-image-src' | 'empty-text' | 'duplicate-mark' | 'exclusive-code-mark'
    | 'invalid-code-content' | 'nesting-limit' | 'character-limit' | 'byte-limit'
    | 'cyclic-content';

export interface ValidationFailure {
    ok: false;
    /** Empty string means the document itself; otherwise relative to the root. */
    path: string;
    reason: ValidationReason;
}

export type DocValidation = { ok: true; doc: RichTextDoc } | ValidationFailure;
export type NodeValidation = { ok: true; node: ShallowRichTextNode } | ValidationFailure;
export type MarkValidation = { ok: true; mark: RichTextMark } | ValidationFailure;
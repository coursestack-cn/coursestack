import { RICH_TEXT_LIMITS, isAllowedChild, validateMark, validateNodeShallow, type RichTextMark } from "./index";

export type RenderNode = {
    type: string;
    content: RenderNode[];
    marks: RichTextMark[];
    text?: string;
    attrs?: Record<string, unknown>;
};

const invalid = (): RenderNode => ({ type: "invalid", content: [], marks: [] });
const containers = new Set(["bulletList", "orderedList", "blockquote"]);

function boundedChars(value: string): number {
    let count = 0;
    for (const _point of value) {
        if (++count > RICH_TEXT_LIMITS.maxChars) break;
    }
    return count;
}

/** Recover siblings independently. The view is deliberately separate from submission validation. */
export function toRenderTree(input: unknown): RenderNode {
    let nodeCount = 0;
    let chars = 0;
    let bytes = 0;
    const encoder = new TextEncoder();
    const seen = new WeakSet<object>();

    function visit(value: unknown, parent: string | null, index: number, nesting: number, depth: number): RenderNode {
        if (++nodeCount > RICH_TEXT_LIMITS.maxBytes / 10 || depth > 64) return invalid();
        const checked = validateNodeShallow(value, { ignoreMarks: true });
        if (!checked.ok) return invalid();
        const node = checked.node;
        if (parent === null ? node.type !== "doc" : !isAllowedChild(parent as Parameters<typeof isAllowedChild>[0], node.type, index)) return invalid();
        if (seen.has(value as object)) return invalid();
        seen.add(value as object);
        const nextNesting = nesting + Number(containers.has(node.type));
        if (nextNesting > RICH_TEXT_LIMITS.maxNestingDepth) return invalid();

        const marks: RichTextMark[] = [];
        if (parent === "codeBlock" && node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.length > 0)) return invalid();
        if (Array.isArray(node.marks)) {
            // Valid documents have at most five distinct marks. Bound malformed arrays too.
            for (const entry of node.marks.slice(0, 32)) {
                const checkedMark = validateMark(entry);
                if (checkedMark.ok && !marks.some((mark) => mark.type === checkedMark.mark.type)) marks.push(checkedMark.mark);
            }
        }
        const cleanMarks = marks.length > 1 ? marks.filter((mark) => mark.type !== "code") : marks;
        const ownChars = node.type === "text" ? boundedChars(node.text ?? "")
            : node.type === "inlineMath" || node.type === "blockMath" ? boundedChars(String(node.attrs?.latex ?? ""))
            : ["image", "hardBreak", "horizontalRule"].includes(node.type) ? 1 : 0;
        if (chars + ownChars > RICH_TEXT_LIMITS.maxChars) return invalid();
        const ownBytes = encoder.encode(JSON.stringify({
            type: node.type,
            ...(node.attrs ? { attrs: node.attrs } : {}),
            ...(node.text !== undefined ? { text: node.text } : {}),
            ...(node.marks !== undefined ? { marks: cleanMarks } : {}),
            ...(node.content ? { content: [] } : {})
        })).length + (index > 0 ? 1 : 0);
        if (bytes + ownBytes > RICH_TEXT_LIMITS.maxBytes) return invalid();
        chars += ownChars;
        bytes += ownBytes;
        const content: RenderNode[] = [];
        for (let childIndex = 0; childIndex < (node.content?.length ?? 0); childIndex += 1) {
            if (nodeCount >= RICH_TEXT_LIMITS.maxBytes / 10 || bytes >= RICH_TEXT_LIMITS.maxBytes) {
                content.push(invalid());
                break;
            }
            content.push(visit(node.content![childIndex], node.type, childIndex, nextNesting, depth + 1));
        }
        seen.delete(value as object);
        return { type: node.type, text: node.text, attrs: node.attrs, marks: cleanMarks, content };
    }

    return visit(input, null, 0, 0, 0);
}
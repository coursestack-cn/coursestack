import type { RichTextDoc, RichTextNode } from '../../../shared/rich-text/index.ts';

export function bodySearchText(doc: RichTextDoc | null): string {
    function render(node: RichTextNode): string {
        if (node.type === 'text') return node.text;
        if (node.type === 'hardBreak') return '\n';
        // Keep a boundary around non-text content without indexing synthetic labels or URLs.
        if (node.type === 'image' || node.type === 'inlineMath' || node.type === 'blockMath' || node.type === 'horizontalRule') return '\n';
        const inline = node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock';
        return (node.content ?? []).map(render).join(inline ? '' : '\n');
    }
    return doc ? render(doc).replace(/\s+/gu, ' ').trim() : '';
}
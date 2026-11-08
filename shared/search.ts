export type HighlightRange = [number, number];
export const foldSearchText = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());

export function parseSearchQuery(value: string) {
    const q = value.trim().replace(/\s+/gu, ' ');
    const words = q ? q.split(' ') : [];
    const error = Array.from(q).length > 100 ? '搜索关键词最多100个字符。'
        : words.length > 8 ? '最多输入8个关键词，用空格分隔。' : null;
    return { q, terms: [...new Set(words.map(foldSearchText))], error };
}

// Offsets are UTF-16 indices into the original string, suitable for String.slice.
export function highlightRanges(text: string, terms: string[]): HighlightRange[] {
    const folded = foldSearchText(text), ranges: HighlightRange[] = [];
    for (const term of terms) {
        if (!term) continue;
        let offset = folded.indexOf(term);
        while (offset >= 0) {
            ranges.push([offset, offset + term.length]);
            offset = folded.indexOf(term, offset + 1);
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: HighlightRange[] = [];
    for (const [start, end] of ranges) {
        const last = merged.at(-1);
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged;
}

export function searchExcerpt(text: string, terms: string[], maxChars = 160): string {
    const plain = text.replace(/\s+/gu, ' ').trim(), points = Array.from(plain);
    const folded = foldSearchText(plain);
    const offsets = terms.filter(Boolean).map(term => folded.indexOf(term)).filter(offset => offset >= 0);
    const position = offsets.length ? Array.from(plain.slice(0, Math.min(...offsets))).length : 0;
    const start = Math.max(0, Math.min(position - 40, points.length - maxChars));
    return (start ? '…' : '') + points.slice(start, start + maxChars).join('') + (start + maxChars < points.length ? '…' : '');
}
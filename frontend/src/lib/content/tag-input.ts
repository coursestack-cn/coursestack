export const TAG_LIMITS = Object.freeze({ maxTags: 8, maxChars: 30 });

export function validateTags(value: readonly string[]): string | undefined {
    if (value.length > TAG_LIMITS.maxTags) return `最多添加 ${TAG_LIMITS.maxTags} 个标签。`;
    const seen = new Set<string>();
    for (const tag of value) {
        if (tag.trim() !== tag || !tag || Array.from(tag).length > TAG_LIMITS.maxChars) {
            return `每个标签须为 1–${TAG_LIMITS.maxChars} 字，且不含首尾空白。`;
        }
        if (seen.has(tag)) return "标签不能重复。";
        seen.add(tag);
    }
    return undefined;
}

export type TagInputResult = { tags: string[]; remaining: string; error: string | undefined; added: number };

/** Trims input and compares exact strings; no case folding or Unicode normalization. */
export function addTags(value: readonly string[], input: string): TagInputResult {
    const tags = [...value];
    const remaining: string[] = [];
    const seen = new Set(tags);
    let error: string | undefined;
    let added = 0;
    for (const part of input.split(/[,，]/u)) {
        const tag = part.trim();
        if (!tag) continue;
        if (Array.from(tag).length > TAG_LIMITS.maxChars) {
            remaining.push(tag);
            error ??= `每个标签最多 ${TAG_LIMITS.maxChars} 字。`;
        } else if (seen.has(tag)) {
            error ??= `标签“${tag}”已存在。`;
        } else if (tags.length >= TAG_LIMITS.maxTags) {
            remaining.push(tag);
            error ??= `最多添加 ${TAG_LIMITS.maxTags} 个标签。`;
        } else {
            tags.push(tag);
            seen.add(tag);
            added += 1;
        }
    }
    return { tags, remaining: remaining.join("，"), error, added };
}
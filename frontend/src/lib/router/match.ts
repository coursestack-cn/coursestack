export function normalizePath(path: string): string {
    return path.replace(/\/+$/, "") || "/";
}

export function matchRoute<T extends { path: string }>(pathname: string, routes: readonly T[]): {
    route: T;
    params: Record<string, string>;
} | null {
    let segments: string[];
    try {
        segments = pathname === "/" ? [] : pathname.slice(1).split("/").map(decodeURIComponent);
    } catch {
        return null;
    }
    const matches: { route: T; params: Record<string, string>; score: number[] }[] = [];
    for (const route of routes) {
        const pattern = route.path === "/" ? [] : route.path.slice(1).split("/");
        const wildcard = pattern.at(-1) === "*";
        if (wildcard ? segments.length < pattern.length : segments.length !== pattern.length) continue;
        const params: Record<string, string> = {};
        const score: number[] = [];
        let matchesPath = true;
        for (let index = 0; index < pattern.length; index++) {
            const part = pattern[index];
            if (part === "*") {
                params.wildcard = segments.slice(index).join("/");
                score.push(0);
            } else if (part.startsWith(":")) {
                if (!segments[index]) { matchesPath = false; break; }
                params[part.slice(1)] = segments[index];
                score.push(1);
            } else if (part === segments[index]) {
                score.push(2);
            } else {
                matchesPath = false;
                break;
            }
        }
        if (matchesPath) matches.push({ route, params, score });
    }
    matches.sort((a, b) => {
        for (let index = 0; index < Math.max(a.score.length, b.score.length); index++) {
            const difference = (b.score[index] ?? -1) - (a.score[index] ?? -1);
            if (difference) return difference;
        }
        return a.route.path.localeCompare(b.route.path);
    });
    return matches[0] ?? null;
}
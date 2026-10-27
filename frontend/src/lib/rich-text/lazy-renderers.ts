export type HighlightNode =
    | { type: "text"; value: string }
    | { type: "element"; properties: { className?: string[] }; children: HighlightNode[] };

async function createHighlighter() {
    const [lowlight, c, cpp, java, python, javascript, typescript, sql, bash, json, xml, css, go, rust, csharp, matlab] = await Promise.all([
        import("lowlight"),
        import("highlight.js/lib/languages/c"),
        import("highlight.js/lib/languages/cpp"),
        import("highlight.js/lib/languages/java"),
        import("highlight.js/lib/languages/python"),
        import("highlight.js/lib/languages/javascript"),
        import("highlight.js/lib/languages/typescript"),
        import("highlight.js/lib/languages/sql"),
        import("highlight.js/lib/languages/bash"),
        import("highlight.js/lib/languages/json"),
        import("highlight.js/lib/languages/xml"),
        import("highlight.js/lib/languages/css"),
        import("highlight.js/lib/languages/go"),
        import("highlight.js/lib/languages/rust"),
        import("highlight.js/lib/languages/csharp"),
        import("highlight.js/lib/languages/matlab")
    ]);
    return lowlight.createLowlight({
        c: c.default,
        cpp: cpp.default,
        java: java.default,
        python: python.default,
        javascript: javascript.default,
        typescript: typescript.default,
        sql: sql.default,
        bash: bash.default,
        json: json.default,
        xml: xml.default,
        css: css.default,
        go: go.default,
        rust: rust.default,
        csharp: csharp.default,
        matlab: matlab.default
    });
}

let highlighter: ReturnType<typeof createHighlighter> | undefined;

/** The caller keeps plain text visible while this optional enhancement loads. */
export async function highlightCode(code: string, language: string | null): Promise<HighlightNode[]> {
    if (!language) return [{ type: "text", value: code }];
    highlighter ??= createHighlighter().catch((error: unknown) => {
        highlighter = undefined;
        throw error;
    });
    const instance = await highlighter;
    if (!instance.registered(language)) return [{ type: "text", value: code }];
    const result = instance.highlight(language, code);
    // lowlight only produces text and span elements. Keep only those fields, never raw HTML.
    const convert = (node: (typeof result.children)[number]): HighlightNode => {
        if (node.type === "text") return { type: "text", value: node.value };
        if (node.type !== "element") return { type: "text", value: "" };
        const classes = node.properties.className;
        return {
            type: "element",
            properties: { className: Array.isArray(classes) ? classes.map(String).filter((name) => /^[\w-]+$/.test(name)) : [] },
            children: node.children.map(convert)
        };
    };
    return result.children.map(convert);
}

async function loadKatex() {
    const [module] = await Promise.all([import("katex"), import("katex/dist/katex.min.css")]);
    return module;
}

let katex: ReturnType<typeof loadKatex> | undefined;

/** KaTeX, its CSS, and its fonts are reached only by mounted formula nodes. */
export async function renderMath(latex: string, display: boolean): Promise<string> {
    katex ??= loadKatex().catch((error: unknown) => {
        katex = undefined;
        throw error;
    });
    const module = await katex;
    return module.renderToString(latex, {
        displayMode: display,
        output: "htmlAndMathml",
        trust: false,
        throwOnError: false,
        strict: "ignore",
        maxSize: 20,
        maxExpand: 1000,
        errorColor: "var(--color-danger)"
    });
}
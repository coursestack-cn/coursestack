import { Extension, Node, textblockTypeInputRule, wrappingInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import OrderedList from "@tiptap/extension-ordered-list";
import CodeBlock from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { mount, unmount } from "svelte";
import MathPreview from "./MathPreview.svelte";
import { CODE_LANGUAGES, RICH_TEXT_LIMITS, normalizeHref, validateDocStructure } from "./index";
import { highlightCode, type HighlightNode } from "./lazy-renderers";

export type EditorExtensionOptions = {
    placeholder: string;
    onError?: (message: string) => void;
};

function imageSource(input: string | null): string | null {
    const normalized = input === null ? null : normalizeHref(input);
    return normalized?.startsWith("/") ? normalized : null;
}

function language(input: unknown): string | null {
    return typeof input === "string" && (CODE_LANGUAGES as readonly string[]).includes(input) ? input : null;
}

function positiveStart(input: string | null): number {
    const start = Number(input);
    return Number.isSafeInteger(start) && start > 0 ? start : 1;
}

const SafeLink = Link.extend({
    addAttributes() {
        return {
            href: {
                default: null,
                parseHTML: (element: HTMLElement) => normalizeHref(element.getAttribute("href") ?? "")
            }
        };
    },
    renderHTML({ HTMLAttributes }) {
        const href = normalizeHref(HTMLAttributes.href ?? "");
        return ["a", href?.startsWith("/") ? { href } : { href, target: "_blank", rel: "noopener noreferrer nofollow" }, 0];
    }
}).configure({
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    markdownLinks: false,
    isAllowedUri: (href) => normalizeHref(href) !== null,
    shouldAutoLink: (href) => normalizeHref(href) !== null,
    HTMLAttributes: {}
});

const SafeImage = Image.extend({
    addAttributes() {
        return {
            src: { default: null, parseHTML: (element: HTMLElement) => imageSource(element.getAttribute("src")) },
            alt: {
                default: null,
                parseHTML: (element: HTMLElement) => {
                    const alt = element.getAttribute("alt");
                    return alt === null ? null : [...alt].slice(0, RICH_TEXT_LIMITS.maxImageAltChars).join("");
                }
            }
        };
    },
    parseHTML() {
        return [{ tag: "img[src]", getAttrs: (element) => imageSource(element.getAttribute("src")) ? null : false }];
    },
    // Images enter through the upload callback or safe HTML, never a remote Markdown URL.
    addInputRules() { return []; }
}).configure({ inline: false, allowBase64: false, resize: false });

const SafeOrderedList = OrderedList.extend({
    addAttributes() {
        return { start: { default: 1, parseHTML: (element: HTMLElement) => positiveStart(element.getAttribute("start")) } };
    },
    // Pasting Markdown text is intentionally not an automatic list conversion.
    addProseMirrorPlugins() { return []; },
    addInputRules() {
        return [wrappingInputRule({
            find: /^(\d+)\.\s$/,
            type: this.type,
            getAttributes: (match) => ({ start: positiveStart(match[1]) }),
            joinPredicate: (match, node) => node.childCount + node.attrs.start === positiveStart(match[1])
        })];
    }
});

const SafeCodeBlock = CodeBlock.extend({
    addAttributes() {
        return {
            language: {
                default: null,
                rendered: false,
                parseHTML: (element: HTMLElement) => language(
                    [...(element.firstElementChild?.classList ?? [])]
                        .find((name) => name.startsWith("language-"))?.slice("language-".length)
                )
            }
        };
    },
    addInputRules() {
        return [/^```([a-z]+)?[\s\n]$/, /^~~~([a-z]+)?[\s\n]$/].map((find) => textblockTypeInputRule({
            find, type: this.type, getAttributes: (match) => ({ language: language(match[1]) })
        }));
    },
    // The upstream VS Code paste handler accepts arbitrary language names.
    addProseMirrorPlugins() { return []; }
}).configure({ enableTabIndentation: false });

function mathNode(name: "inlineMath" | "blockMath") {
    const inline = name === "inlineMath";
    return Node.create({
        name,
        inline,
        group: inline ? "inline" : "block",
        atom: true,
        selectable: true,
        addAttributes() {
            return {
                latex: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-latex") ?? "" }
            };
        },
        parseHTML() {
            return [{
                tag: `${inline ? "span" : "div"}[data-type="${name}"]`,
                getAttrs: (element) => [...(element.getAttribute("data-latex") ?? "")].length <= RICH_TEXT_LIMITS.maxLatexChars ? null : false
            }];
        },
        renderHTML({ node }) {
            return [inline ? "span" : "div", { "data-type": name, "data-latex": node.attrs.latex }, node.attrs.latex];
        },
        addNodeView() {
            return ({ node }) => {
                const dom = document.createElement(inline ? "span" : "div");
                dom.contentEditable = "false";
                dom.setAttribute("data-type", name);
                dom.setAttribute("data-latex", node.attrs.latex);
                let latex: string = node.attrs.latex;
                let preview = mount(MathPreview, { target: dom, props: { latex, display: !inline } });
                return {
                    dom,
                    update(next) {
                        if (next.type.name !== name) return false;
                        if (next.attrs.latex !== latex) {
                            latex = next.attrs.latex;
                            dom.setAttribute("data-latex", latex);
                            void unmount(preview);
                            preview = mount(MathPreview, { target: dom, props: { latex, display: !inline } });
                        }
                        return true;
                    },
                    ignoreMutation: () => true,
                    destroy() { void unmount(preview); }
                };
            };
        }
    });
}

const highlightKey = new PluginKey<DecorationSet>("courseStackCodeHighlight");

function codeDecorations(nodes: HighlightNode[], from: number): Decoration[] {
    const decorations: Decoration[] = [];
    let offset = from;
    function visit(items: HighlightNode[], classes: string[]) {
        for (const node of items) {
            if (node.type === "text") {
                if (node.value.length && classes.length) {
                    decorations.push(Decoration.inline(offset, offset + node.value.length, { class: classes.join(" ") }));
                }
                offset += node.value.length;
            } else {
                visit(node.children, [...classes, ...(node.properties.className ?? [])]);
            }
        }
    }
    visit(nodes, []);
    return decorations;
}

const CodeHighlight = Extension.create({
    name: "courseStackCodeHighlight",
    addProseMirrorPlugins() {
        return [new Plugin<DecorationSet>({
            key: highlightKey,
            state: {
                init: () => DecorationSet.empty,
                apply(transaction, current) {
                    return transaction.getMeta(highlightKey) ?? current.map(transaction.mapping, transaction.doc);
                }
            },
            props: { decorations: (state) => highlightKey.getState(state) },
            view(view) {
                let disposed = false;
                let generation = 0;
                let previous: ProseMirrorNode | null = null;
                let timer: ReturnType<typeof setTimeout> | undefined;
                function refresh() {
                    if (previous === view.state.doc) return;
                    previous = view.state.doc;
                    const doc = previous;
                    const version = ++generation;
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        const jobs: Promise<Decoration[]>[] = [];
                        doc.descendants((node, position) => {
                            if (node.type.name !== "codeBlock") return;
                            // Oversize drafts remain editable without expensive highlighting.
                            if (node.textContent.length > RICH_TEXT_LIMITS.maxChars * 2) return false;
                            jobs.push(highlightCode(node.textContent, language(node.attrs.language))
                                .then((result) => codeDecorations(result, position + 1)).catch(() => []));
                            return false;
                        });
                        void Promise.all(jobs).then((results) => {
                            if (disposed || version !== generation || view.state.doc !== doc) return;
                            view.dispatch(view.state.tr.setMeta(highlightKey, DecorationSet.create(doc, results.flat())));
                        });
                    }, 80);
                }
                refresh();
                return {
                    update() { refresh(); },
                    destroy() { disposed = true; generation++; clearTimeout(timer); }
                };
            }
        })];
    }
});

export function createEditorExtensions({ placeholder, onError }: EditorExtensionOptions) {
    const ContractGuard = Extension.create({
        name: "courseStackContractGuard",
        priority: 1000,
        addProseMirrorPlugins() {
            return [new Plugin({
                filterTransaction(transaction) {
                    if (!transaction.docChanged) return true;
                    const result = validateDocStructure(transaction.doc.toJSON());
                    if (result.ok) return true;
                    queueMicrotask(() => onError?.(result.reason === "nesting-limit"
                        ? "列表和引用最多嵌套 16 层。"
                        : "这次操作包含不支持的格式，内容未插入。"));
                    return false;
                }
            })];
        }
    });
    return [
        StarterKit.configure({
            heading: { levels: [2, 3, 4] },
            underline: false,
            link: false,
            orderedList: false,
            codeBlock: false,
            trailingNode: false,
            dropcursor: false
        }),
        SafeLink,
        SafeImage,
        SafeOrderedList,
        SafeCodeBlock,
        mathNode("inlineMath"),
        mathNode("blockMath"),
        Placeholder.configure({ placeholder }),
        ContractGuard,
        CodeHighlight
    ];
}

/** Keep supported semantic HTML and text; never copy browser/Word styling into the document. */
export function sanitizePastedHTML(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;
    const allowed = new Set(["P", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "HR", "IMG", "BR", "STRONG", "B", "EM", "I", "S", "STRIKE", "DEL", "A"]);
    const discard = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "LINK", "META", "TEMPLATE"]);
    const paragraphs = new Set(["DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "H1", "H5", "H6", "TD", "TH"]);
    function clean(parent: ParentNode, depth: number) {
        for (const child of [...parent.childNodes]) {
            if (child.nodeType === globalThis.Node.COMMENT_NODE) { child.remove(); continue; }
            if (!(child instanceof HTMLElement)) continue;
            const tag = child.tagName;
            if (discard.has(tag)) { child.remove(); continue; }
            const kind = child.getAttribute("data-type");
            const latex = child.getAttribute("data-latex");
            const math = (tag === "SPAN" && kind === "inlineMath") || (tag === "DIV" && kind === "blockMath");
            if (math && latex !== null && [...latex].length <= RICH_TEXT_LIMITS.maxLatexChars) {
                for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
                child.setAttribute("data-type", kind!);
                child.setAttribute("data-latex", latex);
                child.textContent = latex;
                continue;
            }
            const nested = ["UL", "OL", "BLOCKQUOTE"].includes(tag);
            if (nested && depth >= RICH_TEXT_LIMITS.maxNestingDepth) {
                const paragraph = document.createElement("p");
                paragraph.textContent = child.textContent;
                child.replaceWith(paragraph);
                continue;
            }
            const href = tag === "A" ? normalizeHref(child.getAttribute("href") ?? "") : null;
            const src = tag === "IMG" ? imageSource(child.getAttribute("src")) : null;
            const alt = child.getAttribute("alt");
            const start = positiveStart(child.getAttribute("start"));
            const codeLanguage = tag === "CODE" ? language([...child.classList].find((name) => name.startsWith("language-"))?.slice(9)) : null;
            const bold = /^(bold|[6-9]00)$/.test(child.style.fontWeight);
            const italic = child.style.fontStyle === "italic";
            const strike = child.style.textDecoration.includes("line-through");
            for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
            clean(child, depth + (nested ? 1 : 0));
            if (tag === "IMG") {
                if (!src) { child.remove(); continue; }
                child.setAttribute("src", src);
                if (alt !== null) child.setAttribute("alt", [...alt].slice(0, RICH_TEXT_LIMITS.maxImageAltChars).join(""));
            }
            if (tag === "A") {
                if (!href) { child.replaceWith(...child.childNodes); continue; }
                child.setAttribute("href", href);
            }
            if (tag === "OL") child.setAttribute("start", String(start));
            if (codeLanguage) child.setAttribute("class", `language-${codeLanguage}`);
            if (!allowed.has(tag)) {
                let contents: ChildNode[] = [...child.childNodes];
                for (const mark of [bold && "strong", italic && "em", strike && "s"]) {
                    if (!mark) continue;
                    const wrapper = document.createElement(mark);
                    wrapper.append(...contents);
                    contents = [wrapper];
                }
                if (paragraphs.has(tag) && !child.querySelector("p,ul,ol,blockquote,pre,h2,h3,h4")) {
                    const paragraph = document.createElement("p");
                    paragraph.append(...contents);
                    child.replaceWith(paragraph);
                } else child.replaceWith(...contents);
            }
        }
    }
    clean(template.content, 0);
    return template.innerHTML;
}
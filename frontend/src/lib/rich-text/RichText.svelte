<script lang="ts">
    import { ExternalLink } from "@lucide/svelte";
    import Link from "../components/ui/Link.svelte";
    import CodePreview from "./CodePreview.svelte";
    import MathPreview from "./MathPreview.svelte";
    import { toRenderTree, type RenderNode } from "./render-tree";
    import "./rich-text.css";

    let { doc, class: className = "" }: { doc: unknown; class?: string } = $props();
    const tree = $derived(toRenderTree(doc));
</script>

{#snippet marked(node: RenderNode, index = 0)}
    {@const mark = node.marks[index]}
    {#if !mark}
        {@render inline(node)}
    {:else if mark.type === "bold"}<strong>{@render marked(node, index + 1)}</strong>
    {:else if mark.type === "italic"}<em>{@render marked(node, index + 1)}</em>
    {:else if mark.type === "strike"}<s>{@render marked(node, index + 1)}</s>
    {:else if mark.type === "code"}<code>{@render marked(node, index + 1)}</code>
    {:else if mark.type === "link"}
        {@const external = !mark.attrs.href.startsWith("/")}
        <Link href={mark.attrs.href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer nofollow" : undefined}>
            {@render marked(node, index + 1)}{#if external}<span class="rich-external-icon" aria-hidden="true"><ExternalLink size="0.8em" /></span><span class="rich-sr-only">（外部链接，在新标签页打开）</span>{/if}
        </Link>
    {/if}
{/snippet}

{#snippet inline(node: RenderNode)}
    {#if node.type === "text"}{node.text}
    {:else if node.type === "hardBreak"}<br />
    {:else if node.type === "inlineMath"}<MathPreview latex={String(node.attrs?.latex ?? "")} />
    {:else}<span class="rich-content-unavailable">此处内容无法显示</span>{/if}
{/snippet}

{#snippet children(node: RenderNode)}
    {#each node.content as child}{@render block(child)}{/each}
{/snippet}

{#snippet block(node: RenderNode)}
    {#if node.type === "doc"}{@render children(node)}
    {:else if node.type === "paragraph"}<p>{@render children(node)}</p>
    {:else if node.type === "heading"}<svelte:element this={`h${node.attrs?.level}`}>{@render children(node)}</svelte:element>
    {:else if node.type === "bulletList"}<ul>{#each node.content as child}{#if child.type === "invalid"}<li><span class="rich-content-unavailable">此处内容无法显示</span></li>{:else}{@render block(child)}{/if}{/each}</ul>
    {:else if node.type === "orderedList"}<ol start={Number(node.attrs?.start)}>{#each node.content as child}{#if child.type === "invalid"}<li><span class="rich-content-unavailable">此处内容无法显示</span></li>{:else}{@render block(child)}{/if}{/each}</ol>
    {:else if node.type === "listItem"}<li>{@render children(node)}</li>
    {:else if node.type === "blockquote"}<blockquote>{@render children(node)}</blockquote>
    {:else if node.type === "codeBlock"}
        {#if node.content.some((child) => child.type === "invalid")}<span class="rich-content-unavailable">此处内容无法显示</span>{:else}<CodePreview code={node.content.map((child) => child.text ?? "").join("")} language={typeof node.attrs?.language === "string" ? node.attrs.language : null} />{/if}
    {:else if node.type === "horizontalRule"}<hr />
    {:else if node.type === "image"}<img src={String(node.attrs?.src ?? "")} alt={typeof node.attrs?.alt === "string" ? node.attrs.alt : ""} loading="lazy" />
    {:else if node.type === "blockMath"}<MathPreview latex={String(node.attrs?.latex ?? "")} display />
    {:else if ["text", "hardBreak", "inlineMath"].includes(node.type)}{@render marked(node)}
    {:else}<span class="rich-content-unavailable">此处内容无法显示</span>{/if}
{/snippet}

<div class={`rich-text ${className}`}>{@render block(tree)}</div>
<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
        name: string;
        mime?: string;
        iconSize?: string | number;
    };
</script>

<script lang="ts">
    import { File, FileArchive, FileImage, FileSpreadsheet, FileText, FileType, Presentation } from "@lucide/svelte";
    import { classifyFile } from "../../files/validation";

    let { name, mime = "", iconSize = "1.5em", class: className = "", ...rest }: Props = $props();
    const icons = { pdf: FileType, image: FileImage, document: FileText, spreadsheet: FileSpreadsheet, presentation: Presentation, archive: FileArchive, other: File };
    const Icon = $derived(icons[classifyFile(name, mime)]);
</script>

<span {...rest} class={`file-icon ${className}`} aria-hidden={rest["aria-hidden"] ?? true}><Icon size={iconSize} /></span>

<style>
    .file-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--color-text-secondary); }
</style>
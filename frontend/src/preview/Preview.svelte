<script lang="ts">
    import { onMount } from "svelte";
    import { Bell, Check, Download, FileText, Search, Upload } from "@lucide/svelte";
    import logoSource from "../assets/coursestack-logo.svg?raw";
    import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";
    import { sm, lg } from "../styles/breakpoints";
    import {
        contrastPairs, contrastRatio, readColors, semanticRoles, surfaceColors,
        textColors, utilityColors, type ColorValue
    } from "./metrics";

    const themes: { value: ThemePreference; label: string }[] = [
        { value: "system", label: "跟随系统" },
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" }
    ];
    const groups = [
        { title: "纸面与边界", names: surfaceColors },
        { title: "文字层次", names: textColors },
        { title: "交互与遮罩", names: utilityColors }
    ];
    const roleLabels: Record<string, string> = {
        accent: "主色", success: "成功", warning: "警告", danger: "危险", teacher: "教师"
    };
    const fontSizes = ["xs", "sm", "md", "base", "prose", "lg", "xl", "2xl"];
    const spaces = [1, 2, 3, 4, 5, 6, 8, 10, 12];
    const radii = ["sm", "md", "lg", "full"];
    const icons = [
        { icon: Search, label: "搜索" }, { icon: Bell, label: "通知" },
        { icon: Upload, label: "上传" }, { icon: Download, label: "下载" },
        { icon: FileText, label: "文件" }, { icon: Check, label: "对勾" }
    ];
    const measurements = [
        ...fontSizes.map((size) => `font-size-${size}`),
        ...spaces.map((space) => `space-${space}`),
        ...radii.map((radius) => `radius-${radius}`),
        "width-prose", "width-page", "z-sticky", "z-dropdown", "z-dialog", "z-toast",
        "duration-fast", "duration-base", "ease-out"
    ];

    let preference = $state<ThemePreference>(getThemePreference());
    let effectiveTheme = $state("浅色");
    let colors = $state<Record<string, ColorValue>>({});
    let values = $state<Record<string, string>>({});
    const rows = $derived(contrastPairs.map((pair) => ({
        ...pair,
        ratio: colors[pair.foreground] && colors[pair.background]
            ? contrastRatio(colors[pair.foreground]!, colors[pair.background]!) : null
    })));
    const failures = $derived(rows.filter((row) => row.ratio !== null && row.ratio < row.minimum).length);

    function refresh() {
        colors = readColors();
        const root = getComputedStyle(document.documentElement);
        values = Object.fromEntries(measurements.map((name) => [name, root.getPropertyValue(`--${name}`).trim()]));
        effectiveTheme = document.documentElement.dataset.theme === "dark"
            || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches)
            ? "深色" : "浅色";
    }

    function chooseTheme(value: ThemePreference) {
        preference = value;
        setThemePreference(value);
        refresh();
    }

    onMount(() => {
        refresh();
        const scheme = matchMedia("(prefers-color-scheme: dark)");
        const motion = matchMedia("(prefers-reduced-motion: reduce)");
        let frame = 0;
        const scheduleRefresh = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(refresh);
        };
        scheme.addEventListener("change", scheduleRefresh);
        motion.addEventListener("change", scheduleRefresh);
        import.meta.hot?.on("vite:afterUpdate", scheduleRefresh);
        return () => {
            cancelAnimationFrame(frame);
            scheme.removeEventListener("change", scheduleRefresh);
            motion.removeEventListener("change", scheduleRefresh);
            import.meta.hot?.off("vite:afterUpdate", scheduleRefresh);
        };
    });

    // Inline the source geometry, with independent IDs for each of the four samples.
    // Paper and edge strokes use the surrounding surface; the original asset is untouched.
    function inlineLogo(id: string): string {
        return logoSource.replaceAll("coursestack-book", `preview-book-${id}`)
            .replaceAll('"#111"', '"currentColor"')
            .replaceAll('"#fff"', '"var(--logo-paper)"');
    }
</script>

<header class="toolbar">
    <div class="toolbar-inner">
        <a class="wordmark" href="#top">课栈 <span>设计基础</span></a>
        <div class="theme-options">
            {#each themes as theme}
                <label class:active={preference === theme.value}>
                    <input type="radio" name="theme" value={theme.value} checked={preference === theme.value}
                        onchange={() => chooseTheme(theme.value)} />
                    {theme.label}
                </label>
            {/each}
        </div>
    </div>
</header>

<main id="top">
    <div class="intro">
        <p class="eyebrow">COURSESTACK / LAYER 00</p>
        <h1>纸张暖色，墨绿为引。</h1>
        <p class="lede">在真实的文字、纸面和内容里，核验课栈的第一层设计基础。</p>
        <div class="intro-meta">
            <span>当前呈现：{effectiveTheme}</span>
            <span>系统字体</span>
            <span>仅开发预览</span>
        </div>
        <nav class="section-links">
            <a href="#colors">01 颜色</a><a href="#contrast">02 对比度</a><a href="#type">03 字体</a>
            <a href="#geometry">04 空间</a><a href="#logo">05 Logo</a>
            <a href="#composition">06 组合</a><a href="#icons">07 图标</a>
        </nav>
    </div>

    <section id="colors">
        <div class="section-heading"><span>01</span><h2>颜色</h2></div>
        <p class="section-note">色值取自浏览器当前计算结果；切换主题与修改变量后会重新读取。</p>
        {#each groups as group}
            <h3>{group.title}</h3>
            <div class="swatch-grid">
                {#each group.names as name}
                    <div class="swatch-card">
                        <div class="swatch" style:background={`var(--color-${name})`}></div>
                        <div class="swatch-caption"><code>--color-{name}</code><span>{colors[name]?.label ?? "读取中"}</span></div>
                    </div>
                {/each}
            </div>
        {/each}
        <h3>主色与语义配对</h3>
        <div class="semantic-grid">
            {#each semanticRoles as role}
                <div class="semantic-card">
                    <h4>{roleLabels[role]}</h4>
                    {#each [{ background: role, foreground: `on-${role}`, label: "实底" },
                        { background: `${role}-soft`, foreground: `${role}-soft-text`, label: "浅底" }] as pair}
                        <div class="pair-sample" style:background={`var(--color-${pair.background})`}
                            style:color={`var(--color-${pair.foreground})`}>
                            <span>{roleLabels[role]} / {pair.label}</span>
                            <span class="ink-swatch" style:background={`var(--color-${pair.foreground})`}></span>
                        </div>
                        <div class="pair-caption">
                            <code>--color-{pair.background}</code><span>{colors[pair.background]?.label}</span>
                            <code>--color-{pair.foreground}</code><span>{colors[pair.foreground]?.label}</span>
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    </section>

    <section id="contrast">
        <div class="section-heading"><span>02</span><h2>对比度</h2></div>
        <div class="contrast-summary" class:has-failures={failures > 0}>
            <strong>{effectiveTheme}：{failures === 0 ? "全部达到本次门槛" : `${failures} 组低于本次门槛`}</strong>
            <span>普通文字 4.5:1；弱化文字按 brief 取 3:1；选中底色与页面底色至少 1.3:1。合格判断使用未舍入值。</span>
        </div>
        <p class="section-note">3:1 是本次对弱化文字的约定，不代表普通小字号文字达到 WCAG AA。</p>
        <div class="table-scroll">
            <table>
                <thead><tr><th>文字 / 背景（--color-）</th><th>实际搭配</th><th>对比度</th><th>门槛</th><th>结果</th></tr></thead>
                <tbody>
                    {#each rows as row}
                        <tr class:failed={row.ratio !== null && row.ratio < row.minimum}>
                            <td><code>{row.foreground}</code><span class="pair-divider">/</span><code>{row.background}</code></td>
                            <td><span class="contrast-example" style:color={`var(--color-${row.foreground})`}
                                style:background={`var(--color-${row.background})`}>课栈 Aa</span></td>
                            <td class="ratio">{row.ratio?.toFixed(2) ?? "—"}:1</td>
                            <td>{row.minimum}:1</td>
                            <td>{row.ratio === null ? "读取中" : row.ratio < row.minimum ? "未达标" : "通过"}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    </section>

    <section id="type">
        <div class="section-heading"><span>03</span><h2>字体</h2></div>
        <p class="section-note">系统中文字体栈。每档分别展示常规 400 与粗体 600。</p>
        <div class="type-list">
            {#each fontSizes as size}
                <div class="type-row">
                    <div class="type-label"><code>--font-size-{size}</code><span>{values[`font-size-${size}`]}</span></div>
                    <div class="type-samples" style:font-size={`var(--font-size-${size})`}>
                        <p>第三章习题 3.7 的边界条件 Boundary conditions</p>
                        <p class="bold">第三章习题 3.7 的边界条件 Boundary conditions</p>
                    </div>
                </div>
            {/each}
        </div>
        <div class="prose-sample">
            <h3>长文阅读 / 16px / 1.75</h3>
            <p>学习一门课程，也是在慢慢整理自己的问题。遇到不确定的边界条件时，先回到定义，再对照具体例子逐步推导。把思考过程、使用的资料版本和仍有疑惑的地方写清楚，能让后来读到这段讨论的同学更快理解，也让一份答案在不同学期继续发挥作用。</p>
        </div>
        <div class="mono-sample"><code>const boundary = 3.7;</code><span>等宽字体</span><kbd>Ctrl</kbd><span>+</span><kbd>K</kbd></div>
    </section>

    <section id="geometry">
        <div class="section-heading"><span>04</span><h2>间距、圆角与阴影</h2></div>
        <div class="geometry-grid">
            <div class="measurement-panel">
                <h3>间距 / 4px 基数</h3>
                {#each spaces as space}
                    <div class="space-row"><code>--space-{space}</code>
                        <div class="space-track"><span style:width={`var(--space-${space})`}></span></div>
                        <span>{values[`space-${space}`]}</span>
                    </div>
                {/each}
            </div>
            <div class="measurement-panel">
                <h3>圆角</h3>
                <div class="radius-grid">
                    {#each radii as radius}
                        <div><div class="radius-sample" style:border-radius={`var(--radius-${radius})`}></div>
                            <code>--radius-{radius}</code><span>{values[`radius-${radius}`]}</span></div>
                    {/each}
                </div>
                <div class="shadow-sample"><strong>浮层阴影</strong><code>--shadow-popover</code><p>下拉菜单与对话框使用；卡片只用边框。</p></div>
            </div>
        </div>
        <div class="foundation-notes">
            <p>阅读宽度 <code>{values["width-prose"]}</code> / 页面宽度 <code>{values["width-page"]}</code></p>
            <p>层级 sticky → dropdown → dialog → toast：<code>{["sticky", "dropdown", "dialog", "toast"].map((name) => values[`z-${name}`]).join(" → ")}</code></p>
            <p>动效 <code>{values["duration-fast"]}</code> / <code>{values["duration-base"]}</code>，减少动态效果时归零。</p>
            <p>断点 sm <code>{sm}px</code> / lg <code>{lg}px</code></p>
        </div>
    </section>

    <section id="logo">
        <div class="section-heading"><span>05</span><h2>Logo</h2></div>
        <p class="section-note">原始路径内联呈现，墨色随文字或主色，纸色随所在表面。</p>
        <div class="logo-grid">
            {#each ["bg", "surface"] as background}
                {#each ["text", "accent"] as ink}
                    <div class="logo-card" style:background={`var(--color-${background})`}>
                        <div class="logo-art" style:color={`var(--color-${ink})`} style:--logo-paper={`var(--color-${background})`}>
                            {@html inlineLogo(`${background}-${ink}`)}
                        </div>
                        <code>{ink} / {background}</code>
                    </div>
                {/each}
            {/each}
        </div>
    </section>

    <section id="composition">
        <div class="section-heading"><span>06</span><h2>组合示意</h2></div>
        <p class="section-note">问题列表条目的静态草图，用来观察密度与语义色的关系。</p>
        <div class="composition-grid">
            <article class="question">
                <div class="question-score"><strong>12</strong><span>得分</span><span class="solved"><Check size="1em" /> 已解决</span></div>
                <div class="question-content">
                    <h3>第三章习题 3.7：边界条件应该如何确定？</h3>
                    <p class="question-meta">高等数学 A <span>/</span> 第三章习题与解析 v2</p>
                    <div class="question-tags"><span class="teacher-badge">本课程教师已回答</span><span class="tag">边界条件</span><span class="tag">习题讨论</span></div>
                    <p class="answer-count">3 个回答</p>
                </div>
            </article>
        </div>
    </section>

    <section id="icons">
        <div class="section-heading"><span>07</span><h2>图标</h2></div>
        <p class="section-note">Lucide / currentColor / 1em。下方分别继承 14px 正文色与 20px 主色。</p>
        {#each ["regular", "accent"] as variant}
            <div class="icon-row" class:accent-icons={variant === "accent"}>
                {#each icons as item}
                    <div><item.icon size="1em" /><span>{item.label}</span></div>
                {/each}
            </div>
        {/each}
    </section>
    <footer>CourseStack 设计基础 / 在此核验，逐层生长。</footer>
</main>

<style>
    .toolbar {
        position: sticky;
        top: 0;
        z-index: var(--z-sticky);
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
    }

    .toolbar-inner {
        max-width: var(--width-page);
        margin: auto;
        padding: var(--space-3) var(--space-6);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
    }

    .wordmark { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); white-space: nowrap; }
    .wordmark span { color: var(--color-text-secondary); font-size: var(--font-size-sm); margin-left: var(--space-3); font-weight: var(--font-weight-regular); }
    .theme-options { display: flex; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .theme-options label { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; transition: background var(--duration-fast) var(--ease-out); }
    .theme-options label:hover { background: var(--color-surface-sunken); }
    .theme-options label.active { background: var(--color-accent-soft); color: var(--color-accent-soft-text); }
    .theme-options input { margin: 0; accent-color: var(--color-accent); }
    main { max-width: var(--width-page); margin: auto; padding: var(--space-12) var(--space-6) var(--space-6); }
    .intro { padding-bottom: var(--space-8); }
    .eyebrow { color: var(--color-accent); font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); margin-bottom: var(--space-3); }
    .intro h1 { margin-bottom: var(--space-4); }
    .lede { color: var(--color-text-secondary); font-size: var(--font-size-prose); }
    .intro-meta { display: flex; flex-wrap: wrap; gap: var(--space-4); color: var(--color-text-secondary); font-size: var(--font-size-sm); margin-top: var(--space-5); }
    .section-links { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-top: var(--space-8); font-size: var(--font-size-sm); }
    section { padding: var(--space-8) 0 var(--space-12); border-top: 1px solid var(--color-border); scroll-margin-top: calc(var(--space-12) * 3); }
    .section-heading { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-3); }
    .section-heading > span { color: var(--color-accent); font-family: var(--font-mono); font-size: var(--font-size-sm); }
    .section-note { color: var(--color-text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--space-6); }
    h3 { margin-bottom: var(--space-4); }
    .swatch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--space-12) * 4)), 1fr)); gap: var(--space-3); margin-bottom: var(--space-6); }
    .swatch-card { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
    .swatch { height: calc(var(--space-12) + var(--space-4)); border-bottom: 1px solid var(--color-border); }
    .swatch-caption { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); }
    .swatch-caption code, .pair-caption code { font-size: var(--font-size-xs); padding: 0; background: none; overflow-wrap: anywhere; }
    .swatch-caption > span, .pair-caption > span { font-family: var(--font-mono); color: var(--color-text-secondary); font-size: var(--font-size-xs); }
    .semantic-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--space-12) * 5)), 1fr)); gap: var(--space-4); }
    .semantic-card { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    .semantic-card h4 { padding: var(--space-3) var(--space-4); }
    .pair-sample { padding: var(--space-5) var(--space-4); display: flex; justify-content: space-between; align-items: center; font-weight: var(--font-weight-bold); }
    .ink-swatch { width: var(--space-6); height: var(--space-6); border-radius: var(--radius-sm); }
    .pair-caption { display: grid; gap: var(--space-1); padding: var(--space-3) var(--space-4); }
    .pair-caption > span + code { margin-top: var(--space-2); }
    .contrast-summary { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); margin-bottom: var(--space-3); border-radius: var(--radius-md); background: var(--color-success-soft); color: var(--color-success-soft-text); }
    .contrast-summary > span { font-size: var(--font-size-sm); }
    .contrast-summary.has-failures { background: var(--color-danger-soft); color: var(--color-danger-soft-text); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
    table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); text-align: left; background: var(--color-surface); }
    th { background: var(--color-surface-sunken); font-weight: var(--font-weight-bold); }
    th, td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    tbody tr:last-child td { border-bottom: 0; }
    td code { font-size: var(--font-size-xs); background: none; padding: 0; }
    .pair-divider { margin-inline: var(--space-2); color: var(--color-text-secondary); }
    .contrast-example { display: inline-block; padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm); }
    .ratio { font-family: var(--font-mono); }
    .failed { background: var(--color-danger-soft); color: var(--color-danger-soft-text); }
    .failed .ratio { font-weight: var(--font-weight-bold); }
    .type-list { border-top: 1px solid var(--color-border); }
    .type-row { display: grid; grid-template-columns: calc(var(--space-12) * 4) minmax(0, 1fr); gap: var(--space-6); padding: var(--space-5) 0; border-bottom: 1px solid var(--color-border); }
    .type-label { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .type-label code { font-size: var(--font-size-xs); }
    .type-samples { overflow-wrap: anywhere; }
    .type-samples p + p { margin-top: var(--space-2); }
    .bold { font-weight: var(--font-weight-bold); }
    .prose-sample { max-width: var(--width-prose); margin-top: var(--space-8); }
    .prose-sample p { font-size: var(--font-size-prose); line-height: var(--line-height-prose); }
    .mono-sample { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-5); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .geometry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); }
    .measurement-panel { padding: var(--space-5); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
    .space-row { display: grid; grid-template-columns: calc(var(--space-12) * 2) 1fr var(--space-12); align-items: center; gap: var(--space-3); margin-top: var(--space-3); font-size: var(--font-size-sm); }
    .space-row code { font-size: var(--font-size-xs); background: none; padding: 0; }
    .space-track { display: flex; align-items: center; min-width: var(--space-12); }
    .space-track span { height: var(--space-4); background: var(--color-accent); border-radius: var(--radius-sm); }
    .radius-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); }
    .radius-grid > div { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .radius-grid code { background: none; padding: 0; font-size: var(--font-size-xs); }
    .radius-sample { width: calc(var(--space-12) * 2); max-width: 100%; height: var(--space-12); border: 1px solid var(--color-accent); background: var(--color-accent-soft); margin-bottom: var(--space-2); }
    .shadow-sample { margin-top: var(--space-8); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover); background: var(--color-surface); display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
    .shadow-sample p { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .foundation-notes { display: grid; gap: var(--space-2); margin-top: var(--space-6); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .foundation-notes code { font-size: inherit; }
    .logo-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); }
    .logo-card { padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); display: flex; flex-direction: column; align-items: center; gap: var(--space-5); }
    .logo-art { display: flex; }
    .logo-art :global(svg) { width: calc(var(--space-12) * 2); height: auto; }
    .logo-card code { font-size: var(--font-size-xs); background: none; padding: 0; white-space: nowrap; }
    .composition-grid { max-width: var(--width-prose); }
    .question { display: flex; gap: var(--space-5); padding: var(--space-6); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
    .question-score { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: nowrap; }
    .question-score strong { font-size: var(--font-size-2xl); color: var(--color-text); }
    .solved { display: inline-flex; align-items: center; gap: var(--space-1); margin-top: var(--space-3); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-success-soft); color: var(--color-success-soft-text); }
    .question-content { min-width: 0; }
    .question-content h3 { font-size: var(--font-size-lg); }
    .question-meta, .answer-count { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .question-meta span { margin-inline: var(--space-2); }
    .question-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-4) 0; font-size: var(--font-size-xs); }
    .teacher-badge, .tag { padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); }
    .teacher-badge { background: var(--color-teacher-soft); color: var(--color-teacher-soft-text); }
    .tag { background: var(--color-surface-sunken); color: var(--color-text-secondary); }
    .icon-row { display: flex; flex-wrap: wrap; gap: var(--space-6); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: var(--font-size-md); margin-top: var(--space-3); }
    .icon-row > div { display: inline-flex; align-items: center; gap: var(--space-2); }
    .accent-icons { font-size: var(--font-size-xl); color: var(--color-accent); }
    footer { color: var(--color-text-secondary); font-size: var(--font-size-xs); padding: var(--space-6) 0; border-top: 1px solid var(--color-border); }

    @media (max-width: 1023px) {
        .logo-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 639px) {
        .toolbar-inner { flex-wrap: wrap; padding: var(--space-3) var(--space-4); gap: var(--space-2); }
        .theme-options { margin-left: auto; }
        .theme-options label { padding-inline: var(--space-2); }
        main { padding-inline: var(--space-4); padding-top: var(--space-8); }
        .geometry-grid, .type-row { grid-template-columns: 1fr; }
        .type-row { gap: var(--space-3); }
        .type-label { flex-direction: row; align-items: center; gap: var(--space-2); }
        .question { flex-direction: column; padding: var(--space-4); }
        .question-score { flex-direction: row; gap: var(--space-2); }
        .solved { margin-top: 0; margin-left: var(--space-2); }
        .logo-card { padding-inline: var(--space-3); }
    }
</style>
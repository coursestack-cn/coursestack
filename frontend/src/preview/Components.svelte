<script lang="ts">
    import { Check, Search, Upload, Settings, Trash2, ArrowUpRight, BookOpen, Sun, Moon, Monitor, Bell } from "@lucide/svelte";
    import { getThemePreference, setThemePreference, type ThemePreference } from "$lib/theme";
    import Link from "$lib/components/ui/Link.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import SearchInput from "$lib/components/ui/SearchInput.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Checkbox from "$lib/components/ui/Checkbox.svelte";
    import Radio from "$lib/components/ui/Radio.svelte";
    import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
    import Badge, { type BadgeTone } from "$lib/components/ui/Badge.svelte";
    import Tag from "$lib/components/ui/Tag.svelte";
    import Avatar from "$lib/components/ui/Avatar.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import Breadcrumb from "$lib/components/ui/Breadcrumb.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import Menu from "$lib/components/ui/Menu.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import Toast from "$lib/components/ui/Toast.svelte";
    import Toaster from "$lib/components/ui/Toaster.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import Spinner from "$lib/components/ui/Spinner.svelte";
    import StateBlock, { type StateKind } from "$lib/components/ui/StateBlock.svelte";

    let theme = $state<string>(getThemePreference());
    const themes = [{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }];
    const variants = ["primary", "secondary", "ghost", "danger"] as const;
    const sizes = ["sm", "md"] as const;
    const tones: BadgeTone[] = ["neutral", "accent", "success", "warning", "danger", "teacher"];
    const toneLabels = ["默认状态", "重点内容", "已解决", "待处理", "已下架", "本课程教师"];
    const kinds: StateKind[] = ["loading", "empty", "error", "login-required", "forbidden", "unavailable"];
    const longText = "这是一段用于检查换行的超长文字，内容变多时，控件仍应保持完整可读且不撑破页面。";
    const sections = [
        ["button", "Button"], ["field", "Field"], ["text-input", "TextInput"], ["textarea", "Textarea"],
        ["search-input", "SearchInput"], ["select", "Select"], ["checkbox", "Checkbox"], ["radio", "Radio"],
        ["segmented", "SegmentedControl"], ["badge", "Badge"], ["tag", "Tag"], ["avatar", "Avatar"],
        ["card", "Card"], ["tabs", "Tabs"], ["breadcrumb", "Breadcrumb"], ["pagination", "Pagination"],
        ["menu", "Menu"], ["dialog", "Dialog"], ["confirm-dialog", "ConfirmDialog"], ["toast", "Toast"],
        ["toaster", "Toaster"], ["skeleton", "Skeleton"], ["spinner", "Spinner"], ["state-block", "StateBlock"], ["link", "Link"]
    ];
    let inputValue = $state<string | number>("");
    let textareaValue = $state("尝试输入多行文字，输入框会随内容自动增高。\n第二行内容。");
    let query = $state("");
    let searchResult = $state("输入关键词，按 Enter 搜索。");
    let selectedOption = $state("all");
    let checked = $state(true);
    let mixed = $state(true);
    let radio = $state("first");
    let segment = $state("open");
    let removable = $state(true);
    let activeTab = $state("materials");
    let page = $state(7);
    // The linked demo reads its page from the hash, as a router would read it from the URL.
    const pageFromHash = () => Number(/^#page-(\d+)$/.exec(location.hash)?.[1] ?? 2);
    let linkedPage = $state(pageFromHash());
    $effect(() => {
        const sync = () => { linkedPage = pageFromHash(); };
        window.addEventListener("hashchange", sync);
        return () => window.removeEventListener("hashchange", sync);
    });
    let cursor = $state(0);
    let menuSelection = $state("尚未选择");
    let menuSort = $state("recent");
    let dialogOpen = $state(false);
    let closeOnBackdrop = $state(false);
    let confirmOpen = $state(false);
    let confirmFails = $state(false);
    let confirmError = $state("");
    let confirmAttempts = $state(0);
    let staticToast = $state(true);
    let working = $state(false);

    function openConfirm(fails: boolean) {
        confirmFails = fails;
        confirmError = "";
        confirmAttempts = 0;
        confirmOpen = true;
    }
    async function confirm() {
        confirmAttempts++;
        confirmError = "";
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        if (confirmFails) throw new Error("操作失败，稍后重试。演示内容已保留。");
        toast.success("操作已完成。");
    }
    async function simulateSubmit() {
        if (working) return;
        working = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        working = false;
        toast.success("示例已保存。");
    }
</script>

{#snippet uploadIcon()}<Upload size="1em" />{/snippet}
{#snippet searchIcon()}<Search size="1em" />{/snippet}
{#snippet checkIcon()}<Check size="1em" />{/snippet}

<svelte:head><meta name="description" content="CourseStack 第 1 层通用组件：变体、状态和键盘交互预览。" /></svelte:head>

<header class="toolbar">
    <div class="toolbar-inner">
        <Link href="#top" class="brand"><BookOpen size="1em" /><strong>课栈</strong><span>组件预览</span></Link>
        <div class="theme-control">
            <span class="theme-icon" aria-hidden="true">{#if theme === "light"}<Sun size="1em" />{:else if theme === "dark"}<Moon size="1em" />{:else}<Monitor size="1em" />{/if}</span>
            <SegmentedControl options={themes} bind:value={theme} label="预览主题" onchange={(value) => setThemePreference(value as ThemePreference)} />
        </div>
    </div>
</header>

<main id="top">
    <div class="intro">
        <div><p class="eyebrow">COURSESTACK / UI / 01</p><h1>通用组件</h1><p class="lead">从一个按钮，到完整的操作反馈。<br />在同一套纸面、文字与交互规则下，检查每一种状态。</p></div>
        <Link href="/preview.html" class="foundation-link">查看设计基础<ArrowUpRight size="1em" /></Link>
    </div>
    <nav class="index" aria-label="组件索引">
        {#each sections as [id, name], index}<Link href={`#${id}`}><span>{String(index + 1).padStart(2, "0")}</span>{name}</Link>{/each}
    </nav>

    <section id="button">
        <div class="section-heading"><span>01</span><h2>Button <small>按钮</small></h2></div>
        <p class="note">四种用途、两档尺寸。加载时保留原宽度，链接和按钮共享外观。</p>
        <div class="button-matrix">
            {#each variants as variant}
                <div class="sample-row"><code>{variant}</code>
                    {#each sizes as size}<Button {variant} {size} icon={uploadIcon} onclick={() => toast.info(`已触发 ${variant} / ${size}`)}>上传资料 {size}</Button>{/each}
                    <Button {variant} disabled>暂不可用</Button><Button {variant} loading>上传资料</Button>
                </div>
            {/each}
        </div>
        <div class="row"><Button loading={working} onclick={simulateSubmit}>保存示例</Button><Button href="#link">查看链接组件</Button><Button href="#link" disabled>禁用的链接</Button><Button href="#link" loading>加载的链接</Button>
            <Button iconOnly aria-label="打开设置" onclick={() => toast.info("已触发设置按钮。")}><Settings size="1em" /></Button>
            <Button iconOnly size="sm" disabled aria-label="删除示例"><Trash2 size="1em" /></Button>
            <Button iconOnly loading aria-label="正在保存设置"><Settings size="1em" /></Button>
        </div>
        <div class="narrow"><Button>{longText}</Button></div>
    </section>

    <section id="field">
        <div class="section-heading"><span>02</span><h2>Field <small>表单项</small></h2></div>
        <div class="grid">
            <Field label="公开名称" required help="名称会展示在你发布的内容旁。">
                {#snippet children({ id, describedBy, invalid, required })}<TextInput {id} aria-describedby={describedBy} {invalid} {required} placeholder="输入公开名称" />{/snippet}
            </Field>
            <Field label="资料标题" help="用一句话概括资料内容。" error="标题为空，输入标题后重试。">
                {#snippet children({ id, describedBy, invalid })}<TextInput {id} aria-describedby={describedBy} {invalid} placeholder="输入资料标题" />{/snippet}
            </Field>
        </div>
    </section>

    <section id="text-input">
        <div class="section-heading"><span>03</span><h2>TextInput <small>单行输入</small></h2></div>
        <div class="grid">
            <Field label="普通文本">{#snippet children({ id })}<TextInput {id} bind:value={inputValue} placeholder="输入文字" />{/snippet}</Field>
            <Field label="带前置图标">{#snippet children({ id })}<TextInput {id} icon={searchIcon} type="search" placeholder="搜索内容" />{/snippet}</Field>
            <Field label="密码">{#snippet children({ id })}<TextInput {id} type="password" autocomplete="new-password" value="example-password" />{/snippet}</Field>
            <Field label="邮箱">{#snippet children({ id })}<TextInput {id} type="email" placeholder="name@example.com" />{/snippet}</Field>
            <Field label="数字">{#snippet children({ id })}<TextInput {id} type="number" min={0} max={100} value={12} />{/snippet}</Field>
            <Field label="禁用">{#snippet children({ id })}<TextInput {id} disabled value="暂不可编辑" />{/snippet}</Field>
            <Field label="错误" error="格式不正确，检查后重试。">{#snippet children({ id, describedBy, invalid })}<TextInput {id} aria-describedby={describedBy} {invalid} value="错误示例" />{/snippet}</Field>
            <Field label="超长内容">{#snippet children({ id })}<TextInput {id} value={longText} />{/snippet}</Field>
        </div>
        <p class="result">绑定值：{inputValue || "（空）"}</p>
    </section>

    <section id="textarea">
        <div class="section-heading"><span>04</span><h2>Textarea <small>多行输入</small></h2></div>
        <div class="grid">
            <Field label="自动增高">{#snippet children({ id })}<Textarea {id} bind:value={textareaValue} autoResize rows={2} />{/snippet}</Field>
            <Field label="固定行数">{#snippet children({ id })}<Textarea {id} rows={4} placeholder="输入说明，可手动调整高度" />{/snippet}</Field>
            <Field label="禁用">{#snippet children({ id })}<Textarea {id} disabled value="暂不可编辑" rows={2} />{/snippet}</Field>
            <Field label="错误" error="内容过长，缩短后重试。">{#snippet children({ id, describedBy, invalid })}<Textarea {id} aria-describedby={describedBy} {invalid} value={longText.repeat(3)} rows={2} />{/snippet}</Field>
        </div>
    </section>

    <section id="search-input">
        <div class="section-heading"><span>05</span><h2>SearchInput <small>搜索输入</small></h2></div>
        <div class="grid"><SearchInput aria-label="搜索示例" bind:value={query} placeholder="搜索资料与问题" onsubmit={(value) => { searchResult = `搜索：${value || "（空）"}`; }} onclear={() => { searchResult = "已清除搜索。"; }} />
            <SearchInput aria-label="禁用搜索" value="暂不可搜索" disabled />
            <SearchInput aria-label="错误搜索" invalid value="错误状态" />
            <SearchInput aria-label="长文字搜索" value={longText} />
        </div><p class="result" aria-live="polite">{searchResult}</p>
    </section>

    <section id="select">
        <div class="section-heading"><span>06</span><h2>Select <small>原生选择</small></h2></div>
        <div class="grid"><Select aria-label="选择内容类型" bind:value={selectedOption} options={[{ value: "all", label: "全部内容" }, { value: "materials", label: "资料" }, { value: "questions", label: "问答" }, { value: "disabled", label: "暂不可选", disabled: true }]} />
            <Select aria-label="禁用选择" disabled value="all" options={[{ value: "all", label: "暂不可选择" }]} />
            <Select aria-label="错误选择" invalid value="" options={[{ value: "", label: "选择一项后重试" }, { value: "ok", label: "有效选项" }]} />
            <Select aria-label="超长选项" value="long" options={[{ value: "long", label: longText }]} />
        </div><p class="result">绑定值：{selectedOption}</p>
    </section>

    <section id="checkbox">
        <div class="section-heading"><span>07</span><h2>Checkbox <small>多选</small></h2></div>
        <div class="row"><Checkbox label="接收更新提醒" bind:checked /><Checkbox label="部分选中" bind:indeterminate={mixed} /><Checkbox label="未选中" /><Checkbox label="禁用未选" disabled /><Checkbox label="禁用已选" checked disabled /><Checkbox label="禁用部分选中" indeterminate disabled /><Checkbox label="错误状态" invalid /></div>
        <div class="narrow"><Checkbox label={longText} /></div><p class="result">选中：{String(checked)} · 部分选中：{String(mixed)}</p>
    </section>

    <section id="radio">
        <div class="section-heading"><span>08</span><h2>Radio <small>单选</small></h2></div>
        <div class="row" role="radiogroup" aria-label="单选示例"><Radio label="第一项" name="demo-radio" value="first" bind:group={radio} /><Radio label="第二项" name="demo-radio" value="second" bind:group={radio} /><Radio label="禁用选项" name="demo-radio" value="disabled" disabled bind:group={radio} /></div>
        <div class="row"><Radio label="禁用已选" name="disabled-radio" value="selected" group="selected" disabled /><Radio label={longText} name="long-radio" value="long" /></div>
        <p class="result">绑定值：{radio}</p>
    </section>

    <section id="segmented">
        <div class="section-heading"><span>09</span><h2>SegmentedControl <small>分段选择</small></h2></div>
        <div class="stack"><SegmentedControl label="问题筛选" bind:value={segment} options={[{ value: "open", label: "未解决" }, { value: "active", label: "近期活跃" }, { value: "all", label: "全部" }, { value: "disabled", label: "暂不可选", disabled: true }]} />
            <SegmentedControl label="禁用筛选" disabled value="a" options={[{ value: "a", label: "已选中" }, { value: "b", label: "未选中" }]} />
            <SegmentedControl label="长文字选项" value="a" options={[{ value: "a", label: longText }, { value: "b", label: "短选项" }]} />
        </div><p class="result">绑定值：{segment} · 方向键、Home、End 可切换。</p>
    </section>

    <section id="badge">
        <div class="section-heading"><span>10</span><h2>Badge <small>状态标识</small></h2></div>
        <div class="stack">{#each ["soft", "solid"] as appearance}<div class="row">{#each tones as tone, index}<Badge {tone} appearance={appearance as "soft" | "solid"} icon={checkIcon}>{toneLabels[index]}</Badge>{/each}</div>{/each}
            <div class="narrow"><Badge>{longText}</Badge></div>
        </div>
    </section>

    <section id="tag">
        <div class="section-heading"><span>11</span><h2>Tag <small>话题标签</small></h2></div>
        <div class="row"><Tag>普通标签</Tag><Tag href="#link">可跳转标签</Tag><Tag onclick={() => toast.info("已选择标签。")}>可点击标签</Tag><Tag disabled href="#link">禁用标签</Tag>
            {#if removable}<Tag href="#tag" onremove={() => { removable = false; }} removeLabel="移除可删除标签">可删除标签</Tag>{:else}<Button size="sm" onclick={() => { removable = true; }}>恢复标签</Button>{/if}
            <Tag disabled onremove={() => {}}>禁用删除</Tag>
        </div><div class="narrow"><Tag onremove={() => toast.info("已触发移除。")} removeLabel="移除长文字标签">{longText}</Tag></div>
    </section>

    <section id="avatar">
        <div class="section-heading"><span>12</span><h2>Avatar <small>头像</small></h2></div>
        <div class="row">{#each ["sm", "md", "lg"] as size}<Avatar name="课栈" src="/favicon.svg" size={size as "sm" | "md" | "lg"} /><Avatar name="林同学" size={size as "sm" | "md" | "lg"} />{/each}</div>
        <div class="row">{#each ["林", "陈", "周", "叶", "许", "👩🏽‍💻同学"] as name}<Avatar {name} />{/each}<Avatar name="加载失败" src="data:image/png;base64,AA==" /><Avatar name={longText} /><Avatar name="" alt="未设置名称" /></div>
        <p class="note">24 / 32 / 48 px；名称稳定映射柔和色。损坏图片回退到首个完整字符。</p>
    </section>

    <section id="card">
        <div class="section-heading"><span>13</span><h2>Card <small>容器</small></h2></div>
        <div class="grid"><Card padding="none"><div class="card-demo"><h3>无内边距</h3><p>由内容决定留白。</p></div></Card><Card><h3>默认内边距</h3><p>细边框与纸面。</p></Card><Card padding="lg"><h3>较大内边距</h3><p>用于独立内容区块。</p></Card><Card href="#link"><h3>可点击卡片 ↗</h3><p>{longText}</p></Card></div>
    </section>

    <section id="tabs">
        <div class="section-heading"><span>14</span><h2>Tabs <small>页内选项卡</small></h2></div>
        <Tabs label="课程内容示例" bind:value={activeTab} items={[{ value: "materials", label: "资料", count: 12 }, { value: "questions", label: "问答", count: 0 }, { value: "activity", label: "近期动态" }, { value: "disabled", label: "暂不可用", disabled: true }]}>
            {#snippet children(value)}<Card><h3>{value === "materials" ? "资料内容" : value === "questions" ? "问答内容" : "动态内容"}</h3><p>当前值：{value}。用左右方向键、Home、End 切换，Tab 进入内容区。</p></Card>{/snippet}
        </Tabs>
        <Tabs label="长标题选项卡" items={[{ value: "long", label: longText, count: 12345 }, { value: "short", label: "短标题" }]}>{#snippet children(value)}<p>选中：{value}</p>{/snippet}</Tabs>
    </section>

    <section id="breadcrumb">
        <div class="section-heading"><span>15</span><h2>Breadcrumb <small>路径</small></h2></div>
        <div class="stack"><Breadcrumb items={[{ label: "首页", href: "#top" }, { label: "课程", href: "#breadcrumb" }, { label: "资料", href: "#breadcrumb" }, { label: "当前页面" }]} />
            <Breadcrumb items={[{ label: "首页", href: "#top" }, { label: "中间层级没有链接" }, { label: longText, href: "#breadcrumb" }]} />
            <Breadcrumb items={[{ label: "仅当前页面" }]} />
        </div><p class="note">窄屏中间路径折叠，可展开查看；最后一项始终是当前页。</p>
    </section>

    <section id="pagination">
        <div class="section-heading"><span>16</span><h2>Pagination <small>分页</small></h2></div>
        <div class="stack"><Pagination mode="pages" {page} pageCount={42} onchange={(next) => { page = next; }} /><p class="result">第 {page} / 42 页</p>
            <div id="pagination-links"><Pagination aria-label="链接分页" mode="pages" page={linkedPage} pageCount={5} hrefFor={(next) => `#page-${next}`} /></div>
            <Pagination aria-label="游标分页" mode="cursor" hasPrevious={cursor > 0} hasNext={cursor < 2} onchange={(direction) => { cursor += direction === "next" ? 1 : -1; }} /><p class="result">游标位置：{cursor}</p>
            <Pagination aria-label="只有一页" page={1} pageCount={1} /><Pagination aria-label="禁用分页" page={4} pageCount={10} disabled />
        </div>
    </section>

    <section id="menu">
        <div class="section-heading"><span>17</span><h2>Menu <small>下拉菜单</small></h2></div>
        <div class="row menu-row"><p class="result" aria-live="polite">选择结果：{menuSelection}</p>
            <Menu items={[
                { label: "查看示例", icon: searchIcon, onselect: () => { menuSelection = "查看示例"; } },
                { label: "禁用操作", disabled: true }, { label: "查看设计基础", href: "/preview.html" },
                { label: longText, onselect: () => { menuSelection = "长文字选项"; } }, { type: "separator" },
                { label: "删除示例", danger: true, onselect: () => { menuSelection = "删除示例"; } }
            ]}>
                {#snippet trigger(props)}<Button {...props}>打开操作菜单</Button>{/snippet}
            </Menu>
        </div>
        <Menu items={[{ label: "暂不可用", disabled: true }]}>{#snippet trigger(props)}<Button {...props} size="sm">打开全禁用菜单</Button>{/snippet}</Menu>
        <div class="row">
            <Menu items={[
                { label: "最近更新", checked: menuSort === "recent", onselect: () => { menuSort = "recent"; } },
                { label: "最多讨论", checked: menuSort === "discussed", onselect: () => { menuSort = "discussed"; } },
                { label: "暂不可选", checked: false, disabled: true }
            ]}>
                {#snippet trigger(props)}<Button {...props}>打开单选菜单</Button>{/snippet}
            </Menu>
            <Menu items={[{ label: "组件预览", href: "/components.html#menu", current: true }, { label: "设计基础", href: "/preview.html" }]}>
                {#snippet trigger(props)}<Button {...props}>打开当前页面菜单</Button>{/snippet}
            </Menu>
        </div>
        <p class="note">Enter / 空格打开；↑ ↓、Home、End 移动；Enter 选择；Esc 或外部点击关闭。</p>
    </section>

    <section id="dialog">
        <div class="section-heading"><span>18</span><h2>Dialog <small>模态对话框</small></h2></div>
        <div class="row"><Button onclick={() => { dialogOpen = true; }}>打开对话框</Button><Checkbox label="允许点击遮罩关闭" bind:checked={closeOnBackdrop} /></div>
        <Dialog bind:open={dialogOpen} title="编辑示例" description="此对话框用于检查键盘焦点、关闭行为与内容换行。" {closeOnBackdrop}>
            <Field label="示例说明">{#snippet children({ id })}<Textarea {id} value={longText} rows={3} />{/snippet}</Field>
            {#snippet actions()}<Button onclick={() => { dialogOpen = false; }}>取消</Button><Button variant="primary" onclick={() => { dialogOpen = false; }}>保存示例</Button>{/snippet}
        </Dialog>
        <p class="note">默认点击遮罩不关闭；Esc 和关闭按钮可关闭，焦点返回打开按钮。</p>
    </section>

    <section id="confirm-dialog">
        <div class="section-heading"><span>19</span><h2>ConfirmDialog <small>异步确认</small></h2></div>
        <div class="row"><Button onclick={() => openConfirm(false)}>模拟确认成功（1 秒）</Button><Button variant="danger" onclick={() => openConfirm(true)}>模拟确认失败（1 秒）</Button></div>
        <ConfirmDialog bind:open={confirmOpen} title={confirmFails ? "确认删除示例" : "确认保存示例"} danger={confirmFails}
            description={confirmFails ? "确认后等待 1 秒再返回失败，内容会留在对话框中。" : "确认后等待 1 秒，完成后自动关闭。"}
            confirmLabel={confirmFails ? "确认删除" : "确认保存"} onconfirm={confirm} onerror={(error) => { confirmError = error instanceof Error ? error.message : "操作失败，稍后重试。"; }}>
            <p>本次打开已触发确认：<strong data-confirm-attempts>{confirmAttempts}</strong> 次</p>
            {#if confirmError}<p class="error-message" role="alert">{confirmError}</p>{/if}
        </ConfirmDialog>
        <p class="note">等待期间锁定确认、取消、Esc 与关闭按钮，连续点击不会重复触发。</p>
    </section>

    <section id="toast">
        <div class="section-heading"><span>20</span><h2>Toast <small>单条提示</small></h2></div>
        <div class="narrow">{#if staticToast}<Toast tone="error" message="保存失败，检查网络后重试。此提示需手动关闭。" action={{ label: "重试", onclick: () => toast.info("已触发重试。") }} onclose={() => { staticToast = false; }} />{:else}<Button onclick={() => { staticToast = true; }}>恢复提示示例</Button>{/if}</div>
    </section>

    <section id="toaster">
        <div class="section-heading"><span>21</span><h2>Toaster <small>全局提示</small></h2></div>
        <div class="row"><Button onclick={() => toast.success("资料已保存。")}>显示成功提示</Button><Button onclick={() => toast.info("有新的内容可查看。", { action: { label: "查看", onclick: () => toast.success("已触发查看。") } })}>显示信息提示</Button><Button onclick={() => toast.error("加载失败，检查网络后重试。", { action: { label: "重试", onclick: () => toast.success("已触发重试。") } })}>显示错误提示</Button><Button onclick={() => toast.info(longText)}>显示长文字提示</Button><Button onclick={() => { for (let index = 1; index <= 4; index++) toast.info(`第 ${index} 条提示`); }}>连续显示四条</Button><Button variant="ghost" onclick={() => toast.clear()}>清空提示</Button></div>
        <p class="note">最多显示 3 条，其余排队；成功与信息 4 秒消失，悬停或键盘焦点停留时暂停计时，错误需手动关闭。</p>
    </section>

    <section id="skeleton">
        <div class="section-heading"><span>22</span><h2>Skeleton <small>加载占位</small></h2></div>
        <div class="grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton variant="block" width="100%" height="calc(var(--space-12) * 2)" /></Card><Card><div class="row"><Skeleton variant="circle" /><div class="fill"><Skeleton lines={2} /></div></div></Card><Card><Skeleton lines={1} /></Card></div>
        <p class="note">跟随系统“减少动态效果”偏好，关闭闪烁动画。</p>
    </section>

    <section id="spinner">
        <div class="section-heading"><span>23</span><h2>Spinner <small>行内加载</small></h2></div>
        <div class="row"><span class="small"><Spinner label="正在读取小号示例" /> 小号文字</span><span><Spinner label="正在读取普通示例" /> 正在读取</span><span class="large"><Spinner label="正在读取大号示例" /> 大号文字</span></div>
    </section>

    <section id="state-block">
        <div class="section-heading"><span>24</span><h2>StateBlock <small>整体状态</small></h2></div>
        <div class="grid">{#each kinds as kind}<Card padding="none"><StateBlock {kind} /></Card>{/each}</div>
        <h3 class="subheading">紧凑模式与自定义内容</h3>
        <div class="grid">{#each kinds as kind}<Card padding="none"><StateBlock {kind} compact /></Card>{/each}</div>
        <Card padding="none"><StateBlock kind="empty" compact title="还没有收藏" description={longText}>
            {#snippet icon()}<Bell size="1em" />{/snippet}
            {#snippet actions()}<Button href="#top">返回顶部</Button>{/snippet}
        </StateBlock></Card>
    </section>

    <section id="link">
        <div class="section-heading"><span>25</span><h2>Link <small>统一链接入口</small></h2></div>
        <div class="row"><Link href="/preview.html">查看设计基础</Link><Link href="#top">返回组件索引</Link></div><div class="narrow"><Link href="#link">{longText}</Link></div>
    </section>
    <footer>第 1 层 · 通用组件预览<span>仅用于开发与交互核验</span></footer>
</main>
<Toaster />

<style>
    .toolbar { position: sticky; top: 0; z-index: var(--z-sticky); background: var(--color-bg); border-bottom: 1px solid var(--color-border); }
    .toolbar-inner { max-width: var(--width-page); margin-inline: auto; padding: var(--space-3) var(--space-6); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
    :global(.brand) { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text); text-decoration: none; }
    :global(.brand > span) { margin-inline-start: var(--space-3); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .theme-control { display: flex; align-items: center; gap: var(--space-3); }
    .theme-icon { display: flex; color: var(--color-text-secondary); }
    main { max-width: var(--width-page); margin-inline: auto; padding: var(--space-12) var(--space-6) var(--space-6); scroll-margin-top: calc(var(--space-12) * 3); }
    .intro { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: var(--space-5); margin-bottom: var(--space-8); }
    .eyebrow { font: var(--font-size-xs) var(--font-mono); color: var(--color-accent); margin-bottom: var(--space-4); }
    h1 { font-size: calc(var(--font-size-2xl) + var(--space-4)); margin-bottom: var(--space-4); }
    .lead { color: var(--color-text-secondary); line-height: var(--line-height-prose); }
    :global(.foundation-link) { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-sm); }
    .index { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-1); padding: var(--space-4); margin-bottom: var(--space-8); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .index :global(a) { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); min-width: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); overflow-wrap: anywhere; }
    .index span { color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--font-size-xs); flex-shrink: 0; }
    section { padding-block: var(--space-8); border-top: 1px solid var(--color-border); scroll-margin-top: calc(var(--space-12) * 3); }
    .section-heading { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); }
    .section-heading > span { color: var(--color-accent); font: var(--font-size-xs) var(--font-mono); }
    h2 { min-width: 0; overflow-wrap: anywhere; }
    h2 small { display: inline-block; margin-inline-start: var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-md); font-weight: var(--font-weight-regular); }
    .note { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-block: var(--space-3); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); margin-block: var(--space-4); }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-block: var(--space-4); }
    .stack { display: grid; gap: var(--space-4); justify-items: start; }
    .stack > :global(*) { max-width: 100%; min-width: 0; }
    .narrow { width: min(100%, calc(var(--space-12) * 8)); margin-block: var(--space-4); overflow-wrap: anywhere; }
    .sample-row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; padding-block: var(--space-3); border-bottom: 1px solid var(--color-border); }
    .sample-row code { width: calc(var(--space-12) * 2); flex-shrink: 0; font-size: var(--font-size-xs); padding: 0; background: none; color: var(--color-text-secondary); }
    .result { font-size: var(--font-size-sm); color: var(--color-text-secondary); overflow-wrap: anywhere; }
    .card-demo { padding: var(--space-4); }
    .grid h3 { margin-bottom: var(--space-2); }
    .grid p { overflow-wrap: anywhere; }
    .menu-row { justify-content: space-between; }
    .error-message { color: var(--color-danger); font-size: var(--font-size-md); }
    .fill { flex: 1; min-width: 0; }
    .small { font-size: var(--font-size-xs); }
    .large { font-size: var(--font-size-2xl); }
    .subheading { font-size: var(--font-size-md); margin-block: var(--space-6) var(--space-3); }
    footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); padding-top: var(--space-6); border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: var(--font-size-xs); }
    @media (max-width: 1023px) { .index { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 639px) {
        .toolbar-inner { padding-inline: var(--space-4); }
        .theme-control { width: 100%; justify-content: space-between; }
        main { padding: var(--space-8) var(--space-4) var(--space-4); }
        .index { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: var(--space-2); }
        .index :global(a) { font-size: var(--font-size-xs); gap: var(--space-1); }
        .grid { grid-template-columns: minmax(0, 1fr); }
        .sample-row code { width: 100%; }
        h2 small { display: block; margin: var(--space-1) 0 0; }
        section { padding-block: var(--space-6); }
    }
</style>
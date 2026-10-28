# 正文 JSON 契约

问题、回答、评论及资料简介共用这份 ProseMirror JSON 白名单。实现位于仓库共用的 `shared/rich-text/index.ts` 与 `types.ts`，不依赖 DOM、Svelte 或 Tiptap；本目录保留原导入入口。后端正文校验与前端直接复用同一个 `validateDoc`，OpenAPI 的结构白名单位于 `shared/rich-text/schema.ts`。本文件和 `fixtures/manifest.json` 记录协议，后端定向测试同时覆盖这些样例。

## 白名单

| 节点 | 内容 | 必须完整给出的属性 |
| --- | --- | --- |
| `doc` | 一个或多个块；只能作为根节点 | 无 |
| `paragraph` | 零个或多个内联节点 | 无 |
| `heading` | 零个或多个内联节点 | `level: 2 \| 3 \| 4` |
| `bulletList` | 一个或多个 `listItem` | 无 |
| `orderedList` | 一个或多个 `listItem` | `start`：正的 JavaScript 安全整数 |
| `listItem` | 第一个子节点必须是 `paragraph`，其后零个或多个块 | 无 |
| `blockquote` | 一个或多个块 | 无 |
| `codeBlock` | 零个或多个无标记 `text` | `language`：下方语言列表中的值或 `null` |
| `horizontalRule` | 叶节点，不接受 `content` | 无 |
| `image` | 块级叶节点，不接受 `content` | `src`：站内路径；`alt`：字符串或 `null` |
| `inlineMath` | 内联叶节点，不接受 `content` | `latex`：字符串 |
| `blockMath` | 块级叶节点，不接受 `content` | `latex`：字符串 |
| `hardBreak` | 内联叶节点，不接受 `content` | 无 |
| `text` | 不接受 `content`，必须有非空字符串 `text` | 无 |

“块”指 `paragraph`、`heading`、`bulletList`、`orderedList`、`blockquote`、`codeBlock`、`horizontalRule`、`image`、`blockMath`。“内联节点”指 `text`、`hardBreak`、`inlineMath`。`listItem` 不能直接放在 `doc` 或 `blockquote` 中。

空段落、空标题及空代码块可以省略 `content`，也可以给出 `content: []`。其他容器必须给出非空 `content` 数组。叶节点即使给出空 `content` 也无效。空文档的规范表示为：

```json
{"type":"doc","content":[{"type":"paragraph"}]}
```

只有内联节点可带可选的 `marks` 数组，空数组允许。支持的标记为 `bold`、`italic`、`strike`、`code`、`link`；同一个内联节点上同类标记不能重复，标记顺序不影响合法性。`code` 必须独占，不可与其他标记共存。代码块内部文本不得带任何标记，省略 `marks` 或给出空数组均可。

无属性标记只允许 `type`。`link` 必须完整给出 `attrs: { href: string }`。不保存 `target`、`rel`、`class`；渲染外部链接时补充 `target="_blank" rel="noopener noreferrer nofollow"` 及外部链接提示。

所有节点、标记、属性都采用严格白名单。节点本身只能含上述 `type`、适用时的 `content` / `attrs` / `marks` / `text`；不能附加 ID、样式或其他字段。无属性节点不能保存 `attrs`，有属性节点必须给出所有属性，不能使用 `undefined` 替代 `null`。未知节点、未知标记、多余字段、错误类型、空文本均校验失败。对象必须是普通 JSON 对象；循环引用无效。

## 属性与 URL

- `heading.level` 只能是数字 `2`、`3`、`4`，不能是字符串。
- `orderedList.start` 在 `1` 到 `Number.MAX_SAFE_INTEGER` 内，不能为小数、无穷大或 `NaN`。
- `href` 只能是完整的 `http://` / `https://` 绝对地址，或以单个 `/` 开头的站内路径。拒绝 `//`、其他协议、相对路径及仅锚点地址。
- URL 不允许原始空白、控制字符或反斜杠；反斜杠会在浏览器 URL 解析中被当作斜杠，因此必须拒绝。站内路径可以包含查询和片段，不改变已有资料或版本链接。
- `normalizeHref` 用于表单输入：先去除首尾空白，再验证；站内路径保持原样，绝对地址经标准 `URL` 规范化（如协议、域名大小写、默认端口和转义）。返回 `null` 表示非法。规范化前后都不得超过 `2048` 个 Unicode 码点。
- `validateDoc` 不修复或改写输入，要求保存的 `href` 没有首尾空白，且可通过上述链接规则。安全但非规范形式的 HTTP(S) 地址可以校验通过，渲染时规范化。
- `image.src` 只能是上述站内路径，最多 `2048` 个码点。外部地址、`data:`、`blob:` 均无效；路径合法不代表服务端授予访问权或文件存在。
- `image.alt` 为 `null` 或最多 `300` 个码点的字符串；空字符串允许，用于装饰性图片。
- `latex` 为最多 `4000` 个码点的字符串；空字符串允许。KaTeX 语法错误不会使 JSON 无效，公式显示错误由渲染器处理。
- 语言固定为 `c`、`cpp`、`java`、`python`、`javascript`、`typescript`、`sql`、`bash`、`json`、`xml`、`css`、`go`、`rust`、`csharp`、`matlab`。HTML 使用 `xml`；不保存 `html`、`js` 等别名。未知或不指定语言时使用 `null`。

## 深度、计数和上限

`RICH_TEXT_LIMITS` 的全部值：

| 常量字段 | 值 | 计算方式 |
| --- | --- | --- |
| `maxChars` | `30000` | 语义 Unicode 码点数 |
| `maxBytes` | `376832`（368 KiB） | 紧凑 JSON 的 UTF-8 字节数 |
| `maxNestingDepth` | `16` | 同一祖先链中 `bulletList`、`orderedList`、`blockquote` 的累计数量 |
| `maxHrefLength` | `2048` | 链接及图片路径的 Unicode 码点数 |
| `maxImageAltChars` | `300` | 图片替代文本码点数 |
| `maxLatexChars` | `4000` | 单个公式源文本码点数 |

深度不单独累计 `listItem`、`paragraph` 或根 `doc`；混合列表与引用共同占用 16 层配额。顶层列表或引用为第 1 层。

语义计数规则如下：`text.text` 按 Unicode 码点数计；公式按 `attrs.latex` 的码点数计；`image`、`hardBreak`、`horizontalRule` 各计 1；其余结构和标记不计。`😀` 计 1；`e` 加组合重音 `\u0301` 计 2；`A😀é` 共计 4。此处不是 UTF-16 长度或用户感知字素数。

字节数与 `new TextEncoder().encode(JSON.stringify(doc)).byteLength` 一致：无缩进、无结尾换行，中文不额外转成 `\u` 转义。传输 JSON 的空格不计入规范化后的正文大小，但 HTTP 请求本身仍须受后端请求体上限约束。内容写请求（问题、回答、评论和正文编辑）整体上限为 384 KiB，剩余 16 KiB 用于标题、标签等；该整体上限不由本模块校验。

后端必须分别检查语义字符数和字节数。仅检查字符数无法限制大量空段落、长链接、标记或图片替代文本占用的空间。实际请求限制、授权、内容状态、图片访问及下架行为仍由服务端负责。

## 纯 TypeScript API

| 导出 | 用途 |
| --- | --- |
| `RichTextDoc`、`RichTextNode`、各节点类型、`RichTextMark` | 严格 JSON 类型；类型声明不代替运行时校验 |
| `RICH_TEXT_LIMITS`、`CODE_LANGUAGES`、`EMPTY_DOC` | 统一上限、语言列表与空文档；需要修改空文档时先克隆 |
| `validateDoc(input: unknown)` | 成功返回 `{ ok: true, doc }`，其中 `doc` 就是原输入；失败返回 `{ ok: false, path, reason }` |
| `countChars(doc)` | 按上述规则返回语义字符数 |
| `isEmptyDoc(doc)` | 只有空结构、空白文本或段内换行时为 `true`；图片、公式、分隔线均为非空 |
| `toPlainText(doc, { maxChars? })` | 块之间换行，段内换行保留；图片为 `[图片]`，公式为 `[公式]`，分隔线为 `—`；超出 `maxChars` 时保留指定码点数后追加 `…`，不拆开代理对 |
| `normalizeHref(href)` | 校验并规范化表单输入；失败返回 `null` |
| `isInternalPath(input)` | 检查安全的站内图片或链接路径，不检查文件存在性 |
| `validateDocStructure(input)` | 仅供编辑器事务筛查；跳过总字符及总字节上限，其余规则与 `validateDoc` 相同；不能用于后端接收正文 |
| `validateNodeShallow(input, { ignoreMarks? })` | 仅检查当前节点的字段、属性及容器形状；成功的子节点仍是 `unknown`，不是已验证完整文档 |
| `validateMark(input)`、`isAllowedChild(parent, child, index)` | 供只读渲染逐个恢复非法节点或标记；不代替完整校验 |

`countChars`、`isEmptyDoc`、`toPlainText` 接收已满足结构约束的文档；遇到不可信 JSON 先验证。`toPlainText.maxChars` 必须为非负安全整数；`0` 在有内容时输出 `…`，省略号不占传入的截断配额。摘要码点数与语义码点数不同，例如公式摘要固定输出 `[公式]`。

`path` 是相对根的路径，例如 `content[3].marks[0].attrs.href`；空字符串表示根文档整体。`reason` 是稳定的机器可读分类：

- 结构或属性：`invalid-type`、`unknown-node`、`unknown-mark`、`unexpected-field`、`missing-field`、`invalid-content`、`invalid-attribute`、`invalid-href`、`invalid-image-src`、`empty-text`、`duplicate-mark`、`exclusive-code-mark`、`invalid-code-content`、`cyclic-content`。
- 文档上限：`nesting-limit`、`character-limit`、`byte-limit`。

属性自身的长度或取值错误使用 `invalid-attribute`（URL 另用 `invalid-href` / `invalid-image-src`）；`path` 区分具体属性。按深度优先顺序返回第一个错误，字节检查在结构及字符检查通过后进行；不要假设一个非法文档只有一种问题。

## 只读渲染与编辑器

`RichText.svelte` 接收 `doc: unknown`，逐节点生成 Svelte 元素。非法节点在当前位置显示“此处内容无法显示”，非法标记被忽略，其他内容保留。不能把容错显示当作请求校验成功。代码高亮与 KaTeX 按需加载，只有 KaTeX 的受限输出可以使用 HTML 插入；只读组件不依赖编辑器代码。

`RichTextEditor.svelte` 使用同一白名单和正文样式，`value` 可绑定为 `RichTextDoc | null`，支持 `placeholder`、`toolbar`、`maxChars`、`uploadImage`、`disabled`、`invalid`、`id`、`describedBy`、`onsubmit`。`uploadImage(file, signal)` 返回 `{ src, alt? }`，真实上传由调用者注入。

任务同时要求“输出始终通过 `validateDoc`”与“超限仍允许输入”。因此编辑器保留正在输入的超限文本，但当前内容不符合完整契约时将绑定值置为 `null`，不发布非法文档，也不继续暴露旧的合法正文。补充 `onstatechange({ chars, valid, reason, uploading })` 供页面判断提交状态：结构及合同上限通过、未超过页面 `maxChars` 且无正在上传图片时才为有效。页面 `maxChars` 比合同上限更小时，正文仍可保持合法绑定值，但状态为无效。页面应同时检查状态与绑定值，并自行决定是否提交；不要把 `null` 当作一次有效的空正文提交。

## 可复用样例

`fixtures/manifest.json` 列出全部 JSON 样例、中文说明、预期 `ok`、失败 `reason/path` 或成功 `chars`。`valid-all-nodes.json` 适合预览与跨端一致性测试；`valid-unicode.json` 固定验证 emoji 和组合字符的计数。包含所有白名单外输入、属性缺失、非法链接和图片、列表形状、代码标记、16/17 层边界、30000/30001 字符边界及独立字节超限样例。

`invalid-byte-limit.json` 的紧凑 JSON 恰好为 `376833` 字节，字符数仍小于 `30000`，用于避免把两项上限混淆。测试时按 JSON 文档读取，不对已超限样例进行压缩或修复；如后端序列化行为不同，应先对照这里的规范化计数规则。文档合法性与只读容错渲染的行为是两项独立断言。

Node 24+ 可以直接验证样例，无需 DOM 或编辑器依赖：

```js
import { readFile } from 'node:fs/promises';
import { validateDoc } from './index.ts';

const doc = JSON.parse(await readFile(new URL('./fixtures/valid-all-nodes.json', import.meta.url), 'utf8'));
console.log(validateDoc(doc));
```
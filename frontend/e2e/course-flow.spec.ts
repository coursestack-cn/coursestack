import { expect, test, type Browser, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";

// Demo data from `pnpm demo`: T0001 teaches 304208040 in the current term with S0001–S0050.
const course = { code: "304208040", name: "数据库系统原理" };
const teacher = { number: "T0001", nickname: "演示教师 001" };
// Not in this course's class until the teacher imports them.
const uploader = { number: "S0051", nickname: "演示同学 051" };
const answerer = { number: "S0002", nickname: "演示同学 002" };

type Account = typeof teacher;

/** A small valid RGB PNG. Different sizes give different byte lengths for telling versions apart. */
function png(size: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        checksum.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    const rows = Array.from({ length: size }, (_, y) => Buffer.from([0, ...Array.from({ length: size * 3 }, (_, x) => (x * 37 + y * 91) % 256)]));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

async function signIn(browser: Browser, account: Account): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("学工号").fill(account.number);
    await page.getByLabel("密码").fill(account.number);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("button", { name: `${account.nickname}的用户菜单` })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    return page;
}

async function chooseFile(page: Page, name: string, buffer: Buffer) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "选择上传文件" }).click();
    await (await chooser).setFiles({ name, mimeType: "image/png", buffer });
}

/** The value shown next to a term such as “版本” or “大小” in the material's file summary. */
function fileFact(page: Page, term: string) {
    return page.getByRole("region", { name: "文件" }).locator("dl > div")
        .filter({ has: page.getByRole("term").filter({ hasText: new RegExp(`^${term}$`) }) })
        .getByRole("definition");
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("course integration flow: roster, material, versioned question, acceptance, bonus and notifications", async ({ browser }) => {
    const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const materialTitle = `E2E 讲义 ${run}.png`;
    const questionTitle = `E2E 引用资料提问 ${run}`;
    const answerText = `E2E 回答 ${run}：先看第 1 版的第二页。`;
    const versionOne = png(2), versionTwo = png(12);
    expect(versionOne.length).not.toBe(versionTwo.length);
    let acceptancePoints = 0;

    const teacherPage = await signIn(browser, teacher);
    const uploaderPage = await signIn(browser, uploader);
    const answererPage = await signIn(browser, answerer);
    let materialPath = "";
    let questionPath = "";

    try {
        await test.step("teacher imports a student into the class roster", async () => {
            const page = teacherPage;
            await page.goto(`/courses/${course.code}`);
            await page.getByRole("link", { name: "管理课程" }).click();
            await expect(page).toHaveURL(new RegExp(`/manage/courses/${course.code}/classes/[^/]+/[^/]+/students`));
            await expect(page.getByRole("heading", { level: 1, name: course.name })).toBeVisible();
            await expect(page.getByRole("table", { name: "教学班学生名单" })).toBeVisible();

            await page.getByRole("button", { name: "添加学生" }).click();
            const dialog = page.getByRole("dialog", { name: "添加学生" });
            await dialog.getByLabel("学号").fill(uploader.number);
            await expect(dialog.getByRole("status")).toHaveText("共1个学号。");
            await dialog.getByRole("button", { name: "导入" }).click();
            // A fresh reset adds the student; a rerun against the same state reports them as already enrolled.
            await expect(dialog.getByRole("status")).toHaveText(/^(新增1人，已在本班0人|新增0人，已在本班1人)，失败0人。$/);
            await dialog.getByRole("button", { name: "完成" }).click();
            await expect(dialog).toBeHidden();
            await expect(page.getByRole("tab", { name: /学生名单/ })).toContainText("51");
        });

        await test.step("teacher sets a nonzero acceptance reward in the class bonus policy", async () => {
            const page = teacherPage;
            await page.getByRole("button", { name: "加分规则" }).click();
            const dialog = page.getByRole("dialog", { name: "加分规则" });
            const field = dialog.getByLabel("回答被采纳");
            // Demo classes start at 0. Saving requires a change, so a rerun on the same state picks the other value.
            acceptancePoints = await field.inputValue() === "5" ? 6 : 5;
            await field.fill(String(acceptancePoints));
            await dialog.getByRole("button", { name: "保存" }).click();
            await expect(dialog).toBeHidden();
        });

        await test.step("imported student uploads a material file", async () => {
            const page = uploaderPage;
            await page.goto(`/courses/${course.code}`);
            await page.getByRole("link", { name: "上传资料" }).click();
            await expect(page).toHaveURL(new RegExp(`/courses/${course.code}/materials/new$`));
            await chooseFile(page, "lecture-v1.png", versionOne);
            await page.getByLabel("文件名").fill(materialTitle);
            await page.getByRole("button", { name: "发布资料" }).click();

            await page.waitForURL(url => /^\/materials\/[^/]+$/.test(url.pathname));
            materialPath = new URL(page.url()).pathname;
            await expect(page.getByRole("heading", { level: 1, name: materialTitle })).toBeVisible();
            await expect(fileFact(page, "版本")).toHaveText("1");
            await expect(fileFact(page, "大小")).toHaveText(`${versionOne.length} B`);
        });

        const versionLink = () => `${materialPath}/versions/1`;

        await test.step("the uploader asks a question that links to material version 1", async () => {
            const page = uploaderPage;
            await page.goto(`/courses/${course.code}`);
            await page.getByRole("link", { name: "提出问题" }).click();
            await page.getByLabel("问题标题").fill(questionTitle);
            const body = page.getByRole("textbox", { name: "问题正文" });
            await body.click();
            await page.keyboard.type("请看资料第 1 版：");
            await page.getByRole("toolbar", { name: "正文格式" }).getByRole("button", { name: "链接", exact: true }).click();
            const dialog = page.getByRole("dialog", { name: "插入链接" });
            await dialog.getByLabel("链接地址").fill(versionLink());
            await dialog.getByRole("button", { name: "应用链接" }).click();
            await expect(body.getByRole("link", { name: versionLink() })).toBeVisible();
            await page.getByRole("button", { name: "发布问题" }).click();

            await page.waitForURL(url => /^\/questions\/[^/]+$/.test(url.pathname));
            questionPath = new URL(page.url()).pathname;
            await expect(page.getByRole("heading", { level: 1, name: questionTitle })).toBeVisible();
            await expect(page.getByRole("link", { name: versionLink() })).toHaveAttribute("href", versionLink());
            await expect(page.getByText("未解决", { exact: true })).toBeVisible();
        });

        await test.step("another student answers", async () => {
            const page = answererPage;
            await page.goto(questionPath);
            await expect(page.getByRole("heading", { level: 1, name: questionTitle })).toBeVisible();
            await page.getByRole("textbox", { name: "发布回答" }).click();
            await page.keyboard.type(answerText);
            await page.getByRole("button", { name: "发布回答" }).click();
            await expect(page.getByRole("heading", { name: "1 个回答" })).toBeVisible();
            await expect(page.getByRole("region", { name: "回答列表" }).getByText(answerText)).toBeVisible();
        });

        await test.step("teacher accepts the answer and the question shows solved", async () => {
            const page = teacherPage;
            await page.goto(questionPath);
            const answers = page.getByRole("region", { name: "回答列表" });
            await expect(answers.getByText(answerText)).toBeVisible();
            await answers.getByRole("button", { name: "采纳此回答" }).click();
            await expect(answers.getByRole("button", { name: "取消采纳此回答" })).toBeVisible();
            await expect(answers.getByText("已采纳", { exact: true })).toBeVisible();
            await expect(page.getByText("已解决", { exact: true })).toBeVisible();

            await uploaderPage.goto(questionPath);
            await expect(uploaderPage.getByText("已解决", { exact: true })).toBeVisible();
        });

        await test.step("the answerer is notified and sees the acceptance bonus in the course history", async () => {
            const page = answererPage;
            await page.goto("/notifications");
            await expect(page.getByRole("heading", { name: "你的回答已被采纳" }).first()).toBeVisible();
            const bonusNotice = page.getByRole("article")
                .filter({ has: page.getByRole("heading", { name: `你的课程积分已调整：+${acceptancePoints} 分` }) }).first();
            await expect(bonusNotice).toContainText(course.name);
            await bonusNotice.getByRole("button", { name: "查看加分历史" }).click();

            await expect(page).toHaveURL(new RegExp(`/courses/${course.code}\\?.*bonus=history`));
            const history = page.getByRole("dialog", { name: "我的加分历史" });
            const record = history.getByRole("list", { name: "我的加分记录" }).getByRole("listitem")
                .filter({ hasText: "回答被采纳" }).filter({ hasText: `+${acceptancePoints} 分` });
            await expect(record.first()).toBeVisible();
        });

        await test.step("the asker is notified about the new answer", async () => {
            const page = uploaderPage;
            await page.goto("/notifications");
            await expect(page.getByRole("heading", { name: "你的问题收到了新回答" }).first()).toBeVisible();
        });

        await test.step("the uploader publishes version 2 and the version 1 link still opens version 1", async () => {
            const page = uploaderPage;
            await page.goto(materialPath);
            await page.getByRole("link", { name: "上传新版本" }).click();
            await expect(page.getByRole("heading", { level: 1, name: "上传新版本" })).toBeVisible();
            await chooseFile(page, "lecture-v2.png", versionTwo);
            await page.getByRole("button", { name: "发布新版本" }).click();

            await expect(page).toHaveURL(new RegExp(`${escapeRegExp(materialPath)}$`));
            await expect(fileFact(page, "版本")).toHaveText("2");
            await expect(fileFact(page, "大小")).toHaveText(`${versionTwo.length} B`);

            await page.goto(questionPath);
            const link = page.getByRole("link", { name: versionLink() });
            await expect(link).toHaveAttribute("href", versionLink());
            await link.click();
            await expect(page).toHaveURL(new RegExp(`${escapeRegExp(materialPath)}\\?version=1$`));
            await expect(page.getByRole("combobox", { name: "文件版本" })).toHaveValue("1");
            await expect(fileFact(page, "版本")).toHaveText("1");
            await expect(fileFact(page, "大小")).toHaveText(`${versionOne.length} B`);
        });
    } finally {
        for (const page of [teacherPage, uploaderPage, answererPage]) await page.context().close();
    }
});
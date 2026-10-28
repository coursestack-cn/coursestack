import type { Route } from "$lib/router/types";

export const routes: readonly Route[] = [
    { path: "/", title: "首页", requiresAuth: false, load: () => import("../../pages/courses/HomePage.svelte") },
    { path: "/courses", title: "全部课程", requiresAuth: false, load: () => import("../../pages/courses/CourseListPage.svelte") },
    { path: "/courses/:courseCode", title: "课程主页", layout: "course", requiresAuth: false, load: () => import("../../pages/courses/CoursePage.svelte") },
    { path: "/courses/:courseCode/materials", title: "课程资料", layout: "course", requiresAuth: false, load: () => import("../../pages/materials/MaterialListPage.svelte") },
    { path: "/courses/:courseCode/questions", title: "课程问答", layout: "course", requiresAuth: false, load: () => import("../../pages/questions/QuestionListPage.svelte") },
    { path: "/materials/:materialId", title: "资料详情", requiresAuth: false, load: () => import("../../pages/materials/MaterialPage.svelte") },
    { path: "/materials/:materialId/versions/:versionId", title: "资料版本", requiresAuth: false, load: () => import("../../pages/materials/MaterialVersionPage.svelte") },
    { path: "/questions/:questionId", title: "问题详情", requiresAuth: false, load: () => import("../../pages/questions/QuestionPage.svelte") },
    { path: "/answers/:answerId", title: "定位回答", requiresAuth: false, load: () => import("../../pages/questions/AnswerRedirectPage.svelte") },
    { path: "/comments/:commentId", title: "定位评论", requiresAuth: false, load: () => import("../../pages/questions/CommentRedirectPage.svelte") },
    { path: "/search", title: "搜索", requiresAuth: false, load: () => import("../../pages/search/SearchPage.svelte") },
    { path: "/login", title: "成员登录", requiresAuth: false, load: () => import("../../pages/account/LoginPage.svelte") },
    { path: "/courses/:courseCode/materials/new", title: "上传资料", layout: "course", requiresAuth: true, load: () => import("../../pages/materials/MaterialUploadPage.svelte") },
    { path: "/materials/:materialId/edit", title: "编辑资料", requiresAuth: true, load: () => import("../../pages/materials/MaterialEditPage.svelte") },
    { path: "/materials/:materialId/versions/new", title: "发布新版本", requiresAuth: true, load: () => import("../../pages/materials/MaterialNewVersionPage.svelte") },
    { path: "/courses/:courseCode/questions/new", title: "提出问题", requiresAuth: true, load: () => import("../../pages/questions/QuestionNewPage.svelte") },
    { path: "/questions/:questionId/edit", title: "编辑问题", requiresAuth: true, load: () => import("../../pages/questions/QuestionEditPage.svelte") },
    { path: "/me/materials", title: "我的资料", requiresAuth: true, load: () => import("../../pages/me/MyMaterialsPage.svelte") },
    { path: "/me/questions", title: "我的提问", requiresAuth: true, load: () => import("../../pages/me/MyQuestionsPage.svelte") },
    { path: "/me/answers", title: "我的回答", requiresAuth: true, load: () => import("../../pages/me/MyAnswersPage.svelte") },
    { path: "/me/favorites", title: "我的收藏", requiresAuth: true, load: () => import("../../pages/me/FavoritesPage.svelte") },
    { path: "/notifications", title: "通知", requiresAuth: true, load: () => import("../../pages/me/NotificationsPage.svelte") },
    { path: "/settings/password", title: "修改密码", requiresAuth: true, load: () => import("../../pages/account/PasswordPage.svelte") },
    { path: "/settings", title: "个人设置", requiresAuth: true, load: () => import("../../pages/account/SettingsPage.svelte") },
    { path: "/courses/new", title: "新建课程", requiresAuth: true, load: () => import("../../pages/courses/CourseNewPage.svelte") },
    { path: "/courses/:courseCode/manage", title: "课程管理", layout: "course", requiresAuth: true, load: () => import("../../pages/manage/CourseManagePage.svelte") },
    { path: "/courses/:courseCode/manage/info", title: "课程信息", layout: "course", requiresAuth: true, load: () => import("../../pages/manage/CourseInfoPage.svelte") },
    { path: "/courses/:courseCode/manage/teachers", title: "授课教师", layout: "course", requiresAuth: true, load: () => import("../../pages/manage/CourseTeachersPage.svelte") },
    { path: "/courses/:courseCode/manage/roster", title: "学生名单", layout: "course", requiresAuth: true, load: () => import("../../pages/manage/CourseRosterPage.svelte") },
    { path: "/courses/:courseCode/manage/scoring", title: "课程加分", layout: "course", requiresAuth: true, load: () => import("../../pages/manage/CourseScoringPage.svelte") },
    { path: "/courses/:courseCode/manage/reports", title: "举报处理", layout: "course", requiresAuth: true, load: () => import("../../pages/manage/CourseReportsPage.svelte") },
    { path: "/admin/login", title: "管理员登录", requiresAuth: false, load: () => import("../../pages/account/AdminLoginPage.svelte") },
    { path: "/admin", title: "账号管理", requiresAuth: true, load: () => import("../../pages/admin/AdminAccountsPage.svelte") },
    { path: "/admin/accounts", title: "账号管理", requiresAuth: true, load: () => import("../../pages/admin/AdminAccountsPage.svelte") },
    { path: "/admin/courses", title: "课程管理", requiresAuth: true, load: () => import("../../pages/admin/AdminCoursesPage.svelte") },
    { path: "/admin/*", title: "管理端", requiresAuth: true, load: () => import("../../pages/admin/AdminPage.svelte") }
];

export const notFoundRoute: Route = {
    path: "*",
    title: "页面未找到",
    requiresAuth: false,
    load: () => import("../../pages/NotFoundPage.svelte")
};
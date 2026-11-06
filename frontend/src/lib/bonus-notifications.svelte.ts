import { api } from "$lib/api/client";
import { bonusHistoryHref, bonusSourceLabel, signedPoints, type BonusEvents, type BonusRecord } from "$lib/bonus";
import { toast } from "$lib/components/ui/toast.svelte.js";
import { navigate } from "$lib/router/router.svelte.js";
import { session } from "$lib/session.svelte.js";

let revision = $state(0);
export const bonusUpdates = { get revision() { return revision; } };
const cursors = new Map<string, number>();
const interval = 15_000;

function readCursor(key: string): number | undefined {
    let cursor = cursors.get(key);
    try {
        const value = localStorage.getItem(key);
        if (value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
            cursor = Math.max(cursor ?? 0, Number(value));
        }
    } catch { /* Keep notifications working when browser storage is unavailable. */ }
    return cursor;
}

function saveCursor(key: string, cursor: number) {
    cursors.set(key, cursor);
    try { localStorage.setItem(key, String(cursor)); } catch { /* The in-memory cursor still prevents replays in this tab. */ }
}

// Called once during App initialization; the effect follows the authenticated account.
export function watchBonusNotifications() {
    $effect(() => {
        const user = session.user;
        if (session.status !== "authenticated" || user?.role !== "student" || user.mustChangePassword) return;
        const userId = user.id, key = `coursestack:bonus-cursor:${userId}`;
        const controller = new AbortController(), toastIds = new Set<number>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let busy = false;
        const current = () => !controller.signal.aborted && session.user?.id === userId;

        function announce(records: BonusRecord[]) {
            if (records.length) revision++;
            const groups = new Map<string, BonusRecord[]>();
            for (const record of records) {
                if (record.operatorId !== userId) continue;
                const groupKey = JSON.stringify([record.courseId, record.termId]);
                const group = groups.get(groupKey) ?? [];
                group.push(record);
                groups.set(groupKey, group);
            }
            for (const group of groups.values()) {
                const record = group[0]!;
                const points = group.reduce((total, item) => total + item.deltaPoints, 0);
                const description = group.length === 1 ? `${bonusSourceLabel(record)}，${signedPoints(points)} 分`
                    : `${group.length} 笔积分变动，合计 ${signedPoints(points)} 分`;
                const notify = points > 0 ? toast.success : toast.info;
                toastIds.add(notify(`${record.courseName} · ${record.termName}：${description}`, {
                    action: { label: "查看历史", onclick: () => {
                        if (current()) void navigate(bonusHistoryHref(record.courseId, record.termId));
                    } }
                }));
            }
        }

        async function poll() {
            if (!current() || document.visibilityState !== "visible" || busy) return;
            clearTimeout(timer);
            busy = true;
            let delay = interval;
            async function receive() {
                if (!current() || document.visibilityState !== "visible") return;
                const afterId = readCursor(key);
                const query = afterId === undefined ? "" : `?afterId=${afterId}&pageSize=50`;
                const result = await api.get<BonusEvents>(`/api/me/bonus-events${query}`, { signal: controller.signal });
                if (!current() || document.visibilityState !== "visible") return;
                const seen = readCursor(key) ?? afterId ?? result.nextCursor;
                announce(result.items.filter(record => record.id > seen));
                saveCursor(key, Math.max(seen, result.nextCursor));
                if (result.hasMore) delay = 500;
            }
            try {
                // Coordinate visible tabs without making a second tab wait behind a slow request.
                if (navigator.locks) await navigator.locks.request(key, { ifAvailable: true }, async lock => { if (lock) await receive(); });
                else await receive();
            } catch { /* Background failures retry without interrupting the current page. */ }
            finally {
                busy = false;
                if (current() && document.visibilityState === "visible") timer = setTimeout(() => { void poll(); }, delay);
            }
        }

        function wake() {
            if (document.visibilityState === "visible") void poll();
            else clearTimeout(timer);
        }
        function synchronize(event: StorageEvent) {
            if (event.key === key && current()) revision++;
        }
        void poll();
        document.addEventListener("visibilitychange", wake);
        window.addEventListener("focus", wake);
        window.addEventListener("online", wake);
        window.addEventListener("storage", synchronize);
        return () => {
            controller.abort();
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", wake);
            window.removeEventListener("focus", wake);
            window.removeEventListener("online", wake);
            window.removeEventListener("storage", synchronize);
            toastIds.forEach(id => toast.dismiss(id));
        };
    });
}
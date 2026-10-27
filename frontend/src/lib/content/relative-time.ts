export type FormattedTime = { label: string; datetime: string | undefined; title: string };

const completeDate = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "short",
});

function clock(date: Date): string {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Uses the viewer's local calendar; timestamps are Unix seconds, now is milliseconds. */
export function formatRelativeTime(timestamp: number, now = Date.now()): FormattedTime {
    const date = new Date(timestamp * 1000);
    const current = new Date(now);
    if (!Number.isFinite(timestamp) || !Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) {
        return { label: "时间未知", datetime: undefined, title: "时间未知" };
    }

    const elapsed = (now - date.getTime()) / 1000;
    let label: string;
    if (elapsed >= -60 && elapsed < 60) label = "刚刚";
    else if (elapsed >= 60 && elapsed < 3600) label = `${Math.floor(elapsed / 60)} 分钟前`;
    else if (elapsed >= 3600 && elapsed < 86400) label = `${Math.floor(elapsed / 3600)} 小时前`;
    else {
        const yesterday = new Date(current);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) {
            label = `昨天 ${clock(date)}`;
        } else if (date.getFullYear() === current.getFullYear()) {
            label = `${date.getMonth() + 1}月${date.getDate()}日`;
        } else label = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return { label, datetime: date.toISOString(), title: completeDate.format(date) };
}
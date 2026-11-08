/** Format file sizes in IEC binary units. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
    if (bytes < 1024) return `${Math.floor(bytes)} B`;
    const units = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
    let amount = bytes / 1024;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) {
        amount /= 1024;
        index += 1;
    }
    const rounded = Math.round(amount * 10) / 10;
    if (rounded >= 1024 && index < units.length - 1) return `1 ${units[index + 1]}`;
    return `${rounded} ${units[index]}`;
}
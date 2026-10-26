export const surfaceColors = ["bg", "surface", "surface-sunken", "border", "border-strong"];
export const textColors = ["text", "text-secondary", "text-muted"];
export const utilityColors = ["accent-hover", "focus-ring", "overlay", "selection"];
export const semanticRoles = ["accent", "success", "warning", "danger", "teacher"];

export const colorNames = [
    ...surfaceColors,
    ...textColors,
    ...utilityColors,
    ...semanticRoles.flatMap((role) => [role, `on-${role}`, `${role}-soft`, `${role}-soft-text`])
];

export interface ColorValue {
    css: string;
    label: string;
    luminance: number;
}

export interface ContrastPair {
    foreground: string;
    background: string;
    minimum: number;
}

export const contrastPairs: ContrastPair[] = [
    ...textColors.flatMap((foreground) => ["bg", "surface", "surface-sunken"].map((background) => ({
        foreground,
        background,
        minimum: foreground === "text-muted" ? 3 : 4.5
    }))),
    ...["accent", "accent-hover"].flatMap((foreground) => ["bg", "surface", "surface-sunken"].map((background) => ({
        foreground,
        background,
        minimum: 4.5
    }))),
    { foreground: "text", background: "selection", minimum: 4.5 },
    // Not text contrast: the selection highlight must stay visible against the page.
    { foreground: "selection", background: "bg", minimum: 1.3 },
    ...semanticRoles.flatMap((role) => [
        { foreground: `on-${role}`, background: role, minimum: 4.5 },
        { foreground: `${role}-soft-text`, background: `${role}-soft`, minimum: 4.5 }
    ])
];

// Resolve light-dark() through a rendered property, then normalize any CSS color
// syntax to sRGB. Reading a custom property alone can retain light-dark().
export function readColors(): Record<string, ColorValue> {
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        throw new Error("无法读取颜色：浏览器未提供 Canvas 2D。");
    }

    document.body.append(probe);
    try {
        return Object.fromEntries(colorNames.map((name) => {
            probe.style.color = `var(--color-${name})`;
            const css = getComputedStyle(probe).color;
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = css;
            context.fillRect(0, 0, 1, 1);
            const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
            const channels = [red!, green!, blue!];
            const linear = channels.map((channel) => {
                const value = channel / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            const label = alpha === 255
                ? `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`
                : css;
            return [name, {
                css,
                label,
                luminance: 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
            }];
        }));
    } finally {
        probe.remove();
    }
}

export function contrastRatio(foreground: ColorValue, background: ColorValue): number {
    return (Math.max(foreground.luminance, background.luminance) + 0.05)
        / (Math.min(foreground.luminance, background.luminance) + 0.05);
}
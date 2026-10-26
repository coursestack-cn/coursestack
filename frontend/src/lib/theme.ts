export type ThemePreference = "system" | "light" | "dark";

const storageKey = "coursestack-theme";

export function getThemePreference(): ThemePreference {
    try {
        const preference = localStorage.getItem(storageKey);
        return preference === "light" || preference === "dark" ? preference : "system";
    } catch {
        return "system";
    }
}

export function setThemePreference(preference: ThemePreference): void {
    if (preference === "system") {
        document.documentElement.removeAttribute("data-theme");
    } else {
        document.documentElement.setAttribute("data-theme", preference);
    }

    try {
        localStorage.setItem(storageKey, preference);
    } catch {
        // The current page can still switch themes when storage is unavailable.
    }
}
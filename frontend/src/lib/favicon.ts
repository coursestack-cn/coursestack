const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

if (favicon) {
    // This browser preference may inherit the OS theme; it is independent of the page theme.
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateFavicon = () => {
        favicon.href = colorScheme.matches ? "/favicon-white-trs.ico" : "/favicon-black-trs.ico";
    };

    updateFavicon();
    colorScheme.addEventListener("change", updateFavicon);
    import.meta.hot?.dispose(() => colorScheme.removeEventListener("change", updateFavicon));
}